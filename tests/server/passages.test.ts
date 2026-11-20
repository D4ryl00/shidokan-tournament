import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { getCompetition } from '../../src/server/repositories/competitions.js';
import { planInput, playedKeys } from '../../src/server/repositories/passages.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let id: string;
let base: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
const many = async (count: number, over: object = {}) => {
  const out = [];
  for (let i = 0; i < count; i++) out.push(await reg(over));
  return out;
};
/** Connexion directe à la base de l'app (fonctions de dépôt). */
const withDb = async <T>(f: (db: AppDb) => Promise<T> | T): Promise<T> => {
  const db = openDb(dbPath);
  try {
    return await f(db);
  } finally {
    closeDb(db);
  }
};
const kata = { discipline: 'kata', ruleset: null, weightClassId: null };
const boxing = { discipline: 'shido-boxing', ageBandCode: 'senior', weightClassId: 'senior:F:-55' };
type Plan = {
  categories: Record<string, { zoneId: string | null; auto: boolean }>;
  zones: { zoneId: string; passages: { number: number; categoryId: string; matchId: string | null; noRest: boolean; waveId: string | null }[] }[];
  impossible: { categoryId: string; discipline: string }[];
};
type Cat = { id: string; label: string; zoneId: string | null; status: string; bracket: { matches?: { id: string }[]; order?: string[] } };
const plan = async () => (await call('GET', '/passages')).json() as Plan;
const cats = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (label: string) => (await cats()).find((c) => c.label.includes(label))!;
const zones = async () => (await call('GET', '/zones')).json() as { id: string; name: string; disciplines: string[] | null }[];
/** Une seule zone, « Tatami 1 ». */
const oneZone = async () => {
  const [t1] = await zones();
  await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }]);
  return t1!.id;
};

describe('plan de passage', () => {
  test('kata d’abord et numéros : kata de 3 et cadettes de 4 sur une zone → kata n° 1 à 5 (un par kataka), combats 6 à 8', async () => {
    await many(3, kata);
    await many(4);
    const t1 = await oneZone();
    const k = await catOf('Kata');
    const [r1, r2, r3] = k.bracket.order!;
    const p = (await plan()).zones.find((z) => z.zoneId === t1)!.passages;
    expect(p.map((x) => [x.number, x.matchId])).toEqual([
      [1, `kata:tour1:${r1}`], [2, `kata:tour1:${r2}`], [3, `kata:tour1:${r3}`], [4, 'kata:finale:1'], [5, 'kata:finale:2'],
      [6, 'w1-0'], [7, 'w1-1'], [8, 'w2-0'],
    ]);
  });

  test('passages joués : par kataka, absent tardif compris, finale par finaliste', async () => {
    const regs = await many(3, kata);
    await oneZone();
    const k = await catOf('Kata');
    await call('PATCH', `/categories/${k.id}`, { status: 'ready' });
    expect((await call('POST', '/launch', { waveId: null })).statusCode).toBe(204);
    const [r1, r2, r3] = k.bracket.order!;
    expect((await call('PUT', `/categories/${k.id}/kata/${r1}/round1`, { notes: [7, 7, 7] })).statusCode).toBe(204);
    // r3 absent après le lancement (absent tardif) : son passage du tour 1 ne sera jamais joué.
    await call('PUT', `/weigh-in/${regs.find((r) => r.id === r3)!.fighterId}`, { presence: 'absent' });
    let keys = await withDb((db) => playedKeys(db, id));
    expect(keys.has(`${k.id}:kata:tour1:${r1}`)).toBe(true);
    expect(keys.has(`${k.id}:kata:tour1:${r2}`)).toBe(false);
    expect(keys.has(`${k.id}:kata:tour1:${r3}`)).toBe(true);
    expect(keys.has(`${k.id}:kata:finale:1`)).toBe(false);
    // r2 premier du tour 1 : finaliste 1 ; sa note de finale joue `kata:finale:1`, pas `kata:finale:2`.
    expect((await call('PUT', `/categories/${k.id}/kata/${r2}/round1`, { notes: [9, 9, 9] })).statusCode).toBe(204);
    expect((await call('PUT', `/categories/${k.id}/kata/${r2}/final`, { notes: [9, 9, 9] })).statusCode).toBe(204);
    keys = await withDb((db) => playedKeys(db, id));
    expect(keys.has(`${k.id}:kata:tour1:${r2}`)).toBe(true);
    expect(keys.has(`${k.id}:kata:finale:1`)).toBe(true);
    expect(keys.has(`${k.id}:kata:finale:2`)).toBe(false);
    // Plus aucune ancienne clé de bloc.
    expect([...keys].some((x) => x === `${k.id}:kata` || x === `${k.id}:kata:tour1` || x === `${k.id}:kata:finale`)).toBe(false);
  });

  test('durée estimée : un changement par tour, pas par kataka', async () => {
    await many(3, kata);
    const k = await catOf('Kata');
    const [first, second] = k.bracket.order!;
    const { input, kataPassageSec, changeoverSec } = await withDb(async (db) => ({ input: await planInput(db, id), ...(await getCompetition(db, id))!.settings.schedule }));
    expect(input.durationSec!(k.id, `kata:tour1:${first}`)).toBe(kataPassageSec + changeoverSec);
    expect(input.durationSec!(k.id, `kata:tour1:${second}`)).toBe(kataPassageSec);
    expect(input.durationSec!(k.id, 'kata:finale:1')).toBe(kataPassageSec + changeoverSec);
    expect(input.durationSec!(k.id, 'kata:finale:2')).toBe(kataPassageSec);
  });

  test('zone limitée : la boxe sur le Ring ; acceptée nulle part → impossible', async () => {
    await many(2, boxing);
    await many(4);
    const [t1] = await zones();
    const put = await call('PUT', '/zones', [
      { id: t1!.id, name: 'Tatami 1', disciplines: ['karate', 'kata', 'shido-mix', 'triathlon'] },
      { name: 'Ring', disciplines: ['shido-boxing'] },
    ]);
    expect(put.statusCode).toBe(200);
    const ring = (await zones()).find((z) => z.name === 'Ring')!;
    expect(ring.disciplines).toEqual(['shido-boxing']);
    const box = await catOf('Shido-boxing');
    expect((await plan()).categories[box.id]).toEqual({ zoneId: ring.id, auto: true });

    await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }, { id: ring.id, name: 'Ring', disciplines: ['karate'] }]);
    const p = await plan();
    expect(p.categories[box.id]).toEqual({ zoneId: null, auto: true });
    expect(p.impossible).toEqual([{ categoryId: box.id, discipline: 'shido-boxing' }]);
    expect((await call('GET', '/schedule')).json().impossible).toEqual([{ categoryId: box.id, discipline: 'shido-boxing' }]);
  });

  test('épinglage : PATCH zoneId → auto false ; null → retour à l’automatique', async () => {
    await many(4);
    const c = await catOf('Cadets');
    const [, t2] = await zones();
    await call('PATCH', `/categories/${c.id}`, { zoneId: t2!.id });
    expect((await plan()).categories[c.id]).toEqual({ zoneId: t2!.id, auto: false });
    await call('PATCH', `/categories/${c.id}`, { zoneId: null });
    expect((await plan()).categories[c.id]!.auto).toBe(true);
  });

  test('résultats : les numéros ne bougent pas (repêchage devenu exemption compris)', async () => {
    await many(5);
    const c = await catOf('Cadets');
    await call('PATCH', `/categories/${c.id}`, { repechage: true });
    const before = await plan();
    expect(before.zones.flatMap((z) => z.passages).some((p) => p.matchId?.startsWith('rep'))).toBe(true);
    for (const round of ['w1', 'w2']) {
      for (const m of (await catOf('Cadets')).bracket.matches!.filter((x) => x.id.startsWith(`${round}-`))) {
        await call('PUT', `/categories/${c.id}/results/${m.id}`, { winner: 'a', method: 'points' });
      }
    }
    expect((await plan()).zones).toEqual(before.zones);
  });

  test('catégorie lancée : sa zone est enregistrée ; une autre catégorie qui grossit ne la déplace pas', async () => {
    await many(4);
    await many(4, { weightClassId: 'cadet:F:-61' });
    const a = await catOf('-54');
    const b = await catOf('-61');
    const [t1, t2] = await zones();
    expect((await plan()).categories[a.id]!.zoneId).toBe(t1!.id);
    expect((await plan()).categories[b.id]!.zoneId).toBe(t2!.id);
    await call('PUT', `/categories/${a.id}/results/w1-0`, { winner: 'a', method: 'points' });
    expect((await catOf('-54')).zoneId).toBe(t1!.id);
    await many(4, { weightClassId: 'cadet:F:-61' });
    const p = await plan();
    expect(p.categories[a.id]).toEqual({ zoneId: t1!.id, auto: false });
    expect(p.categories[b.id]!.zoneId).toBe(t2!.id);
  });
});

describe('plan de passage (relecture)', () => {
  test('premier résultat d’une session : la répartition de toute la session est fixée, rien ne bouge', async () => {
    await many(4); // -54 : 3 combats
    await many(4, { weightClassId: 'cadet:F:-61' }); // 3 combats
    await many(2, { weightClassId: 'cadet:F:+61' }); // 1 combat
    const [a, b, c] = [await catOf('-54'), await catOf('-61'), await catOf('+61')];
    const before = await plan();
    expect([a, b, c].map((x) => before.categories[x.id]!.zoneId)).toEqual([before.zones[0]!.zoneId, before.zones[1]!.zoneId, before.zones[0]!.zoneId]);
    await call('PUT', `/categories/${c.id}/results/w1-0`, { winner: 'a', method: 'points' });
    const after = await plan();
    for (const x of [a, b, c]) expect(after.categories[x.id]).toEqual({ zoneId: before.categories[x.id]!.zoneId, auto: false });
    expect(after.zones).toEqual(before.zones);
  });
});

describe('file par zone', () => {
  test('?vague= : passages de la session ; combats joués retirés ; noRest renvoyé', async () => {
    await many(4, { ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
    await many(4);
    const t1 = await oneZone();
    const [matin, aprem] = (await call('PUT', '/waves', [
      { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
      { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    ])).json() as { id: string }[];
    type Q = { zones: { zone: { id: string }; queue: { number: number; matchId: string | null; a: string | null; b: string | null; noRest: boolean; categoryLabel: string }[] }[] };
    const queue = async (wave: string) => ((await call('GET', `/schedule?vague=${wave}`)).json() as Q).zones.find((z) => z.zone.id === t1)!.queue;
    let q = await queue(matin!.id);
    expect(q.map((x) => [x.number, x.matchId, x.noRest])).toEqual([[1, 'w1-0', false], [2, 'w1-1', false]]);
    expect(q[0]!.a).toMatch(/^NOM/);
    const mini = await catOf('Minimes');
    for (const m of ['w1-0', 'w1-1']) await call('PUT', `/categories/${mini.id}/results/${m}`, { winner: 'a', method: 'points' });
    q = await queue(matin!.id);
    expect(q.map((x) => [x.number, x.matchId, x.noRest])).toEqual([[3, 'w2-0', true]]);
    expect((await queue(aprem!.id)).map((x) => x.number)).toEqual([4, 5]);
  });
});
