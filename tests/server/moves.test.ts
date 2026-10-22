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
const many = async (count: number, weightClassId: string) => {
  for (let i = 0; i < count; i++) {
    await call('POST', '/registrations', {
      clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual',
    });
  }
};
type Cat = { id: string; label: string; zoneId: string | null; numbersUpdatedAt: string | null };
type Plan = { zones: { zoneId: string; passages: { number: number; categoryId: string; matchId: string | null }[] }[]; pending: unknown[] };
type Move = { changes: { categoryId: string; matchId: string | null; from: { zoneId: string; number: number } | null; to: { zoneId: string; number: number } }[]; reprint: { categoryId: string; label: string }[] };
const cats = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (label: string) => (await cats()).find((c) => c.label.includes(label))!;
const plan = async () => (await call('GET', '/passages')).json() as Plan;
const on = (p: Plan, zoneId: string, categoryId: string) => p.zones.find((z) => z.zoneId === zoneId)!.passages.filter((x) => x.categoryId === categoryId).map((x) => `${x.number}:${x.matchId}`);

/** Sans vague, lancée : -54 (A) et -47 (D) sur Tatami 1, -61 (B) sur Tatami 2. */
async function setup() {
  await many(4, 'cadet:F:-54');
  await many(4, 'cadet:F:-61');
  await many(4, 'cadet:F:-47');
  const [t1, t2] = (await call('GET', '/zones')).json() as { id: string }[];
  for (const c of await cats()) await call('PATCH', `/categories/${c.id}`, { status: 'ready', zoneId: c.label.includes('-61') ? t2!.id : t1!.id });
  expect((await call('POST', '/launch', { waveId: null })).statusCode).toBe(204);
  const [a, b, d] = [await catOf('-54'), await catOf('-61'), await catOf('-47')];
  return { t1: t1!.id, t2: t2!.id, a, b, d };
}
const result = (cid: string, matchId: string) => call('PUT', `/categories/${cid}/results/${matchId}`, { winner: 'a', method: 'points' });
const move = (cid: string, zoneId: string, mode: 'append' | 'shuffle', preview = false) => call('POST', `/categories/${cid}/move${preview ? '/preview' : ''}`, { zoneId, mode });

describe('déplacer une catégorie d’une vague lancée', () => {
  test('à la suite : combats restants sur la zone d’arrivée, le combat joué garde numéro et zone', async () => {
    const { t1, t2, a, b, d } = await setup();
    const before = await plan();
    await result(a.id, 'w1-0');
    const res = await move(a.id, t2, 'append');
    expect(res.statusCode).toBe(200);
    const body = res.json() as Move;
    expect(body.reprint.map((r) => r.categoryId)).toEqual([a.id]);
    expect(body.changes.map((c) => [c.matchId, c.to])).toEqual([['w1-1', { zoneId: t2, number: 4 }], ['w2-0', { zoneId: t2, number: 5 }]]);
    const after = await plan();
    expect(on(after, t2, a.id)).toEqual(['4:w1-1', '5:w2-0']);
    expect(on(after, t1, a.id)).toEqual(on(before, t1, a.id).filter((x) => x.endsWith('w1-0')));
    expect(on(after, t1, d.id)).toEqual(on(before, t1, d.id));
    expect(on(after, t2, b.id)).toEqual(on(before, t2, b.id));
    expect(after.pending).toEqual([]);
    const moved = await catOf('-54');
    expect(moved.zoneId).toBe(t2);
    expect(moved.numbersUpdatedAt).not.toBeNull();
    expect((await catOf('-61')).numbersUpdatedAt).toBeNull();
  });

  test('mélangés : la zone d’arrivée est renumérotée après son plus grand numéro joué', async () => {
    const { t2, a, b } = await setup();
    await result(b.id, 'w1-0');
    const res = (await move(a.id, t2, 'shuffle')).json() as Move;
    expect(res.reprint.map((r) => r.categoryId).sort()).toEqual([a.id, b.id].sort());
    const after = await plan();
    const t2Numbers = after.zones.find((z) => z.zoneId === t2)!.passages.map((p) => p.number).sort((x, y) => x - y);
    expect(t2Numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(on(after, t2, b.id)[0]).toBe('1:w1-0');
    expect((await catOf('-61')).numbersUpdatedAt).not.toBeNull();
  });

  test('aperçu : rien n’est écrit', async () => {
    const { t2, a } = await setup();
    const before = await plan();
    const res = (await move(a.id, t2, 'append', true)).json() as Move;
    expect(res.changes).toHaveLength(3);
    expect(res.changes.every((c) => c.from !== null)).toBe(true);
    expect((await plan()).zones).toEqual(before.zones);
    expect((await catOf('-54')).zoneId).not.toBe(t2);
  });

  test('refus : même zone, discipline non accueillie, vague non lancée', async () => {
    const { t1, t2, a } = await setup();
    expect((await move(a.id, t1, 'append')).statusCode).toBe(400);
    const zones = (await call('GET', '/zones')).json() as { id: string; name: string }[];
    await call('PUT', '/zones', zones.map((z) => ({ id: z.id, name: z.name, disciplines: z.id === t2 ? ['kata'] : null })));
    const refused = await move(a.id, t2, 'append');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().issues).toEqual([`La zone « ${zones.find((z) => z.id === t2)!.name} » n’accueille pas le karaté.`]);
    await call('POST', '/launch/reopen', { waveId: null });
    const reopened = await move(a.id, t1 === a.zoneId ? t2 : t1, 'append');
    expect(reopened.statusCode).toBe(400);
  });

  test('refiger en mélangés : la zone d’arrivée d’une catégorie changée de zone est refaite', async () => {
    const { t2, a, b } = await setup();
    await call('POST', '/launch/reopen', { waveId: null });
    await call('PATCH', `/categories/${a.id}`, { zoneId: t2 });
    expect((await plan()).pending).toHaveLength(1);
    const res = await call('POST', '/launch/number', { waveId: null, mode: 'shuffle' });
    expect(res.statusCode).toBe(200);
    const after = await plan();
    expect(after.pending).toEqual([]);
    expect(after.zones.find((z) => z.zoneId === t2)!.passages.map((p) => p.number).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(on(after, t2, a.id)).toHaveLength(3);
    void b;
  });
});
