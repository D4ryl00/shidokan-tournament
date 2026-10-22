import type { CombatFormat } from '../settings.js';

export type { CombatFormat };
export type BracketFormat = CombatFormat | 'kata_two_rounds';

export interface Entrant {
  registrationId: string;
  clubId: string | null;
  label: string;
}

export type SlotSource =
  | { kind: 'entrant'; registrationId: string }
  | { kind: 'bye' }
  | { kind: 'winner' | 'loser'; matchId: string }
  /** Poules puis tableau : rang dans une poule. */
  | { kind: 'poolRank'; pool: number; rank: number }
  /** Repêchage : combattant battu par le finaliste de la moitié `half` au tour `round` (exemption → bye). */
  | { kind: 'beatenBy'; half: 0 | 1; round: number }
  | { kind: 'empty' };

export type MatchPhase = 'main' | 'repechage' | 'third_place' | 'losers' | 'grand_final' | 'pool' | 'series';

export interface Match {
  id: string;
  phase: MatchPhase;
  round: number;
  order: number;
  a: SlotSource;
  b: SlotSource;
  pool?: number;
  /** 3e manche d'un meilleur des trois : jouée seulement à 1-1. */
  optional?: boolean;
}

export interface CombatBracket {
  kind: 'combat';
  format: CombatFormat;
  entrants: Entrant[];
  matches: Match[];
  /** Poules (identifiants d'inscription), pour round_robin et pools_then_bracket. */
  pools?: string[][];
  options: { repechage: boolean; thirdPlace: boolean };
  seed: number;
}

export type MatchMethod = 'points' | 'decision' | 'ko' | 'abandon' | 'disqualification' | 'forfeit';

export interface MatchResult {
  winner: 'a' | 'b';
  method: MatchMethod;
  score?: string;
}

export interface ResolvedMatch extends Match {
  entrantA: string | null;
  entrantB: string | null;
  result: MatchResult | null;
  /** Les deux combattants sont connus et le match doit être disputé. */
  playable: boolean;
  /** Un côté est une exemption : le match n'est pas disputé. */
  bye: boolean;
}

export interface Podium {
  first: string | null;
  second: string | null;
  thirds: string[];
  complete: boolean;
  /** Égalités à trancher par l'organisateur (poules, kata). */
  ties: string[][];
  /** Portée de chaque égalité (même ordre que `ties`) : « pool:<n> », « kata » (tour 1) ou « kata:final ». */
  tieScopes?: string[];
}
