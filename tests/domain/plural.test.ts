import { expect, test } from 'vitest';
import { ofName, plural } from '../../src/domain/plural.js';

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

test('« de » devant un nom : élidé devant une voyelle (accentuée ou non), gardé devant une consonne, un h ou un y', () => {
  expect(ofName('Arts Martiaux du Cap')).toBe('d’Arts Martiaux du Cap');
  expect(ofName('Élan Karaté')).toBe('d’Élan Karaté');
  expect(ofName('ASPTT Nice')).toBe('d’ASPTT Nice');
  expect(ofName('Budo Collines')).toBe('de Budo Collines');
  expect(ofName('Hirondelles')).toBe('de Hirondelles');
  expect(ofName('Yoseikan')).toBe('de Yoseikan');
  expect(ofName('  Oliviers')).toBe('d’Oliviers');
});
