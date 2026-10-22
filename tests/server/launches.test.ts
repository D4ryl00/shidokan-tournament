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
type Cat = { id: string; label: string; zoneId: string | null; waveId: string | null; waveOverride: string | null; status: string; numbersUpdatedAt: string | null; stale: boolean };
type Plan = { zones: { zoneId: string; passages: { number: number; categoryId: string; matchId: string | null; waveId: string | null }[] }[]; pending: { categoryId: string }[] };
type Status = { state: string; blocking: string[]; pending: { categoryId: string; label: string }[]; zones: { zoneId: string; first: number | null; last: number | null }[] };
const cats = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (label: string) => (await cats()).find((c) => c.label.includes(label))!;
const plan = async () => (await call('GET', '/passages')).json() as Plan;
const status = async (wave: string | null, restart = false) => (await call('GET', `/launch?vague=${wave ?? ''}${restart ? '&restart=1' : ''}`)).json() as Status;
const readyAll = async () => {
  for (const c of await cats()) await call('PATCH', `/categories/${c.id}`, { status: 'ready' });
};
const launch = (waveId: string | null, restart = false) => call('POST', '/launch', { waveId, restart });
const twoWaves = async () =>
  (await call('PUT', '/waves', [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ])).json() as { id: string }[];

describe('lancer une vague', () => {
  test('lancer : numéros enregistrés, vague et zones fixées ; une nouvelle catégorie ne change aucun numéro', async () => {
    await many(4);
    await many(4, { weightClassId: 'cadet:F:-61' });
    await readyAll();
    const before = await plan();
    expect((await status(null)).state).toBe('preparation');
    expect((await launch(null)).statusCode).toBe(204);
    expect((await status(null)).state).toBe('launched');
    expect((await plan()).zones).toEqual(before.zones);
    for (const c of await cats()) expect(c.zoneId).not.toBeNull();
    await many(2, { weightClassId: 'cadet:F:-47' });
    const after = await plan();
    const fresh = await catOf('-47');
    expect(after.pending.map((p) => p.categoryId)).toEqual([fresh.id]);
    expect(after.zones.map((z) => z.passages.filter((p) => p.categoryId !== fresh.id))).toEqual(before.zones.map((z) => z.passages));
  });

  test('blocages : vague précédente, catégorie non prête, discipline acceptée nulle part, déjà lancée', async () => {
    await many(2, { ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
    await many(2);
    const [matin, aprem] = await twoWaves();
    let res = await launch(aprem!.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toContain('Lancez d’abord la vague « Matin ».');
    expect(res.json().issues.join(' ')).toContain('n’est pas prête');
    await readyAll();
    const zones = (await call('GET', '/zones')).json() as { id: string; name: string }[];
    await call('PUT', '/zones', zones.map((z) => ({ id: z.id, name: z.name, disciplines: ['kata'] })));
    res = await launch(matin!.id);
    expect(res.json().issues).toEqual(['Aucune zone n’accepte : Karaté (1 catégorie).']);
    await call('PUT', '/zones', zones.map((z) => ({ id: z.id, name: z.name, disciplines: null })));
    expect((await launch(matin!.id)).statusCode).toBe(204);
    res = await launch(matin!.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toEqual(['La vague a déjà été lancée.']);
  });

  test('reprendre à 1 : la vague suivante repart de 1, sinon elle suit', async () => {
    await many(4, { ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
    await many(4);
    const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
    await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }]);
    const [matin, aprem] = await twoWaves();
    await readyAll();
    await launch(matin!.id);
    expect((await status(aprem!.id)).zones[0]).toMatchObject({ first: 4, last: 6 });
    expect((await status(aprem!.id, true)).zones[0]).toMatchObject({ first: 1, last: 3 });
    await launch(aprem!.id, true);
    expect((await plan()).zones[0]!.passages.filter((p) => p.waveId === aprem!.id).map((p) => p.number)).toEqual([1, 2, 3]);
  });

  test('rouvrir puis numéroter sans rien changer : aucun numéro ne change, vague de nouveau lancée', async () => {
    await many(4);
    await readyAll();
    await launch(null);
    const before = await plan();
    expect((await call('POST', '/launch/reopen', { waveId: null })).statusCode).toBe(204);
    expect((await status(null)).state).toBe('reopened');
    expect((await call('POST', '/launch/number', { waveId: null })).json()).toEqual({ changes: [] });
    expect((await status(null)).state).toBe('launched');
    expect((await plan()).zones).toEqual(before.zones);
  });

  test('nouvelle catégorie dans une vague lancée : à numéroter, à la suite ; l’aperçu n’écrit rien', async () => {
    const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
    await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }]);
    await many(4);
    await readyAll();
    await launch(null);
    await many(2, { weightClassId: 'cadet:F:-47' });
    const fresh = await catOf('-47');
    expect((await status(null)).pending).toEqual([{ categoryId: fresh.id, label: fresh.label }]);
    const preview = (await call('POST', '/launch/number/preview', { waveId: null })).json();
    expect(preview).toEqual({ changes: [{ categoryId: fresh.id, label: fresh.label, numbers: [4] }] });
    expect((await plan()).pending).toHaveLength(1);
    await call('POST', '/launch/number', { waveId: null });
    const p = await plan();
    expect(p.pending).toEqual([]);
    expect(p.zones[0]!.passages.find((x) => x.categoryId === fresh.id)!.number).toBe(4);
    expect((await catOf('-47')).numbersUpdatedAt).not.toBeNull();
    expect((await catOf('-54')).numbersUpdatedAt).toBeNull();
  });
});

describe('vague lancée : verrous', () => {
  test('absent tardif : tableau gardé sans confirmation ; « Régénérer » → numéros à la suite pour elle seule', async () => {
    const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
    await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }]);
    const a = await many(4);
    await many(4, { weightClassId: 'cadet:F:-61' });
    await readyAll();
    await launch(null);
    const before = await plan();
    await call('PUT', `/weigh-in/${a[0]!.fighterId}`, { presence: 'absent' });
    const catA = await catOf('-54');
    expect(catA.stale).toBe(true);
    expect((await plan()).zones).toEqual(before.zones);
    const res = await call('POST', `/categories/${catA.id}/regenerate`);
    expect(res.statusCode).toBe(200);
    expect(res.json().changes).toEqual([{ categoryId: catA.id, label: catA.label, numbers: [7, 8, 9] }]);
    const after = await plan();
    const catB = await catOf('-61');
    const numbersOf = (p: Plan, id: string) => p.zones[0]!.passages.filter((x) => x.categoryId === id).map((x) => x.number);
    expect(numbersOf(after, catB.id)).toEqual(numbersOf(before, catB.id));
    expect(numbersOf(after, catA.id)).toEqual([7, 8, 9]);
    expect((await catOf('-54')).stale).toBe(false);
  });

  test('recasement fermé pendant la vague lancée, rouvert ensuite', async () => {
    await many(4);
    await many(1, { weightClassId: 'cadet:F:-47', approxWeightKg: 47 });
    await readyAll();
    expect(((await call('GET', '/replacement')).json() as { cases: unknown[] }).cases).toHaveLength(1);
    await launch(null);
    expect(((await call('GET', '/replacement')).json() as { cases: unknown[] }).cases).toEqual([]);
    await call('POST', '/launch/reopen', { waveId: null });
    expect(((await call('GET', '/replacement')).json() as { cases: unknown[] }).cases).toHaveLength(1);
  });

  test('zone, vague, format d’une catégorie de la vague lancée : 409 ; rouverte : permis', async () => {
    await many(4);
    await readyAll();
    const [matin] = (await call('PUT', '/waves', [{ name: 'Tous', rules: { ageBandCodes: ['cadet'], disciplines: [] } }])).json() as { id: string }[];
    await launch(matin!.id);
    const c = await catOf('Cadets');
    const [, t2] = (await call('GET', '/zones')).json() as { id: string }[];
    expect((await call('PATCH', `/categories/${c.id}`, { zoneId: t2!.id })).statusCode).toBe(409);
    expect((await call('PATCH', `/categories/${c.id}`, { waveOverride: 'none' })).statusCode).toBe(409);
    expect((await call('PATCH', `/categories/${c.id}`, { format: 'round_robin' })).statusCode).toBe(409);
    await call('POST', '/launch/reopen', { waveId: matin!.id });
    expect((await call('PATCH', `/categories/${c.id}`, { zoneId: t2!.id })).statusCode).toBe(200);
  });

  test('vague lancée une fois : suppression refusée ; compétition lancée sans vague : pas de vagues ; zone portant des numéros figés : non supprimable', async () => {
    await many(4);
    await readyAll();
    const [matin, aprem] = await twoWaves();
    await launch(aprem!.id).then(() => launch(matin!.id));
    const kept = await call('PUT', '/waves', [{ id: aprem!.id, name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } }]);
    expect(kept.statusCode).toBe(409);
    expect(kept.json().error).toBe('La vague « Matin » a été lancée : elle ne peut plus être supprimée.');
  });

  test('sans vague, lancée : création de vagues refusée ; zone portant des numéros figés non supprimable', async () => {
    await many(4);
    await readyAll();
    await launch(null);
    const res = await call('PUT', '/waves', [{ name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('La compétition a été lancée sans vague : impossible de créer des vagues maintenant.');
    const zones = (await call('GET', '/zones')).json() as { id: string; name: string }[];
    const used = (await plan()).zones.find((z) => z.passages.length)!.zoneId;
    const res2 = await call('PUT', '/zones', zones.filter((z) => z.id !== used).map((z) => ({ id: z.id, name: z.name })));
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error).toContain('des combats figés y sont numérotés');
  });
});
