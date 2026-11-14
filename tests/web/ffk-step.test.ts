import { expect, test } from 'vitest';
import { fieldValue } from '../../src/domain/club-form-plan.js';
import { EMPTY_LINE as EMPTY } from '../../src/web/components/ClubLineForm.js';
import { ffkBanner, ffkChoiceState, ffkValueAvailable, importValueText, withStartedDisciplines } from '../../src/web/components/club-line/ffkStep.js';

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

const ctx = {
  ageBands: [{ code: 'senior', label: 'Senior', ages: '18-39', isMinor: false }],
  weightClasses: [{ id: 'senior:F:-54', ageBandCode: 'senior', sex: 'F' as const, label: '-54', maxKg: 54 }],
};

test('importValueText : le texte lisible de chaque champ', () => {
  expect(importValueText('weightClassId', 'senior:F:-54', ctx)).toBe('-54 kg');
  expect(importValueText('weightKg', '52.5', ctx)).toBe('52,5 kg');
  expect(importValueText('ageBandCode', 'senior', ctx)).toBe('Senior');
  expect(importValueText('ruleset', 'jiyu', ctx)).toBe('Jiyu');
  expect(importValueText('ruleset', 'shobu', ctx)).toBe('Shobu');
  expect(importValueText('disciplines', 'karate,kata', ctx)).toBe('Karaté et Kata');
  expect(importValueText('disciplines', 'karate,shido-boxing,kata', ctx)).toBe('Karaté, Shido-boxing et Kata');
  expect(importValueText('prefs', 'shido-boxing,shido-mix', ctx)).toBe('1 Boxing · 2 Mix');
  expect(importValueText('shobuKeep', 'ruleset', ctx)).toBe('Changer de discipline');
  expect(importValueText('shobuKeep', 'discipline', ctx)).toBe('Passer en jiyu');
  expect(importValueText('grade', '3e dan', ctx)).toBe('3e dan');
  expect(importValueText('grade', null, ctx)).toBe('—');
});

test('ffkChoiceState sur la valeur texte d’un champ de la ligne', () => {
  const d = { field: 'disciplines' as const, ffk: 'karate,kata', fiche: 'karate' };
  const line = { ...EMPTY, combats: ['karate' as const], kata: true };
  expect(ffkChoiceState(fieldValue(line, 'disciplines'), d)).toBe('ffk');
  expect(ffkChoiceState(fieldValue({ ...line, kata: false }, 'disciplines'), d)).toBe('fiche');
  expect(ffkChoiceState(fieldValue({ ...line, combats: [] }, 'disciplines'), d)).toBeNull();
});

test('withStartedDisciplines : remet les disciplines commencées dans la valeur', () => {
  expect(withStartedDisciplines('karate', ['kata'])).toBe('karate,kata');
  expect(withStartedDisciplines('shido-mix,kata', ['karate'])).toBe('karate,shido-mix,kata');
  expect(withStartedDisciplines('karate', [])).toBe('karate');
  expect(withStartedDisciplines(null, ['kata', 'karate'])).toBe('karate,kata');
  expect(withStartedDisciplines(null, [])).toBeNull();
});
