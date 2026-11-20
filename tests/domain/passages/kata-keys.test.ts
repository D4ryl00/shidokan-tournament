import { expect, test } from 'vitest';
import { kataBracket } from '../../../src/domain/brackets/kata.js';
import { isKataKey, kataFinaleKey, kataKeys, kataTour1Key, parseKataKey } from '../../../src/domain/passages/index.js';

const entrants = (ids: string[]) => ids.map((registrationId) => ({ registrationId, clubId: null, label: registrationId.toUpperCase() }));

test('kataKeys : tour 1 dans l’ordre du tirage, puis finale', () => {
  const b = kataBracket(entrants(['r1', 'r2', 'r3']), 1, 1, entrants(['r3', 'r1', 'r2']));
  expect(kataKeys(b, 'whole')).toEqual(['kata:tour1:r3', 'kata:tour1:r1', 'kata:tour1:r2', 'kata:finale:1', 'kata:finale:2']);
  expect(kataKeys(b, 'tour1')).toEqual(['kata:tour1:r3', 'kata:tour1:r1', 'kata:tour1:r2']);
  expect(kataKeys(b, 'finale')).toEqual(['kata:finale:1', 'kata:finale:2']);
});

test('kataKeys : à deux, la finale seule', () => {
  expect(kataKeys(kataBracket(entrants(['a', 'b']), 1, 1), 'whole')).toEqual(['kata:finale:1', 'kata:finale:2']);
  expect(kataKeys(kataBracket(entrants(['a', 'b']), 1, 1), 'tour1')).toEqual([]);
});

test('parseKataKey', () => {
  expect(parseKataKey('kata:tour1:r3')).toEqual({ round: 'tour1', registrationId: 'r3' });
  expect(parseKataKey('kata:finale:2')).toEqual({ round: 'finale', slot: 2 });
  expect(parseKataKey('w1-0')).toBeNull();
  // Anciennes clés de bloc : plus des clés de passage.
  for (const old of ['kata', 'kata:tour1', 'kata:finale', 'kata:finale:3', 'kata:tour1:']) expect(parseKataKey(old)).toBeNull();
});

test('kataTour1Key, kataFinaleKey, isKataKey', () => {
  expect(kataTour1Key('r3')).toBe('kata:tour1:r3');
  expect(kataFinaleKey(1)).toBe('kata:finale:1');
  expect(isKataKey('kata:finale:1')).toBe(true);
  expect(isKataKey('w1-0')).toBe(false);
});
