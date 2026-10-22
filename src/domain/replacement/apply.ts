import { keyString } from '../categories.js';
import { detectCases } from './detect.js';
import { proposalsFor } from './propose.js';
import { applyProposal } from './move.js';
import type { Case, Proposal, State } from './types.js';
import { casesOfWave } from './waves.js';

export { applyProposal, recompute } from './move.js';

export type BulkMode = 'simple' | 'all';
export interface BulkStep {
  proposal: Proposal;
  manual: boolean;
}

/**
 * Prochaine étape d'un recasement en masse : meilleure proposition sans changement de vague (ni du combattant, ni entraîné) du premier cas traitable
 * de la vague (`null` : toutes), hors inscriptions déjà déplacées. Un changement de vague se valide un par un.
 */
export function nextBulkStep(state: State, mode: BulkMode, moved: Set<string>, waveId: string | null = null): Proposal | null {
  for (const c of casesOfWave(state, detectCases(state), waveId)) {
    if (moved.has(c.registrationId)) continue;
    const p = proposalsFor(state, c).find((x) => !x.waveChange && x.waveShifts.length === 0 && (mode === 'all' || x.type === 'A' || x.type === 'R'));
    if (p) return p;
  }
  return null;
}

/** Applique la meilleure proposition du premier cas traitable, recalcule, recommence ; une étape par inscription au plus. */
export function bulkPlan(state: State, mode: BulkMode, waveId: string | null = null): { steps: BulkStep[]; final: State; unresolved: Case[] } {
  let current = state;
  const steps: BulkStep[] = [];
  const moved = new Set<string>();
  for (let guard = 0; guard <= state.members.length; guard++) {
    const p = nextBulkStep(current, mode, moved, waveId);
    if (!p) break;
    current = applyProposal(current, p);
    steps.push({ proposal: p, manual: p.manual });
    moved.add(p.registrationId);
  }
  return { steps, final: current, unresolved: casesOfWave(current, detectCases(current), waveId) };
}

export function stateFingerprint(state: State): string {
  const data = JSON.stringify({
    m: [...state.members]
      .sort((a, b) => a.registrationId.localeCompare(b.registrationId))
      .map((m) => [
        m.registrationId, m.categoryId, m.presence, m.weighInKg, m.approxWeightKg, m.weightClassId, m.discipline, m.ruleset, m.ageBandCode, m.sex,
        m.placementLocked, m.clubId, m.clubPreApproval, m.otherDisciplines, m.acceptsJiyuFirst, m.original, m.recasementType,
      ]),
    c: [...state.categories].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, keyString(c.key), c.status, c.aliasKeys, c.waveOverride]),
    w: [...state.waves].sort((a, b) => a.id.localeCompare(b.id)).map((w) => [w.id, w.order, w.rules]),
    r: [...state.refused].sort(),
    s: state.settings,
    g: state.grid,
  });
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
