import { expect, test } from 'vitest';
import { singleElimination } from '../../../src/domain/brackets/elimination.js';
import { resolveBracket } from '../../../src/domain/brackets/index.js';
import { bracketPositions, drawOrder, seededRandom } from '../../../src/domain/brackets/seeding.js';
import { entrants } from './helpers.js';

test('PRNG reproductible', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  expect(seededRandom(43)()).not.toBe(seededRandom(42)());
});

test('positions de tirage : têtes 1-2 dans deux moitiés, 1-4 dans quatre quarts', () => {
  for (const size of [4, 8, 16, 32]) {
    const pos = bracketPositions(size);
    expect([...pos].sort((x, y) => x - y)).toEqual([...Array(size).keys()]);
    const half = (s: number) => Math.floor(pos[s]! / (size / 2));
    const quarter = (s: number) => Math.floor(pos[s]! / (size / 4));
    expect(half(0)).not.toBe(half(1));
    expect(new Set([0, 1, 2, 3].map(quarter)).size).toBe(4);
  }
});

test('ordre de tirage : les clubs les plus nombreux en tête, reproductible', () => {
  const list = entrants(8, (i) => (i < 4 ? 'A' : `x${i}`));
  const order = drawOrder(list, 7);
  expect(order.slice(0, 4).every((e) => e.clubId === 'A')).toBe(true);
  expect(drawOrder(list, 7)).toEqual(order);
});

const firstRoundClubClashes = (n: number, clubOf: (i: number) => string | null, seed: number) => {
  const b = singleElimination(entrants(n, clubOf), { repechage: false, thirdPlace: false }, seed);
  const { matches } = resolveBracket(b, {});
  const club = (id: string | null) => b.entrants.find((e) => e.registrationId === id)?.clubId;
  return matches.filter((m) => m.round === 1 && m.phase === 'main' && m.playable && club(m.entrantA) === club(m.entrantB)).length;
};

test('8 combattants dont 4 du même club : aucun duel entre clubmates au 1er tour', () => {
  for (const seed of [1, 2, 3, 4, 5]) expect(firstRoundClubClashes(8, (i) => (i < 4 ? 'A' : `x${i}`), seed)).toBe(0);
});
test('4 clubs de 2 : aucun duel entre clubmates au 1er tour', () => {
  for (const seed of [1, 2, 3]) expect(firstRoundClubClashes(8, (i) => `c${i % 4}`, seed)).toBe(0);
});
test('6 combattants dont 5 du même club : au plus 1 duel entre clubmates', () => {
  for (const seed of [1, 2, 3]) expect(firstRoundClubClashes(6, (i) => (i < 5 ? 'A' : 'B'), seed)).toBeLessThanOrEqual(1);
});

/** Nombre minimal de duels entre clubmates au 1er tour : exemptions données aux plus gros clubs, puis appariement. */
function optimum(clubs: string[], size: number): number {
  const counts = new Map<string, number>();
  for (const c of clubs) counts.set(c, (counts.get(c) ?? 0) + 1);
  let byes = size - clubs.length;
  while (byes-- > 0) {
    const [top] = [...counts].sort((a, b) => b[1] - a[1]);
    counts.set(top![0], top![1] - 1);
  }
  const playing = [...counts.values()].reduce((s, x) => s + x, 0);
  return Math.max(0, Math.max(...counts.values()) - playing / 2);
}

test.each([
  ['A3 B2 + 3 isolés', ['A', 'A', 'A', 'B', 'B', 'x', 'y', 'z']],
  ['A2 B3 + 3 isolés', ['A', 'A', 'B', 'B', 'B', 'x', 'y', 'z']],
  ['A3 B3', ['A', 'A', 'A', 'B', 'B', 'B']],
  ['A3 B2', ['A', 'A', 'A', 'B', 'B']],
])('séparation optimale : %s', (_, clubs) => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) expect(firstRoundClubClashes(clubs.length, (i) => clubs[i]!, seed)).toBe(0);
});

test('séparation optimale sur des mélanges aléatoires (3 à 16 combattants)', () => {
  const rand = seededRandom(99);
  for (let t = 0; t < 300; t++) {
    const n = 3 + Math.floor(rand() * 14);
    const clubCount = 1 + Math.floor(rand() * 5);
    const clubs = Array.from({ length: n }, () => `c${Math.floor(rand() * clubCount)}`);
    const size = 2 ** Math.ceil(Math.log2(n));
    expect(firstRoundClubClashes(n, (i) => clubs[i]!, t)).toBe(optimum(clubs, size));
  }
});
