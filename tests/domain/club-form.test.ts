import { describe, expect, test } from 'vitest';
import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_SECOND_COMBAT_COLUMN,
  CLUB_FORM_LEGACY_COLUMNS,
  ageBandAbbreviation,
  ageBandAbbreviations,
  CLUB_FORM_FIRST_ROW,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_TITLE,
  NotAClubFormError,
  ageBandFromLabel,
  disciplineFromLabel,
  parseClubForm,
  rulesetFromLabel,
  choosePref,
  lineToRows,
  ONE_COMBAT_ONLY,
  orderedPrefs,
  tidyReclass,
  weightWarning,
  type ClubFormLine,
} from '../../src/domain/club-form.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const CLUB_FORM_COLUMNS_ROW_INDEX = 10;

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
    club: 'Tani Dojo', coachName: 'Jean Coach', coachPhone: '06 00 00 00 00', coachEmails: ['coach@example.org'], preApproval: true,
  });
  expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
  expect(r.rows[0]!.line).toBe(14);
  expect(r.rows[0]!.input).toMatchObject({
    lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-mix', 'shido-boxing'], approxWeightKg: 52.5, source: 'club_form',
  });
  expect(r.rows[1]!.input).toMatchObject({ ruleset: 'shobu', acceptsJiyuFirst: true, weightClassId: 'senior:M:-75' });
});

test('case E-mail : plusieurs adresses séparées par virgule, point-virgule ou espace ; doublons retirés ; vide → aucune', () => {
  const header = (email: string | null) => parseClubForm(sheet(['Tani Dojo', 'Jean', null, email, 'non'], []), grid).header.coachEmails;
  expect(header('coach@tani.fr; pres@tani.fr, COACH@tani.fr secr@tani.fr')).toEqual(['coach@tani.fr', 'pres@tani.fr', 'secr@tani.fr']);
  expect(header(null)).toEqual([]);
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
  expect(r.rows.map((x) => x.line)).toEqual([14, 16]);
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
  const r = parseClubForm(sheet(HEADER, [['A', 'a', 'F', 'Cadets', '-54', 'Karaté', 'Jiyu', '15', null, null]]), grid);
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
    expect(r.rows[1]!.errors.join(' ')).toContain('ligne 14');
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
    expect(r.rows.map((x) => x.line)).toEqual([16]);
  });
  test('fichier sans en-tête : message explicite', () => {
    expect(() => parseClubForm([[CLUB_FORM_TITLE], ['x']], grid)).toThrow(/Nom, Prénom/);
  });
});

describe('nouveau format (une ligne par combattant)', () => {
  const tol = { M: 0.3, F: 0.5 };
  //                 Nom       Prénom  Sexe       Âge       Poids   Combat    Kata   Grade      Règl.   Rk  Rb   Rm   Rt  Priorité shobu
  const line = (over: Partial<Record<number, string | number | null>> = {}): Line => {
    const l: Line = ['MARTIN', 'Léa', 'Féminin', 'Cadets', '53,5', 'Karaté', 'Oui', '1er kyu', 'Jiyu', '', '2', '1', '', ''];
    for (const [k, v] of Object.entries(over)) l[Number(k)] = v ?? null;
    return l;
  };

  test('kata et karaté sur une ligne → deux inscriptions', () => {
    const r = parseClubForm(sheetNew([line()]), grid, tol);
    expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
    expect(r.rows.map((x) => x.line)).toEqual([14, 14]);
    const [combat, kata] = r.rows.map((x) => x.input!);
    expect(combat).toMatchObject({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', approxWeightKg: 53.5, otherDisciplines: ['shido-mix', 'shido-boxing'], acceptsJiyuFirst: null });
    expect(kata).toMatchObject({ discipline: 'kata', ruleset: null, weightClassId: null, otherDisciplines: [], grade: '1er kyu' });
  });

  describe('2e discipline de combat (colonne en fin de ligne)', () => {
    const withSecond = (over: Partial<Record<number, string | number | null>>, second: string | null): unknown[][] => {
      const cells = sheetNew([line(over)]);
      cells[CLUB_FORM_COLUMNS_ROW_INDEX]![14] = CLUB_FORM_SECOND_COMBAT_COLUMN;
      cells[CLUB_FORM_FIRST_ROW - 1]![14] = second;
      return cells;
    };
    test('reading a form with a second combat', () => {
      const r = parseClubForm(withSecond({ 3: 'Seniors', 8: 'Shobu' }, 'Boxing'), grid, tol, new Set(), { multipleCombats: true });
      expect(r.rows.map((x) => x.errors)).toEqual([[], [], []]);
      expect(r.rows.map((x) => x.input!.discipline)).toEqual(['karate', 'shido-boxing', 'kata']);
      expect(r.rows.slice(0, 2).map((x) => x.input!.ruleset)).toEqual(['shobu', 'shobu']);
    });
    test('second combat equal to the first is ignored with a warning', () => {
      const r = parseClubForm(withSecond({}, 'Karaté'), grid, tol, new Set(), { multipleCombats: true });
      expect(r.rows.map((x) => x.input!.discipline)).toEqual(['karate', 'kata']);
      expect(r.rows[0]!.warnings).toContain('2e discipline de combat identique à la première (ignorée).');
    });
    test('réglage désactivé : la colonne est lue, la règle d’enregistrement refuse', () => {
      const r = parseClubForm(withSecond({}, 'Boxing'), grid, tol);
      expect(r.rows[0]!.errors).toContain(ONE_COMBAT_ONLY);
    });
    test('second combat illisible : avertissement', () => {
      const r = parseClubForm(withSecond({}, 'Zumba'), grid, tol, new Set(), { multipleCombats: true });
      expect(r.rows[0]!.warnings.join(' ')).toContain('2e discipline de combat incompréhensible');
    });
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
    const shobu = (keep: string) => parseClubForm(sheetNew([line({ 3: 'Seniors', 4: '60', 6: 'Non', 8: 'Shobu', 13: keep })]), grid, tol).rows[0]!;
    expect(shobu('Autre discipline').input!.acceptsJiyuFirst).toBe(false);
    expect(shobu('Passer en jiyu').input!.acceptsJiyuFirst).toBe(true);
    // Écrit à la main : « changer de discipline » ne doit pas être lu comme « la discipline ».
    expect(shobu('changer de discipline').input!.acceptsJiyuFirst).toBe(false);
    const jiyu = parseClubForm(sheetNew([line({ 6: 'Non', 13: 'Passer en jiyu' })]), grid, tol).rows[0]!;
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

test('colonne Triathlon : numérotée comme les autres, jusqu’à 3 choix', () => {
  const row: Line = ['MARTIN', 'Léa', 'Féminin', 'Cadets', '53,5', 'Karaté', 'Non', null, 'Jiyu', null, '2', '3', '1', null];
  const r = parseClubForm(sheetNew([row]), grid, { M: 0, F: 0 }).rows[0]!;
  expect(r.warnings).toEqual([]);
  expect(r.input!.otherDisciplines).toEqual(['triathlon', 'shido-boxing', 'shido-mix']);
});

test('inscrit en triathlon : ses autres disciplines sont gardées', () => {
  const row: Line = ['MARTIN', 'Léa', 'Féminin', 'Cadets', '53,5', 'Triathlon', 'Non', null, 'Jiyu', '1', null, '2', null, null];
  const r = parseClubForm(sheetNew([row]), grid, { M: 0, F: 0 }).rows[0]!;
  expect(r.warnings).toEqual([]);
  expect(r.input!.otherDisciplines).toEqual(['karate', 'shido-mix']);
});

test('fiche déjà envoyée (sans colonne Triathlon) : toujours lue, avec ses anciens libellés', () => {
  const cells = sheet(HEADER_NEW, []);
  cells[10] = ['Nom', 'Prénom', 'Sexe', "Catégorie d'âge", 'Poids actuel (kg)', 'Discipline de combat', 'Kata (Oui/Non)', 'Grade (si kata)', 'Règlement', 'Karaté', 'Boxing', 'Mix', 'Shobu : si reclassement, garder en priorité'];
  const row = (keep: string): Line => ['DURAND', 'Hugo', 'Masculin', 'Seniors', '74', 'Karaté', 'Non', null, 'Shobu', null, '1', '2', keep];
  const read = (keep: string) => {
    cells[CLUB_FORM_FIRST_ROW - 1] = row(keep);
    return parseClubForm(cells, grid, { M: 0, F: 0 }).rows[0]!;
  };
  expect(read('Les règles shobu').input).toMatchObject({ otherDisciplines: ['shido-boxing', 'shido-mix'], acceptsJiyuFirst: false });
  expect(read('La discipline').input).toMatchObject({ acceptsJiyuFirst: true });
  expect(read('La discipline').warnings).toEqual([]);
});

test('choix de reclassement : ordre, choix, retrait', () => {
  expect(orderedPrefs({ 'shido-mix': 2, karate: 1, triathlon: 3 })).toEqual(['karate', 'shido-mix', 'triathlon']);
  // 1er, puis 2e, puis 3e choix
  expect(choosePref({}, 1, 'karate')).toEqual({ karate: 1 });
  expect(choosePref({ karate: 1 }, 2, 'triathlon')).toEqual({ karate: 1, triathlon: 2 });
  // Reprendre une discipline déjà choisie plus loin : les deux échangent leur rang.
  expect(choosePref({ karate: 1, triathlon: 2 }, 1, 'triathlon')).toEqual({ triathlon: 1, karate: 2 });
  // Retirer un choix retire aussi les suivants : il n'y a jamais de 2e sans 1er.
  expect(choosePref({ karate: 1, triathlon: 2, 'shido-mix': 3 }, 2, null)).toEqual({ karate: 1 });
  expect(choosePref({ karate: 1, triathlon: 2 }, 1, null)).toEqual({});
});

test('reclassement rangé : sa propre discipline retirée, rangs recalculés, priorité shobu seulement si elle sert', () => {
  const line = { combats: ['karate' as const], ruleset: 'shobu' as const, shobuKeep: 'discipline' as const };
  expect(tidyReclass({ ...line, prefs: { karate: 1, 'shido-mix': 2 } })).toEqual({ ...line, prefs: { 'shido-mix': 1 } });
  expect(tidyReclass({ ...line, prefs: { karate: 1 } })).toEqual({ ...line, prefs: {}, shobuKeep: null });
  expect(tidyReclass({ ...line, ruleset: 'jiyu', prefs: { 'shido-mix': 1 } })).toEqual({ ...line, ruleset: 'jiyu', prefs: { 'shido-mix': 1 }, shobuKeep: null });
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

describe('relecture (mineurs) : messages du nouveau format', () => {
  const base: Line = ['MARTIN', 'Léa', 'Féminin', 'Cadets', '53,5', 'Karaté', 'Non', null, 'Jiyu', null, null, null, null];
  const with_ = (i: number, v: string) => base.map((x, j) => (j === i ? v : x));
  test('sexe ou âge illisibles : « incompréhensible », pas « manquant »', () => {
    expect(parseClubForm(sheetNew([with_(2, 'Inconnu')]), grid).rows[0]!.errors).toEqual(['Sexe incompréhensible : « Inconnu ».']);
    expect(parseClubForm(sheetNew([with_(3, 'Sénior 2')]), grid).rows[0]!.errors).toEqual(["Catégorie d'âge incompréhensible : « Sénior 2 »."]);
  });
  test('« 70 kg » : lu comme 70, sans remarque', () => {
    const r = parseClubForm(sheetNew([with_(4, '53,5 kg')]), grid, { M: 0, F: 0.5 }).rows[0]!;
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.input!.approxWeightKg).toBe(53.5);
  });
  test('poids illisible : un seul message', () => {
    expect(parseClubForm(sheetNew([with_(4, 'lourd')]), grid).rows[0]!.errors).toEqual(['Poids actuel incompréhensible : « lourd ».']);
  });
});

test('relecture (mineurs) : abréviations sans doublon dans une grille', () => {
  const m = ageBandAbbreviations([{ code: 'minime', label: 'Minimes' }, { code: 'mini2', label: 'Minimes 2' }, { code: 'cadet', label: 'Cadets' }]);
  expect(m.get('minime')).toBe('Mi');
  expect(m.get('cadet')).toBe('C');
  expect(new Set(m.values()).size).toBe(3);
});

test("ligne dans une catégorie fermée : avertissement, pas d'erreur", () => {
  const line = { lastName: 'PETIT', firstName: 'Zoé', sex: 'F' as const, ageBandCode: 'cadet', weightClassId: null, weightKg: 50, combats: ['shido-mix' as const], kata: false, grade: null, ruleset: 'jiyu' as const, prefs: {}, shobuKeep: null };
  const [row] = lineToRows(line, 1, grid, { M: 0, F: 0 }, new Set(['cadet|F|shido-mix|jiyu']));
  expect(row!.errors).toEqual([]);
  expect(row!.input).not.toBeNull();
  expect(row!.warnings).toContain('Catégorie non ouverte à cette compétition (Shido-mix-martial jiyu) : la ligne ira en Réaffectation.');
});

test('catégorie de poids choisie (en ligne) : elle fait foi, avec ou sans poids ; une catégorie d’une autre tranche est refusée', () => {
  const line: ClubFormLine = {
    lastName: 'PETIT', firstName: 'Zoé', sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-61', weightKg: 50, combats: ['karate'], kata: false, grade: null,
    ruleset: 'jiyu', prefs: {}, shobuKeep: null,
  };
  expect(lineToRows(line, 1, grid, { M: 0, F: 0 })[0]!.input?.weightClassId).toBe('cadet:F:-61');
  expect(lineToRows({ ...line, weightKg: null }, 1, grid, { M: 0, F: 0 })[0]).toMatchObject({ errors: [], input: { weightClassId: 'cadet:F:-61', approxWeightKg: null } });
  expect(lineToRows({ ...line, weightClassId: 'senior:F:-61' }, 1, grid, { M: 0, F: 0 })[0]!.errors).toEqual([
    'La catégorie de poids « -61 » ne correspond pas à l\'âge et au sexe du combattant.',
  ]);
});

test('avertissement de poids : en dehors de la catégorie choisie (au-dessus ou au-dessous), rien sinon ni sans poids', () => {
  const classes = grid.weightClasses.filter((w) => w.ageBandCode === 'cadet').sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity));
  const line = { ageBandCode: 'cadet', sex: 'F' as const, weightClassId: 'cadet:F:+61', weightKg: 52.5, combats: ['karate' as const] };
  expect(weightWarning(line, classes)).toBe('Le poids actuel (52,5 kg) est en dehors de la catégorie +61 kg : il correspond à -54 kg.');
  expect(weightWarning({ ...line, weightClassId: 'cadet:F:-47' }, classes)).toBe('Le poids actuel (52,5 kg) est en dehors de la catégorie -47 kg : il correspond à -54 kg.');
  expect(weightWarning({ ...line, weightClassId: 'cadet:F:-54' }, classes)).toBeNull();
  expect(weightWarning({ ...line, weightClassId: 'cadet:F:-54', weightKg: 54 }, classes)).toBeNull();
  expect(weightWarning({ ...line, weightKg: null }, classes)).toBeNull();
  expect(weightWarning({ ...line, combats: [] }, classes)).toBeNull();
});

describe('plusieurs combats', () => {
  const tol = { M: 0, F: 0 };
  const base: ClubFormLine = { lastName: 'PETIT', firstName: 'Zoé', sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-54', weightKg: 50, combats: [], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null };
  const two: ClubFormLine = { ...base, combats: ['karate', 'shido-boxing'], ruleset: 'jiyu', kata: true, prefs: { 'shido-mix': 1, karate: 2 }, shobuKeep: null };
  test('deux combats et le kata donnent trois inscriptions, dans l’ordre', () => {
    const rows = lineToRows(two, 1, grid, tol, new Set(), { multipleCombats: true });
    expect(rows.map((r) => [r.input?.discipline, r.input?.ruleset])).toEqual([['karate', 'jiyu'], ['shido-boxing', 'jiyu'], ['kata', null]]);
    // Reclassement commun, sans ses propres combats.
    expect(rows[0]!.input!.otherDisciplines).toEqual(['shido-mix']);
    expect(rows[1]!.input!.otherDisciplines).toEqual(['shido-mix']);
  });
  test('shobu : la priorité vaut pour chacun des combats', () => {
    const rows = lineToRows({ ...two, ageBandCode: 'senior', weightClassId: 'senior:F:-55', ruleset: 'shobu', shobuKeep: 'discipline' }, 1, grid, tol, new Set(), { multipleCombats: true });
    expect(rows.slice(0, 2).map((r) => r.input?.acceptsJiyuFirst)).toEqual([true, true]);
  });
  test('réglage désactivé : deux combats refusés', () => {
    const rows = lineToRows(two, 1, grid, tol);
    expect(rows[0]!.input).toBeNull();
    expect(rows[0]!.errors).toContain(ONE_COMBAT_ONLY);
  });
  test('règlement manquant : chaque combat est en erreur', () => {
    const rows = lineToRows({ ...two, ruleset: null }, 1, grid, tol, new Set(), { multipleCombats: true });
    expect(rows[0]!.errors).toContain('Règlement manquant (Jiyu ou Shobu).');
    expect(rows[1]!.errors).toContain('Règlement manquant (Jiyu ou Shobu).');
  });
  test('tidyReclass retire tous ses combats des choix', () => {
    expect(tidyReclass(two).prefs).toEqual({ 'shido-mix': 1 });
  });
});
