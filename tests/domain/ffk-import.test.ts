import { describe, expect, test } from 'vitest';
import {
  disciplineFromSheetName,
  findHeaderRow,
  guessColumnMapping,
  parseFfkRows,
  type ColumnMapping,
} from '../../src/domain/ffk-import.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { BLANK, FFK_HEADER } from '../helpers/ffk-fixture.js';

const grid = ffkDefaultGrid();
const STD: ColumnMapping = { lastName: 0, firstName: 1, licence: 2, club: 3, sex: 4, discipline: 5, ageBand: 6, weight: 7, ruleset: 8 };

describe('correspondance des colonnes', () => {
  test('en-tête FFK réel', () => expect(guessColumnMapping(FFK_HEADER)).toEqual(STD));
  test('autre ordre, autre casse, colonne absente', () => {
    expect(guessColumnMapping(['Sexe', 'PRÉNOM', 'NOM', 'Club', 'Âge', 'Poids'])).toEqual({
      lastName: 2, firstName: 1, licence: null, club: 3, sex: 0, discipline: null, ageBand: 4, weight: 5, ruleset: null,
    });
  });
  test('ligne d’en-tête après des lignes de titre', () => {
    expect(findHeaderRow([['Coupe Shidokan'], [], FFK_HEADER, ['X']])).toBe(2);
    expect(findHeaderRow([['a', 'b'], ['c']])).toBeNull();
  });
});

test.each([
  ['Coupe Shidokan Karate', 'karate'], ['Boxe', 'shido-boxing'], ['Mix Martial', 'shido-mix'],
  ['Kata enfants', 'kata'], ['Triathlon', 'triathlon'], ['Feuil1', null],
] as const)('disciplineFromSheetName(%s)', (name, d) => expect(disciplineFromSheetName(name)).toBe(d));

describe('parseFfkRows', () => {
  const cells = (lines: (string | number | null)[][]) => [FFK_HEADER, ...lines];
  const parse = (lines: (string | number | null)[][], sheet = 'Coupe Shidokan Karate') => parseFfkRows(cells(lines), 0, STD, sheet, grid);

  test('ligne de la forme réelle', () => {
    const [r] = parse([['MOREAU LINA', null, '99999999Z', '0060808 ISSA KYOKUSHIN SCHOOL', 'Feminine', 'Karate', 'Poussin', -20, null]]);
    expect(r).toMatchObject({
      key: 'Coupe Shidokan Karate#2', line: 2, licence: '99999999Z', lastName: 'MOREAU', firstName: 'LINA',
      clubEntity: '0060808 ISSA KYOKUSHIN SCHOOL', clubName: 'ISSA KYOKUSHIN SCHOOL', sex: 'F', ageBandCode: 'poussin',
      discipline: 'karate', ruleset: null, weightLabel: '-20', errors: [],
    });
  });
  test('catégorie fermée : avertissement', () => {
    const [r] = parseFfkRows(cells([['MOREAU LINA', null, '99999999Z', '0060808 ISSA', 'Feminine', 'Karate', 'Poussin', -20, null]]), 0, STD, 'Coupe Shidokan Karate', grid, new Set(['poussin|F|karate|jiyu']));
    expect(r!.errors).toEqual([]);
    expect(r!.warnings).toContain('Catégorie non ouverte à cette compétition (Karaté jiyu) : la ligne ira en Réaffectation.');
  });
  test('lignes vides ignorées, numéros conservés', () => {
    const rows = parse([['A B', null, '1', '1 C', 'Masculin', 'Karate', 'Senior', -75, null], BLANK, BLANK, ['C D', 'x', '2', '1 C', 'Masculin', 'Karate', 'Senior', '+84', null]]);
    expect(rows.map((r) => r.line)).toEqual([2, 5]);
    expect(rows[1]!.weightLabel).toBe('+84');
    expect(rows[1]!.firstName).toBe('x');
  });
  test('JUNIOR, Veteran, Ji Yu', () => {
    const rows = parse([
      ['A B', null, '1', '1 C', 'Masculin', 'Karate', 'JUNIOR', -61, 'Shobu'],
      ['C D', null, '2', '1 C', 'Masculin', 'Karate', 'Veteran', -84, 'Ji Yu'],
    ]);
    expect(rows[0]).toMatchObject({ ageBandCode: 'junior', ruleset: 'shobu' });
    expect(rows[1]).toMatchObject({ ageBandCode: 'v1', ruleset: 'jiyu' });
    expect(rows[1]!.warnings.join(' ')).toContain('V1');
  });
  test('sans licence ni âge', () => {
    const [r] = parse([['A B', null, null, '1 C', 'Masculin', 'Karate', null, -75, null]]);
    expect(r!.errors.join(' ')).toMatch(/catégorie d'âge/i);
    expect(r!.warnings.join(' ')).toContain('licence');
  });
  test('discipline prise depuis le nom de l’onglet', () => {
    const [r] = parse([['A B', null, '1', '1 C', 'Masculin', null, 'Senior', -75, null]], 'Boxe');
    expect(r!.discipline).toBe('shido-boxing');
  });
  test('poids absent pour un combat', () => {
    const [r] = parse([['A B', null, '1', '1 C', 'Masculin', 'Karate', 'Senior', null, null]]);
    expect(r!.errors.join(' ')).toContain('poids');
  });
  test('catégorie ouverte inconnue → erreur', () => {
    const [r] = parse([['A B', null, '1', '1 C', 'Masculin', 'Karate', 'Senior', '+80', null]]);
    expect(r!.errors.join(' ')).toContain('+80');
  });
  test('catégorie non ouverte inconnue → pas d’erreur', () => {
    const [r] = parse([['A B', null, '1', '1 C', 'Feminine', 'Karate', 'Poussin', -20, null]]);
    expect(r!.errors).toEqual([]);
  });
  test('Kmix', () => {
    const [r] = parse([['A B', null, '1', '1 C', 'Masculin', 'Kmix', 'Cadet', -45, null]], 'Mix Martial');
    expect(r!.discipline).toBe('shido-mix');
    expect(r!.errors).toEqual([]);
    expect(r!.warnings.join(' ')).toContain('-45'); // -45 n'existe pas en cadets M (FFK : -52 …) : sera créée
  });
});
