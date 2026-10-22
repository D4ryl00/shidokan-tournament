import { expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { validateGrid, weightClassesFor } from '../../src/domain/grid.js';
import type { Sex } from '../../src/domain/types.js';

const g = ffkDefaultGrid();
const labels = (age: string, sex: Sex) => weightClassesFor(g, age, sex).map((w) => w.label);

test('tranches d’âge FFK dans l’ordre', () => {
  expect(g.ageBands.map((b) => b.code)).toEqual([
    'mini-poussin', 'poussin', 'pupille', 'benjamin', 'minime', 'cadet', 'junior',
    'espoir', 'senior', 'v1', 'v2', 'v3', 'v4', 'v5',
  ]);
  expect(g.ageBands.filter((b) => b.isMinor).map((b) => b.code)).toEqual([
    'mini-poussin', 'poussin', 'pupille', 'benjamin', 'minime', 'cadet', 'junior',
  ]);
});

test('poids — jeunes', () => {
  expect(labels('poussin', 'F')).toEqual(['-25', '-35', '+35']);
  expect(labels('mini-poussin', 'M')).toEqual(['-25', '-35', '+35']);
  expect(labels('pupille', 'M')).toEqual(['-25', '-30', '-35', '-40', '-45', '-50', '+50']);
  expect(labels('pupille', 'F')).toEqual(['-25', '-30', '-35', '-40', '-45', '+45']);
  expect(labels('benjamin', 'F')).toEqual(['-30', '-35', '-40', '-45', '-50', '+50']);
  expect(labels('benjamin', 'M')).toEqual(['-30', '-35', '-40', '-45', '-50', '-55', '+55']);
  expect(labels('minime', 'M')).toEqual(['-35', '-40', '-45', '-50', '-55', '-60', '-65', '+65']);
  expect(labels('minime', 'F')).toEqual(['-35', '-40', '-45', '-50', '-55', '+55']);
  expect(labels('cadet', 'F')).toEqual(['-47', '-54', '-61', '+61']);
  expect(labels('cadet', 'M')).toEqual(['-52', '-57', '-63', '-70', '+70']);
  expect(labels('junior', 'M')).toEqual(['-55', '-61', '-68', '-76', '+76']);
  expect(labels('junior', 'F')).toEqual(['-48', '-53', '-59', '-66', '+66']);
});

test('poids — adultes et vétérans', () => {
  expect(labels('senior', 'F')).toEqual(['-50', '-55', '-61', '-68', '+68']);
  expect(labels('espoir', 'M')).toEqual(['-60', '-67', '-75', '-84', '+84']);
  for (const v of ['v1', 'v2', 'v3', 'v4', 'v5']) {
    expect(labels(v, 'M')).toEqual(['-67', '-75', '-84', '+84']);
    expect(labels(v, 'F')).toEqual(['-55', '-61', '-68', '+68']);
  }
});

test('liens d’âge par défaut (spec §4.3)', () => {
  const k = (from: string, to: string) => g.ageLinks.find((l) => l.from === from && l.to === to)?.kind;
  expect(k('cadet', 'junior')).toBe('C');
  expect(k('junior', 'espoir')).toBe('C');
  expect(k('junior', 'senior')).toBe('C');
  expect(k('espoir', 'senior')).toBe('C');
  expect(k('senior', 'v1')).toBe('D');
  expect(k('v1', 'senior')).toBe('D');
  expect(k('v2', 'v1')).toBe('C');
  expect(k('v1', 'v2')).toBe('C');
  expect(k('junior', 'cadet')).toBeUndefined();
  expect(k('minime', 'junior')).toBeUndefined();
});

test('la grille FFK est valide', () => {
  expect(validateGrid(g)).toEqual([]);
});

test('chaque appel renvoie une copie indépendante', () => {
  const a = ffkDefaultGrid();
  a.weightClasses[0]!.label = 'modifié';
  expect(ffkDefaultGrid().weightClasses[0]!.label).not.toBe('modifié');
});
