import { expect, test } from 'vitest';
import { withSession } from '../../src/web/useSelectedWave.js';

test('la session suit le lien : ajoutée à l’adresse, avec ou sans autres paramètres', () => {
  expect(withSession('/competitions/c1/reaffectation', 'w 2')).toBe('/competitions/c1/reaffectation?session=w%202');
  expect(withSession('/competitions/c1/tableaux?vue=galaxie&categorie=k', 'w2')).toBe('/competitions/c1/tableaux?vue=galaxie&categorie=k&session=w2');
});

test('sans session (compétition sans sessions, catégorie hors session) : lien inchangé', () => {
  expect(withSession('/competitions/c1/reaffectation', null)).toBe('/competitions/c1/reaffectation');
  expect(withSession('/competitions/c1/reaffectation', undefined)).toBe('/competitions/c1/reaffectation');
});
