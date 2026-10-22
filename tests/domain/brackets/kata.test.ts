import { describe, expect, test } from 'vitest';
import { kataBracket, kataScore, resolveKata } from '../../../src/domain/brackets/kata.js';
import { entrants } from './helpers.js';

test.each([
  [[7, 8], 7.5], [[6, 7, 8, 9, 10], 8], [[5, 9, 7, 7, 7, 6], 6.75], [[], null], [[8.333, 8.334, 8.335], 8.33],
] as const)('kataScore(%j) = %s', (notes, expected) => expect(kataScore([...notes])).toBe(expected));

describe('resolveKata', () => {
  const five = kataBracket(entrants(5), 2, 1);
  const r1 = { r1: [9, 9, 9], r2: [8.5, 8.5, 8.5], r3: [8, 8, 8], r4: [7, 7, 7], r5: [6, 6, 6] };
  test('ordre de passage : tous les inscrits', () => expect([...five.order].sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']));
  test('finalistes = deux meilleurs du tour 1 ; finale seule pour 1er/2e ; bronzes = 3e et 4e', () => {
    const res = resolveKata(five, { round1: r1, final: { r1: [7, 7, 7], r2: [9, 9, 9] } });
    expect(res.finalists.sort()).toEqual(['r1', 'r2']);
    expect(res.podium).toMatchObject({ first: 'r2', second: 'r1', thirds: ['r3', 'r4'], complete: true, ties: [] });
  });
  test('un seul bronze', () => {
    const res = resolveKata(kataBracket(entrants(5), 1, 1), { round1: r1, final: { r1: [9], r2: [8] } });
    expect(res.podium.thirds).toEqual(['r3']);
  });
  test('2 katakas : directement la finale', () => {
    const res = resolveKata(kataBracket(entrants(2), 2, 1), { round1: {}, final: { r1: [8], r2: [9] } });
    expect(res.finalists.sort()).toEqual(['r1', 'r2']);
    expect(res.podium).toMatchObject({ first: 'r2', second: 'r1', thirds: [], complete: true });
  });
  test('égalité pour la place en finale → signalée', () => {
    const res = resolveKata(five, { round1: { ...r1, r3: [8.5, 8.5, 8.5] }, final: {} });
    expect(res.podium.ties.length).toBeGreaterThan(0);
    expect(res.podium.complete).toBe(false);
  });
  test('incomplet tant que les notes manquent', () => {
    expect(resolveKata(five, { round1: { r1: [9] }, final: {} }).podium.complete).toBe(false);
  });
});
