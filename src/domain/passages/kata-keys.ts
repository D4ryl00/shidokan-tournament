import type { KataBracket } from '../brackets/index.js';

/** Passage d'un kata : un kataka du tour 1, ou une des deux places de la finale (ordre de `resolveKata(...).finalists`). */
export type KataKey = { round: 'tour1'; registrationId: string } | { round: 'finale'; slot: 1 | 2 };

const TOUR1 = 'kata:tour1:';
const FINALE = 'kata:finale:';

export const kataTour1Key = (registrationId: string) => `${TOUR1}${registrationId}`;
export const kataFinaleKey = (slot: 1 | 2) => `${FINALE}${slot}`;
/** Clé d'un passage de kata (les anciennes clés de bloc `kata`, `kata:tour1`, `kata:finale` comprises). */
export const isKataKey = (matchId: string) => matchId.startsWith('kata:');

/** Clé d'un passage de kata lue ; null pour un combat ou une ancienne clé de bloc. */
export function parseKataKey(matchId: string): KataKey | null {
  if (matchId.startsWith(TOUR1) && matchId.length > TOUR1.length) return { round: 'tour1', registrationId: matchId.slice(TOUR1.length) };
  if (matchId === kataFinaleKey(1)) return { round: 'finale', slot: 1 };
  if (matchId === kataFinaleKey(2)) return { round: 'finale', slot: 2 };
  return null;
}

/** Passage qui ouvre un tour (premier kataka du tirage, place 1 de la finale) : le seul du tour qui porte un changement. */
export function opensKataRound(bracket: KataBracket, matchId: string): boolean {
  const first = bracket.order[0];
  return (first !== undefined && matchId === kataTour1Key(first)) || matchId === kataFinaleKey(1);
}

/**
 * Passages d'un kata, dans l'ordre : tour 1 dans l'ordre du tirage (absents tardifs compris), seulement au-delà de deux
 * katakas ; puis la finale, une place par finaliste (deux au plus).
 */
export function kataKeys(bracket: KataBracket, part: 'whole' | 'tour1' | 'finale'): string[] {
  const tour1 = bracket.order.length > 2 ? bracket.order.map(kataTour1Key) : [];
  const finale = ([1, 2] as const).slice(0, Math.min(bracket.entrants.length, 2)).map(kataFinaleKey);
  if (part === 'tour1') return tour1;
  if (part === 'finale') return finale;
  return [...tour1, ...finale];
}
