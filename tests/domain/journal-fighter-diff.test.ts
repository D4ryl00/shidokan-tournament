import { expect, test } from 'vitest';
import { diffFighter, subjectOf, type FighterSnapshot } from '../../src/domain/journal/fighter-diff.js';

const base: FighterSnapshot = { name: 'DUPONT Léa', club: 'Shidokan Lyon', fields: { Grade: '2e kyu', Licence: null }, registrations: { 'Karaté Jiyu': { 'Catégorie de poids': '-45 kg' } } };
test('aucun écart', () => expect(diffFighter(base, structuredClone(base))).toEqual([]));
test('champ, club, inscription changée, ajoutée, retirée', () => {
  const after = { ...base, club: 'Dojo Marseille', fields: { Grade: '1er kyu', Licence: '11462640R' },
    registrations: { 'Karaté Jiyu': { 'Catégorie de poids': '-50 kg' }, Kata: {} } };
  expect(diffFighter(base, after)).toEqual([
    { label: 'Club', before: 'Shidokan Lyon', after: 'Dojo Marseille' },
    { label: 'Grade', before: '2e kyu', after: '1er kyu' },
    { label: 'Licence', before: null, after: '11462640R' },
    { label: 'Karaté Jiyu · Catégorie de poids', before: '-45 kg', after: '-50 kg' },
    { label: 'Kata', before: null, after: 'inscrit' },
  ]);
  expect(diffFighter(after, base).at(-1)).toEqual({ label: 'Kata', before: 'inscrit', after: null });
});
test('nom changé', () => expect(diffFighter(base, { ...base, name: 'DUPOND Léa' })[0]).toEqual({ label: 'Nom', before: 'DUPONT Léa', after: 'DUPOND Léa' }));
test('sujet', () => {
  expect(subjectOf(base)).toBe('DUPONT Léa (Shidokan Lyon)');
  expect(subjectOf({ ...base, club: null })).toBe('DUPONT Léa');
});
