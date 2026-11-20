import { describe, expect, test } from 'vitest';
import { freeKey, keyString, naturalKey, type CategoryKey } from '../../src/domain/categories.js';
import { buildFfkExport, ffkAgeLabel, FFK_SHEETS, type FfkExportRegistration, type FfkSheet } from '../../src/domain/ffk-export.js';
import { findHeaderRow, guessColumnMapping, parseFfkRows } from '../../src/domain/ffk-import.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { DisciplineId, Ruleset, Sex } from '../../src/domain/types.js';

const grid = ffkDefaultGrid();
const HEADER = ['Prénom', 'Nom', 'Numero', 'Entite rattachement', 'Genre', 'Type', 'Age', 'Categorie', 'Technique'];
const KARATE_WIDTHS = { A: 25.71, B: 19.71, D: 58.29, G: 33.71, H: 11.43 };
const CLUB = '0060690 ETOILE SPORTIVE VILLENEUVE LOUBET KARATE';

type RegInput = {
  first?: string; last: string; sex?: Sex; band?: string;
  discipline?: DisciplineId; ruleset?: Ruleset | null; weight?: string | null;
  licence?: string | null; out?: boolean;
};

/** Inscription restée dans sa catégorie d'inscription (final = sa clé naturelle). */
function reg(i: RegInput): FfkExportRegistration {
  const sex = i.sex ?? 'F';
  const ageBandCode = i.band ?? 'cadet';
  const discipline = i.discipline ?? 'karate';
  const registered = {
    discipline,
    ruleset: i.ruleset === undefined ? (discipline === 'karate' ? 'jiyu' : null) : i.ruleset,
    weightClassId: i.weight === undefined ? `${ageBandCode}:${sex}:-54` : i.weight,
  } as FfkExportRegistration['registered'];
  const key = naturalKey(registered, { sex, ageBandCode });
  return {
    firstName: i.first ?? 'Lina', lastName: i.last, licence: i.licence === undefined ? `L-${i.last}` : i.licence, entity: CLUB,
    sex, ageBandCode, registered, final: { id: keyString(key), key }, out: i.out ?? false,
  };
}
const moved = (r: FfkExportRegistration, key: CategoryKey, id = keyString(key)): FfkExportRegistration => ({ ...r, final: { id, key } });
const key = (k: Partial<CategoryKey> & Pick<CategoryKey, 'sex' | 'ageBandCodes' | 'weightClassIds'>): CategoryKey => ({
  discipline: 'karate', ruleset: 'jiyu', ...k,
});

const sheet = (sheets: FfkSheet[], name: string) => sheets.find((s) => s.name === name)!;
const data = (s: FfkSheet) => s.rows.slice(1).filter((r) => r.length > 0);

test('cinq feuilles dans l’ordre du modèle, en-têtes et largeurs', () => {
  const sheets = buildFfkExport([], grid);
  expect(sheets.map((s) => s.name)).toEqual(['Karate', 'Boxe', 'Mix Martial', 'Triathlon', 'Kata']);
  expect(FFK_SHEETS.map((s) => [s.name, s.discipline, s.type])).toEqual([
    ['Karate', 'karate', 'Karate'], ['Boxe', 'shido-boxing', 'Boxe'], ['Mix Martial', 'shido-mix', 'Kmix'],
    ['Triathlon', 'triathlon', 'Triathlon'], ['Kata', 'kata', 'Kata'],
  ]);
  expect(sheet(sheets, 'Karate')).toEqual({ name: 'Karate', widths: KARATE_WIDTHS, rows: [HEADER] });
  expect(sheet(sheets, 'Boxe')).toEqual({
    name: 'Boxe', widths: { B: 20.43, C: 10.86, D: 58.29, E: 11.29, F: 16.43, G: 33.71, H: 9.57, I: 10.29 }, rows: [HEADER],
  });
  expect(sheet(sheets, 'Mix Martial')).toEqual({
    name: 'Mix Martial', widths: { A: 11.86, B: 21.86, C: 10.71, D: 34.57, E: 8.86, F: 10, G: 33.71, H: 9.57, I: 10.29 }, rows: [HEADER],
  });
  expect(sheet(sheets, 'Kata')).toEqual({ name: 'Kata', widths: { A: 15.57, B: 16.86, D: 44.14, G: 17.14 }, rows: [HEADER] });
});

test('ffkAgeLabel : Poussin, Mini-poussin, Espoir, Vétéran 2, Séniors jiyu ippon kumite, Séniors shobu ippon kumité', () => {
  expect(ffkAgeLabel(grid, 'poussin', null)).toBe('Poussin');
  expect(ffkAgeLabel(grid, 'mini-poussin', null)).toBe('Mini-poussin');
  expect(ffkAgeLabel(grid, 'espoir', 'jiyu')).toBe('Espoir');
  expect(ffkAgeLabel(grid, 'cadet', 'jiyu')).toBe('Cadet');
  expect(ffkAgeLabel(grid, 'v2', 'jiyu')).toBe('Vétéran 2');
  expect(ffkAgeLabel(grid, 'v5', null)).toBe('Vétéran 5');
  expect(ffkAgeLabel(grid, 'senior', 'jiyu')).toBe('Séniors jiyu ippon kumite');
  expect(ffkAgeLabel(grid, 'senior', null)).toBe('Séniors jiyu ippon kumite');
  expect(ffkAgeLabel(grid, 'senior', 'shobu')).toBe('Séniors shobu ippon kumité');
});

test('combattant non déplacé : sa ligne, Categorie -54 en nombre, +61 en texte', () => {
  const sheets = buildFfkExport([
    reg({ first: 'Lina', last: 'Moreau', licence: '11462640R' }),
    reg({ first: 'Inès', last: 'Durand', weight: 'cadet:F:+61', licence: null }),
  ], grid);
  expect(data(sheet(sheets, 'Karate'))).toEqual([
    ['LINA', 'MOREAU', '11462640R', CLUB, 'Féminin', 'Karate', 'Cadet', -54, null],
    ['INÈS', 'DURAND', null, CLUB, 'Féminin', 'Karate', 'Cadet', '+61', null],
  ]);
});

test('déplacé vers une vraie catégorie voisine (cadette -54 → -61) : Categorie -61', () => {
  const r = moved(reg({ last: 'Moreau' }), key({ sex: 'F', ageBandCodes: ['cadet'], weightClassIds: ['cadet:F:-61'] }));
  expect(data(sheet(buildFfkExport([r], grid), 'Karate'))).toEqual([
    ['LINA', 'MOREAU', 'L-Moreau', CLUB, 'Féminin', 'Karate', 'Cadet', -61, null],
  ]);
});

test('catégorie fusionnée cadettes -61 + juniors : chacun garde sa tranche et son poids d’inscription, un seul bloc', () => {
  const merged = key({ sex: 'F', ageBandCodes: ['cadet', 'junior'], weightClassIds: ['cadet:F:-61', 'junior:F:-59'] });
  const sheets = buildFfkExport([
    moved(reg({ last: 'Alpha', weight: 'cadet:F:-61' }), merged, 'm1'),
    moved(reg({ last: 'Bravo', band: 'junior', weight: 'junior:F:-53' }), merged, 'm1'),
  ], grid);
  expect(sheet(sheets, 'Karate').rows).toEqual([
    HEADER,
    ['LINA', 'ALPHA', 'L-Alpha', CLUB, 'Féminin', 'Karate', 'Cadet', -61, null],
    ['LINA', 'BRAVO', 'L-Bravo', CLUB, 'Féminin', 'Karate', 'Junior', -53, null],
  ]);
});

test('seniors fusionnés avec Vétérans 1 : les seniors restent « Séniors … »', () => {
  const merged = key({ sex: 'M', ageBandCodes: ['senior', 'v1'], weightClassIds: ['senior:M:-75', 'v1:M:-75'] });
  const sheets = buildFfkExport([
    moved(reg({ first: 'Paul', last: 'Senior', sex: 'M', band: 'senior', weight: 'senior:M:-75' }), merged, 'm'),
    moved(reg({ first: 'Marc', last: 'Veteran', sex: 'M', band: 'v1', weight: 'v1:M:-75' }), merged, 'm'),
  ], grid);
  expect(data(sheet(sheets, 'Karate')).map((r) => [r[1], r[6], r[7]])).toEqual([
    ['SENIOR', 'Séniors jiyu ippon kumite', -75],
    ['VETERAN', 'Vétéran 1', -75],
  ]);
});

test('catégorie mixte : une fille dans un -50 de garçons garde son poids d’inscription', () => {
  const mixed = key({ sex: 'X', ageBandCodes: ['minime'], weightClassIds: ['minime:M:-50'] });
  const sheets = buildFfkExport([
    moved(reg({ first: 'Léa', last: 'Fille', band: 'minime', weight: 'minime:F:-45' }), mixed, 'x'),
    moved(reg({ first: 'Tom', last: 'Garcon', sex: 'M', band: 'minime', weight: 'minime:M:-45' }), mixed, 'x'),
  ], grid);
  expect(data(sheet(sheets, 'Karate')).map((r) => [r[1], r[4], r[6], r[7]])).toEqual([
    ['FILLE', 'Féminin', 'Minime', -45],
    ['GARCON', 'Masculin', 'Minime', -50],
  ]);
});

test('passé de shobu à jiyu : Age « Séniors jiyu ippon kumite »', () => {
  const r = reg({ sex: 'M', band: 'senior', ruleset: 'shobu', weight: 'senior:M:-67', last: 'Shobu' });
  expect(data(sheet(buildFfkExport([r], grid), 'Karate'))[0]![6]).toBe('Séniors shobu ippon kumité');
  const toJiyu = moved(r, key({ sex: 'M', ageBandCodes: ['senior'], weightClassIds: ['senior:M:-67'], ruleset: 'jiyu' }));
  expect(data(sheet(buildFfkExport([toJiyu], grid), 'Karate'))[0]![6]).toBe('Séniors jiyu ippon kumite');
});

test('passé du karaté au boxing : ligne dans la feuille Boxe', () => {
  const r = moved(reg({ last: 'Boxeuse' }), key({ discipline: 'shido-boxing', ruleset: null, sex: 'F', ageBandCodes: ['cadet'], weightClassIds: ['cadet:F:-54'] }));
  const sheets = buildFfkExport([r], grid);
  expect(sheet(sheets, 'Karate').rows).toEqual([HEADER]);
  expect(data(sheet(sheets, 'Boxe'))).toEqual([['LINA', 'BOXEUSE', 'L-Boxeuse', CLUB, 'Féminin', 'Boxe', 'Cadet', -54, null]]);
});

test('absent ou ne combat pas : omis', () => {
  const sheets = buildFfkExport([reg({ last: 'Absente', out: true }), reg({ last: 'Presente' })], grid);
  expect(data(sheet(sheets, 'Karate')).map((r) => r[1])).toEqual(['PRESENTE']);
});

test('deux disciplines, absent dans une seule : une seule ligne', () => {
  const sheets = buildFfkExport([
    reg({ last: 'Double', out: true }),
    reg({ last: 'Double', discipline: 'shido-boxing' }),
  ], grid);
  expect(sheet(sheets, 'Karate').rows).toEqual([HEADER]);
  expect(data(sheet(sheets, 'Boxe')).map((r) => [r[1], r[5]])).toEqual([['DOUBLE', 'Boxe']]);
});

test('tableau libre : catégorie d’inscription', () => {
  const r = { ...reg({ last: 'Libre', weight: 'cadet:F:-47' }), final: { id: 'f1', key: freeKey('Gala', 'shido-boxing', null) } };
  const sheets = buildFfkExport([r], grid);
  expect(data(sheet(sheets, 'Karate'))).toEqual([['LINA', 'LIBRE', 'L-Libre', CLUB, 'Féminin', 'Karate', 'Cadet', -47, null]]);
  expect(sheet(sheets, 'Boxe').rows).toEqual([HEADER]);
});

test('non placé : catégorie d’inscription', () => {
  const r = { ...reg({ last: 'Seule', band: 'pupille', weight: 'pupille:F:+45' }), final: null };
  expect(data(sheet(buildFfkExport([r], grid), 'Karate'))).toEqual([['LINA', 'SEULE', 'L-Seule', CLUB, 'Féminin', 'Karate', 'Pupille', '+45', null]]);
});

test('deux lignes vides entre deux catégories, rien à la fin', () => {
  const sheets = buildFfkExport([
    reg({ last: 'Zeta', weight: 'cadet:F:-54' }),
    reg({ first: 'Tom', last: 'Garcon', sex: 'M', weight: 'cadet:M:-52' }),
    reg({ first: 'Zoé', last: 'Martin', weight: 'cadet:F:-47' }),
    reg({ first: 'Anna', last: 'Martin', weight: 'cadet:F:-47' }),
    reg({ last: 'Abel', weight: 'cadet:F:-47' }),
  ], grid);
  expect(sheet(sheets, 'Karate').rows.map((r) => (r.length ? `${r[0]} ${r[1]} ${r[7]}` : ''))).toEqual([
    'Prénom Nom Categorie',
    'LINA ABEL -47', 'ANNA MARTIN -47', 'ZOÉ MARTIN -47', '', '',
    'LINA ZETA -54', '', '',
    'TOM GARCON -52',
  ]);
});

test('ordre des blocs : filles puis garçons et mixtes, tranches, poids (ouverte en dernier), jiyu avant shobu, fusionnée à sa place', () => {
  const merged = key({ sex: 'M', ageBandCodes: ['junior', 'cadet'], weightClassIds: ['junior:M:-76', 'cadet:M:-63'] });
  const mixed = key({ sex: 'X', ageBandCodes: ['cadet'], weightClassIds: ['cadet:M:-57'] });
  const sheets = buildFfkExport([
    reg({ last: 'SeniorShobu', sex: 'M', band: 'senior', ruleset: 'shobu', weight: 'senior:M:-60' }),
    reg({ last: 'SeniorJiyu', sex: 'M', band: 'senior', ruleset: 'jiyu', weight: 'senior:M:-60' }),
    reg({ last: 'JuniorOpen', sex: 'M', band: 'junior', weight: 'junior:M:+76' }),
    reg({ last: 'Junior55', sex: 'M', band: 'junior', weight: 'junior:M:-55' }),
    moved(reg({ last: 'Fusion', sex: 'M', band: 'junior', weight: 'junior:M:-76' }), merged, 'fus'),
    moved(reg({ last: 'Mixte', sex: 'F', band: 'cadet', weight: 'cadet:F:-54' }), mixed, 'mix'),
    reg({ last: 'Cadet52', sex: 'M', band: 'cadet', weight: 'cadet:M:-52' }),
    reg({ last: 'Cadet70', sex: 'M', band: 'cadet', weight: 'cadet:M:-70' }),
    reg({ last: 'SeniorF', sex: 'F', band: 'senior', weight: 'senior:F:-55' }),
    reg({ last: 'MinimeF', sex: 'F', band: 'minime', weight: 'minime:F:+55' }),
  ], grid);
  expect(data(sheet(sheets, 'Karate')).map((r) => r[1])).toEqual([
    'MINIMEF', 'SENIORF', 'CADET52', 'MIXTE', 'FUSION', 'CADET70', 'JUNIOR55', 'JUNIOROPEN', 'SENIORJIYU', 'SENIORSHOBU',
  ]);
});

describe('Triathlon', () => {
  test('Triathlon vide : [[\'Ytiathlon\']]', () => {
    expect(sheet(buildFfkExport([reg({ last: 'K' })], grid), 'Triathlon')).toEqual({ name: 'Triathlon', widths: {}, rows: [['Ytiathlon']] });
  });
  test('avec des inscriptions : rempli comme les autres, largeurs de Karate', () => {
    const s = sheet(buildFfkExport([reg({ last: 'Tri', discipline: 'triathlon' })], grid), 'Triathlon');
    expect(s).toEqual({ name: 'Triathlon', widths: KARATE_WIDTHS, rows: [HEADER, ['LINA', 'TRI', 'L-Tri', CLUB, 'Féminin', 'Triathlon', 'Cadet', -54, null]] });
  });
});

test('kata : pas de Categorie', () => {
  const s = sheet(buildFfkExport([reg({ last: 'Kata', discipline: 'kata', band: 'v1', weight: null })], grid), 'Kata');
  expect(data(s)).toEqual([['LINA', 'KATA', 'L-Kata', CLUB, 'Féminin', 'Kata', 'Vétéran 1', null, null]]);
});

test('relecture par l’import : chaque ligne reconnue, même discipline, règlement, tranche et catégorie de poids', () => {
  type Expected = { discipline: DisciplineId; ruleset: Ruleset | null; ageBandCode: string; weightLabel: string | null };
  const cases: [FfkExportRegistration, Expected][] = [
    [reg({ last: 'Cadette' }), { discipline: 'karate', ruleset: null, ageBandCode: 'cadet', weightLabel: '-54' }],
    [reg({ last: 'Ouverte', weight: 'cadet:F:+61' }), { discipline: 'karate', ruleset: null, ageBandCode: 'cadet', weightLabel: '+61' }],
    [moved(reg({ last: 'Voisine' }), key({ sex: 'F', ageBandCodes: ['cadet'], weightClassIds: ['cadet:F:-61'] })),
      { discipline: 'karate', ruleset: null, ageBandCode: 'cadet', weightLabel: '-61' }],
    [reg({ last: 'Mini', band: 'mini-poussin', weight: 'mini-poussin:F:-25' }), { discipline: 'karate', ruleset: null, ageBandCode: 'mini-poussin', weightLabel: '-25' }],
    [reg({ last: 'Poussine', band: 'poussin', weight: 'poussin:F:+35' }), { discipline: 'karate', ruleset: null, ageBandCode: 'poussin', weightLabel: '+35' }],
    [reg({ last: 'Pupille', band: 'pupille', weight: 'pupille:M:-50', sex: 'M' }), { discipline: 'karate', ruleset: null, ageBandCode: 'pupille', weightLabel: '-50' }],
    [reg({ last: 'Benjamin', band: 'benjamin', weight: 'benjamin:M:+55', sex: 'M' }), { discipline: 'karate', ruleset: null, ageBandCode: 'benjamin', weightLabel: '+55' }],
    [reg({ last: 'Minime', band: 'minime', weight: 'minime:F:-35' }), { discipline: 'karate', ruleset: null, ageBandCode: 'minime', weightLabel: '-35' }],
    [reg({ last: 'Junior', band: 'junior', weight: 'junior:M:-68', sex: 'M' }), { discipline: 'karate', ruleset: null, ageBandCode: 'junior', weightLabel: '-68' }],
    [reg({ last: 'Espoir', band: 'espoir', weight: 'espoir:F:-61' }), { discipline: 'karate', ruleset: null, ageBandCode: 'espoir', weightLabel: '-61' }],
    [reg({ last: 'Shobu', band: 'senior', ruleset: 'shobu', weight: 'senior:M:+84', sex: 'M' }), { discipline: 'karate', ruleset: 'shobu', ageBandCode: 'senior', weightLabel: '+84' }],
    [reg({ last: 'Jiyu', band: 'senior', weight: 'senior:F:-50' }), { discipline: 'karate', ruleset: 'jiyu', ageBandCode: 'senior', weightLabel: '-50' }],
    ...(['v1', 'v2', 'v3', 'v4', 'v5'] as const).map((v): [FfkExportRegistration, Expected] => [
      reg({ last: `Vet${v}`, band: v, weight: `${v}:M:-75`, sex: 'M' }), { discipline: 'karate', ruleset: null, ageBandCode: v, weightLabel: '-75' },
    ]),
    [moved(reg({ last: 'Fusionnee', weight: 'cadet:F:-61' }), key({ sex: 'F', ageBandCodes: ['cadet', 'junior'], weightClassIds: ['cadet:F:-61', 'junior:F:-59'] }), 'm'),
      { discipline: 'karate', ruleset: null, ageBandCode: 'cadet', weightLabel: '-61' }],
    [moved(reg({ last: 'Mixte', band: 'minime', weight: 'minime:F:-45' }), key({ sex: 'X', ageBandCodes: ['minime'], weightClassIds: ['minime:M:-50'] }), 'x'),
      { discipline: 'karate', ruleset: null, ageBandCode: 'minime', weightLabel: '-45' }],
    [reg({ last: 'Boxeuse', discipline: 'shido-boxing', band: 'senior', weight: 'senior:F:-55' }), { discipline: 'shido-boxing', ruleset: 'jiyu', ageBandCode: 'senior', weightLabel: '-55' }],
    [moved(reg({ last: 'Passee' }), key({ discipline: 'shido-boxing', ruleset: null, sex: 'F', ageBandCodes: ['cadet'], weightClassIds: ['cadet:F:+61'] })),
      { discipline: 'shido-boxing', ruleset: null, ageBandCode: 'cadet', weightLabel: '+61' }],
    [reg({ last: 'Mix', discipline: 'shido-mix', band: 'junior', sex: 'M', weight: 'junior:M:+76' }), { discipline: 'shido-mix', ruleset: null, ageBandCode: 'junior', weightLabel: '+76' }],
    [reg({ last: 'Tri', discipline: 'triathlon', band: 'minime', sex: 'M', weight: 'minime:M:-40' }), { discipline: 'triathlon', ruleset: null, ageBandCode: 'minime', weightLabel: '-40' }],
    [reg({ last: 'Kata', discipline: 'kata', band: 'v2', weight: null }), { discipline: 'kata', ruleset: null, ageBandCode: 'v2', weightLabel: null }],
    [{ ...reg({ last: 'Libre', band: 'benjamin', weight: 'benjamin:F:-30' }), final: { id: 'f', key: freeKey('Gala', 'karate', 'jiyu') } },
      { discipline: 'karate', ruleset: null, ageBandCode: 'benjamin', weightLabel: '-30' }],
  ];
  const expected = new Map(cases.map(([r, e]) => [r.lastName.toUpperCase(), e]));
  const seen: string[] = [];
  for (const s of buildFfkExport(cases.map(([r]) => r), grid)) {
    if (s.rows.length === 1 && s.rows[0]![0] === 'Ytiathlon') continue;
    const header = findHeaderRow(s.rows);
    expect(header, s.name).toBe(0);
    const rows = parseFfkRows(s.rows, header!, guessColumnMapping(s.rows[header!]!), s.name, grid);
    for (const row of rows) {
      seen.push(row.lastName);
      expect(row.errors, row.lastName).toEqual([]);
      expect(row.weightIssue ?? null, row.lastName).toBeNull();
      const { discipline, ruleset, ageBandCode, weightLabel } = row;
      expect({ discipline, ruleset, ageBandCode, weightLabel }, row.lastName).toEqual(expected.get(row.lastName));
    }
  }
  expect(seen.sort()).toEqual([...expected.keys()].sort());
});
