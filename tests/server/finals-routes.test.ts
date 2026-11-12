import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
const register = async (count: number, over: object) => {
  for (let i = 0; i < count; i++) {
    await call('POST', '/registrations', { clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...over });
  }
};
type Row = { categoryId: string; label: string; zoneId: string | null; discipline: string; kata: boolean; kataSplit: boolean; noFinal: boolean; fixed: string | null; where: string; when: string };
type View = { waveId: string | null; finalsZoneId: string | null; locked: boolean; rows: Row[]; summary: { zoneId: string; ownPassages: number; ready: number; end: number }[] };
type Cat = { id: string; label: string };

/** Session « Matin » : cadettes -54 (élimination, Tatami 1), kata (Tatami 1), cadettes -61 en poule unique (Tatami 2) ; session « Après-midi » : minimes -45. */
async function setup() {
  await register(4, { ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
  await register(3, { ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null });
  await register(3, { ageBandCode: 'cadet', weightClassId: 'cadet:F:-61' });
  await register(2, { ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  const [matin, aprem] = ((await call('PUT', '/waves', [
    { name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['minime'], disciplines: [] } },
  ])).json() as { id: string }[]).map((w) => w.id) as [string, string];
  const [t1, t2] = ((await call('GET', '/zones')).json() as { id: string }[]).map((z) => z.id) as [string, string];
  const cats = (await call('GET', '/categories')).json() as Cat[];
  const of = (s: string) => cats.find((c) => c.label.includes(s))!.id;
  const ids = { a54: of('-54'), kata: of('Kata'), b61: of('-61'), m45: of('-45') };
  for (const [id, zoneId] of [[ids.a54, t1], [ids.kata, t1], [ids.b61, t2]] as const) await call('PATCH', `/categories/${id}`, { status: 'ready', zoneId });
  return { matin, aprem, t1, t2, ...ids };
}
const view = async (wave: string | null) => (await call('GET', `/finals?vague=${wave ?? ''}`)).json() as View;

describe('GET /finals', () => {
  test('une catégorie à un seul inscrit n’est pas « sans finale (poule) » : elle garde ses choix', async () => {
    await register(1, { ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
    await register(3, { ageBandCode: 'cadet', weightClassId: 'cadet:F:-61' });
    const matin = ((await call('PUT', '/waves', [{ name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } }])).json() as { id: string }[])[0]!.id;
    const v = await view(matin);
    const byLabel = (s: string) => v.rows.find((r) => r.label.includes(s))!;
    expect(byLabel('-54').noFinal).toBe(false);
    expect(byLabel('-61').noFinal).toBe(true);
  });
  test('lignes de la session dans l’ordre des catégories, choix effectifs, poule unique, résumé par zone', async () => {
    const s = await setup();
    const v = await view(s.matin);
    expect(v).toMatchObject({ waveId: s.matin, finalsZoneId: null, locked: false });
    expect(v.rows.map((r) => r.categoryId).sort()).toEqual([s.a54, s.kata, s.b61].sort());
    expect(v.rows.some((r) => r.categoryId === s.m45)).toBe(false);
    const row = (id: string) => v.rows.find((r) => r.categoryId === id)!;
    expect(row(s.a54)).toMatchObject({ zoneId: s.t1, discipline: 'karate', kata: false, noFinal: false, fixed: null, where: 'own', when: 'end' });
    expect(row(s.kata)).toMatchObject({ zoneId: s.t1, discipline: 'kata', kata: true, kataSplit: false, when: 'ready' });
    expect(row(s.b61)).toMatchObject({ zoneId: s.t2, noFinal: true });
    // Même ordre que le plan de passage (rang des catégories).
    const plan = (await call('GET', '/passages')).json() as { zones: { zoneId: string; passages: { categoryId: string; matchId: string | null; waveId: string | null }[] }[] };
    expect(v.summary).toEqual(
      plan.zones
        .map((z) => {
          const mine = z.passages.filter((p) => p.waveId === s.matin);
          const finals = mine.filter((p) => p.matchId === 'w2-0');
          return { zoneId: z.zoneId, ownPassages: mine.length - finals.length, ready: 0, end: finals.length };
        })
        .filter((t) => t.ownPassages + t.ready + t.end > 0),
    );
  });

  test('zone des finales : la catégorie qui y est est « fixée », la finale des autres y va ; kata en deux passages', async () => {
    const s = await setup();
    const put = await call('PUT', '/finals/zone', { waveId: s.matin, finalsZoneId: s.t2 });
    expect(put.statusCode).toBe(200);
    const v = put.json() as View;
    expect(v.finalsZoneId).toBe(s.t2);
    const row = (id: string) => v.rows.find((r) => r.categoryId === id)!;
    expect(row(s.b61)).toMatchObject({ fixed: 'finals-zone', where: 'finals' });
    expect(row(s.a54)).toMatchObject({ fixed: null, where: 'finals', when: 'end' });
    expect(row(s.kata)).toMatchObject({ where: 'finals', kataSplit: true });
    expect(v.summary.find((t) => t.zoneId === s.t2)).toMatchObject({ ready: 0, end: 2 });
  });
});

describe('PUT /finals/categories', () => {
  test('sans categoryIds : règle toute la session ; avec : seulement ces catégories', async () => {
    const s = await setup();
    let v = (await call('PUT', '/finals/categories', { waveId: s.matin, when: 'ready' })).json() as View;
    expect(v.rows.map((r) => r.when)).toEqual(['ready', 'ready', 'ready']);
    v = (await call('PUT', '/finals/categories', { waveId: s.matin, categoryIds: [s.a54], when: 'end' })).json() as View;
    expect(v.rows.find((r) => r.categoryId === s.a54)!.when).toBe('end');
    expect(v.rows.find((r) => r.categoryId === s.kata)!.when).toBe('ready');
  });

  test('refus : zone d’une autre compétition, catégorie hors session, corps invalide', async () => {
    const s = await setup();
    const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Open', date: '2026-12-06' } })).json().id as string;
    const foreign = ((await app.inject({ method: 'GET', url: `/api/competitions/${other}/zones` })).json() as { id: string }[])[0]!.id;
    expect((await call('PUT', '/finals/zone', { waveId: s.matin, finalsZoneId: foreign })).statusCode).toBe(400);
    expect((await call('PUT', '/finals/categories', { waveId: s.matin, categoryIds: [s.m45], where: 'own' })).statusCode).toBe(400);
    expect((await call('PUT', '/finals/categories', { waveId: s.matin, when: 'jamais' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/competitions/inconnue/finals/zone', payload: { waveId: null, finalsZoneId: null } })).statusCode).toBe(404);
  });
});

describe('session figée', () => {
  test('lancée : 400 avec le message exact, lecture seule ; rouverte : 200', async () => {
    const s = await setup();
    expect((await call('POST', '/launch', { waveId: s.matin })).statusCode).toBe(204);
    expect((await view(s.matin)).locked).toBe(true);
    for (const [url, body] of [['/finals/zone', { waveId: s.matin, finalsZoneId: s.t2 }], ['/finals/categories', { waveId: s.matin, when: 'ready' }]] as const) {
      const res = await call('PUT', url, body);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain('Session figée : rouvrez-la dans Combats pour changer les finales.');
    }
    // L'autre session reste modifiable.
    expect((await call('PUT', '/finals/zone', { waveId: s.aprem, finalsZoneId: s.t2 })).statusCode).toBe(200);
    expect((await call('POST', '/launch/reopen', { waveId: s.matin })).statusCode).toBe(204);
    const res = await call('PUT', '/finals/zone', { waveId: s.matin, finalsZoneId: s.t2 });
    expect(res.statusCode).toBe(200);
    expect((res.json() as View).locked).toBe(false);
  });
});

describe('jour J', () => {
  test('figée : changer l’ordre de passage ne touche pas la file ; rouverte : « Tout dès que finie » ne rend à numéroter que les catégories avec une finale, et le refigeage dit quelles zones sont refaites', async () => {
    const s = await setup();
    expect((await call('POST', '/launch', { waveId: s.matin })).statusCode).toBe(204);
    type Queue = { zones: { zone: { id: string }; queue: { number: number; categoryId: string; matchId: string | null }[] }[] };
    const queues = async () => ((await call('GET', `/schedule?vague=${s.matin}`)).json() as Queue).zones.map((z) => [z.zone.id, z.queue]);
    const status = async () => (await call('GET', `/launch?vague=${s.matin}`)).json() as { pending: { categoryId: string; reason: string }[] };
    const before = await queues();
    expect(before.length).toBeGreaterThan(0);
    expect((await app.inject({ method: 'PATCH', url: base, payload: { settings: { passageOrder: 'categories' } } })).statusCode).toBe(200);
    expect((await status()).pending).toEqual([]);
    expect(await queues()).toEqual(before);

    expect((await call('POST', '/launch/reopen', { waveId: s.matin })).statusCode).toBe(204);
    expect((await call('PUT', '/finals/categories', { waveId: s.matin, when: 'ready' })).statusCode).toBe(200);
    // La poule unique (Tatami 2) et le kata (déjà « dès que finie ») ne changent pas.
    expect((await status()).pending).toEqual([{ categoryId: s.a54, label: expect.any(String), reason: 'finals' }]);
    const preview = (await call('POST', '/launch/number/preview', { waveId: s.matin })).json() as { zonesRedone: string[]; changes: { categoryId: string }[] };
    expect(preview.zonesRedone).toEqual([s.t1]);
    expect((await call('POST', '/launch/number', { waveId: s.matin })).statusCode).toBe(200);
    expect((await status()).pending).toEqual([]);
  });
});
