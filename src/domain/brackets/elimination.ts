import { bracketPositions, drawOrder, nextPowerOfTwo } from './seeding.js';
import type { CombatBracket, Entrant, Match, SlotSource } from './types.js';

const winner = (matchId: string): SlotSource => ({ kind: 'winner', matchId });
const loser = (matchId: string): SlotSource => ({ kind: 'loser', matchId });

/** Cases du 1er tour : sources dans l'ordre des têtes de série, placées selon bracketPositions, exemptions en face des premières. */
export function firstRoundSlots(seeded: SlotSource[]): SlotSource[] {
  const size = nextPowerOfTwo(seeded.length);
  const positions = bracketPositions(size);
  const slots: SlotSource[] = Array.from({ length: size }, () => ({ kind: 'bye' }));
  seeded.forEach((src, i) => (slots[positions[i]!] = src));
  return slots;
}

const idOf = (s: SlotSource) => (s.kind === 'entrant' ? s.registrationId : null);

/** Nombre de duels entre clubmates au 1er tour (les matchs contre une exemption ne comptent pas). */
function clubClashes(slots: SlotSource[], clubOf: Map<string, string | null>): number {
  let n = 0;
  for (let i = 0; i < slots.length; i += 2) {
    const a = idOf(slots[i]!);
    const b = idOf(slots[i + 1]!);
    if (a && b && clubOf.get(a) !== null && clubOf.get(a) === clubOf.get(b)) n++;
  }
  return n;
}

/**
 * Réduit les duels entre clubmates au 1er tour : échanges de combattants (exemptions comprises dans les
 * positions possibles) tant que le nombre de duels diminue.
 */
export function separateClubs(slots: SlotSource[], entrants: Entrant[]): SlotSource[] {
  const clubOf = new Map(entrants.map((e) => [e.registrationId, e.clubId]));
  const out = [...slots];
  let current = clubClashes(out, clubOf);
  for (let guard = 0; current > 0 && guard < 200; guard++) {
    let improved = false;
    for (let i = 0; i < out.length && !improved; i++) {
      if (!idOf(out[i]!)) continue;
      for (let j = 0; j < out.length && !improved; j++) {
        if (i === j || !idOf(out[j]!) || (i ^ 1) === j) continue;
        [out[i], out[j]] = [out[j]!, out[i]!];
        const next = clubClashes(out, clubOf);
        if (next < current) {
          current = next;
          improved = true;
        } else [out[i], out[j]] = [out[j]!, out[i]!];
      }
    }
    if (!improved) break;
  }
  return out;
}

/** Tableau principal (phase 'main') ; identifiants w<tour>-<index>. Avec `entrants`, sépare les clubs au 1er tour. */
export function winnersBracket(order: Entrant[] | SlotSource[], startOrder = 0, entrants?: Entrant[]): Match[] {
  const sources = (order as (Entrant | SlotSource)[]).map((x) => ('kind' in x ? x : ({ kind: 'entrant', registrationId: x.registrationId } as SlotSource)));
  const slots = entrants ? separateClubs(firstRoundSlots(sources), entrants) : firstRoundSlots(sources);
  const size = slots.length;
  const rounds = Math.log2(size);
  const matches: Match[] = [];
  let n = startOrder;
  for (let k = 0; k < size / 2; k++) {
    matches.push({ id: `w1-${k}`, phase: 'main', round: 1, order: n++, a: slots[2 * k]!, b: slots[2 * k + 1]! });
  }
  for (let r = 2; r <= rounds; r++) {
    for (let k = 0; k < size / 2 ** r; k++) {
      matches.push({ id: `w${r}-${k}`, phase: 'main', round: r, order: n++, a: winner(`w${r - 1}-${2 * k}`), b: winner(`w${r - 1}-${2 * k + 1}`) });
    }
  }
  return matches;
}

export function singleElimination(entrants: Entrant[], options: { repechage: boolean; thirdPlace: boolean }, seed: number): CombatBracket {
  const order = drawOrder(entrants, seed);
  const base = { kind: 'combat' as const, format: 'single_elimination' as const, entrants: order, options, seed };
  if (order.length < 2) return { ...base, matches: [] };
  const matches = winnersBracket(order, 0, order);
  const rounds = Math.log2(nextPowerOfTwo(order.length));
  let n = matches.length;
  if (options.repechage && rounds >= 2) {
    // Repêchage FFK : les combattants battus par chaque finaliste avant la finale, en chaîne, dans l'ordre des tours.
    for (const half of [0, 1] as const) {
      for (let j = 1; j <= rounds - 2; j++) {
        matches.push({
          id: `rep${half}-${j}`,
          phase: 'repechage',
          round: j,
          order: n++,
          a: j === 1 ? { kind: 'beatenBy', half, round: 1 } : winner(`rep${half}-${j - 1}`),
          b: { kind: 'beatenBy', half, round: j + 1 },
        });
      }
    }
  } else if (options.thirdPlace && rounds >= 2) {
    matches.push({ id: 'third', phase: 'third_place', round: rounds, order: n++, a: loser(`w${rounds - 1}-0`), b: loser(`w${rounds - 1}-1`) });
  }
  return { ...base, options: { ...options, thirdPlace: options.thirdPlace && !options.repechage }, matches };
}

/** Double élimination : tableau des gagnants, tableau des perdants, grande finale unique. */
export function doubleElimination(entrants: Entrant[], seed: number): CombatBracket {
  const order = drawOrder(entrants, seed);
  const base = { kind: 'combat' as const, format: 'double_elimination' as const, entrants: order, options: { repechage: false, thirdPlace: false }, seed };
  if (order.length < 2) return { ...base, matches: [] };
  const matches = winnersBracket(order, 0, order);
  const size = nextPowerOfTwo(order.length);
  const rounds = Math.log2(size);
  let n = matches.length;
  if (rounds >= 2) {
    for (let k = 0; k < size / 4; k++) {
      matches.push({ id: `l1-${k}`, phase: 'losers', round: 1, order: n++, a: loser(`w1-${2 * k}`), b: loser(`w1-${2 * k + 1}`) });
    }
    for (let j = 1; j <= rounds - 1; j++) {
      const count = size / 2 ** (j + 1);
      for (let k = 0; k < count; k++) {
        // Perdants du tableau des gagnants croisés (ordre inversé) pour éviter les revanches immédiates.
        matches.push({ id: `l${2 * j}-${k}`, phase: 'losers', round: 2 * j, order: n++, a: winner(`l${2 * j - 1}-${k}`), b: loser(`w${j + 1}-${count - 1 - k}`) });
      }
      if (j <= rounds - 2) {
        for (let k = 0; k < count / 2; k++) {
          matches.push({ id: `l${2 * j + 1}-${k}`, phase: 'losers', round: 2 * j + 1, order: n++, a: winner(`l${2 * j}-${2 * k}`), b: winner(`l${2 * j}-${2 * k + 1}`) });
        }
      }
    }
    matches.push({ id: 'gf', phase: 'grand_final', round: 2 * rounds - 1, order: n++, a: winner(`w${rounds}-0`), b: winner(`l${2 * (rounds - 1)}-0`) });
  }
  return { ...base, matches };
}
