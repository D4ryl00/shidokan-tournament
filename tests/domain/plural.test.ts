import { expect, test } from 'vitest';
import { plural } from '../../src/domain/plural.js';

test('0 et 1 au singulier, au-delà au pluriel', () => {
  expect(plural(0, 'présent')).toBe('0 présent');
  expect(plural(1, 'présent')).toBe('1 présent');
  expect(plural(3, 'présent')).toBe('3 présents');
});

test('pluriel irrégulier ; grands nombres à la française', () => {
  expect(plural(2, 'cas', 'cas')).toBe('2 cas');
  expect(plural(2, 'catégorie terminée', 'catégories terminées')).toBe('2 catégories terminées');
  expect(plural(1200, 'inscription')).toBe('1\u202f200 inscriptions');
});
