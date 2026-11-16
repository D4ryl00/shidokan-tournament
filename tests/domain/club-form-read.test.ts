import { describe, expect, test } from 'vitest';
import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_FIRST_ROW,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_LICENCE_COLUMN,
  CLUB_FORM_LEGACY_COLUMNS,
  CLUB_FORM_TITLE,
  NotAClubFormError,
} from '../../src/domain/club-form.js';
import { LEGACY_FORM_REFUSED, readClubFormLines } from '../../src/domain/club-form-read.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const TOL = { M: 0, F: 0 };
const COLUMNS_ROW_INDEX = 10;
type Line = (string | number | null)[];

function sheet(lines: Line[], preApproval: string | null = 'non', columns: readonly string[] = CLUB_FORM_COLUMNS): unknown[][] {
  const cells: unknown[][] = [];
  cells[0] = [CLUB_FORM_TITLE];
  const header = ['Tani Dojo', 'Jean Coach', null, null, preApproval];
  CLUB_FORM_HEADER_FIELDS.forEach((label, i) => (cells[3 + i] = [label, header[i] ?? null]));
  cells[COLUMNS_ROW_INDEX] = [...columns];
  lines.forEach((l, i) => (cells[CLUB_FORM_FIRST_ROW - 1 + i] = l));
  return cells;
}

describe('readClubFormLines', () => {
  test('ligne complète', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', 'Féminin', 'Cadets', '52', 'Karaté', 'Oui', '2e kyu', 'Jiyu', '', '1', '', '', '']]), grid, TOL);
    const cadetF = grid.weightClasses
      .filter((w) => w.ageBandCode === 'cadet' && w.sex === 'F' && w.maxKg !== null && w.maxKg >= 52)
      .sort((a, b) => a.maxKg! - b.maxKg!)[0]!;
    expect(r.items[0]).toMatchObject({
      order: 0,
      rows: [14],
      line: { combats: ['karate'], kata: true, grade: '2e kyu', ruleset: 'jiyu', weightKg: 52, weightClassId: cadetF.id, prefs: { 'shido-boxing': 1 } },
      notes: [],
    });
    expect(r.header).toEqual({ club: 'Tani Dojo', coachName: 'Jean Coach', coachPhone: null, coachEmails: [], preApproval: false });
  });

  test('poids sans catégorie', () => {
    // Grille sans catégorie ouverte : un poids au-dessus de la plus lourde n'a pas de catégorie.
    const closedGrid = { ...grid, weightClasses: grid.weightClasses.filter((w) => w.maxKg !== null) };
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', 'F', 'Cadets', '300', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', '']]), closedGrid, TOL);
    expect(r.items[0]!.line.weightClassId).toBeNull();
    expect(r.items[0]!.notes.join(' ')).toContain('catégorie de poids');
  });

  test('ligne illisible gardée', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', 'F', '12 ans', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', '']]), grid, TOL);
    const it = r.items[0]!;
    expect(it.line.ageBandCode).toBeNull();
    expect(it.notes).toContain("Catégorie d'âge incompréhensible : « 12 ans ».");
    expect(it.line).toMatchObject({ lastName: 'MARTIN', firstName: 'Léa', sex: 'F', weightKg: 52, combats: ['karate'] });
  });

  test('vétéran sans numéro', () => {
    const r = readClubFormLines(sheet([['DURAND', 'Hugo', 'M', 'Vétéran', '70', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', '']]), grid, TOL);
    expect(r.items[0]!.line.ageBandCode).toBe('v1');
    expect(r.items[0]!.notes).toContain('« Vétéran » sans numéro : placé en V1 (à corriger si besoin).');
  });

  test('règlement illisible : remarque, ligne gardée', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Kumite', '', '', '', '', '']]), grid, TOL);
    expect(r.items[0]!.line.ruleset).toBeNull();
    expect(r.items[0]!.notes).toContain('Règlement incompréhensible : « Kumite » (Jiyu ou Shobu).');
  });

  test('lignes sans nom : jamais fusionnées', () => {
    const r = readClubFormLines(
      sheet([
        [null, null, 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        [null, null, 'F', 'Cadets', '48', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
      ]),
      grid,
      TOL,
    );
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.rows)).toEqual([[14], [15]]);
    expect(r.merged).toEqual([]);
  });

  test('fusion', () => {
    const r = readClubFormLines(
      sheet([
        ['MARTIN', 'Léa', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        ['DURAND', 'Hugo', 'M', 'Seniors', '70', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        ['MARTIN', 'Léa', 'F', 'Cadets', '', '', 'Oui', '2e kyu', '', '', '', '', '', ''],
      ]),
      grid,
      TOL,
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ order: 0, rows: [14, 16], line: { combats: ['karate'], kata: true, grade: '2e kyu', weightKg: 52 } });
    expect(r.items[1]!.order).toBe(1);
    expect(r.merged).toEqual([{ label: 'MARTIN Léa', rows: [14, 16] }]);
  });

  test('fusion : une ligne au sexe illisible rejoint la seule ligne du même nom', () => {
    const r = readClubFormLines(
      sheet([
        ['MARTIN', 'Léa', 'Fille ?', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        ['DURAND', 'Hugo', 'M', 'Seniors', '70', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        ['MARTIN', 'Léa', 'F', 'Cadets', '', '', 'Oui', '2e kyu', '', '', '', '', '', ''],
      ]),
      grid,
      TOL,
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ order: 0, rows: [14, 16], line: { sex: 'F', combats: ['karate'], kata: true, grade: '2e kyu', weightKg: 52 } });
    expect(r.items[0]!.notes).toContain('Sexe incompréhensible : « Fille ? ».');
    expect(r.items[1]).toMatchObject({ order: 1, rows: [15] });
    expect(r.merged).toEqual([{ label: 'MARTIN Léa', rows: [14, 16] }]);
  });

  test('fusion : sexe illisible et deux lignes du même nom de sexes différents : gardée à part', () => {
    const r = readClubFormLines(
      sheet([
        ['MARTIN', 'Camille', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        ['MARTIN', 'Camille', 'M', 'Cadets', '60', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', ''],
        ['MARTIN', 'Camille', '?', 'Cadets', '', '', 'Oui', '', '', '', '', '', '', ''],
      ]),
      grid,
      TOL,
    );
    expect(r.items.map((i) => i.rows)).toEqual([[14], [15], [16]]);
  });

  test('pré-accord vide ou Oui', () => {
    expect(readClubFormLines(sheet([], null), grid, TOL).header.preApproval).toBeNull();
    expect(readClubFormLines(sheet([], 'Oui'), grid, TOL).header.preApproval).toBe(true);
  });

  test('ancien format refusé', () => {
    const cells = sheet([], 'non', CLUB_FORM_LEGACY_COLUMNS);
    expect(() => readClubFormLines(cells, grid, TOL)).toThrow(NotAClubFormError);
    expect(() => readClubFormLines(cells, grid, TOL)).toThrow(LEGACY_FORM_REFUSED);
  });
});

describe('colonne licence', () => {
  const columns = [CLUB_FORM_COLUMNS[0], CLUB_FORM_COLUMNS[1], CLUB_FORM_LICENCE_COLUMN, ...CLUB_FORM_COLUMNS.slice(2)];
  test('fiche renvoyée : la licence entre dans la ligne lue', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', '1146 2640 r', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '']], 'non', columns), grid, TOL);
    expect(r.items[0]!.line).toMatchObject({ licence: '11462640R', lastName: 'MARTIN', sex: 'F', combats: ['karate'], weightKg: 52 });
  });
  test('texte trop long dans la case licence : ligne lue, licence ignorée, remarque', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', 'Licence en cours de renouvellement', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '']], 'non', columns), grid, TOL);
    expect(r.items[0]!.line).toMatchObject({ licence: null, lastName: 'MARTIN', combats: ['karate'] });
    expect(r.items[0]!.notes).toContain('N° de licence ignoré (trop long) : « Licence en cours de renouvellement ».');
  });
  test('licence de 20 caractères (espaces retirés) : gardée', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', '1234 5678 9012 3456 7890', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '']], 'non', columns), grid, TOL);
    expect(r.items[0]!.line.licence).toBe('12345678901234567890');
    expect(r.items[0]!.notes).toEqual([]);
  });
  test('fiche sans la colonne : licence nulle', () => {
    const r = readClubFormLines(sheet([['MARTIN', 'Léa', 'F', 'Cadets', '52', 'Karaté', 'Non', '', 'Jiyu', '', '', '', '', '']]), grid, TOL);
    expect(r.items[0]!.line.licence).toBeNull();
  });
});
