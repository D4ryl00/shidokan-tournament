import { expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { groupClubLines, type LineGroup } from '../../src/web/components/club-entry/groups.js';

const ageBands = [
  { code: 'cadet', label: 'Cadets', ages: '14 à 15 ans', isMinor: true },
  { code: 'junior', label: 'Juniors', ages: '16 à 17 ans', isMinor: true },
  { code: 'senior', label: 'Seniors', ages: '18 à 34 ans', isMinor: false },
];
const weightClasses = [
  { id: 'cadet:F:-54', ageBandCode: 'cadet', sex: 'F' as const, label: '-54', maxKg: 54 },
  { id: 'cadet:M:-57', ageBandCode: 'cadet', sex: 'M' as const, label: '-57', maxKg: 57 },
  { id: 'cadet:M:-63', ageBandCode: 'cadet', sex: 'M' as const, label: '-63', maxKg: 63 },
  { id: 'junior:M:-70', ageBandCode: 'junior', sex: 'M' as const, label: '-70', maxKg: 70 },
  { id: 'senior:M:-75', ageBandCode: 'senior', sex: 'M' as const, label: '-75', maxKg: 75 },
];
const base: ClubFormLine = { lastName: '', firstName: '', sex: 'M', ageBandCode: 'cadet', weightClassId: null, weightKg: null, combat: null, kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null };
const line = (id: string, o: Partial<ClubFormLine>) => ({ fighterId: id, line: { ...base, ...o } });

const lines = [
  line('roux', { lastName: 'ROUX', firstName: 'Nathan', ageBandCode: 'junior', weightClassId: 'junior:M:-70', combat: 'shido-mix', ruleset: 'jiyu' }),
  line('dubois', { lastName: 'DUBOIS', firstName: 'Karim', ageBandCode: 'senior', weightClassId: 'senior:M:-75', combat: 'karate', ruleset: 'shobu' }),
  line('chevalier', { lastName: 'CHEVALIER', firstName: 'Noé', weightClassId: 'cadet:M:-63', combat: 'karate', ruleset: 'jiyu' }),
  line('bernard', { lastName: 'BERNARD', firstName: 'Hugo', weightClassId: 'cadet:M:-57', combat: 'karate', ruleset: 'jiyu', kata: true }),
  line('martin', { lastName: 'MARTIN', firstName: 'Léa', sex: 'F', weightClassId: 'cadet:F:-54', kata: true }),
  line('sans-age', { lastName: 'AUBRY', firstName: 'Zoé', ageBandCode: null }),
];
const ctx = { ageBands, weightClasses, query: '' };
const shape = (g: LineGroup<(typeof lines)[number]>[]) => g.map((x) => [x.section?.title ?? null, x.title, x.lines.map((l) => l.fighterId)]);

test('par catégorie (défaut) : discipline, jiyu avant shobu, kata en dernier ; une carte par tranche d’âge, des plus jeunes aux plus âgés', () => {
  const g = groupClubLines(lines, { ...ctx, mode: 'category' });
  expect(shape(g)).toEqual([
    ['Karaté · Jiyu', 'Cadets', ['bernard', 'chevalier']],
    ['Karaté · Shobu', 'Seniors', ['dubois']],
    ['Shido-mix-martial · Jiyu', 'Juniors', ['roux']],
    ['Kata', 'Cadets', ['martin', 'bernard']],
    ['Sans discipline', 'Sans tranche d’âge', ['sans-age']],
  ]);
  expect(g[0]).toMatchObject({ id: 'karate-jiyu-cadet', sub: '14 à 15 ans', count: '2 combattants', hide: { age: true, combat: true, kata: false } });
  expect(g[0]!.section).toEqual({ key: 'karate-jiyu', title: 'Karaté · Jiyu', short: 'Karaté jiyu', sub: null, size: 2 });
  expect(g[3]!.section).toMatchObject({ key: 'kata', short: 'Kata', sub: 'sans catégorie de poids', size: 2 });
  expect(g[3]!.hide).toEqual({ age: true, combat: true, kata: true });
});

test('par âge : tranches dans l’ordre de la grille, puis sexe (F d’abord), poids, nom ; sans tranche en dernier', () => {
  const g = groupClubLines(lines, { ...ctx, mode: 'age' });
  expect(shape(g)).toEqual([
    [null, 'Cadets', ['martin', 'bernard', 'chevalier']],
    [null, 'Juniors', ['roux']],
    [null, 'Seniors', ['dubois']],
    [null, 'Sans tranche d’âge', ['sans-age']],
  ]);
  expect(g[0]).toMatchObject({ id: 'age-cadet', sub: '14 à 15 ans', count: '3 combattants', hide: { age: true, combat: false, kata: false } });
});

test('par nom : un seul groupe sans titre, de A à Z', () => {
  const g = groupClubLines(lines, { ...ctx, mode: 'name' });
  expect(shape(g)).toEqual([[null, null, ['sans-age', 'bernard', 'chevalier', 'dubois', 'martin', 'roux']]]);
  expect(g[0]!.hide).toEqual({ age: false, combat: false, kata: false });
});

test('recherche sans accents ni casse, sur le nom et le prénom dans les deux ordres ; la taille de la section suit la recherche', () => {
  expect(shape(groupClubLines(lines, { ...ctx, mode: 'name', query: 'lea' }))).toEqual([[null, null, ['martin']]]);
  expect(shape(groupClubLines(lines, { ...ctx, mode: 'name', query: 'noe cheva' }))).toEqual([[null, null, ['chevalier']]]);
  expect(groupClubLines(lines, { ...ctx, mode: 'category', query: 'hugo' }).map((g) => g.section!.size)).toEqual([1, 1]);
  expect(groupClubLines(lines, { ...ctx, mode: 'age', query: 'personne' })).toEqual([]);
});
