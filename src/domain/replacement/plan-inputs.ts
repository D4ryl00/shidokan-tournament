import type { PlanChoice } from './plan.js';
import type { State } from './types.js';
import { memberWave } from './waves.js';

/**
 * L'état donné au calcul du plan, à partir des choix du poste : les refus faits dans le plan s'ajoutent aux refus des cartes ;
 * coche « Tenir compte des décisions prises sur les cartes » décochée, les refus des cartes et les mises de côté sont ignorés
 * (les cartes, elles, ne changent pas). Les refus ne sont jamais des épingles : `choices` ne les contient plus.
 * `stale` : refus du plan dont le combattant n'est plus dans la session (absent, supprimé, autre session) ; on ne juge pas sur
 * les propositions de l'état réel, un déplacement du plan pouvant venir d'un cas qui n'existe qu'au milieu du plan.
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
  const live = refusals.filter((c) => present(c.registrationId));
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
