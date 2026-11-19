import type { Bracket, CombatBracket } from '../brackets/index.js';

/**
 * Combat(s) pour la 1re place d'un tableau, ceux qui passent sur la zone des finales : finale du tableau, grande finale,
 * finale à trois, combat unique, manches d'un meilleur des trois. Une poule unique n'en a pas.
 */
export function finalMatchIds(bracket: CombatBracket): string[] {
  const ids = new Set(bracket.matches.map((m) => m.id));
  const mainRounds = Math.max(0, ...bracket.matches.filter((m) => m.phase === 'main').map((m) => m.round));
  switch (bracket.format) {
    case 'round_robin':
      return [];
    case 'best_of_three':
      return bracket.matches.filter((m) => m.phase === 'series').map((m) => m.id);
    case 'double_elimination':
      return ids.has('gf') ? ['gf'] : [];
    case 'three_with_repechage':
      return ids.has('m3') ? ['m3'] : [];
    default:
      return mainRounds > 0 && ids.has(`w${mainRounds}-0`) ? [`w${mainRounds}-0`] : [];
  }
}

/** Passage de finale : bloc de finale d'un kata, ou combat pour la 1re place ; un bloc de kata entier n'en est pas une à part. */
export function isFinalPassage(bracket: Bracket | null, matchId: string | null): boolean {
  return matchId === 'kata:finale' || (bracket?.kind === 'combat' && matchId !== null && finalMatchIds(bracket).includes(matchId));
}
