import { describe, expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import {
  combatConflictWarning,
  parsePreferences,
  validateRegistration,
  type Registration,
  type RegistrationInput,
} from '../../src/domain/registration.js';

const grid = ffkDefaultGrid();

describe('parsePreferences', () => {
  test.each(['32', '3 2', '3,2', '3-2', 32])('%s → mix puis boxing', (raw) => {
    expect(parsePreferences(raw, 'karate')).toEqual({ value: ['shido-mix', 'shido-boxing'], errors: [] });
  });
  test('vide', () => expect(parsePreferences('', 'karate')).toEqual({ value: [], errors: [] }));
  test('null', () => expect(parsePreferences(null, 'karate')).toEqual({ value: [], errors: [] }));
  test('discipline principale ignorée avec erreur', () => {
    const r = parsePreferences('12', 'karate');
    expect(r.value).toEqual(['shido-boxing']);
    expect(r.errors.join(' ')).toContain('discipline principale');
  });
  test('code inconnu', () => expect(parsePreferences('4', 'karate').errors.join(' ')).toContain('code inconnu'));
  test('doublon ignoré sans erreur', () => expect(parsePreferences('22', 'karate')).toEqual({ value: ['shido-boxing'], errors: [] }));
  test.each(['kata', 'triathlon'] as const)('pas de préférences pour %s', (d) => {
    const r = parsePreferences('2', d);
    expect(r.value).toEqual([]);
    expect(r.errors.join(' ')).toContain('pas de préférences');
  });
});

const base: RegistrationInput = {
  clubId: null, lastName: 'DUPONT', firstName: 'Lyna', sex: 'M', ageBandCode: 'senior',
  discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:M:-75', otherDisciplines: ['shido-boxing'], source: 'manual',
};

describe('validateRegistration', () => {
  test('inscription valide', () => expect(validateRegistration(base, grid)).toEqual([]));
  test('shobu interdit aux mineurs', () => {
    const errs = validateRegistration({ ...base, ageBandCode: 'minime', weightClassId: 'minime:M:-45' }, grid);
    expect(errs.join(' ')).toContain('réservé aux adultes');
  });
  test('kata sans poids ni règlement', () => {
    expect(validateRegistration({ ...base, discipline: 'kata', ruleset: null, weightClassId: null, otherDisciplines: [] }, grid)).toEqual([]);
  });
  test('kata avec catégorie de poids → erreur', () => {
    expect(validateRegistration({ ...base, discipline: 'kata', ruleset: null, otherDisciplines: [] }, grid).length).toBeGreaterThan(0);
  });
  test('combat sans catégorie de poids → erreur', () => {
    expect(validateRegistration({ ...base, weightClassId: null }, grid).length).toBeGreaterThan(0);
  });
  test('combat sans règlement → erreur', () => {
    expect(validateRegistration({ ...base, ruleset: null }, grid).length).toBeGreaterThan(0);
  });
  test('catégorie de poids d’une autre tranche → erreur', () => {
    expect(validateRegistration({ ...base, weightClassId: 'cadet:M:-52' }, grid).length).toBeGreaterThan(0);
  });
  test('catégorie de poids inconnue → erreur', () => {
    expect(validateRegistration({ ...base, weightClassId: 'nope' }, grid).length).toBeGreaterThan(0);
  });
  test('tranche d’âge inconnue → erreur', () => {
    expect(validateRegistration({ ...base, ageBandCode: 'inconnue' }, grid).join(' ')).toContain('inconnue');
  });
  test('jiyu en priorité alors que jiyu → erreur', () => {
    expect(validateRegistration({ ...base, ruleset: 'jiyu', acceptsJiyuFirst: true }, grid).length).toBeGreaterThan(0);
  });
  test('préférences incluant la discipline principale → erreur', () => {
    expect(validateRegistration({ ...base, otherDisciplines: ['karate'] }, grid).length).toBeGreaterThan(0);
  });
  test('préférences incluant le kata → erreur', () => {
    expect(validateRegistration({ ...base, otherDisciplines: ['kata'] }, grid).length).toBeGreaterThan(0);
  });
  test('nom vide → erreur', () => {
    expect(validateRegistration({ ...base, lastName: ' ' }, grid).length).toBeGreaterThan(0);
  });
});

describe('combatConflictWarning', () => {
  const existing = [{ discipline: 'karate' }] as Registration[];
  test('deuxième discipline de combat interdite → message', () => {
    expect(combatConflictWarning(existing, { discipline: 'shido-boxing' }, false)).toMatch(/discipline/);
  });
  test('autorisée par la compétition → null', () => {
    expect(combatConflictWarning(existing, { discipline: 'shido-boxing' }, true)).toBeNull();
  });
  test('kata ne compte pas', () => {
    expect(combatConflictWarning(existing, { discipline: 'kata' }, false)).toBeNull();
  });
});

describe('préférences écrites en toutes lettres', () => {
  test('« boxe, mix »', () => expect(parsePreferences('boxe, mix', 'karate')).toEqual({ value: ['shido-boxing', 'shido-mix'], errors: [] }));
  test('« Shido-mix-martial > Shido-boxing »', () =>
    expect(parsePreferences('Shido-mix-martial > Shido-boxing', 'karate').value).toEqual(['shido-mix', 'shido-boxing']));
  test('mot inconnu → remarque', () => expect(parsePreferences('judo', 'karate').errors.join(' ')).toContain('judo'));
});
