import { describe, expect, test } from 'vitest';
import { buildCards, type ExistingFighter } from '../../src/domain/ffk-plan/cards.js';
import type { ClubLink } from '../../src/domain/ffk-plan/clubs.js';
import type { FfkRow } from '../../src/domain/ffk-import.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const ENTITY = '0060893 TANI DOJO';
const links: ClubLink[] = [{ clubEntity: ENTITY, clubName: 'TANI DOJO', affiliationNumber: '0060893', proposal: null, target: 'c1', chosen: false, rows: 3 }];

let n = 0;
function row(over: Partial<FfkRow> = {}): FfkRow {
  n++;
  return {
    key: `K#${n}`, sheet: 'Karate', line: n + 1, licence: `L${n}`, lastName: 'MARTIN', firstName: 'LEA',
    clubEntity: ENTITY, clubName: 'TANI DOJO', sex: 'F', ageBandCode: 'cadet', discipline: 'karate',
    ruleset: null, weightLabel: '-54', weightIssue: null, errors: [], warnings: [], ...over,
  };
}
function fighter(id: string, clubId: string | null, lastName: string, firstName: string, over: Partial<ExistingFighter> = {}): ExistingFighter {
  return {
    fighterId: id, clubId, licence: null, publicNameHidden: false, version: 'v', editable: true, partlyEditable: false,
    startedDisciplines: [], fromFfk: false,
    line: { lastName, firstName, sex: 'F', ageBandCode: 'cadet', weightClassId: null, weightKg: null, combats: ['karate'], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null },
    ...over,
  };
}
const build = (rows: FfkRow[], fighters: ExistingFighter[] = []) => buildCards(rows, links, fighters, grid, new Set());

describe('regroupement', () => {
  test('Karaté + Kata, même licence → une carte, deux disciplines ; doublon même discipline signalé', () => {
    const { cards } = build([row({ licence: '11518201J', discipline: 'karate' }), row({ licence: '11518201J', discipline: 'kata', weightLabel: null }), row({ licence: '11518201J', discipline: 'karate', line: 9 })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe('L:11518201J');
    expect(cards[0]!.exportLine).toMatchObject({ combats: ['karate'], kata: true, licence: '11518201J' });
    expect(cards[0]!.notes.join(' ')).toMatch(/Ligne en double/);
  });
  test('sans licence : regroupées par nom + sexe + club', () => {
    const { cards } = build([row({ licence: null, discipline: 'karate' }), row({ licence: null, discipline: 'kata' })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe(`N:MARTIN LEA|F|${ENTITY}`);
    expect(cards[0]!.clubId).toBe('c1');
  });
  test('ligne sans nom ni licence : sa propre carte, erreurs en notes', () => {
    const { cards } = build([row({ licence: null, lastName: '', firstName: '', sex: null, errors: ['Nom manquant.'] }), row({ licence: null, lastName: '', firstName: '', sex: null, errors: ['Nom manquant.'] })]);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.key).toMatch(/^R:/);
    expect(cards[0]!.notes).toEqual(['Nom manquant.']);
    expect(cards[0]!.exportLine.sex).toBeNull();
  });
});

describe('candidats', () => {
  const lea = (over: Partial<FfkRow> = {}) => row({ licence: null, ...over });
  test('licence = sûr', () => {
    const [c] = build([row({ licence: 'ABC' })], [fighter('f1', 'c9', 'AUTRE', 'NOM', { licence: 'ABC' })]).cards;
    expect(c!.sure).toBe('f1');
  });
  test('nom exact dans le club relié = sûr', () => {
    const [c] = build([lea()], [fighter('f1', 'c1', 'Martin', 'Léa')]).cards;
    expect(c).toMatchObject({ sure: 'f1' });
  });
  test('même nom de famille, prénom différent', () => {
    const [c] = build([lea()], [fighter('f1', 'c1', 'Martin', 'Zoé')]).cards;
    expect(c).toMatchObject({ sure: null, candidates: [{ fighterId: 'f1', reason: 'même nom de famille, prénom différent' }] });
  });
  test('nom très proche', () => {
    const [c] = build([lea()], [fighter('f1', 'c1', 'Marting', 'Lea')]).cards;
    expect(c).toMatchObject({ sure: null, candidates: [{ fighterId: 'f1', reason: 'nom très proche' }] });
  });
  test('même nom, autre club', () => {
    const [c] = build([lea()], [fighter('f1', 'c2', 'Martin', 'Lea')]).cards;
    expect(c).toMatchObject({ sure: null, candidates: [{ fighterId: 'f1', reason: 'même nom, autre club' }] });
  });
  test('même nom, club non renseigné', () => {
    const noClub = buildCards([lea({ clubEntity: null, clubName: null })], links, [fighter('f1', 'c2', 'Martin', 'Lea')], grid, new Set()).cards[0]!;
    expect(noClub).toMatchObject({ sure: null, candidates: [{ fighterId: 'f1', reason: 'même nom, club non renseigné' }] });
  });
  test('même nom, autre licence', () => {
    const [c] = build([row({ licence: 'NEW' })], [fighter('f1', 'c1', 'Martin', 'Lea', { licence: 'OLD' })]).cards;
    expect(c).toMatchObject({ sure: null, candidates: [{ fighterId: 'f1', reason: 'même nom, autre licence' }] });
  });
  test('sexe différent : jamais candidat', () => {
    const [c] = build([lea()], [fighter('f1', 'c1', 'Martin', 'Lea', { line: { ...fighter('x', null, 'Martin', 'Lea').line, sex: 'M' } })]).cards;
    expect(c).toMatchObject({ sure: null, candidates: [] });
  });
});

describe('poids', () => {
  test('hors grille : catégorie nouvelle non acceptée → weightClassId null + weightIssue ; acceptée → id', () => {
    const r = row({ ageBandCode: 'poussin', sex: 'M', weightLabel: '-20' });
    expect(buildCards([r], links, [], grid, new Set()).cards[0]).toMatchObject({ exportLine: { weightClassId: null }, weightIssue: '« −20 » n’est pas dans la grille.' });
    expect(buildCards([r], links, [], grid, new Set(['poussin:M:-20'])).cards[0]!.exportLine.weightClassId).toBe('poussin:M:-20');
    expect(buildCards([r], links, [], grid, new Set()).newWeightClasses[0]).toMatchObject({ id: 'poussin:M:-20', rows: 1 });
  });
  test('catégorie nouvelle : combattants comptés une fois, même sur deux lignes de combat', () => {
    const karate = row({ licence: 'X1', ageBandCode: 'poussin', sex: 'M', weightLabel: '-20', discipline: 'karate' });
    const boxing = row({ licence: 'X1', ageBandCode: 'poussin', sex: 'M', weightLabel: '-20', discipline: 'shido-boxing' });
    const other = row({ licence: 'X2', lastName: 'AUTRE', ageBandCode: 'poussin', sex: 'M', weightLabel: '-20' });
    expect(build([karate, boxing]).newWeightClasses).toEqual([expect.objectContaining({ id: 'poussin:M:-20', rows: 2, fighters: 1 })]);
    expect(build([karate, boxing, other]).newWeightClasses[0]).toMatchObject({ rows: 3, fighters: 2 });
  });
  test('poids illisible : la ligne devient une carte avec weightIssue', () => {
    const msg = 'Catégorie de poids « 70 » inconnue : écrire -70 ou +70.';
    const { cards } = build([row({ weightLabel: null, weightIssue: msg })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ weightIssue: msg, notes: [], exportLine: { weightClassId: null } });
  });
  test('catégorie de la grille : son id', () => {
    expect(build([row()]).cards[0]!.exportLine.weightClassId).toBe('cadet:F:-54');
  });
});
