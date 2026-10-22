import { expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { weightClassesFor } from '../../src/domain/grid.js';
import { neighborWeightClasses, parseWeightLabel, weightClassForWeight } from '../../src/domain/weights.js';

test.each([
  ['-35', '-35', 35], [-35, '-35', 35], ['-35 kg', '-35', 35], [' -35 ', '-35', 35], ['-47,5', '-47.5', 47.5],
  ['−35', '-35', 35], ['–35 kg', '-35', 35], ['+84', '+84', null], ['84+', '+84', null], ['84 kg et +', '+84', null], ['+84 kg', '+84', null], ['84 et +', '+84', null],
] as const)('parseWeightLabel(%s)', (raw, label, maxKg) => {
  expect(parseWeightLabel(raw)).toEqual({ label, maxKg });
});

test.each(['', 'lourd', 'abc', '-', '+'])('parseWeightLabel(%s) → null', (raw) => {
  expect(parseWeightLabel(raw)).toBeNull();
});

const g = ffkDefaultGrid();

test('catégorie selon le poids réel, tolérance FFK', () => {
  expect(weightClassForWeight(g, 'senior', 'M', 66.9, 0.3)?.label).toBe('-67');
  expect(weightClassForWeight(g, 'senior', 'M', 67.3, 0.3)?.label).toBe('-67');
  expect(weightClassForWeight(g, 'senior', 'M', 67.31, 0.3)?.label).toBe('-75');
  expect(weightClassForWeight(g, 'senior', 'F', 55.5, 0.5)?.label).toBe('-55');
  expect(weightClassForWeight(g, 'senior', 'M', 120, 0.3)?.label).toBe('+84');
});

test('tranche inconnue → null', () => {
  expect(weightClassForWeight(g, 'inconnue', 'M', 50, 0.3)).toBeNull();
});

test('catégories voisines', () => {
  const f = weightClassesFor(g, 'cadet', 'F');
  expect(neighborWeightClasses(g, f[0]!)).toMatchObject({ lighter: null, heavier: { label: '-54' } });
  expect(neighborWeightClasses(g, f[3]!)).toMatchObject({ lighter: { label: '-61' }, heavier: null });
});

test('ancienne catégorie ouverte « +45 » après ajout de -50 → -50 avec remarque', async () => {
  const { mergeWeightClasses } = await import('../../src/domain/grid.js');
  const { resolveWeightCell } = await import('../../src/domain/weights.js');
  const merged = mergeWeightClasses(g, [{ id: 'pupille:F:-50', ageBandCode: 'pupille', sex: 'F', label: '-50', maxKg: 50, sortOrder: 0 }]);
  const res = resolveWeightCell(merged, 'pupille', 'F', '+45');
  expect(res).toMatchObject({ kind: 'ok', weightClass: { label: '-50' } });
  if (res.kind === 'ok') expect(res.warning).toContain('+45');
  expect(resolveWeightCell(merged, 'pupille', 'F', '+60')).toMatchObject({ kind: 'unknown' });
});

test.each(['‑35', '﹣35', '－35'])('tirets exotiques (%s) lus comme « - »', (raw) => {
  expect(parseWeightLabel(raw)).toEqual({ label: '-35', maxKg: 35 });
});
