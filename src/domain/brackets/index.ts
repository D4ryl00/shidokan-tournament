import type { CompetitionSettings } from '../settings.js';
import type { DisciplineId } from '../types.js';
import { doubleElimination, singleElimination } from './elimination.js';
import { kataBracket, type KataBracket } from './kata.js';
import { bestOfThree, poolsThenBracket, rankPool, roundRobin, singleMatch, threeWithRepechage } from './pools.js';
import type { BracketFormat, CombatBracket, Entrant, MatchResult, Podium, ResolvedMatch, SlotSource } from './types.js';

export * from './types.js';
export type { KataBracket, KataScores } from './kata.js';
export type Bracket = CombatBracket | KataBracket;

/** Côté d'un match : identifiant d'inscription, exemption, ou pas encore connu (null). */
type Side = string | 'bye' | null;
interface Outcome {
  winner: Side;
  loser: Side;
}
const BYE = 'bye';

export function compatibleFormats(discipline: DisciplineId, count: number): BracketFormat[] {
  if (discipline === 'kata') return ['kata_two_rounds'];
  if (count <= 1) return ['single_elimination'];
  if (count === 2) return ['single_match', 'best_of_three'];
  const list: BracketFormat[] = ['round_robin', 'single_elimination', 'double_elimination'];
  if (count === 3) list.unshift('three_with_repechage');
  if (count > 8) list.splice(list.indexOf('round_robin'), 1);
  if (count >= 6) list.push('pools_then_bracket');
  return list;
}

export function defaultFormat(discipline: DisciplineId, count: number, settings: CompetitionSettings): BracketFormat {
  if (discipline === 'kata') return 'kata_two_rounds';
  const wanted = count === 2 ? settings.formats.two : count === 3 ? settings.formats.three : settings.formats.fourPlus;
  if (compatibleFormats(discipline, count).includes(wanted)) return wanted;
  return count === 2 ? 'single_match' : count === 3 ? 'round_robin' : 'single_elimination';
}

export function generateBracket(
  format: BracketFormat,
  entrants: Entrant[],
  options: { repechage: boolean; thirdPlace: boolean; kataBronzeCount: 1 | 2 },
  seed: number,
): Bracket {
  const opts = { repechage: options.repechage, thirdPlace: options.thirdPlace };
  switch (format) {
    case 'kata_two_rounds':
      return kataBracket(entrants, options.kataBronzeCount, seed);
    case 'single_match':
      return singleMatch(entrants, seed);
    case 'best_of_three':
      return bestOfThree(entrants, seed);
    case 'round_robin':
      return roundRobin(entrants, seed);
    case 'three_with_repechage':
      return threeWithRepechage(entrants, seed);
    case 'double_elimination':
      return doubleElimination(entrants, seed);
    case 'pools_then_bracket':
      return poolsThenBracket(entrants, seed, opts);
    case 'single_elimination':
      return singleElimination(entrants, opts, seed);
  }
}

/**
 * Remplit les cases d'un tableau de combat d'après les résultats et calcule le podium.
 * `tieBreaks[pool]` : ordre imposé par l'organisateur pour départager une égalité de poule.
 */
export function resolveBracket(
  bracket: CombatBracket,
  results: Record<string, MatchResult>,
  tieBreaks: Record<number, string[]> = {},
): { matches: ResolvedMatch[]; podium: Podium } {
  const byId = new Map(bracket.matches.map((m) => [m.id, m]));
  const mainRounds = Math.max(0, ...bracket.matches.filter((m) => m.phase === 'main').map((m) => m.round));
  const outcomes = new Map<string, Outcome>();
  const sidesCache = new Map<string, [Side, Side]>();
  const poolCache = new Map<number, { ranking: string[]; ties: string[][] } | null>();

  const sides = (id: string): [Side, Side] => {
    let s = sidesCache.get(id);
    if (!s) {
      const m = byId.get(id)!;
      s = [sideOf(m.a), sideOf(m.b)];
      sidesCache.set(id, s);
    }
    return s;
  };

  /** Meilleur des trois : la manche décisive n'a lieu qu'à 1-1. */
  const seriesDeciderNeeded = (): boolean | null => {
    const firsts = bracket.matches.filter((m) => m.phase === 'series' && !m.optional);
    if (firsts.some((m) => !results[m.id])) return null;
    const winners = firsts.map((m) => sides(m.id)[results[m.id]!.winner === 'a' ? 0 : 1]);
    return winners[0] !== winners[1];
  };

  const outcome = (id: string): Outcome => {
    const cached = outcomes.get(id);
    if (cached) return cached;
    const m = byId.get(id)!;
    const [a, b] = sides(id);
    let o: Outcome = { winner: null, loser: null };
    if (m.optional && seriesDeciderNeeded() !== true) o = { winner: seriesDeciderNeeded() === false ? BYE : null, loser: null };
    else if (a === BYE && b === BYE) o = { winner: BYE, loser: BYE };
    else if (a === BYE && b !== null) o = { winner: b, loser: BYE };
    else if (b === BYE && a !== null) o = { winner: a, loser: BYE };
    else if (a !== null && b !== null && results[id]) {
      o = results[id]!.winner === 'a' ? { winner: a, loser: b } : { winner: b, loser: a };
    }
    outcomes.set(id, o);
    return o;
  };

  const poolResult = (pool: number) => {
    if (poolCache.has(pool)) return poolCache.get(pool)!;
    const games = bracket.matches.filter((m) => m.phase === 'pool' && m.pool === pool);
    let res: { ranking: string[]; ties: string[][] } | null = null;
    if (games.every((m) => outcome(m.id).winner !== null)) {
      const played = games.map((m) => {
        const [a, b] = sides(m.id) as [string, string];
        return { a, b, winner: outcome(m.id).winner as string };
      });
      res = rankPool(bracket.pools?.[pool] ?? [], played, tieBreaks[pool]);
    }
    poolCache.set(pool, res);
    return res;
  };

  const poolRank = (pool: number, rank: number): Side => {
    const res = poolResult(pool);
    if (!res) return null;
    const id = res.ranking[rank - 1];
    if (!id) return BYE;
    const tiedAtRank = res.ties.some((t) => t.includes(id));
    return tiedAtRank ? null : id;
  };

  /** Repêchage : battu par le finaliste de la moitié `half` au tour `round`. */
  const beatenBy = (half: 0 | 1, round: number): Side => {
    const finalist = outcome(`w${mainRounds - 1}-${half}`).winner;
    if (finalist === null) return null;
    if (finalist === BYE) return BYE;
    const m = bracket.matches.find((x) => x.phase === 'main' && x.round === round && outcome(x.id).winner === finalist);
    return m ? outcome(m.id).loser : null;
  };

  function sideOf(src: SlotSource): Side {
    switch (src.kind) {
      case 'entrant':
        return src.registrationId;
      case 'bye':
      case 'empty':
        return BYE;
      case 'winner':
        return outcome(src.matchId).winner;
      case 'loser':
        return outcome(src.matchId).loser;
      case 'beatenBy':
        return beatenBy(src.half, src.round);
      case 'poolRank':
        return poolRank(src.pool, src.rank);
    }
  }

  const real = (s: Side) => (s === null || s === BYE ? null : s);
  const matches: ResolvedMatch[] = bracket.matches.map((m) => {
    const [a, b] = sides(m.id);
    const playable = real(a) !== null && real(b) !== null && (!m.optional || seriesDeciderNeeded() === true);
    return { ...m, entrantA: real(a), entrantB: real(b), result: playable ? (results[m.id] ?? null) : null, playable, bye: a === BYE || b === BYE };
  });

  return { matches, podium: podiumOf() };

  function podiumOf(): Podium {
    const ids = bracket.entrants.map((e) => e.registrationId);
    const empty: Podium = { first: null, second: null, thirds: [], complete: true, ties: [] };
    if (ids.length === 0) return empty;
    if (ids.length === 1) return { ...empty, first: ids[0]! };
    const known = (s: Side) => s !== null;
    switch (bracket.format) {
      case 'round_robin': {
        const res = poolResult(0);
        if (!res) return { ...empty, complete: false };
        const top = res.ranking.slice(0, 3);
        const ties = res.ties.filter((t) => t.some((id) => top.includes(id)));
        return { first: top[0] ?? null, second: top[1] ?? null, thirds: top[2] ? [top[2]] : [], complete: ties.length === 0, ties, tieScopes: ties.map(() => 'pool:0') };
      }
      case 'best_of_three': {
        const wins = new Map<string, number>();
        for (const m of matches) if (m.result) {
          const w = m.result.winner === 'a' ? m.entrantA! : m.entrantB!;
          wins.set(w, (wins.get(w) ?? 0) + 1);
        }
        const champion = [...wins].find(([, n]) => n >= 2)?.[0] ?? null;
        return { first: champion, second: champion ? ids.find((id) => id !== champion)! : null, thirds: [], complete: champion !== null, ties: [] };
      }
      case 'three_with_repechage': {
        if (!byId.has('m3')) return { ...empty, complete: false };
        const final = outcome('m3');
        const third = outcome('m2').loser;
        return { first: real(final.winner), second: real(final.loser), thirds: real(third) ? [real(third)!] : [], complete: known(final.winner) && known(third), ties: [] };
      }
      default: {
        // Poules puis tableau : une égalité qui empêche de connaître les qualifiés bloque le tableau final.
        const poolTies: string[][] = [];
        const poolScopes: string[] = [];
        if (bracket.format === 'pools_then_bracket') {
          (bracket.pools ?? []).forEach((_, p) => {
            const res = poolResult(p);
            for (const t of res?.ties ?? []) {
              if (t.some((id) => res!.ranking.indexOf(id) < 2)) {
                poolTies.push(t);
                poolScopes.push(`pool:${p}`);
              }
            }
          });
        }
        const finalId = bracket.format === 'double_elimination' ? 'gf' : `w${mainRounds}-0`;
        const final = outcome(finalId);
        let thirdSides: Side[] = [];
        if (bracket.format === 'double_elimination') thirdSides = mainRounds >= 2 ? [outcome(`l${2 * (mainRounds - 1)}-0`).loser] : [];
        else if (bracket.options.repechage && mainRounds >= 2) {
          thirdSides = ([0, 1] as const).map((half) => (mainRounds - 2 >= 1 ? outcome(`rep${half}-${mainRounds - 2}`).winner : beatenBy(half, 1)));
        } else if (bracket.options.thirdPlace && mainRounds >= 2) thirdSides = [outcome('third').winner];
        else if (mainRounds >= 2) thirdSides = [outcome(`w${mainRounds - 1}-0`).loser, outcome(`w${mainRounds - 1}-1`).loser];
        return {
          first: real(final.winner),
          second: real(final.loser),
          thirds: thirdSides.map(real).filter((x): x is string => x !== null),
          complete: known(final.winner) && thirdSides.every(known),
          ties: poolTies,
          tieScopes: poolScopes,
        };
      }
    }
  }
}
