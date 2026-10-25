import { expect, test } from 'vitest';
import { categoryKeyClosed, closedSummary, columnLabel, entryCells, entryKey, offeredAgeBands } from '../../src/domain/closed-categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const cells = (pred: (k: string) => boolean) => new Set(entryCells(grid).map(entryKey).filter(pred));

test('entryCells : 9 colonnes chez les adultes, 5 chez les mineurs (pas de shobu)', () => {
  const all = entryCells(grid);
  expect(all.filter((c) => c.ageBandCode === 'senior' && c.sex === 'F')).toHaveLength(9);
  expect(all.filter((c) => c.ageBandCode === 'cadet' && c.sex === 'F')).toHaveLength(5);
  expect(all.some((c) => c.ageBandCode === 'cadet' && c.ruleset === 'shobu')).toBe(false);
  expect(entryKey(all[0]!)).toBe('mini-poussin|F|karate|jiyu');
  expect(entryKey({ ageBandCode: 'senior', sex: 'M', discipline: 'kata', ruleset: null })).toBe('senior|M|kata|');
});

test('columnLabel : discipline puis règlement en minuscules', () => {
  expect(columnLabel({ discipline: 'karate', ruleset: 'jiyu' })).toBe('Karaté jiyu');
  expect(columnLabel({ discipline: 'shido-mix', ruleset: 'shobu' })).toBe('Shido-mix-martial shobu');
  expect(columnLabel({ discipline: 'kata', ruleset: null })).toBe('Kata');
});

test('closedSummary : phrases en clair', () => {
  expect(closedSummary(grid, new Set())).toEqual([]);
  expect(closedSummary(grid, cells((k) => k.startsWith('benjamin|') && k.includes('|shido-mix|')))).toEqual(['Benjamins (F et M) : pas de Shido-mix-martial']);
  expect(closedSummary(grid, new Set(['senior|F|karate|shobu']))).toEqual(['Seniors (F) : pas de Karaté shobu']);
  expect(closedSummary(grid, new Set(['senior|F|karate|jiyu', 'senior|F|karate|shobu', 'senior|F|kata|']))).toEqual(['Seniors (F) : pas de Karaté, Kata']);
  expect(closedSummary(grid, cells((k) => k.startsWith('mini-poussin|')))).toEqual(['Mini-poussins : aucune catégorie ouverte']);
  expect(closedSummary(grid, new Set(['senior|F|kata|', 'senior|M|triathlon|jiyu']))).toEqual(['Seniors (F) : pas de Kata', 'Seniors (M) : pas de Triathlon jiyu']);
});

test('offeredAgeBands : une tranche entièrement fermée disparaît', () => {
  const codes = offeredAgeBands(grid, cells((k) => k.startsWith('mini-poussin|'))).map((b) => b.code);
  expect(codes).not.toContain('mini-poussin');
  expect(codes).toContain('poussin');
});

test('categoryKeyClosed : fermée seulement si toutes ses parts le sont', () => {
  const closed = new Set(['cadet|F|karate|jiyu', 'cadet|M|karate|jiyu']);
  const key = { discipline: 'karate' as const, ruleset: 'jiyu' as const, sex: 'F' as const, ageBandCodes: ['cadet'], weightClassIds: [] };
  expect(categoryKeyClosed(closed, key)).toBe(true);
  expect(categoryKeyClosed(closed, { ...key, ageBandCodes: ['cadet', 'junior'] })).toBe(false);
  expect(categoryKeyClosed(new Set(['cadet|F|karate|jiyu']), { ...key, sex: 'X' })).toBe(false);
  expect(categoryKeyClosed(closed, { ...key, sex: 'X' })).toBe(true);
});
