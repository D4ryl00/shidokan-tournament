import { expect, test } from 'vitest';
import { ffkBanner, ffkChoiceState, ffkValueAvailable } from '../../src/web/components/club-line/ffkStep.js';

const diff = { field: 'weightClassId' as const, ffk: 'benjamin:F:-40', fiche: 'benjamin:F:-45' };

test('ffkChoiceState : la valeur FFK, celle de la fiche, ou une autre saisie', () => {
  expect(ffkChoiceState('benjamin:F:-40', diff)).toBe('ffk');
  expect(ffkChoiceState('benjamin:F:-45', diff)).toBe('fiche');
  expect(ffkChoiceState('benjamin:F:-50', diff)).toBeNull();
  expect(ffkChoiceState(null, { ...diff, fiche: null })).toBe('fiche');
});

test('ffkBanner : une, deux ou trois disciplines', () => {
  const end = ' Ce que vous choisissez ici vaut pour toutes ses disciplines.';
  expect(ffkBanner('Jade', ['Karaté', 'Kata'])).toBe(`Fiche déjà créée. Une seule fiche par combattant : celle de Jade est inscrite en Karaté et Kata.${end}`);
  expect(ffkBanner('Jade', ['Karaté'])).toBe(`Fiche déjà créée. Une seule fiche par combattant : celle de Jade est inscrite en Karaté.${end}`);
  expect(ffkBanner('Jade', ['Karaté', 'Boxing', 'Kata'])).toBe(`Fiche déjà créée. Une seule fiche par combattant : celle de Jade est inscrite en Karaté, Boxing et Kata.${end}`);
  expect(ffkBanner('Jade', ['Karaté'], { locked: true })).toBe('Fiche déjà créée. Une seule fiche par combattant : celle de Jade est inscrite en Karaté.');
});

test('ffkValueAvailable : la valeur doit figurer dans la liste actuelle du champ (null toujours permis)', () => {
  expect(ffkValueAvailable('a', ['a', 'b'])).toBe(true);
  expect(ffkValueAvailable('c', ['a', 'b'])).toBe(false);
  expect(ffkValueAvailable('c', [])).toBe(false);
  expect(ffkValueAvailable(null, [])).toBe(true);
});
