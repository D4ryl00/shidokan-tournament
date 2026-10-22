import { expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { mergeWeightClasses, validateGrid, weightClassesFor } from '../../src/domain/grid.js';

test('code de tranche d’âge en double', () => {
  const g = ffkDefaultGrid();
  g.ageBands.push({ ...g.ageBands[0]! });
  expect(validateGrid(g).some((e) => e.includes('en double'))).toBe(true);
});

test('deux poids max identiques pour une même tranche et un même sexe', () => {
  const g = ffkDefaultGrid();
  const wc = g.weightClasses.find((w) => w.ageBandCode === 'senior' && w.sex === 'M' && w.maxKg === 60)!;
  g.weightClasses.push({ ...wc, label: '-60 bis', sortOrder: 99 });
  expect(validateGrid(g).length).toBeGreaterThan(0);
});

test('aucune catégorie ouverte', () => {
  const g = ffkDefaultGrid();
  g.weightClasses = g.weightClasses.filter((w) => !(w.ageBandCode === 'cadet' && w.sex === 'F' && w.maxKg === null));
  expect(validateGrid(g).some((e) => e.includes('Cadets'))).toBe(true);
});

test('plusieurs catégories ouvertes', () => {
  const g = ffkDefaultGrid();
  g.weightClasses.push({ id: 'x', ageBandCode: 'cadet', sex: 'F', label: '+70', maxKg: null, sortOrder: 99 });
  expect(validateGrid(g).length).toBeGreaterThan(0);
});

test('lien d’âge vers une tranche inexistante', () => {
  const g = ffkDefaultGrid();
  g.ageLinks.push({ from: 'senior', to: 'v9', kind: 'D' });
  expect(validateGrid(g).some((e) => e.includes('v9'))).toBe(true);
});

test('catégorie de poids rattachée à une tranche inexistante', () => {
  const g = ffkDefaultGrid();
  g.weightClasses.push({ id: 'y', ageBandCode: 'inconnue', sex: 'M', label: '-30', maxKg: 30, sortOrder: 1 });
  expect(validateGrid(g).some((e) => e.includes('inconnue'))).toBe(true);
});

test('libellé incohérent avec le poids max', () => {
  const g = ffkDefaultGrid();
  const wc = g.weightClasses.find((w) => w.ageBandCode === 'senior' && w.sex === 'M' && w.maxKg === 60)!;
  wc.maxKg = 50;
  expect(validateGrid(g).some((e) => e.includes('-60'))).toBe(true);
});

test('la catégorie ouverte doit porter la limite la plus haute', () => {
  const g = ffkDefaultGrid();
  g.weightClasses.push({ id: 'nouvelle', ageBandCode: 'poussin', sex: 'F', label: '-40', maxKg: 40, sortOrder: 9 });
  expect(validateGrid(g).some((e) => e.includes('+35') && e.includes('+40'))).toBe(true);
});

test('identifiants de catégories de poids uniques', () => {
  const g = ffkDefaultGrid();
  expect(new Set(g.weightClasses.map((w) => w.id)).size).toBe(g.weightClasses.length);
  g.weightClasses[1]!.id = g.weightClasses[0]!.id;
  expect(validateGrid(g).some((e) => e.includes('identifiant'))).toBe(true);
});

test('ajout de catégories : ordre recalculé, catégorie ouverte renommée si besoin', () => {
  const merged = mergeWeightClasses(ffkDefaultGrid(), [
    { id: 'pupille:F:-50', ageBandCode: 'pupille', sex: 'F', label: '-50', maxKg: 50, sortOrder: 0 },
    { id: 'poussin:F:-20', ageBandCode: 'poussin', sex: 'F', label: '-20', maxKg: 20, sortOrder: 0 },
  ]);
  expect(validateGrid(merged)).toEqual([]);
  expect(weightClassesFor(merged, 'pupille', 'F').map((w) => w.label)).toEqual(['-25', '-30', '-35', '-40', '-45', '-50', '+50']);
  expect(weightClassesFor(merged, 'pupille', 'F').at(-1)!.id).toBe('pupille:F:+45'); // même identifiant
  expect(weightClassesFor(merged, 'poussin', 'F').map((w) => [w.label, w.sortOrder])).toEqual([['-20', 0], ['-25', 1], ['-35', 2], ['+35', 3]]);
});

test('âge minimum supérieur à l’âge maximum', () => {
  const g = ffkDefaultGrid();
  g.ageBands[0]!.minAge = 9;
  expect(validateGrid(g).some((e) => e.includes('âge'))).toBe(true);
});

test('passage d’âge en double', () => {
  const g = ffkDefaultGrid();
  g.ageLinks.push({ ...g.ageLinks[0]! });
  expect(validateGrid(g).some((e) => e.includes('double'))).toBe(true);
});

test('relecture (mineurs) : au moins une tranche proposée sur la fiche club', () => {
  const g = ffkDefaultGrid();
  const errors = validateGrid({ ...g, ageBands: g.ageBands.map((b) => ({ ...b, onClubForm: false })) });
  expect(errors).toContain("Au moins une tranche d'âge doit être proposée sur la fiche club.");
});
