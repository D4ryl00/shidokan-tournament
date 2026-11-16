import { expect, test } from 'vitest';
import { searchByName } from '../../src/web/components/ffk-import/search.js';

const people = ['NAVARO Tess', 'DURAND Léa', 'MARTINI Giulia', 'LEROY Aria'].map((label) => ({ label }));
const name = (p: { label: string }) => p.label;

test('searchByName : le nom contient la recherche, en majuscules ou minuscules', () => {
  expect(searchByName(people, 'nava', name)).toEqual([{ label: 'NAVARO Tess' }]);
  expect(searchByName(people, 'TESS', name)).toEqual([{ label: 'NAVARO Tess' }]);
});

test('searchByName : les accents sont ignorés, des deux côtés', () => {
  expect(searchByName(people, 'lea', name)).toEqual([{ label: 'DURAND Léa' }]);
  expect(searchByName(people, 'léa', name)).toEqual([{ label: 'DURAND Léa' }]);
});

test('searchByName : rien avant 2 lettres', () => {
  expect(searchByName(people, 'n', name)).toEqual([]);
  expect(searchByName(people, '  a ', name)).toEqual([]);
  expect(searchByName(people, '', name)).toEqual([]);
});

test('searchByName : 6 résultats au plus (ou la limite donnée)', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ label: `MARTIN ${i}` }));
  expect(searchByName(many, 'martin', name)).toHaveLength(6);
  expect(searchByName(many, 'martin', name, 3)).toEqual(many.slice(0, 3));
});
