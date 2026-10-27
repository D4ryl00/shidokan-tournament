import type { PlanChoice } from './plan.js';
import type { State } from './types.js';
import { memberWave } from './waves.js';

/**
 * L'état donné au calcul du plan, à partir des choix du poste : les refus faits dans le plan s'ajoutent aux refus des cartes ;
 * coche « Tenir compte des décisions prises sur les cartes » décochée, les refus des cartes et les mises de côté sont ignorés
 * (les cartes, elles, ne changent pas). Les refus ne sont jamais des épingles : `choices` ne les contient plus.
 * `stale` : refus du plan dont le combattant n'est plus dans la session (absent, supprimé, autre session) ou a quitté la catégorie
 * de départ du déplacement refusé ; on ne juge pas sur les propositions de l'état réel, un déplacement du plan pouvant venir
 * d'un cas qui n'existe qu'au milieu du plan.
 */
export function preparePlanState(
  state: State,
  choices: PlanChoice[],
  cardDecisions: boolean,
  waveId: string | null,
): { state: State; choices: PlanChoice[]; stale: PlanChoice[] } {
  const present = (registrationId: string) => {
    const m = state.members.find((x) => x.registrationId === registrationId);
    return !!m && !!m.categoryId && m.presence !== 'absent' && (waveId === null || memberWave(state, m) === waveId);
  };
  const refusals = choices.filter((c) => c.kind === 'refuse');
  // Combattant déplacé pour de vrai depuis le refus (plan appliqué, carte validée) : le déplacement refusé n'existe plus.
  // Une catégorie créée en route (`new:…`) ou un refus sans catégorie de départ ne se compare pas.
  const moved = (c: (typeof refusals)[number]) => {
    const from = c.fromCategoryId;
    if (!from || from.startsWith('new:')) return false;
    return state.members.find((x) => x.registrationId === c.registrationId)?.categoryId !== from;
  };
  const live = refusals.filter((c) => present(c.registrationId) && !moved(c));
  return {
    state: {
      ...state,
      refused: [...new Set([...(cardDecisions ? state.refused : []), ...live.map((c) => c.proposalId)])],
      setAside: cardDecisions ? state.setAside : [],
    },
    choices: choices.filter((c) => c.kind !== 'refuse'),
    stale: refusals.filter((c) => !live.includes(c)),
  };
}
