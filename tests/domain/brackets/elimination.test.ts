import { describe, expect, test } from 'vitest';
import { doubleElimination, singleElimination } from '../../../src/domain/brackets/elimination.js';
import { resolveBracket } from '../../../src/domain/brackets/index.js';
import { bestWins, entrants, play } from './helpers.js';

const se = (n: number, opts = { repechage: false, thirdPlace: false }, seed = 1) => singleElimination(entrants(n), opts, seed);

describe('élimination directe', () => {
  test.each([
    [2, 1], [3, 2], [5, 4], [8, 7], [9, 8], [17, 16],
  ])('%i combattants : %i matchs jouables, podium complet', (n, playable) => {
    const res = play(se(n), bestWins);
    expect(Object.keys(res.results)).toHaveLength(playable);
    expect(res.podium.complete).toBe(true);
    expect(res.podium.first).toBe('r1');
    expect(res.podium.second).not.toBeNull();
  });
  test('3 combattants : un seul 3e', () => {
    const res = play(se(3), bestWins);
    expect(res.podium.thirds).toHaveLength(1);
  });
  test('8 combattants sans option : deux 3es (perdants des demies)', () => {
    expect(play(se(8), bestWins).podium.thirds).toHaveLength(2);
  });
  test('3e place : un match de plus, un seul 3e', () => {
    const b = se(8, { repechage: false, thirdPlace: true });
    expect(b.matches.filter((m) => m.phase === 'third_place')).toHaveLength(1);
    const res = play(b, bestWins);
    expect(res.podium.thirds).toHaveLength(1);
    const semiLosers = res.matches.filter((m) => m.phase === 'main' && m.round === 2).map((m) => (m.result!.winner === 'a' ? m.entrantB! : m.entrantA!));
    expect(res.podium.thirds[0]).toBe(semiLosers.sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))[0]);
  });
  test('1 combattant : pas de match, podium = lui', () => {
    const b = se(1);
    expect(b.matches).toEqual([]);
    expect(resolveBracket(b, {}).podium).toMatchObject({ first: 'r1', second: null, thirds: [], complete: true });
  });
  test('0 combattant : vide', () => {
    expect(resolveBracket(se(0), {}).podium).toMatchObject({ first: null, complete: true });
  });
  test('podium incomplet tant que la finale n’est pas jouée', () => {
    expect(resolveBracket(se(4), {}).podium.complete).toBe(false);
  });
});

describe('repêchage (FFK)', () => {
  test('8 combattants : ceux battus par chaque finaliste sont repêchés', () => {
    const b = se(8, { repechage: true, thirdPlace: false });
    const res = play(b, bestWins);
    // r1 et r2 finalistes (meilleurs) ; repêchage : battus par r1 (2 combattants), battus par r2 (2) → 1 match chacun
    const rep = res.matches.filter((m) => m.phase === 'repechage' && m.playable);
    expect(rep).toHaveLength(2);
    const beatenBy = (winner: string) =>
      res.matches.filter((m) => m.phase === 'main' && m.result && m.round < 3 && (m.result.winner === 'a' ? m.entrantA : m.entrantB) === winner)
        .map((m) => (m.result!.winner === 'a' ? m.entrantB : m.entrantA));
    const final = res.matches.find((m) => m.phase === 'main' && m.round === 3)!;
    for (const m of rep) {
      const pair = [m.entrantA, m.entrantB].sort();
      expect([beatenBy(final.entrantA!).sort(), beatenBy(final.entrantB!).sort()]).toContainEqual(pair);
    }
    expect(res.podium.thirds).toHaveLength(2);
    expect(res.podium.complete).toBe(true);
  });
  test('16 combattants : chaîne de 2 matchs par côté', () => {
    const res = play(se(16, { repechage: true, thirdPlace: false }), bestWins);
    expect(res.matches.filter((m) => m.phase === 'repechage' && m.playable)).toHaveLength(4);
    expect(res.podium.thirds).toHaveLength(2);
  });
  test('5 combattants avec exemptions : la chaîne ignore les exemptions', () => {
    const res = play(se(5, { repechage: true, thirdPlace: false }), bestWins);
    expect(res.podium.complete).toBe(true);
    expect(res.podium.thirds.length).toBeGreaterThanOrEqual(1);
    expect(new Set([res.podium.first, res.podium.second, ...res.podium.thirds]).size).toBe(2 + res.podium.thirds.length);
  });
  test('4 combattants : pas de match de repêchage, les perdants des demies sont 3es', () => {
    const res = play(se(4, { repechage: true, thirdPlace: false }), bestWins);
    expect(res.matches.filter((m) => m.phase === 'repechage' && m.playable)).toHaveLength(0);
    expect(res.podium.thirds).toHaveLength(2);
  });
  test('repêchage et 3e place : le repêchage l’emporte', () => {
    const b = se(8, { repechage: true, thirdPlace: true });
    expect(b.matches.some((m) => m.phase === 'third_place')).toBe(false);
  });
});

describe('double élimination', () => {
  test.each([3, 4, 6, 8])('%i combattants : podium complet, chacun perd au plus une fois avant élimination', (n) => {
    const res = play(doubleElimination(entrants(n), 1), bestWins);
    expect(res.podium).toMatchObject({ first: 'r1', second: 'r2', complete: true });
    expect(res.podium.thirds).toEqual(['r3']);
    const losses = new Map<string, number>();
    for (const m of res.matches) if (m.result) {
      const loser = m.result.winner === 'a' ? m.entrantB! : m.entrantA!;
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
    }
    expect(Math.max(...losses.values())).toBeLessThanOrEqual(2);
  });
  test('le perdant du tableau des gagnants peut encore gagner', () => {
    // r2 bat r1 en finale du tableau des gagnants, r1 remonte puis gagne la grande finale
    const b = doubleElimination(entrants(4), 1);
    const res = play(b, (m) => {
      const ids = [m.entrantA, m.entrantB];
      if (m.phase === 'main' && ids.includes('r1') && ids.includes('r2')) return m.entrantA === 'r2' ? 'a' : 'b';
      return bestWins(m);
    });
    expect(res.podium.first).toBe('r1');
    expect(res.podium.second).toBe('r2');
  });
});
