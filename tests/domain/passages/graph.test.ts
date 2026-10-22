import { describe, expect, test } from 'vitest';
import { compatibleFormats, generateBracket, resolveBracket, type BracketFormat, type CombatBracket, type MatchResult } from '../../../src/domain/brackets/index.js';
import { matchNodes, zoneOrder } from '../../../src/domain/passages/index.js';

const entrants = (n: number) => Array.from({ length: n }, (_, i) => ({ registrationId: `e${i + 1}`, clubId: null, label: `E${i + 1}` }));
const bracket = (format: BracketFormat, n: number, opts: { repechage?: boolean; thirdPlace?: boolean } = {}) =>
  generateBracket(format, entrants(n), { repechage: opts.repechage ?? false, thirdPlace: opts.thirdPlace ?? false, kataBronzeCount: 2 }, 1) as CombatBracket;
const distances = (b: CombatBracket) => Object.fromEntries(matchNodes(b).map((n) => [n.matchId, n.distance]));

describe('graphe des combats', () => {
  test('élimination directe à 8 : w1 → 2, w2 → 1, w3-0 → 0 ; w2-0 fourni par w1-0 et w1-1', () => {
    const nodes = matchNodes(bracket('single_elimination', 8));
    expect(nodes).toHaveLength(7);
    for (const n of nodes) expect(n.distance).toBe(3 - Number(n.matchId[1]));
    expect(nodes.find((n) => n.matchId === 'w2-0')!.feeds.sort()).toEqual(['w1-0', 'w1-1']);
  });

  test('5 inscrits : 4 combats numérotés (exemptions exclues), un seul au 1er tour', () => {
    const nodes = matchNodes(bracket('single_elimination', 5));
    expect(nodes).toHaveLength(4);
    expect(nodes.filter((n) => n.matchId.startsWith('w1-'))).toHaveLength(1);
  });

  test('3e place : third → 0, fournie par les deux demies (demies → 1)', () => {
    const nodes = matchNodes(bracket('single_elimination', 4, { thirdPlace: true }));
    const third = nodes.find((n) => n.matchId === 'third')!;
    expect(third.distance).toBe(0);
    expect(third.feeds.sort()).toEqual(['w1-0', 'w1-1']);
    expect(distances(bracket('single_elimination', 4, { thirdPlace: true }))).toMatchObject({ 'w1-0': 1, 'w1-1': 1, 'w2-0': 0 });
  });

  test('repêchage à 16 : rep<h>-1 → 1, rep<h>-2 → 0 ; rep0-1 fourni par les tours 1 et 2 et la demie de la moitié haute seulement', () => {
    const b = bracket('single_elimination', 16, { repechage: true });
    expect(distances(b)).toMatchObject({ 'rep0-1': 1, 'rep1-1': 1, 'rep0-2': 0, 'rep1-2': 0, 'w4-0': 0 });
    const rep = matchNodes(b).find((n) => n.matchId === 'rep0-1')!;
    expect(rep.feeds.sort()).toEqual(['w1-0', 'w1-1', 'w1-2', 'w1-3', 'w2-0', 'w2-1', 'w3-0']);
  });

  test('double élimination à 4 : gf → 0, w1-0 a la plus grande distance', () => {
    const d = distances(bracket('double_elimination', 4));
    expect(d.gf).toBe(0);
    expect(d['w1-0']).toBe(Math.max(...Object.values(d)));
  });

  test('poules puis tableau à 6 : poules avant le tableau, journées dans l’ordre', () => {
    const b = bracket('pools_then_bracket', 6);
    const nodes = matchNodes(b);
    const firstRound = Math.max(...nodes.filter((n) => n.matchId.startsWith('w1-')).map((n) => n.distance));
    const pool = nodes.filter((n) => n.phase === 'pool');
    expect(pool.every((n) => n.distance > firstRound)).toBe(true);
    const round = (id: string) => b.matches.find((m) => m.id === id)!.round;
    for (const x of pool) for (const y of pool) {
      const same = b.matches.find((m) => m.id === x.matchId)!.pool === b.matches.find((m) => m.id === y.matchId)!.pool;
      if (same && round(x.matchId) < round(y.matchId)) expect(x.distance).toBeGreaterThan(y.distance);
    }
  });

  test('poule à 3 : journées à distance 2, 1, 0', () => {
    const b = bracket('round_robin', 3);
    const byRound = matchNodes(b).map((n) => [b.matches.find((m) => m.id === n.matchId)!.round, n.distance]);
    expect(byRound.sort()).toEqual([[1, 2], [2, 1], [3, 0]]);
  });

  test('meilleur des trois, combat unique, trois avec repêchage', () => {
    expect(distances(bracket('best_of_three', 2))).toEqual({ s1: 2, s2: 1, s3: 0 });
    expect(distances(bracket('single_match', 2))).toEqual({ 'w1-0': 0 });
    expect(distances(bracket('three_with_repechage', 3))).toEqual({ m1: 2, m2: 1, m3: 0 });
  });

  test('moins de 2 inscrits : aucun combat', () => {
    expect(matchNodes(bracket('single_elimination', 1))).toEqual([]);
  });
});

describe('ordre de passage jouable (relecture)', () => {
  /** Joue une catégorie seule sur sa zone, dans l'ordre des numéros : chaque combat appelé a ses deux combattants connus. */
  const playInOrder = (b: CombatBracket, mode: 'rounds' | 'categories') => {
    const results: Record<string, MatchResult> = {};
    const problems: string[] = [];
    for (const p of zoneOrder([{ id: 'c', rank: 0, kataEntrants: null, nodes: matchNodes(b) }], mode, 1)) {
      const m = resolveBracket(b, results).matches.find((x) => x.id === p.matchId)!;
      if (m.bye || (m.optional && !m.playable)) continue;
      if (!m.playable) {
        problems.push(`${b.format}/${b.entrants.length}: ${p.matchId} appelé avant d'être jouable`);
        continue;
      }
      // Le plus petit identifiant gagne : classement de poule sans égalité.
      results[m.id] = { winner: m.entrantA! < m.entrantB! ? 'a' : 'b', method: 'points' };
    }
    return problems;
  };

  test('tous les formats, de 2 à 20 inscrits, options et modes : chaque combat est jouable quand on l’appelle', () => {
    const problems: string[] = [];
    for (let n = 2; n <= 20; n++) {
      for (const format of compatibleFormats('karate', n)) {
        for (const opts of [{}, { repechage: true }, { thirdPlace: true }]) {
          for (const mode of ['rounds', 'categories'] as const) problems.push(...playInOrder(bracket(format as BracketFormat, n, opts), mode));
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  test('repêchage : fourni aussi par la demi-finale de sa moitié', () => {
    const rep = matchNodes(bracket('single_elimination', 16, { repechage: true })).find((n) => n.matchId === 'rep0-1')!;
    expect(rep.feeds).toContain('w3-0');
  });

  test('poules puis tableau à 17 : une exemption ne coupe pas la dépendance (poules avant le tableau)', () => {
    const b = bracket('pools_then_bracket', 17);
    const d = distances(b);
    const bracketMax = Math.max(...matchNodes(b).filter((x) => x.phase === 'main').map((x) => x.distance));
    for (const n of matchNodes(b).filter((x) => x.phase === 'pool')) expect(d[n.matchId]).toBeGreaterThan(bracketMax - 1);
  });
});
