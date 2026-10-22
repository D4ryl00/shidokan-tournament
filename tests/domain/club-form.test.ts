import { describe, expect, test } from 'vitest';
import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_FIRST_ROW,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_TITLE,
  NotAClubFormError,
  ageBandFromLabel,
  disciplineFromLabel,
  parseClubForm,
  rulesetFromLabel,
} from '../../src/domain/club-form.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();

type Line = (string | number | null)[];
function sheet(header: (string | null)[], lines: Line[]): unknown[][] {
  const cells: unknown[][] = [];
  cells[0] = [CLUB_FORM_TITLE];
  cells[1] = ["Coupe Shidokan – Côte d'Azur — 22/11/2026"];
  CLUB_FORM_HEADER_FIELDS.forEach((label, i) => (cells[3 + i] = [label, header[i] ?? null]));
  cells[10] = [...CLUB_FORM_COLUMNS];
  lines.forEach((l, i) => (cells[CLUB_FORM_FIRST_ROW - 1 + i] = l));
  return cells;
}
const HEADER = ['Tani Dojo', 'Jean Coach', '06 00 00 00 00', 'coach@example.org', 'oui'];

test('fiche correcte', () => {
  const r = parseClubForm(
    sheet(HEADER, [
      ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, 52.5],
      ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Karaté', 'Shobu', '', 'Oui', null],
    ]),
    grid,
  );
  expect(r.header).toEqual({
    club: 'Tani Dojo', coachName: 'Jean Coach', coachPhone: '06 00 00 00 00', coachEmail: 'coach@example.org', preApproval: true,
  });
  expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
  expect(r.rows[0]!.line).toBe(12);
  expect(r.rows[0]!.input).toMatchObject({
    lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-mix', 'shido-boxing'], approxWeightKg: 52.5, source: 'club_form',
  });
  expect(r.rows[1]!.input).toMatchObject({ ruleset: 'shobu', acceptsJiyuFirst: true, weightClassId: 'senior:M:-75' });
});

test('lignes vides au milieu ignorées, numéros de ligne conservés', () => {
  const r = parseClubForm(
    sheet(HEADER, [
      ['MARTIN', 'Léa', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null],
      [null, null, null, null, null, null, null, null, null, null],
      ['DURAND', 'Hugo', 'M', 'Seniors', '-75', 'Karaté', 'Jiyu', null, null, null],
    ]),
    grid,
  );
  expect(r.rows.map((x) => x.line)).toEqual([12, 14]);
});

test('variantes de saisie', () => {
  const r = parseClubForm(
    sheet(HEADER, [
      ['A', 'a', 'Fille', 'cadette', '-54kg', 'Boxe', 'ji yu', '3,1', null, '54,5'],
      ['B', 'b', 'Garçon', 'Vétéran', '-75', 'Mix', 'Shobu', null, 'x', null],
    ]),
    grid,
  );
  expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
  expect(r.rows[0]!.input).toMatchObject({
    sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-54', discipline: 'shido-boxing', ruleset: 'jiyu',
    otherDisciplines: ['shido-mix', 'karate'], approxWeightKg: 54.5,
  });
  expect(r.rows[1]!.input).toMatchObject({ ageBandCode: 'v1', discipline: 'shido-mix', acceptsJiyuFirst: true });
});

test('erreurs par ligne sans bloquer les autres', () => {
  const r = parseClubForm(
    sheet(HEADER, [
      ['MINIME', 'Shobu', 'M', 'Minimes', '-45', 'Karaté', 'Shobu', null, null, null],
      ['POIDS', 'Faux', 'F', 'Cadets', '-99', 'Karaté', 'Jiyu', null, null, null],
      ['OK', 'Ok', 'F', 'Cadets', '-47', 'Karaté', 'Jiyu', null, null, null],
    ]),
    grid,
  );
  expect(r.rows[0]!.input).toBeNull();
  expect(r.rows[0]!.errors.join(' ')).toContain('réservé aux adultes');
  expect(r.rows[1]!.input).toBeNull();
  expect(r.rows[1]!.errors.join(' ')).toContain('-99');
  expect(r.rows[2]!.errors).toEqual([]);
});

test('kata : règlement et poids vides', () => {
  const r = parseClubForm(sheet(HEADER, [['K', 'k', 'F', 'Benjamins', null, 'Kata', null, null, null, null]]), grid);
  expect(r.rows[0]!.errors).toEqual([]);
  expect(r.rows[0]!.input).toMatchObject({ discipline: 'kata', ruleset: null, weightClassId: null });
});

test('préférences douteuses : avertissement, la ligne reste valide', () => {
  const r = parseClubForm(sheet(HEADER, [['A', 'a', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', '14', null, null]]), grid);
  expect(r.rows[0]!.errors).toEqual([]);
  expect(r.rows[0]!.warnings.length).toBe(2);
  expect(r.rows[0]!.input!.otherDisciplines).toEqual([]);
});

describe('pas une fiche club', () => {
  test('export FFK', () => {
    const ffk = [['Nom', 'Prenom', 'Numero', 'Entite rattachement', 'Genre', 'Type', 'Age', 'Categorie', 'Discipline']];
    expect(() => parseClubForm(ffk, grid)).toThrow(NotAClubFormError);
  });
  test('vide', () => expect(() => parseClubForm([], grid)).toThrow(NotAClubFormError));
  test('club manquant', () => {
    expect(() => parseClubForm(sheet([null], []), grid)).toThrow('Le nom du club est obligatoire');
  });
});

test.each([
  ['Karaté', 'karate'], [1, 'karate'], ['Shido-boxing', 'shido-boxing'], ['BOXE', 'shido-boxing'], ['Kmix', 'shido-mix'],
  ['Shido-mix-martial', 'shido-mix'], ['Mix Martial', 'shido-mix'], ['Triathlon', 'triathlon'], ['kata', 'kata'], ['judo', null],
])('disciplineFromLabel(%s)', (v, r) => expect(disciplineFromLabel(v)).toBe(r));

test.each([['Jiyu', 'jiyu'], ['Ji Yu', 'jiyu'], ['Jiyu ippon kumite', 'jiyu'], ['SHOBU', 'shobu'], ['x', null]])(
  'rulesetFromLabel(%s)', (v, r) => expect(rulesetFromLabel(v)).toBe(r),
);

test.each([
  ['Poussin', 'poussin'], ['MINI-POUSSINS', 'mini-poussin'], ['cadette', 'cadet'], ['Benjamine', 'benjamin'], ['JUNIOR', 'junior'],
  ['Seniors', 'senior'], ['Vétéran', 'v1'], ['Vétérans 3', 'v3'], ['V2', 'v2'], ['Espoirs', 'espoir'], ['adulte', null],
])('ageBandFromLabel(%s)', (v, r) => expect(ageBandFromLabel(v, grid)).toBe(r));

describe('poids saisi sans signe (le tableur transforme « +84 » en 84)', () => {
  const one = (weight: string | number) =>
    parseClubForm(sheet(HEADER, [['A', 'a', 'M', 'Seniors', weight, 'Karaté', 'Jiyu', null, null, null]]), grid).rows[0]!;
  test('84 : -84 et +84 existent → ambigu, ligne en erreur', () => {
    const r = one(84);
    expect(r.input).toBeNull();
    expect(r.errors.join(' ')).toContain('ambigu');
  });
  test('75 : seule -75 existe → -75 avec remarque', () => {
    const r = one(75);
    expect(r.input!.weightClassId).toBe('senior:M:-75');
    expect(r.warnings.join(' ')).toContain('-75');
  });
  test('texte « 75 » sans signe → même règle', () => {
    expect(one('75').input!.weightClassId).toBe('senior:M:-75');
  });
  test('« +84 » en texte → catégorie ouverte', () => {
    expect(one('+84').input!.weightClassId).toBe('senior:M:+84');
  });
});

describe('corrections reportées', () => {
  test('ligne en double : la seconde est en erreur', () => {
    const r = parseClubForm(sheet(HEADER, [
      ['MARTIN', 'Léa', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null],
      ['Martin', 'Lea', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null],
    ]), grid);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[1]!.input).toBeNull();
    expect(r.rows[1]!.errors.join(' ')).toContain('ligne 12');
  });
  test('deux disciplines de combat pour le même combattant : remarque', () => {
    const r = parseClubForm(sheet(HEADER, [
      ['MARTIN', 'Léa', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null],
      ['MARTIN', 'Léa', 'F', 'Cadets', '-54', 'Boxe', 'Jiyu', null, null, null],
      ['MARTIN', 'Léa', 'F', 'Cadets', null, 'Kata', null, null, null, null],
    ]), grid);
    expect(r.rows[1]!.input).not.toBeNull();
    expect(r.rows[1]!.warnings.join(' ')).toContain('deux disciplines de combat');
    expect(r.rows[2]!.warnings).toEqual([]);
  });
  test('« Vétéran » seul : remarque', () => {
    const r = parseClubForm(sheet(HEADER, [['A', 'a', 'M', 'Vétéran', '-75', 'Karaté', 'Jiyu', null, null, null]]), grid);
    expect(r.rows[0]!.warnings.join(' ')).toContain('V1');
  });
  test('nom affiché même pour une ligne en erreur', () => {
    const r = parseClubForm(sheet(HEADER, [['PETIT', 'Noé', 'M', 'Minimes', '-45', 'Karaté', 'Shobu', null, null, null]]), grid);
    expect(r.rows[0]!.label).toBe('PETIT Noé');
  });
  test('lignes insérées au-dessus du tableau : en-tête retrouvé', () => {
    const cells = sheet(HEADER, [['MARTIN', 'Léa', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null]]);
    cells.splice(2, 0, ['Ligne ajoutée par le coach'], []);
    const r = parseClubForm(cells, grid);
    expect(r.header.club).toBe('Tani Dojo');
    expect(r.rows.map((x) => x.line)).toEqual([14]);
  });
  test('fichier sans en-tête : message explicite', () => {
    expect(() => parseClubForm([[CLUB_FORM_TITLE], ['x']], grid)).toThrow(/Nom, Prénom/);
  });
});
