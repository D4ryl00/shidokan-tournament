import { DISCIPLINES } from '../disciplines.js';
import { isClosedTarget } from './detect.js';
import { moveViolations } from './propose.js';
import type { Proposal, State } from './types.js';
import { waveEffects } from './waves.js';

export type ManualProposalError = 'not-found' | 'locked' | 'frozen' | 'closed';

/**
 * Proposition « déplacement manuel » (type M) et ses avertissements. Erreur si l'inscription ou la catégorie est
 * introuvable, si l'une des deux catégories est lancée (`frozen` : d'une session lancée), ou si la cible est fermée.
 */
export function manualProposal(
  state: State,
  registrationId: string,
  categoryId: string,
): { p: Proposal; warnings: string[] } | { error: ManualProposalError } {
  const m = state.members.find((x) => x.registrationId === registrationId);
  const t = state.categories.find((c) => c.id === categoryId);
  if (!m || !t) return { error: 'not-found' };
  const source = state.categories.find((c) => c.id === m.categoryId);
  // Catégorie lancée, ou d'une vague lancée (fermée au recasement).
  const locked = (c: { status: string; frozen?: boolean } | undefined) => c?.status === 'started' || c?.status === 'finished' || c?.frozen === true;
  if (locked(t) || locked(source)) return { error: t.frozen || source?.frozen ? 'frozen' : 'locked' };
  // Liste affichée avant la fermeture, ou appel direct : une catégorie fermée n'accueille personne.
  if (isClosedTarget(state, t.key)) return { error: 'closed' };
  const warnings = moveViolations(state, m, t);
  const toKata = !DISCIPLINES[t.key.discipline].hasWeight && DISCIPLINES[m.discipline].hasWeight;
  if (toKata) warnings.push(`Passage en ${DISCIPLINES[t.key.discipline].label.toLowerCase()} : règlement et catégorie de poids retirés.`);
  const p: Omit<Proposal, 'waveChange' | 'waveShifts'> = {
    id: `M:${registrationId}>${categoryId}`,
    caseId: 'manual',
    type: 'M',
    registrationId,
    target: { categoryId },
    changes: {
      ...(t.key.discipline !== m.discipline ? { discipline: t.key.discipline } : {}),
      ...(t.key.ruleset && t.key.ruleset !== m.ruleset ? { ruleset: t.key.ruleset } : {}),
      ...(toKata ? { ruleset: null, weightClassId: null } : {}),
    },
    checks: { weightGapKg: 0, threshold: 0, ageMove: 'same', crossesMinorAdult: false, mixedSex: t.key.sex !== m.sex, ageDirections: [] },
    rules: [],
    manual: true,
    preApproved: false,
    reason: 'Déplacement manuel',
    rank: 0,
  };
  return { p: { ...p, ...waveEffects(state, p) }, warnings };
}
