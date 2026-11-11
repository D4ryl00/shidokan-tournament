import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { categories, frozenPassages } from '../../src/server/db/schema.js';
import { launchStatus, numberPending } from '../../src/server/repositories/launches.js';
import { passagePlan, planInput } from '../../src/server/repositories/passages.js';
import { RegistrationValidationError } from '../../src/server/repositories/registrations.js';
import { assertFinalsEditable, listWaveFinals, setCategoryFinals, setFinalsZone } from '../../src/server/repositories/wave-finals.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let db: AppDb;
let id: string;
let base: string;
beforeEach(async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${id}`;
  db = openDb(dbPath);
});
afterEach(async () => {
  closeDb(db);
  await app.close();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
const register = async (count: number, over: object) => {
  for (let i = 0; i < count; i++) {
    await call('POST', '/registrations', { clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...over });
  }
};
type Cat = { id: string; label: string };

/** Session « Matin » (cadettes -54 et kata, Tatami 1) et « Après-midi » (minimes -45), deux zones, rien de lancé. */
async function setup() {
  await register(4, { ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
  await register(3, { ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null });
  await register(2, { ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  const [matin, aprem] = (await call('PUT', '/waves', [
    { name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['minime'], disciplines: [] } },
  ])).json() as { id: string }[];
  const [t1, t2] = ((await call('GET', '/zones')).json() as { id: string }[]).map((z) => z.id) as [string, string];
  const cats = (await call('GET', '/categories')).json() as Cat[];
  const of = (s: string) => cats.find((c) => c.label.includes(s))!.id;
  return { matin: matin!.id, aprem: aprem!.id, t1, t2, a54: of('-54'), kata: of('Kata'), m45: of('-45') };
}
const stored = (categoryId: string) => db.select({ where: categories.finalsWhere, when: categories.finalsWhen }).from(categories).where(eq(categories.id, categoryId)).get();
const waveOf = (waveKey: string) => listWaveFinals(db, id).find((w) => w.waveKey === waveKey);

describe('finales par session', () => {
  test('choisir une zone des finales remet « Où » à la valeur de la session, pour cette session seulement', async () => {
    const s = await setup();
    await setCategoryFinals(db, id, s.matin, { categoryIds: [s.a54, s.kata], where: 'own', when: 'ready' });
    await setCategoryFinals(db, id, s.aprem, { categoryIds: [s.m45], where: 'own' });
    await setFinalsZone(db, id, s.matin, s.t2);
    expect(waveOf(s.matin)).toEqual({ waveKey: s.matin, finalsZoneId: s.t2, whereDefault: 'finals', whenDefault: null });
    expect(stored(s.a54)).toEqual({ where: null, when: 'ready' });
    expect(stored(s.kata)).toEqual({ where: null, when: 'ready' });
    expect(stored(s.m45)).toEqual({ where: 'own', when: null });
    expect(waveOf(s.aprem)).toBeUndefined();
    // « Aucune » : la zone disparaît, le reste est gardé.
    await setFinalsZone(db, id, s.matin, null);
    expect(waveOf(s.matin)).toEqual({ waveKey: s.matin, finalsZoneId: null, whereDefault: 'finals', whenDefault: null });
  });

  test('« Tout… » (sans catégories) : toutes les catégories de la session et les valeurs de la session', async () => {
    const s = await setup();
    await setCategoryFinals(db, id, s.matin, { where: 'own', when: 'end' });
    expect(waveOf(s.matin)).toEqual({ waveKey: s.matin, finalsZoneId: null, whereDefault: 'own', whenDefault: 'end' });
    expect(stored(s.a54)).toEqual({ where: 'own', when: 'end' });
    expect(stored(s.kata)).toEqual({ where: 'own', when: 'end' });
    expect(stored(s.m45)).toEqual({ where: null, when: null });
    await setCategoryFinals(db, id, s.matin, { when: 'ready' });
    expect(waveOf(s.matin)).toMatchObject({ whereDefault: 'own', whenDefault: 'ready' });
    expect(stored(s.a54)).toEqual({ where: 'own', when: 'ready' });
  });

  test('refus : session inconnue, zone ou catégorie étrangère à la session', async () => {
    const s = await setup();
    await expect(setFinalsZone(db, id, null, s.t2)).rejects.toThrow(RegistrationValidationError);
    await expect(setFinalsZone(db, id, 'inconnue', s.t2)).rejects.toThrow(RegistrationValidationError);
    await expect(setFinalsZone(db, id, s.matin, 'inconnue')).rejects.toThrow(RegistrationValidationError);
    await expect(setCategoryFinals(db, id, s.matin, { categoryIds: [s.m45], where: 'own' })).rejects.toThrow(RegistrationValidationError);
    expect(stored(s.m45)).toEqual({ where: null, when: null });
  });

  test('session lancée : finales en lecture seule ; rouverte : modifiables', async () => {
    const s = await setup();
    for (const c of [s.a54, s.kata]) await call('PATCH', `/categories/${c}`, { status: 'ready', zoneId: s.t1 });
    expect((await call('POST', '/launch', { waveId: s.matin })).statusCode).toBe(204);
    const refused = 'Session figée : rouvrez-la dans Combats pour changer les finales.';
    expect(() => assertFinalsEditable(db, id, s.matin)).toThrow(refused);
    await expect(setFinalsZone(db, id, s.matin, s.t2)).rejects.toThrow(refused);
    await expect(setCategoryFinals(db, id, s.matin, { when: 'end' })).rejects.toThrow(refused);
    expect(() => assertFinalsEditable(db, id, s.aprem)).not.toThrow();
    expect((await call('POST', '/launch/reopen', { waveId: s.matin })).statusCode).toBe(204);
    expect(() => assertFinalsEditable(db, id, s.matin)).not.toThrow();
  });

  test('zone des finales supprimée : plus de zone des finales, le plan se calcule', async () => {
    const s = await setup();
    await setFinalsZone(db, id, s.matin, s.t2);
    expect((await call('PUT', '/zones', [{ id: s.t1, name: 'Tatami 1' }])).statusCode).toBe(200);
    expect(waveOf(s.matin)?.finalsZoneId).toBeNull();
    await expect(passagePlan(db, id)).resolves.toMatchObject({ impossible: [] });
  });
});

describe('plan de passage', () => {
  test('lit la zone des finales des sessions, les choix des catégories et les durées', async () => {
    const s = await setup();
    await setFinalsZone(db, id, s.matin, s.t2);
    await setCategoryFinals(db, id, s.matin, { categoryIds: [s.kata], when: 'ready' });
    await call('PATCH', `/categories/${s.m45}`, { durations: { bracket: { rounds: 1, roundSec: 100, restSec: 0, overtimeSec: 0 }, matches: {} } });
    const input = await planInput(db, id);
    expect(input.waveFinals).toEqual([{ waveKey: s.matin, finalsZoneId: s.t2, whereDefault: 'finals', whenDefault: null }]);
    const cat = (cid: string) => input.categories.find((c) => c.id === cid)!;
    expect(cat(s.kata).finals).toEqual({ where: null, when: 'ready' });
    expect(cat(s.a54).finals).toEqual({ where: null, when: null });
    const duration = input.durationSec!;
    // Cadettes : 2 rounds de 2 min, 1 min de repos ; plus 1 min de changement.
    expect(duration(s.a54, 'w1-0')).toBe(2 * 120 + 60 + 60);
    // Durée propre au tableau.
    expect(duration(s.m45, 'w1-0')).toBe(100 + 60);
    // Kata de 3 : bloc entier (3 passages + finale à 2), tour 1, finale ; 1 min 30 par passage.
    expect(duration(s.kata, null)).toBe(5 * 90 + 60);
    expect(duration(s.kata, 'kata:tour1')).toBe(3 * 90 + 60);
    expect(duration(s.kata, 'kata:finale')).toBe(2 * 90 + 60);
  });
});

describe('figeage', () => {
  test('les numéros figés gardent le choix des finales ; le changer rend la catégorie à numéroter', async () => {
    const s = await setup();
    await setFinalsZone(db, id, s.matin, s.t2);
    for (const c of [s.a54, s.kata]) await call('PATCH', `/categories/${c}`, { status: 'ready', zoneId: s.t1 });
    expect((await call('POST', '/launch', { waveId: s.matin })).statusCode).toBe(204);
    const choices = () => new Set(db.select({ categoryId: frozenPassages.categoryId, finalsChoice: frozenPassages.finalsChoice }).from(frozenPassages).all().map((r) => `${r.categoryId}=${r.finalsChoice}`));
    expect(choices()).toEqual(new Set([`${s.a54}=${s.t2}|end`, `${s.kata}=${s.t2}|end`]));
    expect((await launchStatus(db, id, s.matin)).pending).toEqual([]);

    expect((await call('POST', '/launch/reopen', { waveId: s.matin })).statusCode).toBe(204);
    await setCategoryFinals(db, id, s.matin, { categoryIds: [s.a54], when: 'ready' });
    expect((await launchStatus(db, id, s.matin)).pending.map((p) => p.categoryId)).toEqual([s.a54]);
    await numberPending(db, id, s.matin, undefined, false, 'shuffle');
    expect(choices()).toEqual(new Set([`${s.a54}=${s.t2}|ready`, `${s.kata}=${s.t2}|end`]));
    expect((await launchStatus(db, id, s.matin)).pending).toEqual([]);
  });
});
