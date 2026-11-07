import { expect, test } from 'vitest';
import { categoryLabel, freeKey, type Category, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { cardTitle, groupTitle, loneFighters, plancheFilter, plancheGroups, shownOnPlanche } from '../../src/web/components/planche/model.js';

const grid = ffkDefaultGrid();
let n = 0;
function cat(key: CategoryKey, o: Partial<Category> = {}): Category {
  n += 1;
  return { id: `c${n}`, key, label: categoryLabel(key, grid), status: 'provisional', registrationIds: ['a', 'b'], absentIds: [], waveId: null, bracket: null, ...o } as unknown as Category;
}
const k = (d: 'karate' | 'kata', age: string, sex: 'F' | 'M', w: string | null): CategoryKey => ({
  discipline: d, ruleset: d === 'kata' ? null : 'jiyu', sex, ageBandCodes: [age], weightClassIds: w ? [w] : [],
});

const cats = [
  cat(freeKey('Gala', 'karate', 'jiyu'), { registrationIds: [] }),
  cat(k('kata', 'minime', 'F', null)),
  cat(k('karate', 'minime', 'M', 'minime:M:-50')),
  cat(k('karate', 'benjamin', 'M', 'benjamin:M:-40')),
  cat(k('karate', 'benjamin', 'F', 'benjamin:F:-35')),
];
const noZone = { sort: 'categorie' as const, grid, zoneOf: () => null, zoneOrder: [] };

test('groupes par catégorie : ordre de l’appli, tableaux libres en dernier', () => {
  const g = plancheGroups(cats, noZone);
  expect(g.map((x) => x.title)).toEqual(['Karaté · Jiyu — Benjamins', 'Karaté · Jiyu — Minimes', 'Kata — Minimes', 'Tableaux libres']);
  expect(g[0]!.categories.map((c) => cardTitle(c, grid))).toEqual(['Benjamins F · -35 kg', 'Benjamins M · -40 kg']);
  expect(groupTitle(cats[1]!, grid)).toBe('Kata — Minimes');
  expect(cardTitle(cats[0]!, grid)).toBe('Gala');
});

test('une tranche regroupée va dans le groupe de sa première tranche', () => {
  const merged = cat({ ...k('karate', 'benjamin', 'M', 'minime:M:-50'), ageBandCodes: ['minime', 'benjamin'] });
  expect(groupTitle(merged, grid)).toBe('Karaté · Jiyu — Benjamins');
});

test('classement par zone : ordre des zones, « Sans zone » en dernier', () => {
  const zoneOf = (c: Category) => (c.key.discipline === 'kata' ? { id: 'z2', name: 'Ring' } : c.key.free ? null : { id: 'z1', name: 'Tatami 1' });
  const g = plancheGroups(cats, { sort: 'zone', grid, zoneOf, zoneOrder: ['z1', 'z2'] });
  expect(g.map((x) => x.title)).toEqual(['Tatami 1', 'Ring', 'Sans zone']);
  expect(g[0]!.categories).toHaveLength(3);
  expect(g[0]!.categories[0]!.label).toContain('Benjamins F');
});

test('recherche : tous les mots, libellé et membres', () => {
  const names = new Map([['a', 'FONTAINE Léa'], ['b', 'DUBOIS Lucas']]);
  const o = { query: '', names, onlyTodo: false, cases: new Map<string, number>() };
  expect(plancheFilter(cats, o)).toHaveLength(5);
  expect(plancheFilter(cats, { ...o, query: 'minimes -50' }).map((c) => c.id)).toEqual([cats[2]!.id]);
  expect(plancheFilter(cats, { ...o, query: 'fontaine' })).toHaveLength(4);
  expect(plancheFilter(cats, { ...o, query: 'zzz' })).toEqual([]);
  const lone = cat(k('karate', 'cadet', 'F', null), { registrationIds: ['a'] });
  expect(plancheFilter([...cats, lone], { ...o, onlyTodo: true })).toEqual([lone]);
  expect(plancheFilter(cats, { ...o, onlyTodo: true, cases: new Map([[cats[1]!.id, 2]]) })).toEqual([cats[1]]);
});

test('shownOnPlanche', () => {
  expect(shownOnPlanche(cats[0]!)).toBe(true);
  expect(shownOnPlanche(cat(k('kata', 'cadet', 'F', null), { absentIds: ['a', 'b'] }))).toBe(false);
  expect(shownOnPlanche(cats[1]!)).toBe(true);
});

test('loneFighters : session affichée et catégories en attente', () => {
  const a = cat(k('karate', 'cadet', 'F', null), { registrationIds: ['x'], waveId: 'w1' });
  const b = cat(k('karate', 'cadet', 'M', null), { registrationIds: ['y'], waveId: null });
  const c = cat(k('karate', 'junior', 'M', null), { registrationIds: ['z'], waveId: 'w2' });
  const d = cat(k('karate', 'junior', 'F', null), { registrationIds: ['p', 'q'], absentIds: ['q'], waveId: 'w1' });
  const all = [a, b, c, d];
  const ids = (r: { registrationId: string }[]) => r.map((x) => x.registrationId);
  expect(ids(loneFighters(all, { waveId: 'w1', scopeAll: false }))).toEqual(['x', 'y', 'p']);
  expect(ids(loneFighters(all, { waveId: 'w1', scopeAll: true }))).toEqual(['x', 'y', 'z', 'p']);
  expect(loneFighters(all, { waveId: 'w1', scopeAll: false })[0]).toEqual({ categoryId: a.id, registrationId: 'x' });
});
