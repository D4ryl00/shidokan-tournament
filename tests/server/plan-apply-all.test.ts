import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { forgetDisplayedPlans } from '../../src/server/plan/displayed.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/** « Appliquer aussi les déplacements à valider » : le plan affiché, appliqué en entier ; les demandes d'autorisation suivent. */
let app: FastifyInstance;
let base: string;
beforeEach(async () => {
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
type Choice =
  | { kind: 'validate'; proposalId: string; caseId: string }
  | { kind: 'refuse'; proposalId: string; registrationId: string; reason: string };
type PlanOut = { plan: { moves: { id: string; registrationId: string; manual: boolean; validated: boolean; reason: string }[]; hash: string }; fingerprint: string };
const plan = async (body: { choices?: Choice[]; forApply?: boolean } = {}) => (await call('POST', '/replacement/plan', { choices: [], ...body })).json() as PlanOut;
const applyAll = (choices: Choice[], p: PlanOut) => call('POST', '/replacement/plan/apply', { choices, withToValidate: true, fingerprint: p.fingerprint, hash: p.plan.hash });
type Recasement = { registrationId: string; type: string; manual: boolean; bulk: boolean; status: string };
const recasements = async () => ((await call('GET', '/replacement')).json() as { recasements: Recasement[] }).recasements;
type Entry = { kind: string; groupId: string | null; summary: { registrationIds: string[] } };
const history = async () => ((await call('GET', '/history')).json() as { entries: Entry[] }).entries;
type AuthList = { clubs: { requests: { registrationId: string; situation: { kind: string }; status: string }[] }[]; pending: number };
const authorizations = async () => (await call('GET', '/authorizations')).json() as AuthList;

/** Deux cadettes seules (-47, -54 : réunies sans validation) et une minime seule (monte chez les cadettes : à valider). */
async function seed() {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  return reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
}

test('avec les déplacements à valider : tout le plan affiché est appliqué, dans un seul groupe, et la demande apparaît', async () => {
  const mini = await seed();
  const shown = await plan();
  expect(shown.plan.moves).toHaveLength(2);
  expect(shown.plan.moves.find((m) => m.registrationId === mini.id)).toMatchObject({ manual: true, validated: false });
  const res = await applyAll([], shown);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ applied: 2 });
  // Écrit comme un déplacement validé à la main, en masse.
  expect((await recasements()).find((r) => r.registrationId === mini.id)).toMatchObject({ type: 'C', manual: true, bulk: true, status: 'validated' });
  const entries = (await history()).filter((e) => e.kind === 'plan');
  expect(entries).toHaveLength(2);
  expect(new Set(entries.map((e) => e.groupId)).size).toBe(1);
  expect(entries.flatMap((e) => e.summary.registrationIds)).toContain(mini.id);
  // La minime chez les cadettes : sa demande d'âge attend la réponse du club.
  const requests = (await authorizations()).clubs.flatMap((c) => c.requests);
  expect(requests.filter((r) => r.registrationId === mini.id).map((r) => [r.situation.kind, r.status])).toContainEqual(['age', 'pending']);
});

test('avec les déplacements à valider : plan affiché oublié (serveur redémarré), recalculé puis appliqué', async () => {
  const mini = await seed();
  const shown = await plan();
  forgetDisplayedPlans();
  expect((await applyAll([], shown)).json()).toEqual({ applied: 2 });
  expect((await recasements()).map((r) => r.registrationId)).toContain(mini.id);
});

test('avec les déplacements à valider : une ligne refusée n’est pas appliquée, le plan affiché avec le refus l’est', async () => {
  const mini = await seed();
  const m = (await plan()).plan.moves.find((x) => x.registrationId === mini.id)!;
  const choices: Choice[] = [{ kind: 'refuse', proposalId: m.id, registrationId: mini.id, reason: m.reason }];
  const shown = await plan({ choices });
  expect(shown.plan.moves.map((x) => x.id)).not.toContain(m.id);
  expect((await applyAll(choices, shown)).json()).toEqual({ applied: shown.plan.moves.length });
  // Les déplacements écrits sont ceux du plan affiché avec le refus, dans son ordre.
  const written = (await history()).filter((e) => e.kind === 'plan').map((e) => e.summary.registrationIds[0]!);
  expect(written.sort()).toEqual(shown.plan.moves.map((x) => x.registrationId).sort());
});

test('avec les déplacements à valider : le hash du plan à appliquer (sans validation) est refusé, rien n’est écrit', async () => {
  await seed();
  const toApply = await plan({ forApply: true });
  expect(toApply.plan.moves).toHaveLength(1);
  const res = await applyAll([], toApply);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
  expect(await recasements()).toEqual([]);
});

test('sans le drapeau, le hash du plan affiché est refusé : seul le plan à appliquer s’applique', async () => {
  await seed();
  const shown = await plan();
  const res = await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: shown.fingerprint, hash: shown.plan.hash });
  expect(res.statusCode).toBe(409);
  expect(await recasements()).toEqual([]);
});

test('avec les déplacements à valider : état changé depuis l’affichage, 409, rien n’est écrit', async () => {
  const mini = await seed();
  const shown = await plan();
  await call('PUT', `/weigh-in/${mini.fighterId}`, { weighInKg: 44 });
  expect((await applyAll([], shown)).statusCode).toBe(409);
  expect(await recasements()).toEqual([]);
});

test('« Refusée… » : déplacements en cause annulés puis leurs propositions refusées, le plan suivant ne les propose plus', async () => {
  const mini = await seed();
  const shown = await plan();
  const m = shown.plan.moves.find((x) => x.registrationId === mini.id)!;
  expect((await applyAll([], shown)).json()).toEqual({ applied: 2 });
  type Row = { registrationId: string; situation: { kind: string }; blame: string[]; blameProposalIds: string[] };
  const rows = (await (await call('GET', '/authorizations')).json() as { clubs: { requests: Row[] }[] }).clubs.flatMap((c) => c.requests);
  const age = rows.find((r) => r.registrationId === mini.id && r.situation.kind === 'age')!;
  expect(age.blameProposalIds).toContain(m.id);
  expect(age.blameProposalIds.every((id) => !id.startsWith('M:') && !id.startsWith('W:'))).toBe(true);
  // L'annulation seule ne suffit pas : le plan, déterministe, repropose le même déplacement.
  const { entries } = (await call('GET', '/history')).json() as { entries: { id: string; cascade: string[] }[] };
  const shownBatch = [...new Set(age.blame.flatMap((id) => [id, ...(entries.find((e) => e.id === id)?.cascade ?? [])]))];
  expect((await call('POST', '/history/undo', { ids: age.blame, expect: shownBatch })).statusCode).toBe(200);
  expect((await plan()).plan.moves.map((x) => x.id)).toContain(m.id);
  // Les refus de « Refusée… » (POST /replacement/refuse, comme sur les cartes) : le déplacement ne revient plus.
  for (const proposalId of age.blameProposalIds) expect((await call('POST', '/replacement/refuse', { proposalId })).statusCode).toBe(200);
  const next = await plan();
  expect(next.plan.moves.map((x) => x.id)).not.toContain(m.id);
  expect(next.plan.moves.some((x) => x.registrationId === mini.id && x.id === m.id)).toBe(false);
});
