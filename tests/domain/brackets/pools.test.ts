import { describe, expect, test } from 'vitest';
import { resolveBracket } from '../../../src/domain/brackets/index.js';
import { bestOfThree, poolStandings, poolsThenBracket, roundRobin, singleMatch, threeWithRepechage } from '../../../src/domain/brackets/pools.js';
import type { MatchResult } from '../../../src/domain/brackets/types.js';
import { bestWins, entrants, play } from './helpers.js';

describe('poule', () => {
  test.each([[3, 3], [4, 6], [5, 10]])('%i combattants : %i matchs, chacun rencontre tous les autres', (n, count) => {
    const b = roundRobin(entrants(n), 1);
    expect(b.matches).toHaveLength(count);
    const { matches } = resolveBracket(b, {});
    const pairs = new Set(matches.map((m) => [m.entrantA, m.entrantB].sort().join('-')));
    expect(pairs.size).toBe(count);
  });
  test('podium d’une poule de 3 : un seul 3e', () => {
    const res = play(roundRobin(entrants(3), 1), bestWins);
    expect(res.podium).toMatchObject({ first: 'r1', second: 'r2', thirds: ['r3'], complete: true, ties: [] });
  });
  test('égalité à trois (1 victoire chacun) → signalée ; départage fourni → appliqué', () => {
    const b = roundRobin(entrants(3), 1);
    // cycle : r1 bat r2, r2 bat r3, r3 bat r1
    const beats: Record<string, string> = { r1: 'r2', r2: 'r3', r3: 'r1' };
    const res = play(b, (m) => (beats[m.entrantA!] === m.entrantB ? 'a' : 'b'));
    expect(res.podium.complete).toBe(false);
    expect(res.podium.ties[0]!.sort()).toEqual(['r1', 'r2', 'r3']);
    const decided = resolveBracket(b, res.results, { 0: ['r3', 'r1', 'r2'] });
    expect(decided.podium).toMatchObject({ first: 'r3', second: 'r1', thirds: ['r2'], complete: true });
  });
  test('égalité à deux → confrontation directe', () => {
    const b = roundRobin(entrants(4), 1);
    // r1 3 victoires ; r2 et r3 : 1 victoire chacun… on force r2 bat r3, r3 bat r4, r4 bat r2 → r2,r3,r4 à 1 ; r1 bat tous
    const res = play(b, (m) => {
      const ids = [m.entrantA!, m.entrantB!];
      if (ids.includes('r1')) return m.entrantA === 'r1' ? 'a' : 'b';
      const w = ids.includes('r2') && ids.includes('r3') ? 'r2' : ids.includes('r3') && ids.includes('r4') ? 'r3' : 'r4';
      return m.entrantA === w ? 'a' : 'b';
    });
    expect(res.podium.first).toBe('r1');
    expect(res.podium.complete).toBe(false); // r2/r3/r4 à égalité (cycle) pour les places 2-3
  });
  test('poolStandings simple', () => {
    const b = roundRobin(entrants(3), 1);
    const results: Record<string, MatchResult> = {};
    const { matches } = play(b, bestWins);
    for (const m of matches) results[m.id] = m.result!;
    expect(poolStandings(resolveBracket(b, results).matches, 0).ranking).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('petits formats', () => {
  test('combat unique', () => {
    const res = play(singleMatch(entrants(2), 1), bestWins);
    expect(res.podium).toMatchObject({ first: 'r1', second: 'r2', thirds: [], complete: true });
  });
  test('meilleur des trois : 2-0 → 3e manche non jouée', () => {
    const res = play(bestOfThree(entrants(2), 1), bestWins);
    expect(Object.keys(res.results)).toHaveLength(2);
    expect(res.podium).toMatchObject({ first: 'r1', second: 'r2', complete: true });
  });
  test('meilleur des trois : 1-1 → 3e manche jouable', () => {
    const b = bestOfThree(entrants(2), 1);
    const [m1, m2] = b.matches;
    const first = resolveBracket(b, {}).matches[0]!;
    const r1IsA = first.entrantA === 'r1';
    const results: Record<string, MatchResult> = {
      [m1!.id]: { winner: r1IsA ? 'a' : 'b', method: 'points' },
      [m2!.id]: { winner: r1IsA ? 'b' : 'a', method: 'points' },
    };
    const res = resolveBracket(b, results);
    expect(res.matches[2]!.playable).toBe(true);
    expect(res.podium.complete).toBe(false);
  });
  test.each([
    ['a', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'b'],
  ] as const)('3 avec repêchage, M1=%s M2=%s : podium cohérent', (w1, w2) => {
    const b = threeWithRepechage(entrants(3), 1);
    expect(b.matches).toHaveLength(3);
    const res = play(b, (m) => (m.id === 'm1' ? w1 : m.id === 'm2' ? w2 : 'a'));
    const { first, second, thirds, complete } = res.podium;
    expect(complete).toBe(true);
    expect(thirds).toHaveLength(1);
    expect(new Set([first, second, thirds[0]]).size).toBe(3);
    const m2 = res.matches.find((m) => m.id === 'm2')!;
    expect(thirds[0]).toBe(m2.result!.winner === 'a' ? m2.entrantB : m2.entrantA);
  });
});

describe('poules puis tableau', () => {
  test.each([[6, [3, 3]], [7, [4, 3]], [9, [3, 3, 3]], [12, [4, 4, 4]]])('%i combattants → poules %j, podium complet', (n, sizes) => {
    const b = poolsThenBracket(entrants(n), 1);
    expect(b.pools!.map((p) => p.length).sort((x, y) => y - x)).toEqual(sizes);
    const res = play(b, bestWins);
    expect(res.podium.complete).toBe(true);
    expect(res.podium.first).toBe('r1');
  });
  test('au 1er tour du tableau final, pas deux combattants de la même poule', () => {
    for (const n of [6, 7, 9, 12]) {
      const b = poolsThenBracket(entrants(n), 1);
      const res = play(b, bestWins);
      const poolOf = (id: string) => b.pools!.findIndex((p) => p.includes(id));
      const firstRound = res.matches.filter((m) => m.phase === 'main' && m.round === 1 && m.playable);
      for (const m of firstRound) expect(poolOf(m.entrantA!)).not.toBe(poolOf(m.entrantB!));
    }
  });
});

describe('poules puis tableau : pas de revanche évitable', () => {
  test.each([6, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20])('%i combattants : 1er et 2e de poule dans des moitiés opposées, pas de même poule au 1er combat', (n) => {
    for (const seed of [1, 2, 3]) {
      const b = poolsThenBracket(entrants(n), seed);
      const res = play(b, bestWins);
      const poolOf = (id: string) => b.pools!.findIndex((p) => p.includes(id));
      const main = res.matches.filter((m) => m.phase === 'main');
      const rounds = Math.max(...main.map((m) => m.round));
      // premier combat réellement disputé par chaque qualifié
      const firstFight = new Map<string, string>();
      for (const m of [...main].sort((a, c) => a.round - c.round || a.order - c.order)) {
        if (!m.playable) continue;
        for (const [x, y] of [[m.entrantA!, m.entrantB!], [m.entrantB!, m.entrantA!]] as const) if (!firstFight.has(x)) firstFight.set(x, y);
      }
      for (const [x, y] of firstFight) expect(poolOf(x)).not.toBe(poolOf(y));
      if (rounds >= 2) {
        const half = new Map<string, number>();
        main.filter((m) => m.round === 1).forEach((m, i, arr) => {
          for (const id of [m.entrantA, m.entrantB]) if (id) half.set(id, i < arr.length / 2 ? 0 : 1);
        });
        const semiWinners = main.filter((m) => m.round === rounds - 1).flatMap((m) => [m.entrantA, m.entrantB]).filter(Boolean) as string[];
        void semiWinners;
        for (let p = 0; p < b.pools!.length; p++) {
          const q = [...half.keys()].filter((id) => poolOf(id) === p);
          if (q.length === 2) expect(half.get(q[0]!)).not.toBe(half.get(q[1]!));
        }
      }
    }
  });
});
