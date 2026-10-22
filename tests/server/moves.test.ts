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

/** Sans vague, lancée : -54 (A) et -47 (D) sur Tatami 1, -61 (B) sur Tatami 2 ; `finals` : zone des finales (index). */
async function setup(finals?: 0 | 1) {
  await many(4, 'cadet:F:-54');
  await many(4, 'cadet:F:-61');
  await many(4, 'cadet:F:-47');
  const [t1, t2] = (await call('GET', '/zones')).json() as { id: string }[];
  if (finals !== undefined) await call('PATCH', '', { settings: { finalsZoneId: [t1, t2][finals]!.id } });
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

describe('déplacements (relecture)', () => {
  const numberOf = (p: Plan, cid: string, matchId: string) => p.zones.flatMap((z) => z.passages.map((x) => ({ ...x, zoneId: z.zoneId }))).find((x) => x.categoryId === cid && x.matchId === matchId)!;

  test('vers la zone des finales, à la suite : la finale passe après les demies', async () => {
    const { t2, a } = await setup(1);
    await move(a.id, t2, 'append');
    const p = await plan();
    expect(p.pending).toEqual([]);
    const semis = ['w1-0', 'w1-1'].map((m) => numberOf(p, a.id, m).number);
    expect(numberOf(p, a.id, 'w2-0').number).toBeGreaterThan(Math.max(...semis));
  });

  test('depuis la zone des finales, mélangés : la finale reste où elle est, rien n’est perdu', async () => {
    const { t1, t2, a } = await setup(0);
    await result(a.id, 'w1-0');
    const before = await plan();
    await move(a.id, t2, 'shuffle');
    const p = await plan();
    expect(p.pending).toEqual([]);
    expect(numberOf(p, a.id, 'w2-0')).toEqual(numberOf(before, a.id, 'w2-0'));
    expect(numberOf(p, a.id, 'w1-0')).toEqual(numberOf(before, a.id, 'w1-0'));
    expect(numberOf(p, a.id, 'w1-1').zoneId).toBe(t2);
    void t1;
  });

  test('valider après un changement depuis l’aperçu : tout est recalculé', async () => {
    const { t2, a } = await setup();
    const preview = (await move(a.id, t2, 'append', true)).json() as Move;
    expect(preview.changes).toHaveLength(3);
    await result(a.id, 'w1-0');
    const done = (await move(a.id, t2, 'append')).json() as Move;
    expect(done.changes.map((c) => c.matchId)).toEqual(['w1-1', 'w2-0']);
  });

  test('tous les combats joués : rien à déplacer', async () => {
    const { t1, b } = await setup();
    for (const m of ['w1-0', 'w1-1', 'w2-0']) await result(b.id, m);
    const res = await move(b.id, t1, 'append');
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toEqual(['Tous ses combats sont joués : rien à déplacer.']);
  });

  test('kata : déplacé en bloc ; une note saisie = joué', async () => {
    for (let i = 0; i < 3; i++) {
      await call('POST', '/registrations', { clubId: null, lastName: `K${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' });
    }
    const [t1, t2] = (await call('GET', '/zones')).json() as { id: string }[];
    const k = await catOf('Kata');
    await call('PATCH', `/categories/${k.id}`, { status: 'ready', zoneId: t1!.id });
    await call('POST', '/launch', { waveId: null });
    const res = (await move(k.id, t2!.id, 'append')).json() as Move;
    expect(res.changes.map((c) => [c.matchId, c.to.zoneId])).toEqual([[null, t2!.id]]);
    const rid = ((await call('GET', '/registrations')).json() as { id: string; categoryId: string }[]).find((r) => r.categoryId === k.id)!.id;
    await call('PUT', `/categories/${k.id}/kata/${rid}/round1`, { notes: [7] });
    expect((await move(k.id, t1!.id, 'append')).statusCode).toBe(400);
  });
});

