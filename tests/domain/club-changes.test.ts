import { expect, test } from 'vitest';
import { defaultChoice, differingFields, emailChoices, isUpcoming, propagationKind, resolvedValues, type ClubValues } from '../../src/domain/club-changes.js';

const a: ClubValues = { name: 'Dojo', coachName: 'Marie', coachPhone: '06', coachEmails: ['a@x.fr', 'b@x.fr'], affiliationNumber: null };

test('differingFields : adresses comparées sans casse ni ordre, autres champs dans l’ordre des champs', () => {
  expect(differingFields(a, { ...a, coachEmails: ['B@x.fr', 'a@x.fr'] })).toEqual([]);
  expect(differingFields(a, { ...a, name: 'Dojo 2', coachPhone: null })).toEqual(['name', 'coachPhone']);
  expect(differingFields(a, { ...a, coachEmails: ['a@x.fr'] })).toEqual(['coachEmails']);
});

test('differingFields : un téléphone écrit autrement n’est pas une différence', () => {
  expect(differingFields({ ...a, coachPhone: '0600000000' }, { ...a, coachPhone: '06 00 00 00 00' })).toEqual([]);
  expect(differingFields({ ...a, coachPhone: '+33 6 00 00 00 00' }, { ...a, coachPhone: '0600000000' })).toEqual([]);
  expect(differingFields({ ...a, coachPhone: '0600000000' }, { ...a, coachPhone: '0600000001' })).toEqual(['coachPhone']);
  expect(differingFields({ ...a, coachPhone: 'abc' }, { ...a, coachPhone: null })).toEqual(['coachPhone']);
});

test('defaultChoice : la compétition pour un champ modifié par l’enregistrement, sauf si sa valeur est vide ; sinon la fiche', () => {
  expect(defaultChoice('coachPhone', { ...a, coachPhone: '07' }, ['coachPhone'])).toBe('competition');
  expect(defaultChoice('coachPhone', { ...a, coachPhone: null }, ['coachPhone'])).toBe('directory');
  expect(defaultChoice('coachPhone', { ...a, coachPhone: '' }, ['coachPhone'])).toBe('directory');
  expect(defaultChoice('coachEmails', { ...a, coachEmails: [] }, ['coachEmails'])).toBe('directory');
  // Champ que l'enregistrement n'a pas modifié : une ancienne différence ne revient pas dans la fiche.
  expect(defaultChoice('coachName', { ...a, coachName: 'Autre' }, ['coachPhone'])).toBe('directory');
});

test('emailChoices : modifiées par l’enregistrement ; ajoutées cochées, autres seulement dans la compétition décochées, retirées décochées', () => {
  expect(emailChoices(['a@x.fr', 'old@x.fr'], ['new@x.fr', 'A@x.fr', 'ancienne@x.fr'], ['coachEmails'], ['new@x.fr'])).toEqual([
    { email: 'new@x.fr', origin: 'competition', checked: true },
    { email: 'A@x.fr', origin: 'both', checked: true },
    { email: 'ancienne@x.fr', origin: 'competition-only', checked: false },
    { email: 'old@x.fr', origin: 'directory', checked: false },
  ]);
});

test('emailChoices : liste de la compétition vide (effacée) → les adresses de la fiche sont cochées ; vider demande de les décocher', () => {
  expect(emailChoices(['a@x.fr'], [], ['coachEmails'], [])).toEqual([{ email: 'a@x.fr', origin: 'directory', checked: true }]);
});

test('emailChoices : champ non modifié par l’enregistrement → la fiche pour choix par défaut', () => {
  expect(emailChoices(['a@x.fr', 'b@x.fr'], ['a@x.fr', 'z@x.fr'], ['coachPhone'], [])).toEqual([
    { email: 'a@x.fr', origin: 'both', checked: true },
    { email: 'b@x.fr', origin: 'directory', checked: true },
    { email: 'z@x.fr', origin: 'competition-only', checked: false },
  ]);
});

test('N4 : e-mails non modifiés par l’enregistrement : les adresses de la fiche gardent leur ordre, en tête', () => {
  expect(emailChoices(['a@x.fr', 'b@x.fr'], ['b@x.fr', 'a@x.fr', 'c@x.fr'], ['coachPhone'], []).map((c) => `${c.email}:${c.checked}`)).toEqual(['a@x.fr:true', 'b@x.fr:true', 'c@x.fr:false']);
});

test('resolvedValues : le choix de chaque champ différent, les adresses cochées', () => {
  const changed = ['name', 'coachName'] as const;
  expect(resolvedValues(a, { ...a, name: 'Autre', coachName: null }, { name: 'competition', coachName: 'directory' }, ['b@x.fr'], [...changed])).toEqual({ ...a, name: 'Autre', coachEmails: ['b@x.fr'] });
  expect(resolvedValues(a, { ...a, name: 'Autre', coachPhone: '07' }, {}, ['b@x.fr'], ['coachPhone'])).toEqual({ ...a, coachPhone: '07', coachEmails: ['b@x.fr'] });
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

test('differingFields : une adresse en double ne compte qu’une fois', () => {
  expect(differingFields(a, { ...a, coachEmails: [...a.coachEmails, a.coachEmails[0]!.toUpperCase()] })).toEqual([]);
  expect(differingFields(a, { ...a, coachEmails: [a.coachEmails[0]!, a.coachEmails[0]!] })).toEqual(a.coachEmails.length > 1 ? ['coachEmails'] : []);
});
