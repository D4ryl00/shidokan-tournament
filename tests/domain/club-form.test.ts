import { describe, expect, test } from 'vitest';
import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_LEGACY_COLUMNS,
  ageBandAbbreviation,
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
  cells[10] = [...CLUB_FORM_LEGACY_COLUMNS];
  lines.forEach((l, i) => (cells[CLUB_FORM_FIRST_ROW - 1 + i] = l));
  return cells;
}
/** Même fiche, au nouveau format (une ligne par combattant). */
function sheetNew(lines: Line[]): unknown[][] {
  const cells = sheet(HEADER_NEW, []);
  cells[10] = [...CLUB_FORM_COLUMNS];
  lines.forEach((l, i) => (cells[CLUB_FORM_FIRST_ROW - 1 + i] = l));
  return cells;
}
const HEADER_NEW = ['Tani Dojo', 'Jean Coach', null, null, 'non'];
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

describe('nouveau format (une ligne par combattant)', () => {
  const tol = { M: 0.3, F: 0.5 };
  //                 Nom       Prénom  Sexe       Âge       Poids   Combat    Kata   Grade      Règl.   Rk  Rb   Rm   Priorité shobu
  const line = (over: Partial<Record<number, string | number | null>> = {}): Line => {
    const l: Line = ['MARTIN', 'Léa', 'Féminin', 'Cadets', '53,5', 'Karaté', 'Oui', '1er kyu', 'Jiyu', '', '2', '1', ''];
    for (const [k, v] of Object.entries(over)) l[Number(k)] = v ?? null;
    return l;
  };

  test('kata et karaté sur une ligne → deux inscriptions', () => {
    const r = parseClubForm(sheetNew([line()]), grid, tol);
    expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
    expect(r.rows.map((x) => x.line)).toEqual([12, 12]);
    const [combat, kata] = r.rows.map((x) => x.input!);
    expect(combat).toMatchObject({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', approxWeightKg: 53.5, otherDisciplines: ['shido-mix', 'shido-boxing'], acceptsJiyuFirst: null });
    expect(kata).toMatchObject({ discipline: 'kata', ruleset: null, weightClassId: null, otherDisciplines: [], grade: '1er kyu' });
  });

  test('poids actuel → catégorie de poids, tolérance de pesée comprise', () => {
    expect(parseClubForm(sheetNew([line({ 4: '54,4', 6: 'Non' })]), grid, tol).rows[0]!.input!.weightClassId).toBe('cadet:F:-54');
    expect(parseClubForm(sheetNew([line({ 4: '54,6', 6: 'Non' })]), grid, tol).rows[0]!.input!.weightClassId).toBe('cadet:F:-61');
  });

  test('combat sans poids actuel → erreur', () => {
    const r = parseClubForm(sheetNew([line({ 4: '', 6: 'Non' })]), grid, tol);
    expect(r.rows[0]!.errors).toEqual(['Poids actuel manquant (nécessaire pour la catégorie de poids).']);
  });

  test('kata seul : pas de poids demandé', () => {
    const r = parseClubForm(sheetNew([line({ 4: '', 5: '', 8: '', 10: '', 11: '' })]), grid, tol);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.input).toMatchObject({ discipline: 'kata', grade: '1er kyu' });
  });

  test('priorité shobu', () => {
    const shobu = (keep: string) => parseClubForm(sheetNew([line({ 3: 'Seniors', 4: '60', 6: 'Non', 8: 'Shobu', 12: keep })]), grid, tol).rows[0]!;
    expect(shobu('Les règles shobu').input!.acceptsJiyuFirst).toBe(false);
    expect(shobu('La discipline').input!.acceptsJiyuFirst).toBe(true);
    const jiyu = parseClubForm(sheetNew([line({ 6: 'Non', 12: 'La discipline' })]), grid, tol).rows[0]!;
    expect(jiyu.input!.acceptsJiyuFirst).toBeNull();
    expect(jiyu.warnings.join(' ')).toMatch(/shobu/i);
  });

  test('relecture : case Kata — « Kata » accepté, valeur illisible signalée', () => {
    const kataWord = parseClubForm(sheetNew([line({ 6: 'Kata' })]), grid, tol).rows;
    expect(kataWord.map((r) => r.input?.discipline)).toEqual(['karate', 'kata']);
    const unreadable = parseClubForm(sheetNew([line({ 6: 'peut-être' })]), grid, tol).rows;
    expect(unreadable.map((r) => r.input?.discipline)).toEqual(['karate']);
    expect(unreadable[0]!.warnings.join(' ')).toContain('Kata');
    // « Kata » écrit dans la colonne de combat : c'est du kata
    const inCombat = parseClubForm(sheetNew([line({ 4: '', 5: 'Kata', 6: '', 8: '', 10: '', 11: '' })]), grid, tol).rows;
    expect(inCombat.map((r) => [r.input?.discipline, r.errors])).toEqual([['kata', []]]);
  });

  test('relecture : le grade ne va qu’à l’inscription kata', () => {
    const inputs = parseClubForm(sheetNew([line()]), grid, tol).rows.map((r) => r.input!);
    expect(inputs[0]!.grade).toBeUndefined();
    expect(inputs[1]!.grade).toBe('1er kyu');
  });

  test('préférence vers sa propre discipline ignorée avec remarque', () => {
    const r = parseClubForm(sheetNew([line({ 6: 'Non', 9: '1', 10: '', 11: '' })]), grid, tol).rows[0]!;
    expect(r.errors).toEqual([]);
    expect(r.input!.otherDisciplines).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });
});

test('ancien format toujours lu', () => {
  const r = parseClubForm(sheet(HEADER, [['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null]]), grid);
  expect(r.rows[0]!.input).toMatchObject({ weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-boxing'] });
});

test('abréviations des tranches d’âge', () => {
  expect(ageBandAbbreviation('pupille', 'Pupilles')).toBe('Pu');
  expect(ageBandAbbreviation('v3', 'Vétérans 3')).toBe('V3');
  expect(ageBandAbbreviation('ado', 'Adolescents')).toBe('Ad');
});
