import { detectCases } from '../../../src/domain/replacement/detect.js';
import { applyAll, proposalMoves } from '../../../src/domain/replacement/move.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import { aloneRegistrations } from '../../../src/domain/replacement/plan.js';
import type { Proposal, State } from '../../../src/domain/replacement/types.js';
import { casesOfWave } from '../../../src/domain/replacement/waves.js';

/**
 * Copie de l'ancien calcul « carte par carte » (`nextBulkStep` / `bulkPlan` de apply.ts, mode `all`), pour comparer.
 * Écart voulu : les cas `weight_gap` sont ignorés, car le plan d'ensemble ne les traite pas (spec §5.1).
 */
function nextStep(state: State, moved: Set<string>, waveId: string | null): Proposal | null {
  for (const c of casesOfWave(state, detectCases(state), waveId)) {
    if (c.kind === 'weight_gap') continue;
    if (moved.has(c.registrationId) || state.setAside.includes(c.id)) continue;
    const p = proposalsFor(state, c).find((x) => !x.waveChange && x.waveShifts.length === 0 && x.registrationId === c.registrationId);
    if (p) return p;
  }
  return null;
}

/** Nombre d'inscriptions seules après l'ancien calcul glouton. */
export function greedyAlone(state: State, waveId: string | null): number {
  let current = state;
  const moved = new Set<string>();
  for (let guard = 0; guard <= state.members.length; guard++) {
    const p = nextStep(current, moved, waveId);
    if (!p) break;
    current = applyAll(current, p);
    for (const x of proposalMoves(p)) moved.add(x.registrationId);
  }
  return aloneRegistrations(current, waveId).length;
}
