import { firstRoundSlots, singleElimination, winnersBracket } from './elimination.js';
import { drawOrder } from './seeding.js';
import type { CombatBracket, Entrant, Match, ResolvedMatch, SlotSource } from './types.js';

const entrantSrc = (e: Entrant): SlotSource => ({ kind: 'entrant', registrationId: e.registrationId });
const NO_OPTIONS = { repechage: false, thirdPlace: false };

export function singleMatch(entrants: Entrant[], seed: number): CombatBracket {
  return { ...singleElimination(entrants, NO_OPTIONS, seed), format: 'single_match' };
}

/** Trois manches entre les deux mêmes combattants ; la 3e n'est disputée qu'à 1-1. */
export function bestOfThree(entrants: Entrant[], seed: number): CombatBracket {
  const order = drawOrder(entrants, seed);
  const base = { kind: 'combat' as const, format: 'best_of_three' as const, entrants: order, options: NO_OPTIONS, seed };
  if (order.length < 2) return { ...base, matches: [] };
  const [a, b] = [entrantSrc(order[0]!), entrantSrc(order[1]!)];
  return {
    ...base,
    matches: [1, 2, 3].map((r) => ({ id: `s${r}`, phase: 'series' as const, round: r, order: r - 1, a, b, ...(r === 3 ? { optional: true } : {}) })),
  };
}

/** Tous contre tous (méthode du cercle) : rencontres d'une poule, dans un ordre qui espace les combats. */
function circleMatches(ids: string[], pool: number, startOrder: number): Match[] {
  const players: (string | null)[] = ids.length % 2 ? [...ids, null] : [...ids];
  const n = players.length;
  const matches: Match[] = [];
  let order = startOrder;
  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const x = players[i]!;
      const y = players[n - 1 - i]!;
      if (x !== null && y !== null) {
        matches.push({
          id: `p${pool}-${matches.length}`,
          phase: 'pool',
          pool,
          round: round + 1,
          order: order++,
          a: { kind: 'entrant', registrationId: x },
          b: { kind: 'entrant', registrationId: y },
        });
      }
    }
    players.splice(1, 0, players.pop()!);
  }
  return matches;
}

export function roundRobin(entrants: Entrant[], seed: number): CombatBracket {
  const order = drawOrder(entrants, seed);
  const ids = order.map((e) => e.registrationId);
  return { kind: 'combat', format: 'round_robin', entrants: order, options: NO_OPTIONS, seed, pools: [ids], matches: circleMatches(ids, 0, 0) };
}

/** M1 A–B ; M2 perdant M1 – C ; M3 (finale) vainqueur M1 – vainqueur M2 ; 3e = perdant M2. */
export function threeWithRepechage(entrants: Entrant[], seed: number): CombatBracket {
  const order = drawOrder(entrants, seed);
  const base = { kind: 'combat' as const, format: 'three_with_repechage' as const, entrants: order, options: NO_OPTIONS, seed };
  if (order.length !== 3) return { ...roundRobin(entrants, seed), format: 'three_with_repechage' };
  return {
    ...base,
    matches: [
      { id: 'm1', phase: 'main', round: 1, order: 0, a: entrantSrc(order[0]!), b: entrantSrc(order[1]!) },
      { id: 'm2', phase: 'repechage', round: 2, order: 1, a: { kind: 'loser', matchId: 'm1' }, b: entrantSrc(order[2]!) },
      { id: 'm3', phase: 'main', round: 3, order: 2, a: { kind: 'winner', matchId: 'm1' }, b: { kind: 'winner', matchId: 'm2' } },
    ],
  };
}

/** Poules de 3 ou 4 (serpentin dans l'ordre du tirage), puis les 2 premiers de chaque poule en élimination directe. */
export function poolsThenBracket(entrants: Entrant[], seed: number, options = NO_OPTIONS): CombatBracket {
  const order = drawOrder(entrants, seed);
  const poolCount = Math.max(1, Math.ceil(order.length / 4));
  const pools: string[][] = Array.from({ length: poolCount }, () => []);
  order.forEach((e, i) => {
    const lap = Math.floor(i / poolCount);
    const idx = i % poolCount;
    pools[lap % 2 === 0 ? idx : poolCount - 1 - idx]!.push(e.registrationId);
  });
  const matches: Match[] = [];
  pools.forEach((ids, p) => matches.push(...circleMatches(ids, p, matches.length)));

  // Têtes de série : 1ers de poule, puis 2es dans l'ordre qui évite au mieux les revanches (voir qualifierPenalty).
  const winners: SlotSource[] = pools.map((_, p) => ({ kind: 'poolRank', pool: p, rank: 1 }));
  const runnerOrders = poolCount <= 6 ? permutations([...Array(poolCount).keys()]) : [...Array(poolCount).keys()].map((k) => pools.map((_, p) => (p + k) % poolCount));
  let seeded: SlotSource[] = [];
  let best = Infinity;
  for (const perm of runnerOrders) {
    const candidate: SlotSource[] = [...winners, ...perm.map((p): SlotSource => ({ kind: 'poolRank', pool: p, rank: 2 }))];
    const penalty = qualifierPenalty(firstRoundSlots(candidate));
    if (penalty < best) {
      best = penalty;
      seeded = candidate;
      if (penalty === 0) break;
    }
  }
  matches.push(...winnersBracket(seeded, matches.length));
  const rounds = Math.max(...matches.filter((m) => m.phase === 'main').map((m) => m.round));
  if (options.thirdPlace && rounds >= 2) {
    matches.push({ id: 'third', phase: 'third_place', round: rounds, order: matches.length, a: { kind: 'loser', matchId: `w${rounds - 1}-0` }, b: { kind: 'loser', matchId: `w${rounds - 1}-1` } });
  }
  return { kind: 'combat', format: 'pools_then_bracket', entrants: order, options: { repechage: false, thirdPlace: options.thirdPlace }, seed, pools, matches };
}

/**
 * Classement d'une poule : victoires, puis confrontation directe (égalité à deux), sinon départage fourni
 * par l'organisateur ; les égalités non tranchées sont renvoyées dans `ties`.
 */
export function rankPool(
  ids: string[],
  games: { a: string; b: string; winner: string }[],
  tieBreak?: string[],
): { ranking: string[]; ties: string[][] } {
  const wins = new Map(ids.map((id) => [id, 0]));
  for (const g of games) wins.set(g.winner, (wins.get(g.winner) ?? 0) + 1);
  const groups = new Map<number, string[]>();
  for (const id of ids) groups.set(wins.get(id)!, [...(groups.get(wins.get(id)!) ?? []), id]);
  const ranking: string[] = [];
  const ties: string[][] = [];
  for (const w of [...groups.keys()].sort((x, y) => y - x)) {
    const group = groups.get(w)!;
    if (group.length === 1) ranking.push(group[0]!);
    else if (group.length === 2) {
      const duel = games.find((g) => group.includes(g.a) && group.includes(g.b));
      if (duel) ranking.push(duel.winner, group.find((id) => id !== duel.winner)!);
      else ranking.push(...group);
    } else if (tieBreak && group.every((id) => tieBreak.includes(id))) {
      ranking.push(...[...group].sort((x, y) => tieBreak.indexOf(x) - tieBreak.indexOf(y)));
    } else {
      ranking.push(...group);
      ties.push(group);
    }
  }
  return { ranking, ties };
}

export function poolStandings(matches: ResolvedMatch[], pool: number, tieBreak?: string[]): { ranking: string[]; ties: string[][] } {
  const games = matches.filter((m) => m.phase === 'pool' && m.pool === pool);
  const ids = [...new Set(games.flatMap((m) => [m.entrantA, m.entrantB]).filter((x): x is string => x !== null))];
  const played = games
    .filter((m) => m.result && m.entrantA && m.entrantB)
    .map((m) => ({ a: m.entrantA!, b: m.entrantB!, winner: m.result!.winner === 'a' ? m.entrantA! : m.entrantB! }));
  return rankPool(ids, played, tieBreak);
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/**
 * Pénalité d'un placement des qualifiés : même poule au 1er combat (y compris après une exemption, au 2e tour)
 * = 10 ; 1er et 2e d'une même poule dans la même moitié du tableau = 1.
 */
function qualifierPenalty(slots: SlotSource[]): number {
  const pool = (s: SlotSource | undefined) => (s?.kind === 'poolRank' ? s.pool : -1);
  const bye = (s: SlotSource | undefined) => s?.kind === 'bye';
  let penalty = 0;
  for (let i = 0; i < slots.length; i += 2) {
    const [a, b] = [slots[i], slots[i + 1]];
    if (pool(a) >= 0 && pool(a) === pool(b)) penalty += 10;
    // Un qualifié exempté rencontre au 2e tour l'un des deux combattants de la paire voisine.
    const sibling = i % 4 === 0 ? i + 2 : i - 2;
    const exempted = bye(a) ? b : bye(b) ? a : undefined;
    if (exempted && pool(exempted) >= 0) {
      for (const s of [slots[sibling], slots[sibling + 1]]) if (pool(s) === pool(exempted)) penalty += 10;
    }
  }
  const half = slots.length / 2;
  const sides = new Map<number, number[]>();
  slots.forEach((s, i) => pool(s) >= 0 && sides.set(pool(s), [...(sides.get(pool(s)) ?? []), i < half ? 0 : 1]));
  for (const h of sides.values()) if (h.length === 2 && h[0] === h[1]) penalty += 1;
  return penalty;
}
