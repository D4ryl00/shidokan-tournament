import { expect, test } from 'vitest';
import { categoryLabel, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { keyParts, whyText } from '../../src/web/components/replacement/keyDiff.js';

const grid = ffkDefaultGrid();
const key = (ageBandCodes: string[], sex: 'F' | 'M' | 'X', weightClassIds: string[]): CategoryKey => ({ discipline: 'karate', ruleset: 'jiyu', sex, ageBandCodes, weightClassIds });
const joined = (parts: ReturnType<typeof keyParts>) => parts.map((p) => p.sep + p.text).join('');
const changed = (parts: ReturnType<typeof keyParts>) => parts.filter((p) => p.changed).map((p) => p.text);

test('keyParts : seul le poids change (GIRARD Emma)', () => {
  const from = key(['minime'], 'F', ['minime:F:-40']);
  const to = key(['minime'], 'F', ['minime:F:-45']);
  const parts = keyParts(to, from, grid);
  expect(joined(parts)).toBe(categoryLabel(to, grid));
  expect(changed(parts)).toEqual(['-45 kg']);
  expect(changed(keyParts(from, to, grid))).toEqual(['-40 kg']);
});

test('keyParts : tranche et poids changent (GARNIER Sacha)', () => {
  const from = key(['benjamin'], 'M', ['benjamin:M:-40']);
  const to = key(['benjamin', 'minime'], 'M', ['benjamin:M:-40', 'minime:M:-50']);
  const parts = keyParts(to, from, grid);
  expect(joined(parts)).toBe(categoryLabel(to, grid));
  expect(changed(parts)).toEqual(['Benjamins / Minimes', '-40 / -50 kg']);
});

test('keyParts : sexe et discipline', () => {
  const from = key(['cadet'], 'F', ['cadet:F:-54']);
  const to: CategoryKey = { ...key(['cadet'], 'X', ['cadet:F:-54']), discipline: 'shido-boxing' };
  expect(changed(keyParts(to, from, grid))).toEqual(['Shido-boxing', 'F/M']);
});

test('keyParts : sans autre clé, rien de changé', () => {
  expect(changed(keyParts(key(['cadet'], 'F', ['cadet:F:-54']), null, grid))).toEqual([]);
});

test('whyText : textes exacts, accordés', () => {
  expect(whyText({ kind: 'weight_out', weighInKg: 41, limitLabel: '-40', toleranceKg: 0.5 }, 'F')).toBe('Pesée à 41 kg : trop lourde pour -40 kg (tolérance 0,5 kg)');
  expect(whyText({ kind: 'weight_out', weighInKg: 45.3, limitLabel: '-45', toleranceKg: 0.3 }, 'M')).toBe('Pesé à 45,3 kg : trop lourd pour -45 kg (tolérance 0,3 kg)');
  expect(whyText({ kind: 'alone' }, 'F')).toBe('Seule dans sa catégorie');
  expect(whyText({ kind: 'alone' }, 'M')).toBe('Seul dans sa catégorie');
  expect(whyText({ kind: 'split', forLabel: 'ROUSSEAU Tom', forSex: 'M', forCategoryLabel: 'Karaté · Jiyu · Minimes M · -50 kg', count: 1 }, 'M'))
    .toBe('Donner un adversaire à ROUSSEAU Tom, seul en Karaté · Jiyu · Minimes M · -50 kg');
  expect(whyText({ kind: 'split', forLabel: 'LÉA', forSex: 'F', forCategoryLabel: 'X', count: 2 }, 'F')).toBe('Donner une poule à LÉA, seule en X');
  expect(whyText({ kind: 'return' }, 'M')).toBe('Retour dans sa catégorie d’origine (elle a de nouveau des combattants)');
  expect(whyText({ kind: 'closed' }, 'F')).toBe('Inscrite dans une catégorie fermée');
  expect(whyText({ kind: 'closed' }, 'M')).toBe('Inscrit dans une catégorie fermée');
  expect(whyText({ kind: 'manual' }, 'M')).toBe('Choisi à la main');
  expect(whyText({ kind: 'weight_gap' }, 'M')).toBe('Écart de poids trop grand dans sa catégorie');
});
