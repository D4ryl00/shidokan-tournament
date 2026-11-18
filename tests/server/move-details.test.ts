import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

// Le plan se calcule dans ce fil (pas dans le fil de calcul) : plus rapide, et sans chargeur TypeScript dans le fil.
const jobs = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/server/plan/runner.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/server/plan/runner.js')>();
  const { planPayload } = await import('../../src/server/plan/compute.js');
  return {
    ...mod,
    runPlanJob: async (...[state, input, opts]: Parameters<typeof mod.runPlanJob>) => {
      jobs.count++;
      return planPayload(state, input, opts?.onProgress);
    },
  };
});

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
type Cat = { id: string; label: string; registrationIds: string[]; bracket: unknown };
type Details = { from: Cat | null; to: Cat; movers: string[] };
type Replacement = { cases: { id: string; kind: string; registrationId: string }[]; proposals: Record<string, { id: string; target: { categoryId?: string; newKey?: object } }[]> };
type Choice = { kind: 'validate'; proposalId: string; caseId: string };
type PlanOut = { fingerprint: string; plan: { hash: string; moves: { id: string; caseId: string; registrationId: string; target: { categoryId?: string } }[] } };
const details = (payload: object) => call('POST', '/replacement/details/preview', payload);
const categories = async () => (await call('GET', '/categories')).json() as Cat[];
const plan = async (choices: Choice[], forApply = false) => (await call('POST', '/replacement/plan', { choices, forApply })).json() as PlanOut;
/** Proposition de la carte « hors catégorie » de `registrationId` qui satisfait `pick`. */
async function cardProposal(registrationId: string, pick: (p: Replacement['proposals'][string][number]) => boolean) {
  const r = (await call('GET', '/replacement')).json() as Replacement;
  const c = r.cases.find((k) => k.kind === 'weight_out' && k.registrationId === registrationId)!;
  return { caseId: c.id, proposal: r.proposals[c.id]!.find(pick)! };
}

test('carte : De = catégorie actuelle, Vers = celle d’après, rien n’est écrit', async () => {
  // X (pesée 58 kg, inscrite -54) ; deux combattantes en -61 l'attendent.
  const x = await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-61', approxWeightKg: 60 });
  await reg({ weightClassId: 'cadet:F:-61', approxWeightKg: 60 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const before = await categories();
  const m61 = before.find((c) => c.label.includes('-61'))!;
  const { proposal } = await cardProposal(x.id, (p) => p.target.categoryId === m61.id);
  const history = (await call('GET', '/history')).json();
  const journal = (await call('GET', '/journal')).body;
  const res = await details({ proposalId: proposal.id });
  expect(res.statusCode).toBe(200);
  const d = res.json() as Details;
  expect(d.from!.registrationIds).toContain(x.id);
  expect(d.from!.label).toContain('-54');
  expect(d.to.id).toBe(m61.id);
  expect(d.to.registrationIds).toContain(x.id);
  expect(d.to.registrationIds).toHaveLength(3);
  expect(d.to.bracket).not.toBeNull();
  expect(d.movers).toEqual([x.id]);
  expect(await categories()).toEqual(before);
  expect((await call('GET', '/history')).json()).toEqual(history);
  expect((await call('GET', '/journal')).body).toBe(journal);
});

test('carte vers une catégorie vide : Vers a le tableau qu’écrit l’application', async () => {
  const x = await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const { proposal } = await cardProposal(x.id, (p) => 'newKey' in p.target);
  const d = (await details({ proposalId: proposal.id })).json() as Details;
  expect(d.to.registrationIds).toEqual([x.id]);
  // Créée à blanc : pas d'id (il disparaît avec l'annulation).
  expect(d.to.id).toBeUndefined();
  expect((await call('POST', '/replacement/apply', { proposalId: proposal.id })).statusCode).toBe(200);
  const to = (await categories()).find((c) => c.registrationIds.includes(x.id))!;
  expect(d.to.label).toBe(to.label);
  expect(d.to.bracket).toEqual(to.bracket);
});

/** X (58 kg) part dans une catégorie -61 créée en route ; Y, seule en +61, la rejoint ensuite (comme `plan-apply-anchor`). */
async function anchorPlan() {
  const x = await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  const y = await reg({ weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const { caseId, proposal } = await cardProposal(x.id, (p) => 'newKey' in p.target);
  const first = await plan([{ kind: 'validate', proposalId: proposal.id, caseId }]);
  const my = first.plan.moves.find((m) => m.registrationId === y.id)!;
  const choices: Choice[] = [
    { kind: 'validate', proposalId: proposal.id, caseId },
    { kind: 'validate', proposalId: my.id, caseId: my.caseId },
  ];
  return { x, y, choices, shown: await plan(choices) };
}

test('plan : la ligne k voit les lignes précédentes', async () => {
  const { x, y, choices, shown } = await anchorPlan();
  expect(shown.plan.moves.map((m) => m.registrationId)).toEqual([x.id, y.id]);
  expect(shown.plan.moves[1]!.target.categoryId).toMatch(/^new:/);
  const res = await details({ plan: { choices, fingerprint: shown.fingerprint, hash: shown.plan.hash }, moveId: shown.plan.moves[1]!.id });
  expect(res.statusCode).toBe(200);
  const d = res.json() as Details;
  expect(d.from!.registrationIds).toEqual([y.id]);
  expect(d.to.registrationIds).toEqual(expect.arrayContaining([x.id, y.id]));
  expect(d.movers).toEqual([y.id]);
  expect(d.from!.id).toEqual(expect.any(String));
  expect(d.to.id).toBeUndefined();
  // Ligne 1 : départ de -54, arrivée seule dans la catégorie créée.
  const d0 = (await details({ plan: { choices, fingerprint: shown.fingerprint, hash: shown.plan.hash }, moveId: shown.plan.moves[0]!.id })).json() as Details;
  expect(d0.from!.registrationIds).toContain(x.id);
  expect(d0.to.registrationIds).toEqual([x.id]);
  // Les mêmes lignes appliquées pour de vrai : le même tableau.
  const toApply = await plan(choices, true);
  expect(toApply.plan.moves.map((m) => m.registrationId)).toEqual([x.id, y.id]);
  const applied = await call('POST', '/replacement/plan/apply', { choices, fingerprint: toApply.fingerprint, hash: toApply.plan.hash });
  expect(applied.json()).toEqual({ applied: 2 });
  const to = (await categories()).find((c) => c.registrationIds.includes(y.id))!;
  expect(d.to.label).toBe(to.label);
  expect(d.to.bracket).not.toBeNull();
  expect(d.to.bracket).toEqual(to.bracket);
});

test('plan : sans le plan en mémoire (redémarrage), il est recalculé', async () => {
  const { y, choices, shown } = await anchorPlan();
  const { forgetDisplayedPlans } = await import('../../src/server/plan/displayed.js');
  forgetDisplayedPlans();
  const count = jobs.count;
  const res = await details({ plan: { choices, fingerprint: shown.fingerprint, hash: shown.plan.hash }, moveId: shown.plan.moves[1]!.id });
  expect(res.statusCode).toBe(200);
  expect(jobs.count).toBe(count + 1);
  expect((res.json() as Details).to.registrationIds).toContain(y.id);
  // Le plan recalculé est gardé : l'appel suivant ne recalcule plus.
  expect((await details({ plan: { choices, fingerprint: shown.fingerprint, hash: shown.plan.hash }, moveId: shown.plan.moves[0]!.id })).statusCode).toBe(200);
  expect(jobs.count).toBe(count + 1);
});

test('plan affiché (réponse JSON ou flux) : gardé en mémoire, pas recalculé pour les détails', async () => {
  const { y, choices, shown } = await anchorPlan();
  const body = { plan: { choices, fingerprint: shown.fingerprint, hash: shown.plan.hash }, moveId: shown.plan.moves[1]!.id };
  const count = jobs.count;
  expect((await details(body)).statusCode).toBe(200);
  expect(jobs.count).toBe(count);
  const { forgetDisplayedPlans } = await import('../../src/server/plan/displayed.js');
  forgetDisplayedPlans();
  const stream = await app.inject({ method: 'POST', url: `${base}/replacement/plan`, headers: { accept: 'application/x-ndjson' }, payload: { choices } });
  const result = stream.body.trim().split('\n').map((l) => JSON.parse(l) as { type: string; data?: PlanOut }).find((e) => e.type === 'result')!;
  expect(result.data!.plan.hash).toBe(shown.plan.hash);
  const after = jobs.count;
  const res = await details(body);
  expect((res.json() as Details).to.registrationIds).toContain(y.id);
  expect(jobs.count).toBe(after);
});

test('plan périmé : 409', async () => {
  const { choices, shown } = await anchorPlan();
  const moveId = shown.plan.moves[1]!.id;
  const badHash = await details({ plan: { choices, fingerprint: shown.fingerprint, hash: 'faux' }, moveId });
  expect(badHash.statusCode).toBe(409);
  expect(badHash.json().error).toBe('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
  const badMove = await details({ plan: { choices, fingerprint: shown.fingerprint, hash: shown.plan.hash }, moveId: 'inconnu' });
  expect(badMove.statusCode).toBe(409);
  expect(badMove.json().error).toBe('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
  const badFingerprint = await details({ plan: { choices, fingerprint: 'faux', hash: shown.plan.hash }, moveId });
  expect(badFingerprint.statusCode).toBe(409);
});

test('corps inconnu : 400', async () => {
  expect((await details({ proposalId: 'p', extra: 1 })).statusCode).toBe(400);
});

test('pas d’événement « change »', async () => {
  const x = await reg({ approxWeightKg: 52 });
  await reg({ approxWeightKg: 52 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const { proposal } = await cardProposal(x.id, (p) => 'newKey' in p.target);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const controller = new AbortController();
  const stream = await fetch(`${url}${base}/events`, { signal: controller.signal });
  const reader = stream.body!.getReader();
  let text = '';
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    } catch {
      /* flux fermé */
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  const res = await fetch(`${url}${base}/replacement/details/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposalId: proposal.id }) });
  expect(res.status).toBe(200);
  await new Promise((r) => setTimeout(r, 400));
  controller.abort();
  await reading;
  expect(text).toContain('event: hello');
  expect(text).not.toContain('event: change');
});
