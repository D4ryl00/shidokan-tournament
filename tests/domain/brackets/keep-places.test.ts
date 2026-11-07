import { describe, expect, test } from 'vitest';
import { singleElimination } from '../../../src/domain/brackets/elimination.js';
import { type Bracket, type BracketFormat, generateBracket, resolveBracket } from '../../../src/domain/brackets/index.js';
import { kataBracket, type KataBracket } from '../../../src/domain/brackets/kata.js';
import { keepPlaces } from '../../../src/domain/brackets/keep-places.js';
import { poolsThenBracket, singleMatch } from '../../../src/domain/brackets/pools.js';
import type { CombatBracket, Entrant, SlotSource } from '../../../src/domain/brackets/types.js';
import { bestWins, entrants, play } from './helpers.js';

const NO = { repechage: false, thirdPlace: false };
const OPTS = { ...NO, kataBronzeCount: 1 as const };

const src = (id: string | null): SlotSource => (id ? { kind: 'entrant', registrationId: id } : { kind: 'bye' });
const id = (s: SlotSource) => (s.kind === 'entrant' ? s.registrationId : null);

/** Tableau arrangé à la main : cases du 1er tour imposées, paire par paire. */
const arranged = (people: Entrant[], pairs: (string | null)[][], options = NO) => singleElimination(people, options, 1, pairs.flat().map(src));

/** Paires [a, b] des matchs w1-*, exemption = null. */
const firstRound = (b: Bracket) =>
  (b as CombatBracket).matches.filter((m) => m.phase === 'main' && m.round === 1).map((m) => [id(m.a), id(m.b)]);

const without = (people: Entrant[], ...ids: string[]) => people.filter((e) => !ids.includes(e.registrationId));

describe('keepPlaces : élimination', () => {
  test('élimination, même taille, un départ', () => {
    const six = entrants(6);
    const prev = arranged(six, [['r1', 'r2'], ['r3', 'r4'], ['r5', null], ['r6', null]]);
    const next = keepPlaces(prev, without(six, 'r3'), 'single_elimination', OPTS, 1);
    expect(firstRound(next)).toEqual([['r1', 'r2'], [null, 'r4'], ['r5', null], ['r6', null]]);
    expect(next.entrants.map((e) => e.registrationId).sort()).toEqual(['r1', 'r2', 'r4', 'r5', 'r6']);
  });

  test('élimination, même taille, une arrivée', () => {
    const prev = arranged(entrants(5), [['r1', 'r2'], ['r3', null], ['r4', null], ['r5', null]]);
    const next = keepPlaces(prev, entrants(6), 'single_elimination', OPTS, 1);
    expect(firstRound(next)).toEqual([['r1', 'r2'], ['r3', 'r6'], ['r4', null], ['r5', null]]);
  });

  test('arrivée : évite son club', () => {
    // r5 et r7 du même club : r7 va face à l’autre exempté (r6).
    const club = (i: number) => (i === 4 || i === 6 ? 'A' : `club${i}`);
    const prev = arranged(entrants(6, club), [['r1', 'r2'], ['r3', 'r4'], ['r5', null], ['r6', null]]);
    const next = keepPlaces(prev, entrants(7, club), 'single_elimination', OPTS, 1);
    expect(firstRound(next)).toEqual([['r1', 'r2'], ['r3', 'r4'], ['r5', null], ['r6', 'r7']]);
  });

  test('le tableau grandit 4 ➜ 5', () => {
    const prev = arranged(entrants(4), [['r1', 'r2'], ['r3', 'r4']]);
    const next = keepPlaces(prev, entrants(5), 'single_elimination', OPTS, 1);
    const rounds = firstRound(next);
    expect(rounds).toHaveLength(4); // 8 places
    // Une seule paire tient au 1er tour (exemptions réparties comme le tirage) ; l’autre se retrouve au 2e tour,
    // dans deux matchs voisins : r3 et r4 se rencontrent quand même en premier. r5 est exempt.
    expect(rounds).toEqual([['r5', null], ['r1', 'r2'], ['r3', null], ['r4', null]]);
    const w2 = (next as CombatBracket).matches.find((m) => m.id === 'w2-1')!;
    expect([w2.a, w2.b]).toEqual([{ kind: 'winner', matchId: 'w1-2' }, { kind: 'winner', matchId: 'w1-3' }]);
  });

  test('le tableau rétrécit 5 ➜ 4', () => {
    const five = entrants(5);
    const prev = arranged(five, [['r1', null], ['r2', 'r3'], ['r4', null], ['r5', null]]);
    const next = keepPlaces(prev, without(five, 'r1'), 'single_elimination', OPTS, 1);
    expect(firstRound(next)).toEqual([['r2', 'r3'], ['r4', 'r5']]);
  });

  test('options changées, mêmes inscrits', () => {
    const eight = entrants(8);
    const pairs = [['r1', 'r5'], ['r2', 'r6'], ['r3', 'r7'], ['r4', 'r8']];
    const prev = arranged(eight, pairs);
    const next = keepPlaces(prev, eight, 'single_elimination', { ...OPTS, thirdPlace: true }, 1) as CombatBracket;
    expect(firstRound(next)).toEqual(pairs);
    expect(next.options.thirdPlace).toBe(true);
    expect(next.matches.filter((m) => m.phase === 'third_place')).toHaveLength(1);
  });

  test('double élimination : mêmes cases', () => {
    const prev = arranged(entrants(5), [['r1', 'r2'], ['r3', null], ['r4', null], ['r5', null]]);
    const next = keepPlaces(prev, entrants(5), 'double_elimination', OPTS, 1) as CombatBracket;
    expect(next.format).toBe('double_elimination');
    expect(firstRound(next)).toEqual([['r1', 'r2'], ['r3', null], ['r4', null], ['r5', null]]);
    expect(next.matches.some((m) => m.id === 'gf')).toBe(true);
  });

  test('départ d’un exempté : pas de match exemption contre exemption', () => {
    const six = entrants(6);
    const prev = arranged(six, [['r1', 'r2'], ['r3', 'r4'], ['r5', null], ['r6', null]]);
    const next = keepPlaces(prev, without(six, 'r5'), 'single_elimination', OPTS, 1) as CombatBracket;
    // Exemptions comme le tirage ; r1-r2 au 1er tour, r3 et r4 se rencontrent au 2e tour, r6 rencontre le vainqueur r1/r2.
    expect(firstRound(next)).toEqual([['r6', null], ['r1', 'r2'], ['r3', null], ['r4', null]]);
    const fought = play(next, bestWins).matches.filter((m) => m.playable && [m.entrantA, m.entrantB].includes('r6'));
    expect(fought.some((m) => m.round < 3)).toBe(true);
  });

  test('il reste un seul combattant', () => {
    const four = entrants(4);
    const prev = arranged(four, [['r1', 'r2'], ['r3', 'r4']]);
    const next = keepPlaces(prev, without(four, 'r1', 'r3', 'r4'), 'single_elimination', OPTS, 1) as CombatBracket;
    expect(next.matches).toEqual([]);
    expect(resolveBracket(next, {}).podium).toMatchObject({ first: 'r2', complete: true });
  });
});

describe('keepPlaces : poules, kata, changement de format', () => {
  test('poules : arrivée dans la plus petite poule, hors de son club', () => {
    // r11 du club de r5 : les poules 1 et 2 sont les plus petites, la poule 1 a son club ➜ poule 2.
    const club = (i: number) => (i === 4 || i === 10 ? 'A' : `club${i}`);
    const pools = [['r1', 'r2', 'r3', 'r4'], ['r5', 'r6', 'r7'], ['r8', 'r9', 'r10']];
    const prev = poolsThenBracket(entrants(10, club), 1, NO, pools);
    expect(prev.pools).toEqual(pools);
    const next = keepPlaces(prev, entrants(11, club), 'pools_then_bracket', OPTS, 1) as CombatBracket;
    expect(next.pools).toEqual([['r1', 'r2', 'r3', 'r4'], ['r5', 'r6', 'r7'], ['r8', 'r9', 'r10', 'r11']]);
    expect(next.matches.filter((m) => m.phase === 'pool' && m.pool === 2)).toHaveLength(6);
  });

  test('poules : un départ, les autres restent dans leur poule', () => {
    const pools = [['r1', 'r2', 'r3', 'r4'], ['r5', 'r6', 'r7', 'r8']];
    const prev = poolsThenBracket(entrants(8), 1, NO, pools);
    const next = keepPlaces(prev, without(entrants(8), 'r2'), 'pools_then_bracket', OPTS, 1) as CombatBracket;
    expect(next.pools).toEqual([['r1', 'r3', 'r4'], ['r5', 'r6', 'r7', 'r8']]);
  });

  test('élimination ➜ poules : chaque paire du 1er tour reste dans la même poule', () => {
    const eight = entrants(8);
    const pairs = [['r1', 'r5'], ['r2', 'r6'], ['r3', 'r7'], ['r4', 'r8']];
    const next = keepPlaces(arranged(eight, pairs), eight, 'pools_then_bracket', OPTS, 1) as CombatBracket;
    expect(next.pools).toEqual([['r1', 'r5', 'r3', 'r7'], ['r2', 'r6', 'r4', 'r8']]);
    for (const [a, b] of pairs) expect(next.pools!.some((p) => p.includes(a!) && p.includes(b!))).toBe(true);
  });

  test('poules : une poule réduite à un combattant n’est pas gardée', () => {
    const pools = [['r1', 'r2', 'r3', 'r4'], ['r5', 'r6', 'r7', 'r8'], ['r9', 'r10', 'r11', 'r12']];
    const prev = poolsThenBracket(entrants(12), 1, NO, pools);
    const next = keepPlaces(prev, without(entrants(12), 'r1', 'r2', 'r3'), 'pools_then_bracket', OPTS, 1) as CombatBracket;
    // Tailles du tirage (3, 3, 3) ; les anciennes poules restent ensemble autant que possible.
    expect(next.pools).toEqual([['r5', 'r6', 'r7'], ['r8', 'r12', 'r4'], ['r9', 'r10', 'r11']]);
  });

  test('kata : départ et arrivée', () => {
    const four = entrants(4);
    const prev = kataBracket(four, 1, 1, [four[2]!, four[0]!, four[3]!, four[1]!]);
    expect(prev.order).toEqual(['r3', 'r1', 'r4', 'r2']);
    // Arrivants dans le désordre : triés par inscription.
    const people = [...without(entrants(6), 'r1')].reverse();
    const next = keepPlaces(prev, people, 'kata_two_rounds', OPTS, 1) as KataBracket;
    expect(next.order).toEqual(['r3', 'r4', 'r2', 'r5', 'r6']);
    expect(next.entrants.map((e) => e.registrationId)).toEqual(next.order);
  });

  test('2 ➜ 3 : combat unique ➜ poule', () => {
    const prev = singleMatch(entrants(2), 7);
    const [pair] = firstRound(prev);
    const next = keepPlaces(prev, entrants(3), 'round_robin', OPTS, 7) as CombatBracket;
    expect(next.format).toBe('round_robin');
    expect(next.matches).toHaveLength(3);
    const first = next.matches.find((m) => m.order === 0)!;
    expect([id(first.a), id(first.b)].sort()).toEqual([...pair!].sort());
  });

  test('élimination ➜ trois avec repêchage : la paire du 1er tour au premier combat', () => {
    const prev = arranged(entrants(4), [['r1', 'r3'], ['r2', 'r4']]);
    const next = keepPlaces(prev, without(entrants(4), 'r4'), 'three_with_repechage', OPTS, 1) as CombatBracket;
    const m1 = next.matches.find((m) => m.id === 'm1')!;
    expect([id(m1.a), id(m1.b)]).toEqual(['r1', 'r3']);
    expect(id(next.matches.find((m) => m.id === 'm2')!.b)).toBe('r2');
  });

  test('il reste un seul combattant (kata, poule)', () => {
    const kata = keepPlaces(kataBracket(entrants(3), 1, 1), entrants(1), 'kata_two_rounds', OPTS, 1) as KataBracket;
    expect(kata.order).toEqual(['r1']);
    const rr = keepPlaces(singleMatch(entrants(2), 1), entrants(1), 'round_robin', OPTS, 1) as CombatBracket;
    expect(rr.matches).toEqual([]);
  });
});

describe('keepPlaces : rien ne bouge quand rien ne change', () => {
  const opts = { repechage: false, thirdPlace: true, kataBronzeCount: 2 as const };
  const shape = (b: Bracket) => (b.kind === 'kata' ? b.order : { matches: b.matches, pools: b.pools });
  test.each([
    ['single_elimination', 6], ['double_elimination', 5], ['single_match', 2], ['best_of_three', 2], ['round_robin', 5],
    ['three_with_repechage', 3], ['pools_then_bracket', 9], ['kata_two_rounds', 5],
  ] as [BracketFormat, number][])('%s (%i)', (format, n) => {
    const people = entrants(n, (i) => `club${i % 3}`);
    const drawn = generateBracket(format, people, opts, 3);
    const once = keepPlaces(drawn, people, format, opts, 3);
    expect(shape(once)).toEqual(shape(drawn));
    expect(shape(keepPlaces(once, people, format, opts, 3))).toEqual(shape(once));
  });
});
