import { keyString } from '../categories.js';
import type { State } from './types.js';

export { applyAll, applyProposal, proposalMoves, recompute } from './move.js';

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
    x: [...state.closedEntries].sort(),
    a: [...state.setAside].sort(),
    s: state.settings,
    g: state.grid,
  });
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
