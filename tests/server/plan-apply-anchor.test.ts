import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/** Plan à appliquer dont les déplacements vers une catégorie créée en route ont perdu leur ancre (cas qu'on ne sait pas produire autrement). */
const hooks = vi.hoisted(() => ({ dropAnchors: false }));
vi.mock('../../src/domain/replacement/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/domain/replacement/index.js')>();
  return {
    ...mod,
    computePlan: (...args: Parameters<typeof mod.computePlan>) => {
      const r = mod.computePlan(...args);
      if (!hooks.dropAnchors) return r;
      return { ...r, moves: r.moves.map((m) => ('categoryId' in m.target && m.target.categoryId.startsWith('new:') ? { ...m, anchor: null } : m)) };
    },
  };
});
// Le faux `computePlan` ne vaut que dans ce fil : le plan se calcule donc ici, pas dans le fil de calcul.
vi.mock('../../src/server/plan/runner.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/server/plan/runner.js')>();
  const { planPayload } = await import('../../src/server/plan/compute.js');
  return { ...mod, runPlanJob: async (...[state, input, opts]: Parameters<typeof mod.runPlanJob>) => planPayload(state, input, opts?.onProgress) };
});

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  hooks.dropAnchors = false;
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
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

test('déplacement vers une catégorie créée en route, sans ancre : 409 « relisez-le », pas d’erreur 500', async () => {
  // X (pesée 58 kg, inscrite -54) part dans une catégorie -61 vide ; Y, seule en +61, la rejoint ensuite.
  const x = await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const r = (await call('GET', '/replacement')).json() as { cases: { id: string; kind: string; registrationId: string }[]; proposals: Record<string, { id: string; target: object }[]> };
  const c = r.cases.find((k) => k.kind === 'weight_out' && k.registrationId === x.id)!;
  const toNew = r.proposals[c.id]!.find((p) => 'newKey' in p.target)!;
  const choices = [{ kind: 'validate', proposalId: toNew.id, caseId: c.id }];
  hooks.dropAnchors = true;
  const p = (await call('POST', '/replacement/plan', { choices, forApply: true })).json() as { fingerprint: string; plan: { hash: string; moves: { target: { categoryId?: string }; anchor: string | null }[] } };
  expect(p.plan.moves[1]).toMatchObject({ target: { categoryId: expect.stringMatching(/^new:/) }, anchor: null });
  const res = await call('POST', '/replacement/plan/apply', { choices, fingerprint: p.fingerprint, hash: p.plan.hash });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
});
