import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applyProposal, bulkPlan, detectCases, stateFingerprint } from '../../domain/replacement/index.js';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import {
  allProposals,
  displayedProposals,
  applyProposalById,
  bulkApply,
  closeWeighIn,
  findProposal,
  listRecasements,
  loadState,
  manualMove,
  manualProposal,
  previewTransition,
  refuseProposal,
  unrefuseProposal,
  setWeighIn,
  undoRecasement,
  weighInList,
} from '../repositories/replacement.js';

type P = { Params: { id: string } };
const mode = z.enum(['simple', 'all']);

export async function replacementRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
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

  app.get<P>('/api/competitions/:id/replacement', async (req) => {
    const state = await loadState(db, req.params.id);
    const proposals = allProposals(state);
    const shown = displayedProposals(state);
    const fighters = new Map(state.members.map((m) => [m.fighterId, m.presence]));
    const presence = [...fighters.values()];
    const cases = detectCases(state);
    return {
      cases,
      proposals: Object.fromEntries(shown),
      summary: {
        present: presence.filter((p) => p === 'present').length,
        absent: presence.filter((p) => p === 'absent').length,
        unknown: presence.filter((p) => p === 'unknown').length,
        cases: cases.length,
        alone: cases.filter((c) => c.kind === 'alone').length,
        withoutProposal: cases.filter((c) => (proposals.get(c.id) ?? []).length === 0).length,
        readyCategories: state.categories.filter((c) => c.status === 'ready').length,
        startedCategories: state.categories.filter((c) => c.status === 'started' || c.status === 'finished').length,
      },
      fingerprint: stateFingerprint(state),
      recasements: await listRecasements(db, req.params.id),
    };
  });

  app.post<P>('/api/competitions/:id/replacement/preview', async (req) => {
    const body = z
      .union([z.object({ proposalId: z.string() }), z.object({ bulk: mode }), z.object({ move: z.object({ registrationId: z.string(), categoryId: z.string() }) })])
      .parse(req.body);
    const state = await loadState(db, req.params.id);
    if ('move' in body) {
      const { p, warnings } = manualProposal(state, body.move.registrationId, body.move.categoryId);
      return { steps: [{ proposal: p, manual: true }], categories: previewTransition(state, applyProposal(state, p)), warnings };
    }
    if ('proposalId' in body) {
      const p = findProposal(state, body.proposalId);
      return { steps: [{ proposal: p, manual: p.manual }], categories: previewTransition(state, applyProposal(state, p)) };
    }
    const plan = bulkPlan(state, body.bulk);
    return { steps: plan.steps, categories: previewTransition(state, plan.final), unresolved: plan.unresolved.length };
  });

  app.post<P>('/api/competitions/:id/replacement/apply', async (req, reply) => {
    const { proposalId, fingerprint } = z.object({ proposalId: z.string(), fingerprint: z.string().optional() }).parse(req.body);
    await applyProposalById(db, req.params.id, proposalId, { fingerprint });
    return reply.status(200).send({ ok: true });
  });

  app.post<P>('/api/competitions/:id/replacement/bulk', async (req) => {
    const body = z.object({ mode, fingerprint: z.string() }).parse(req.body);
    return bulkApply(db, req.params.id, body.mode, body.fingerprint);
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

  app.post<P>('/api/competitions/:id/replacement/undo', async (req) => {
    const { recasementId } = z.object({ recasementId: z.string() }).parse(req.body);
    await undoRecasement(db, req.params.id, recasementId);
    return { ok: true };
  });

  app.post<P>('/api/competitions/:id/replacement/move', async (req) => {
    const { registrationId, categoryId } = z.object({ registrationId: z.string(), categoryId: z.string() }).parse(req.body);
    return manualMove(db, req.params.id, registrationId, categoryId);
  });
}
