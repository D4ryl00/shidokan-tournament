import { expect, test } from 'vitest';
import { defaultChoice, differingFields, emailChoices, isUpcoming, propagationKind, resolvedValues, type ClubValues } from '../../src/domain/club-changes.js';

const a: ClubValues = { name: 'Dojo', coachName: 'Marie', coachPhone: '06', coachEmails: ['a@x.fr', 'b@x.fr'], affiliationNumber: null };

test('differingFields : adresses comparées sans casse ni ordre, autres champs dans l’ordre des champs', () => {
  expect(differingFields(a, { ...a, coachEmails: ['B@x.fr', 'a@x.fr'] })).toEqual([]);
  expect(differingFields(a, { ...a, name: 'Dojo 2', coachPhone: null })).toEqual(['name', 'coachPhone']);
  expect(differingFields(a, { ...a, coachEmails: ['a@x.fr'] })).toEqual(['coachEmails']);
});

test('defaultChoice : la compétition, sauf si sa valeur est vide', () => {
  expect(defaultChoice('coachPhone', { ...a, coachPhone: '07' })).toBe('competition');
  expect(defaultChoice('coachPhone', { ...a, coachPhone: null })).toBe('directory');
  expect(defaultChoice('coachPhone', { ...a, coachPhone: '' })).toBe('directory');
  expect(defaultChoice('coachEmails', { ...a, coachEmails: [] })).toBe('directory');
});

test('emailChoices : celles de la compétition d’abord, cochées ; celles de l’annuaire seules ensuite, décochées', () => {
  expect(emailChoices(['a@x.fr', 'old@x.fr'], ['new@x.fr', 'A@x.fr'])).toEqual([
    { email: 'new@x.fr', origin: 'competition', checked: true },
    { email: 'A@x.fr', origin: 'both', checked: true },
    { email: 'old@x.fr', origin: 'directory', checked: false },
  ]);
});

test('resolvedValues : le choix de chaque champ différent, les adresses cochées', () => {
  expect(resolvedValues(a, { ...a, name: 'Autre', coachName: null }, { name: 'competition', coachName: 'directory' }, ['b@x.fr'])).toEqual({ ...a, name: 'Autre', coachEmails: ['b@x.fr'] });
});

test('propagationKind : apply seulement si le club avait exactement la valeur d’avant', () => {
  expect(propagationKind('coachPhone', { ...a, coachPhone: '06' }, a)).toBe('apply');
  expect(propagationKind('coachPhone', { ...a, coachPhone: '09' }, a)).toBe('conflict');
  expect(propagationKind('coachEmails', { ...a, coachEmails: ['B@x.fr', 'a@x.fr'] }, a)).toBe('apply');
});

test('isUpcoming : le jour même compte', () => {
  expect(isUpcoming('2026-11-05', '2026-11-05')).toBe(true);
  expect(isUpcoming('2026-11-04', '2026-11-05')).toBe(false);
});
