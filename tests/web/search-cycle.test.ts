import { expect, test } from 'vitest';
import { cycleIndex } from '../../src/web/components/planche/searchCycle.js';

test('cycleIndex : suivant et précédent, en boucle aux deux bouts', () => {
  expect(cycleIndex(0, 1, 5)).toBe(1);
  expect(cycleIndex(3, -1, 5)).toBe(2);
  expect(cycleIndex(4, 1, 5)).toBe(0);
  expect(cycleIndex(0, -1, 5)).toBe(4);
  expect(cycleIndex(0, 1, 1)).toBe(0);
  expect(cycleIndex(0, -1, 1)).toBe(0);
});

test('cycleIndex : aucun résultat → 0', () => {
  expect(cycleIndex(0, 1, 0)).toBe(0);
  expect(cycleIndex(0, -1, 0)).toBe(0);
  expect(cycleIndex(3, 1, 0)).toBe(0);
});

test('cycleIndex : un index hors limites (résultats qui ont diminué) part du dernier, celui affiché', () => {
  expect(cycleIndex(7, 1, 3)).toBe(0);
  expect(cycleIndex(7, -1, 3)).toBe(1);
});
