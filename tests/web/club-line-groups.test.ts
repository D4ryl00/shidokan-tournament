import { expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { groupClubLines } from '../../src/web/components/club-entry/groups.js';

const ageBands = [
  { code: 'cadet', label: 'Cadets', ages: '14 à 15 ans', isMinor: true },
  { code: 'junior', label: 'Juniors', ages: '16 à 17 ans', isMinor: true },
];
const weightClasses = [
  { id: 'cadet:F:-54', ageBandCode: 'cadet', sex: 'F' as const, label: '-54', maxKg: 54 },
  { id: 'cadet:M:-57', ageBandCode: 'cadet', sex: 'M' as const, label: '-57', maxKg: 57 },
  { id: 'cadet:M:-63', ageBandCode: 'cadet', sex: 'M' as const, label: '-63', maxKg: 63 },
  { id: 'junior:M:-70', ageBandCode: 'junior', sex: 'M' as const, label: '-70', maxKg: 70 },
];
const base: ClubFormLine = { lastName: '', firstName: '', sex: 'M', ageBandCode: 'cadet', weightClassId: null, weightKg: null, combat: null, kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null };
const line = (id: string, o: Partial<ClubFormLine>) => ({ fighterId: id, line: { ...base, ...o } });

const lines = [
  line('roux', { lastName: 'ROUX', firstName: 'Nathan', ageBandCode: 'junior', weightClassId: 'junior:M:-70', combat: 'shido-mix', ruleset: 'jiyu' }),
  line('chevalier', { lastName: 'CHEVALIER', firstName: 'Noé', weightClassId: 'cadet:M:-63', combat: 'karate', ruleset: 'jiyu' }),
  line('bernard', { lastName: 'BERNARD', firstName: 'Hugo', weightClassId: 'cadet:M:-57', combat: 'karate', ruleset: 'jiyu', kata: true }),
  line('martin', { lastName: 'MARTIN', firstName: 'Léa', sex: 'F', weightClassId: 'cadet:F:-54', kata: true }),
  line('sans-age', { lastName: 'AUBRY', firstName: 'Zoé', ageBandCode: null }),
];
const ctx = { ageBands, weightClasses, query: '' };
const shape = (g: ReturnType<typeof groupClubLines<(typeof lines)[number]>>) => g.map((x) => [x.title, x.lines.map((l) => l.fighterId)]);

test('par âge : tranches dans l’ordre de la grille, puis sexe (F d’abord), poids, nom ; sans tranche en dernier', () => {
  const g = groupClubLines(lines, { ...ctx, mode: 'age' });
  expect(shape(g)).toEqual([
    ['Cadets', ['martin', 'bernard', 'chevalier']],
    ['Juniors', ['roux']],
    ['Sans tranche d’âge', ['sans-age']],
  ]);
  expect(g[0]).toMatchObject({ id: 'age-cadet', sub: '14 à 15 ans', hide: 'age', count: '3 combattants' });
});

test('par discipline : un combattant en combat et en kata est dans les deux groupes, Kata en dernier', () => {
  const g = groupClubLines(lines, { ...ctx, mode: 'discipline' });
  expect(shape(g)).toEqual([
    ['Karaté', ['bernard', 'chevalier']],
    ['Shido-mix-martial', ['roux']],
    ['Kata', ['martin', 'bernard']],
    ['Sans discipline', ['sans-age']],
  ]);
  expect(g[0]).toMatchObject({ hide: 'karate', count: '2 inscrits' });
  expect(g[2]).toMatchObject({ hide: 'kata', sub: 'sans catégorie de poids', count: '2 inscrits' });
});

test('par nom : un seul groupe sans titre, de A à Z', () => {
  const g = groupClubLines(lines, { ...ctx, mode: 'name' });
  expect(shape(g)).toEqual([[null, ['sans-age', 'bernard', 'chevalier', 'martin', 'roux']]]);
  expect(g[0]!.hide).toBeNull();
});

test('recherche sans accents ni casse, sur le nom et le prénom dans les deux ordres', () => {
  expect(shape(groupClubLines(lines, { ...ctx, mode: 'name', query: 'lea' }))).toEqual([[null, ['martin']]]);
  expect(shape(groupClubLines(lines, { ...ctx, mode: 'name', query: 'noe cheva' }))).toEqual([[null, ['chevalier']]]);
  expect(groupClubLines(lines, { ...ctx, mode: 'age', query: 'personne' })).toEqual([]);
});
