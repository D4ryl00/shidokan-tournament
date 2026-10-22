import { expect, test } from 'vitest';
import { normalizeName, parseSex, parseYesNo, splitFullName } from '../../src/domain/names.js';

test.each([
  ["Côte-d'Azur  Éloïse", 'COTE D AZUR ELOISE'],
  ['  dupont ', 'DUPONT'],
  ['Ñoño', 'NONO'],
  ['O’Neil', 'O NEIL'],
])('normalizeName(%s)', (a, b) => {
  expect(normalizeName(a)).toBe(b);
});

test('nom complet sans prénom séparé : dernier mot = prénom', () => {
  expect(splitFullName('DUBOIS MARIE ANNE')).toEqual({ lastName: 'DUBOIS MARIE', firstName: 'ANNE' });
});
test('prénom fourni à part', () => {
  expect(splitFullName('DUPONT', 'Lyna')).toEqual({ lastName: 'DUPONT', firstName: 'Lyna' });
});
test('prénom vide fourni à part : découpe le nom complet', () => {
  expect(splitFullName('DUPONT LYNA', '  ')).toEqual({ lastName: 'DUPONT', firstName: 'LYNA' });
});
test('un seul mot', () => {
  expect(splitFullName('DUPONT')).toEqual({ lastName: 'DUPONT', firstName: '' });
});

test.each([
  ['Oui', true], ['oui', true], ['OUI ', true], ['X', true], ['x', true], [true, true], [1, true], ['o', true],
  ['Non', false], ['non', false], [false, false], [0, false],
  ['', null], [null, null], [undefined, null], ['peut-être', null],
])('parseYesNo(%s)', (v, r) => {
  expect(parseYesNo(v)).toBe(r);
});

test.each([
  ['F', 'F'], ['Féminin', 'F'], ['Féminine', 'F'], ['Feminine', 'F'], ['fille', 'F'], ['Femme', 'F'], ['Fém.', 'F'],
  ['M', 'M'], ['Masculin', 'M'], ['Garçon', 'M'], ['homme', 'M'], ['Masc.', 'M'], ['H', 'M'],
  ['?', null], ['', null], [null, null],
])('parseSex(%s)', (v, r) => {
  expect(parseSex(v)).toBe(r);
});
