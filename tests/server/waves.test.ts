import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

type Wave = { id: string; name: string; order: number; rules: { ageBandCodes: string[]; disciplines: string[] }; weighInClosed: boolean };
type Cat = { id: string; label: string; waveId: string | null; waveOverride: string | null };
const MATIN = { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } };
const APREM = { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior', 'v1', 'v2', 'v3', 'v4', 'v5'], disciplines: [] } };
const waves = async () => (await app.inject({ method: 'GET', url: `${base}/waves` })).json() as Wave[];
const putWaves = (payload: object) => app.inject({ method: 'PUT', url: `${base}/waves`, payload });
const cats = async () => (await app.inject({ method: 'GET', url: `${base}/categories` })).json() as Cat[];
const reg = (ageBandCode: string, weightClassId: string, lastName: string, source = 'manual') =>
  app.inject({ method: 'POST', url: `${base}/registrations`, payload: {
    clubId: null, lastName, firstName: 'x', sex: 'F', ageBandCode, discipline: 'karate', ruleset: 'jiyu', weightClassId, source,
  } });

test('créer, renommer, réordonner, supprimer des sessions (identifiants stables)', async () => {
  expect(await waves()).toEqual([]);
  const created = (await putWaves([MATIN, APREM])).json() as Wave[];
  expect(created.map((w) => [w.name, w.order, w.weighInClosed])).toEqual([['Matin', 0, false], ['Après-midi', 1, false]]);
  const [m, a] = created;
  const res = await putWaves({ waves: [{ id: a!.id, ...APREM, name: 'Dimanche' }, { id: m!.id, ...MATIN }], knownIds: [m!.id, a!.id] });
  expect(res.statusCode).toBe(200);
  expect((await waves()).map((w) => [w.id, w.name])).toEqual([[a!.id, 'Dimanche'], [m!.id, 'Matin']]);
  expect((await putWaves({ waves: [{ id: m!.id, ...MATIN }], knownIds: [m!.id, a!.id] })).statusCode).toBe(200);
  expect((await waves()).map((w) => w.name)).toEqual(['Matin']);
});

test('noms en double → 400 ; liste périmée → 409', async () => {
  expect((await putWaves([MATIN, { ...APREM, name: 'matin' }])).statusCode).toBe(400);
  const [m] = (await putWaves([MATIN])).json() as Wave[];
  const stale = await putWaves({ waves: [{ id: m!.id, ...MATIN }, APREM], knownIds: [] });
  expect(stale.statusCode).toBe(409);
});

test('session d’une catégorie calculée ; choix individuel ; catégorie créée après coup', async () => {
  for (let i = 0; i < 2; i++) await reg('minime', 'minime:F:-45', `MIN${i}`);
  for (let i = 0; i < 2; i++) await reg('cadet', 'cadet:F:-54', `CAD${i}`);
  const [m, a] = (await putWaves([MATIN, APREM])).json() as Wave[];
  const byLabel = async (part: string) => (await cats()).find((c) => c.label.includes(part))!;
  expect((await byLabel('Minimes')).waveId).toBe(m!.id);
  expect((await byLabel('Cadets')).waveId).toBe(a!.id);
  const minimes = await byLabel('Minimes');
  const patch = (waveOverride: string | null) => app.inject({ method: 'PATCH', url: `${base}/categories/${minimes.id}`, payload: { waveOverride } });
  expect((await patch(a!.id)).statusCode).toBe(200);
  expect(await byLabel('Minimes')).toMatchObject({ waveId: a!.id, waveOverride: a!.id });
  await patch('none');
  expect((await byLabel('Minimes')).waveId).toBeNull();
  await patch(null);
  expect((await byLabel('Minimes')).waveId).toBe(m!.id);
  expect((await patch('inconnue')).statusCode).toBe(400);
  // Inscription sur place d'une benjamine : nouvelle catégorie, dans la vague du matin d'office
  await reg('benjamin', 'benjamin:F:-35', 'SURPLACE', 'onsite');
  expect((await byLabel('Benjamins')).waveId).toBe(m!.id);
});

test('supprimer une session efface les choix individuels qui la visaient', async () => {
  for (let i = 0; i < 2; i++) await reg('minime', 'minime:F:-45', `MIN${i}`);
  const [m, a] = (await putWaves([MATIN, APREM])).json() as Wave[];
  const c = (await cats())[0]!;
  await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { waveOverride: a!.id } });
  await putWaves({ waves: [{ id: m!.id, ...MATIN }], knownIds: [m!.id, a!.id] });
  expect((await cats())[0]).toMatchObject({ waveOverride: null, waveId: m!.id });
});

test('sans session : session nulle partout', async () => {
  for (let i = 0; i < 2; i++) await reg('minime', 'minime:F:-45', `MIN${i}`);
  expect((await cats()).every((c) => c.waveId === null)).toBe(true);
});

test('migration : présence des combattants recopiée sur leurs inscriptions, pesée close conservée', () => {
  const file = olderDb(9);
  const raw = new Database(file);
  raw.prepare("INSERT INTO competitions (id, name, date, settings_json, weigh_in_closed) VALUES ('c1', 'Ancienne', '2026-11-22', '{}', 1)").run();
  raw.prepare("INSERT INTO fighters (id, competition_id, last_name, first_name, name_key, sex, age_band_code, presence) VALUES ('f1', 'c1', 'A', 'B', 'A B', 'F', 'cadet', 'absent'), ('f2', 'c1', 'C', 'D', 'C D', 'F', 'cadet', 'present')").run();
  raw.prepare("INSERT INTO registrations (id, competition_id, fighter_id, discipline, source) VALUES ('r1', 'c1', 'f1', 'kata', 'manual'), ('r2', 'c1', 'f1', 'karate', 'manual'), ('r3', 'c1', 'f2', 'kata', 'manual')").run();
  raw.close();
  const db = openDb(file);
  expect(db.$client.prepare('SELECT id, presence FROM registrations ORDER BY id').all()).toEqual([
    { id: 'r1', presence: 'absent' }, { id: 'r2', presence: 'absent' }, { id: 'r3', presence: 'present' },
  ]);
  expect(db.$client.prepare("SELECT weigh_in_closed AS w FROM competitions WHERE id = 'c1'").get()).toEqual({ w: 1 });
  expect(db.$client.prepare('SELECT count(*) AS n FROM fighters').get()).toEqual({ n: 2 });
  closeDb(db);
});

test('relecture (mineurs) : tranche inconnue de la grille dans une règle → 400', async () => {
  const res = await putWaves([{ name: 'Matin', rules: { ageBandCodes: ['poussin', 'inconnue'], disciplines: [] } }]);
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.join(' ')).toContain('Tranche d’âge inconnue dans la session « Matin » : inconnue.');
});

test('relecture (mineurs) : migration — inscription orpheline sans combattant : présence « non pesé »', () => {
  const file = olderDb(9);
  const raw = new Database(file);
  raw.pragma('foreign_keys = OFF');
  raw.prepare("INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Ancienne', '2026-11-22', '{}')").run();
  raw.prepare("INSERT INTO registrations (id, competition_id, fighter_id, discipline, source) VALUES ('r1', 'c1', 'fantome', 'kata', 'manual')").run();
  raw.close();
  const db = openDb(file);
  expect(db.$client.prepare("SELECT presence FROM registrations WHERE id = 'r1'").get()).toEqual({ presence: 'unknown' });
  closeDb(db);
});

test('relecture (mineurs) : tranche retirée de la grille → retirée des règles des sessions', async () => {
  await putWaves([{ name: 'Vétérans', rules: { ageBandCodes: ['v4', 'v5'], disciplines: [] } }]);
  const g = (await app.inject({ method: 'GET', url: `${base}/grid` })).json() as { ageBands: { code: string }[]; weightClasses: { ageBandCode: string }[]; ageLinks: { from: string; to: string }[] };
  const grid = { ...g, ageBands: g.ageBands.filter((b) => b.code !== 'v5'), weightClasses: g.weightClasses.filter((w) => w.ageBandCode !== 'v5'), ageLinks: g.ageLinks.filter((l) => l.from !== 'v5' && l.to !== 'v5') };
  expect((await app.inject({ method: 'PUT', url: `${base}/grid`, payload: grid })).statusCode).toBe(204);
  expect((await waves())[0]!.rules.ageBandCodes).toEqual(['v4']);
});
