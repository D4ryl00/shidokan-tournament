import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { keyString } from '../../src/domain/categories.js';
import type { CategoryKey } from '../../src/domain/categories.js';
import { categorySeed } from '../../src/server/repositories/category-seed.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let competitionId: string;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  competitionId = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${competitionId}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  n++;
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
type Cat = { id: string; key: CategoryKey; seed: number; registrationIds: string[] };

test('categorySeed : déterministe, dépend de la compétition et de la clé, entier 32 bits non signé', () => {
  expect(categorySeed('c1', 'k')).toBe(categorySeed('c1', 'k'));
  expect(categorySeed('c1', 'k')).not.toBe(categorySeed('c1', 'k2'));
  expect(categorySeed('c1', 'k')).not.toBe(categorySeed('c2', 'k'));
  const x = categorySeed('c1', 'k');
  expect(Number.isInteger(x)).toBe(true);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(2 ** 32);
});

test('catégorie créée par un déplacement : graine = categorySeed(compétition, clé)', async () => {
  const x = await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const r = (await call('GET', '/replacement')).json() as { cases: { id: string; kind: string; registrationId: string }[]; proposals: Record<string, { id: string; target: object }[]> };
  const c = r.cases.find((k) => k.kind === 'weight_out' && k.registrationId === x.id)!;
  const toNew = r.proposals[c.id]!.find((p) => 'newKey' in p.target)!;
  expect((await call('POST', '/replacement/apply', { proposalId: toNew.id })).statusCode).toBe(200);
  const cats = (await call('GET', '/categories')).json() as Cat[];
  const created = cats.find((k) => k.registrationIds.includes(x.id))!;
  expect(created.seed).toBe(categorySeed(competitionId, keyString(created.key)));
});

test('catégorie créée à l’inscription : graine = categorySeed(compétition, clé)', async () => {
  const a = await reg();
  const [cat] = (await call('GET', '/categories')).json() as Cat[];
  expect(cat!.registrationIds).toContain(a.id);
  expect(cat!.seed).toBe(categorySeed(competitionId, keyString(cat!.key)));
});

test('« Nouveau tirage » donne toujours une graine différente de l’ancienne', async () => {
  for (let i = 0; i < 4; i++) await reg();
  let [cat] = (await call('GET', '/categories')).json() as Cat[];
  for (let i = 0; i < 5; i++) {
    const next = (await call('POST', `/categories/${cat!.id}/redraw`)).json() as Cat;
    expect(next.seed).not.toBe(cat!.seed);
    cat = next;
  }
});
