import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import { applyAll, applyProposal, casesOfWave, categoryWave, detectCases, isClosedTarget, isLocked, memberWave, stateFingerprint } from '../../domain/replacement/index.js';
import type { AppDb } from '../db/client.js';
import { applyRulesView, rulesView, rulesViewSchema } from '../../domain/replacement/rules.js';
import { getAppSettings } from '../repositories/app-settings.js';
import { getCompetition, updateCompetition } from '../repositories/competitions.js';
import {
  allProposals,
  displayedProposals,
  applyProposalById,
  applyPlan,
  planInput,
  planResponse,
  closeWeighIn,
  knownWave,
  findProposal,
  listRecasements,
  resetReplacement,
  loadState,
  manualMove,
  manualProposal,
  previewTransition,
  refuseProposal,
  unrefuseProposal,
  setWeighIn,
  undoRecasement,
  withdrawRegistration,
  setAsideCase,
  resumeCase,
  setAsideNotes,
  weighInList, fighterPresence } from '../repositories/replacement.js';
import { PlanAbortedError, runPlanJob } from '../plan/runner.js';

type P = { Params: { id: string } };
/** Plan d'ensemble en flux : une ligne JSON par événement (progression, puis résultat ou erreur). */
const NDJSON = 'application/x-ndjson';
const planChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('validate'), proposalId: z.string(), caseId: z.string() }).strict(),
  z.object({ kind: z.literal('manual'), registrationId: z.string(), categoryId: z.string() }).strict(),
]);
const choices = z.array(planChoice).max(500);

export async function replacementRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });

  /** Liste des règles du plan d'ensemble : rangée, coupée et activée par la Table centrale. */
  app.put<P>('/api/competitions/:id/replacement/rules', async (req) => {
    const view = rulesViewSchema.parse(req.body);
    const current = (await getCompetition(db, req.params.id))!;
    const updated = await updateCompetition(db, req.params.id, { settings: applyRulesView(current.settings, view) });
    return rulesView(updated.settings);
  });

  /** Remet la liste de cette compétition à celle des réglages de l'application. */
  app.post<P>('/api/competitions/:id/replacement/rules/reset', async (req) => {
    const current = (await getCompetition(db, req.params.id))!;
    const updated = await updateCompetition(db, req.params.id, { settings: applyRulesView(current.settings, getAppSettings(db).defaultReplacementRules) });
    return rulesView(updated.settings);
  });

  app.get<P & { Querystring: { vague?: string } }>('/api/competitions/:id/weigh-in', async (req) => weighInList(db, req.params.id, req.query.vague || undefined));

  app.put<{ Params: { id: string; fighterId: string } }>('/api/competitions/:id/weigh-in/:fighterId', async (req, reply) => {
    const data = z
      .object({ presence: z.enum(['unknown', 'present', 'absent']).optional(), weighInKg: z.number().positive().max(250).nullable().optional(), waveId: z.string().optional() })
      .strict()
      .parse(req.body);
    await setWeighIn(db, req.params.id, req.params.fighterId, data);
    return reply.status(204).send();
  });

  app.post<P>('/api/competitions/:id/weigh-in/close', async (req) => {
    const { waveId } = z.object({ waveId: z.string().optional() }).strict().parse(req.body ?? {});
    return closeWeighIn(db, req.params.id, waveId);
  });

  /** Tableau de bord ; avec `?vague=` : cas, propositions et compteurs des catégories de cette vague. */
  app.get<P & { Querystring: { vague?: string } }>('/api/competitions/:id/replacement', async (req) => {
    const state = await loadState(db, req.params.id);
    const waveId = knownWave(state.waves, req.query.vague || undefined);
    const cases = casesOfWave(state, detectCases(state), waveId);
    const proposals = allProposals(state, cases);
    const shown = displayedProposals(state, cases);
    const inWave = waveId ? state.members.filter((m) => memberWave(state, m) === waveId) : state.members;
    const waveCategories = waveId ? state.categories.filter((c) => categoryWave(state, c) === waveId) : state.categories;
    // Par combattant, d'après ses inscriptions (de la vague) : présent s'il l'est dans l'une d'elles.
    const byFighter = new Map<string, typeof state.members>();
    for (const m of inWave) byFighter.set(m.fighterId, [...(byFighter.get(m.fighterId) ?? []), m]);
    const presence = [...byFighter.values()].map(fighterPresence);
    // Par cas : le combattant (pour comprendre le problème d'un coup d'œil) et les catégories où le déplacer à la main,
    // chacune avec les règles qu'enfreindrait le déplacement (aucune : déplacement cohérent avec les réglages).
    const byRegistration = new Map(state.members.map((m) => [m.registrationId, m]));
    const fighters = Object.fromEntries(
      cases.map((c) => {
        const m = byRegistration.get(c.registrationId)!;
        const { sex, ageBandCode, discipline, ruleset, weightClassId, weighInKg, approxWeightKg, otherDisciplines, acceptsJiyuFirst, presence } = m;
        return [c.registrationId, { sex, ageBandCode, discipline, ruleset, weightClassId, weighInKg, approxWeightKg, otherDisciplines, acceptsJiyuFirst, presence }];
      }),
    );
    const moveTargets = Object.fromEntries(
      cases.map((c) => {
        const m = byRegistration.get(c.registrationId)!;
        const targets = state.categories
          .filter((t) => t.id !== m.categoryId && !isLocked(t) && !isClosedTarget(state, t.key))
          .map((t) => ({ categoryId: t.id, warnings: manualProposal(state, m.registrationId, t.id).warnings }));
        return [c.id, targets];
      }),
    );
    // Les compteurs ne comptent que les cartes à traiter (pas celles mises de côté).
    const aside = new Set(state.setAside);
    const active = cases.filter((c) => !aside.has(c.id));
    return {
      cases,
      fighters,
      moveTargets,
      proposals: Object.fromEntries(shown),
      setAside: setAsideNotes(db, req.params.id, cases.filter((c) => aside.has(c.id)).map((c) => c.id)),
      summary: {
        present: presence.filter((p) => p === 'present').length,
        absent: presence.filter((p) => p === 'absent').length,
        unknown: presence.filter((p) => p === 'unknown').length,
        cases: active.length,
        setAside: cases.length - active.length,
        closed: active.filter((c) => c.kind === 'closed').length,
        alone: active.filter((c) => c.kind === 'alone').length,
        withoutProposal: active.filter((c) => (proposals.get(c.id) ?? []).length === 0).length,
        readyCategories: waveCategories.filter((c) => c.status === 'ready').length,
        startedCategories: waveCategories.filter((c) => c.status === 'started' || c.status === 'finished').length,
      },
      fingerprint: stateFingerprint(state),
      recasements: await listRecasements(db, req.params.id),
    };
  });

  app.post<P>('/api/competitions/:id/replacement/preview', async (req) => {
    const body = z
      .union([z.object({ proposalId: z.string() }), z.object({ move: z.object({ registrationId: z.string(), categoryId: z.string() }) })])
      .parse(req.body);
    const state = await loadState(db, req.params.id);
    if ('move' in body) {
      const { p, warnings } = manualProposal(state, body.move.registrationId, body.move.categoryId);
      return { steps: [{ proposal: p, manual: true }], categories: previewTransition(state, applyProposal(state, p)), warnings };
    }
    if ('proposalId' in body) {
      const p = findProposal(state, body.proposalId);
      return { steps: [{ proposal: p, manual: p.manual }], categories: previewTransition(state, applyAll(state, p)) };
    }
  });

  app.post<P>('/api/competitions/:id/replacement/apply', async (req, reply) => {
    const { proposalId, fingerprint } = z.object({ proposalId: z.string(), fingerprint: z.string().optional() }).parse(req.body);
    await applyProposalById(db, req.params.id, proposalId, { fingerprint });
    return reply.status(200).send({ ok: true });
  });

  /** Plan d'ensemble de la réaffectation (diagramme et plan), ou, avec `forApply`, plan à appliquer et aperçu. */
  app.post<P>('/api/competitions/:id/replacement/plan', async (req, reply) => {
    const body = z.object({ waveId: z.string().optional(), choices, forApply: z.boolean().optional() }).strict().parse(req.body);
    // Client parti avant la fin (changement de choix, page quittée) : le fil est arrêté.
    const gone = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) gone.abort();
    });
    if (!(req.headers.accept ?? '').includes(NDJSON)) return planResponse(db, req.params.id, body, { signal: gone.signal });
    // Flux : les erreurs d'avant le calcul (400, 404) restent des réponses JSON ordinaires.
    const { state, input } = await planInput(db, req.params.id, body);
    const out = new PassThrough();
    const send = (event: object) => {
      if (!out.writableEnded && !out.destroyed) out.write(`${JSON.stringify(event)}\n`);
    };
    runPlanJob(state, input, { signal: gone.signal, onProgress: (p) => send({ type: 'progress', ...p }) })
      .then(
        (data) => send({ type: 'result', data }),
        (e: unknown) => {
          if (gone.signal.aborted) return;
          const status = (e as { statusCode?: number }).statusCode ?? 500;
          if (status >= 500 && !(e instanceof PlanAbortedError)) req.log.error(e);
          send({ type: 'error', status, error: e instanceof PlanAbortedError ? e.message : 'Erreur interne du serveur' });
        },
      )
      .finally(() => {
        if (!out.destroyed) out.end();
      });
    // Mêmes en-têtes que le flux SSE : Caddy (encode gzip) ne doit pas retenir les lignes de progression.
    reply.header('Content-Encoding', 'identity').header('Cache-Control', 'no-cache, no-transform').header('X-Accel-Buffering', 'no');
    return reply.type(NDJSON).send(out);
  });

  app.post<P>('/api/competitions/:id/replacement/plan/apply', async (req) => {
    const body = z.object({ waveId: z.string().optional(), choices, fingerprint: z.string(), hash: z.string() }).strict().parse(req.body);
    return applyPlan(db, req.params.id, body);
  });

  app.post<P>('/api/competitions/:id/replacement/refuse', async (req) => {
    const { proposalId } = z.object({ proposalId: z.string() }).parse(req.body);
    await refuseProposal(db, req.params.id, proposalId);
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/unrefuse', async (req) => {
    const { proposalId } = z.object({ proposalId: z.string() }).parse(req.body);
    await unrefuseProposal(db, req.params.id, proposalId);
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/set-aside', async (req) => {
    const { caseId, note } = z.object({ caseId: z.string(), note: z.string().max(80).optional() }).strict().parse(req.body);
    await setAsideCase(db, req.params.id, caseId, note ?? '');
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/resume', async (req) => {
    const { caseId } = z.object({ caseId: z.string() }).strict().parse(req.body);
    await resumeCase(db, req.params.id, caseId);
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/withdraw', async (req) => {
    const { registrationId, fingerprint } = z.object({ registrationId: z.string(), fingerprint: z.string() }).strict().parse(req.body);
    await withdrawRegistration(db, req.params.id, registrationId, fingerprint);
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/undo', async (req) => {
    const { recasementId } = z.object({ recasementId: z.string() }).parse(req.body);
    await undoRecasement(db, req.params.id, recasementId);
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/reset', async (req) => ({ ok: true, ...(await resetReplacement(db, req.params.id)) }));

  app.post<P>('/api/competitions/:id/replacement/move', async (req) => {
    const { registrationId, categoryId } = z.object({ registrationId: z.string(), categoryId: z.string() }).parse(req.body);
    return manualMove(db, req.params.id, registrationId, categoryId);
  });
}
