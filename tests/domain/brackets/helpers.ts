import { resolveBracket } from '../../../src/domain/brackets/index.js';
import type { CombatBracket, Entrant, MatchResult, ResolvedMatch } from '../../../src/domain/brackets/types.js';

export function entrants(n: number, clubOf: (i: number) => string | null = (i) => `club${i}`): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({ registrationId: `r${i + 1}`, clubId: clubOf(i), label: `E${i + 1}` }));
}

/** Joue tous les matchs jouables ; `pick` choisit le vainqueur (par défaut : le côté a). */
export function play(b: CombatBracket, pick: (m: ResolvedMatch) => 'a' | 'b' = () => 'a') {
  const results: Record<string, MatchResult> = {};
  for (let guard = 0; guard < 500; guard++) {
    const { matches } = resolveBracket(b, results);
    const next = matches.find((m) => m.playable && !m.result);
    if (!next) break;
    results[next.id] = { winner: pick(next), method: 'points' };
  }
  return { ...resolveBracket(b, results), results };
}

/** Vainqueur = plus petit numéro d'inscription (r1 bat tout le monde, etc.). */
export const bestWins = (m: ResolvedMatch): 'a' | 'b' => (Number(m.entrantA!.slice(1)) < Number(m.entrantB!.slice(1)) ? 'a' : 'b');
