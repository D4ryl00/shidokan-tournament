import { expect, test } from 'vitest';
import { generateBracket } from '../../src/domain/brackets/index.js';
import { newSameClubPairs, sameClubFirstRound, sameClubSentence } from '../../src/domain/brackets/same-club.js';
import { singleElimination } from '../../src/domain/brackets/elimination.js';
import { entrants } from './brackets/helpers.js';

const OPTS = { repechage: false, thirdPlace: false, kataBronzeCount: 1 as const };
const slot = (ids: string[]) => ids.map((registrationId) => ({ kind: 'entrant' as const, registrationId }));

test('élimination : deux du même club face à face au combat 1', () => {
  const four = entrants(4, (i) => (i < 2 ? 'c1' : `x${i}`));
  const b = singleElimination(four, OPTS, 1, slot(['r1', 'r2', 'r3', 'r4']));
  expect(sameClubFirstRound(b)).toEqual([['r1', 'r2']]);
  const apart = singleElimination(four, OPTS, 1, slot(['r1', 'r3', 'r2', 'r4']));
  expect(sameClubFirstRound(apart)).toEqual([]);
  expect(newSameClubPairs(b, b)).toEqual([]);
  expect(newSameClubPairs(apart, b)).toEqual([['r1', 'r2']]);
  expect(newSameClubPairs(null, null)).toEqual([]);
});
test('poule du même club et kata : aucune paire', () => {
  expect(sameClubFirstRound(generateBracket('round_robin', entrants(3, () => 'c1'), OPTS, 1))).toEqual([]);
  expect(sameClubFirstRound(generateBracket('kata_two_rounds', entrants(4, () => 'c1'), OPTS, 1))).toEqual([]);
  expect(sameClubFirstRound(null)).toEqual([]);
});
test('club inconnu : pas de paire', () => {
  expect(sameClubFirstRound(singleElimination(entrants(4, () => null), OPTS, 1, slot(['r1', 'r2', 'r3', 'r4'])))).toEqual([]);
});
test('phrase', () => {
  const info = (id: string) => (id === 'r1' ? { name: 'BERNARD Léa', club: 'Tani Dojo' } : { name: 'DUBOIS Lucas', club: 'Tani Dojo' });
  expect(sameClubSentence(['r1', 'r2'], info)).toBe('BERNARD Léa et DUBOIS Lucas (Tani Dojo) se rencontrent au 1er tour.');
});
