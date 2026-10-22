import { expect, test } from 'vitest';
import { activeEntrantCount, categoryLabel, compareKeys, keyString, naturalKey, type Category, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();

test('clé et libellé d’un combat', () => {
  const k = naturalKey({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' }, { sex: 'F', ageBandCode: 'cadet' });
  expect(k).toEqual({ discipline: 'karate', ruleset: 'jiyu', sex: 'F', ageBandCodes: ['cadet'], weightClassIds: ['cadet:F:-54'] });
  expect(keyString(k)).toBe('karate|jiyu|F|cadet|cadet:F:-54');
  expect(categoryLabel(k, grid)).toBe('Karaté · Jiyu · Cadets F · -54 kg');
});

test('clé et libellé d’un kata', () => {
  const k = naturalKey({ discipline: 'kata', ruleset: null, weightClassId: null }, { sex: 'M', ageBandCode: 'benjamin' });
  expect(k).toEqual({ discipline: 'kata', ruleset: null, sex: 'M', ageBandCodes: ['benjamin'], weightClassIds: [] });
  expect(categoryLabel(k, grid)).toBe('Kata · Benjamins M');
});

test('fusion et mixité', () => {
  const k: CategoryKey = { discipline: 'karate', ruleset: 'jiyu', sex: 'X', ageBandCodes: ['junior', 'cadet'], weightClassIds: ['cadet:F:-61', 'cadet:F:-54'] };
  expect(categoryLabel(k, grid)).toBe('Karaté · Jiyu · Cadets / Juniors F/M · -54 / -61 kg');
  const same: CategoryKey = { ...k, ageBandCodes: ['cadet', 'junior'], weightClassIds: ['cadet:F:-54', 'cadet:F:-61'] };
  expect(keyString(k)).toBe(keyString(same));
});

test('ordre : discipline, règlement, âge, sexe, poids', () => {
  const mk = (d: 'karate' | 'kata', age: string, sex: 'F' | 'M', w: string | null): CategoryKey => ({
    discipline: d, ruleset: d === 'kata' ? null : 'jiyu', sex, ageBandCodes: [age], weightClassIds: w ? [w] : [],
  });
  const keys = [mk('kata', 'cadet', 'F', null), mk('karate', 'senior', 'F', 'senior:F:-50'), mk('karate', 'cadet', 'M', 'cadet:M:-52'),
    mk('karate', 'cadet', 'F', 'cadet:F:-61'), mk('karate', 'cadet', 'F', 'cadet:F:-47')];
  const sorted = [...keys].sort((a, b) => compareKeys(a, b, grid)).map((k) => categoryLabel(k, grid));
  expect(sorted).toEqual([
    'Karaté · Jiyu · Cadets F · -47 kg', 'Karaté · Jiyu · Cadets F · -61 kg', 'Karaté · Jiyu · Cadets M · -52 kg',
    'Karaté · Jiyu · Seniors F · -50 kg', 'Kata · Cadets F',
  ]);
});

test('activeEntrantCount : présents avant lancement, inscrits du tableau ensuite', () => {
  const base = { registrationIds: ['a', 'b', 'c'], absentIds: ['c'], bracket: null } as unknown as Category;
  expect(activeEntrantCount({ ...base, status: 'provisional' })).toBe(2);
  expect(activeEntrantCount({ ...base, absentIds: ['a', 'b', 'c'], status: 'ready' })).toBe(0);
  expect(activeEntrantCount({ ...base, status: 'started', bracket: { entrants: [{}, {}, {}] } } as unknown as Category)).toBe(3);
});
