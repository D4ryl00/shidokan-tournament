import { eq } from 'drizzle-orm';
import type { Category } from '../../domain/categories.js';
import type { DetailsCategory, MoveDetails, MoveDetailsBody } from '../../domain/replacement/move-details.js';
import { stateFingerprint, type PlanMove, type Proposal } from '../../domain/replacement/index.js';
import { dryRun } from '../db/atomic.js';
import type { AppDb } from '../db/client.js';
import { categories } from '../db/schema.js';
import { recallDisplayedPlan } from '../plan/displayed.js';
import { runPlanJob } from '../plan/runner.js';
import { listCategories } from './categories.js';
import { actionWave, findProposal, loadState, persistAll, PLAN_CHANGED, planWave, StaleProposalError, writePlanMove } from './replacement.js';

/**
 * De et Vers d'un déplacement, joué à blanc (tout est annulé : ni catégorie, ni historique, ni journal ne restent).
 * Carte : la proposition écrite comme par `applyProposalById`. Ligne du plan affiché : ses lignes rejouées dans l'ordre, avec
 * l'écriture d'`applyPlan`, jusqu'à `moveId` ; De = juste avant elle, Vers = juste après.
 */
export async function moveDetails(db: AppDb, competitionId: string, body: MoveDetailsBody): Promise<MoveDetails> {
  if ('proposalId' in body) {
    return dryRun(db, async () => {
      const known = categoryIds(db, competitionId);
      const state = await loadState(db, competitionId);
      const p = findProposal(state, body.proposalId);
      const before = await listCategories(db, competitionId);
      persistAll(db, competitionId, state, p, { bulk: false, waveId: actionWave(state, p.caseId, p.registrationId) });
      await loadState(db, competitionId);
      return result(p, before, await listCategories(db, competitionId), known);
    });
  }
  const { plan, moveId } = body;
  const waveId = await planWave(db, competitionId, plan.waveId);
  const state = await loadState(db, competitionId);
  if (stateFingerprint(state) !== plan.fingerprint) throw new StaleProposalError();
  // Le plan affiché, gardé à la fin de son calcul ; sinon recalculé dans le fil, avant de prendre le verrou d'écriture.
  let moves: PlanMove[] | undefined = recallDisplayedPlan(competitionId, plan.fingerprint, plan.hash);
  const recomputed = moves === undefined;
  if (!moves) {
    const r = await runPlanJob(state, { waveId, choices: plan.choices, forApply: false, cardDecisions: plan.cardDecisions !== false });
    if (r.plan.hash !== plan.hash) throw new StaleProposalError(PLAN_CHANGED);
    moves = r.plan.moves;
  }
  const k = moves.findIndex((m) => m.id === moveId);
  if (k < 0) throw new StaleProposalError(PLAN_CHANGED);
  const lines = moves;
  return dryRun(db, async () => {
    const known = categoryIds(db, competitionId);
    // Pendant le calcul, un autre poste a pu écrire : comme `applyPlan`, l'empreinte est revérifiée.
    if (recomputed && stateFingerprint(await loadState(db, competitionId)) !== plan.fingerprint) throw new StaleProposalError();
    const opts = { groupId: crypto.randomUUID(), waveId };
    for (const move of lines.slice(0, k)) await writePlanMove(db, competitionId, move, opts);
    const before = await listCategories(db, competitionId);
    await writePlanMove(db, competitionId, lines[k]!, opts);
    return result(lines[k]!, before, await listCategories(db, competitionId), known);
  });
}

/** Ids des catégories en base avant l'essai : les autres n'ont pas d'id à montrer (il disparaît avec l'annulation). */
const categoryIds = (db: AppDb, competitionId: string) =>
  new Set(db.select({ id: categories.id }).from(categories).where(eq(categories.competitionId, competitionId)).all().map((r) => r.id));

function result(p: Pick<Proposal, 'registrationId' | 'alsoMoved'>, before: Category[], after: Category[], known: Set<string>): MoveDetails {
  const shown = ({ id, ...c }: Category): DetailsCategory => (known.has(id) ? { id, ...c } : c);
  const holding = (list: Category[]) => list.find((c) => c.registrationIds.includes(p.registrationId));
  const from = holding(before);
  const to = holding(after);
  if (!to) throw new StaleProposalError();
  return { from: from ? shown(from) : null, to: shown(to), movers: [p.registrationId, ...(p.alsoMoved ?? [])] };
}
