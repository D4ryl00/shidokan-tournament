import { expect, test } from 'vitest';
import type { CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { validateWaves, WAVE_NONE, waveConflicts, waveOfCategory, type Wave } from '../../src/domain/waves.js';

const grid = ffkDefaultGrid();
const key = (ageBandCodes: string[], discipline: CategoryKey['discipline'] = 'karate'): CategoryKey => ({
  discipline, ruleset: discipline === 'kata' ? null : 'jiyu', sex: 'F', ageBandCodes, weightClassIds: [],
});
const wave = (id: string, order: number, ageBandCodes: string[], disciplines: Wave['rules']['disciplines'] = []): Wave => ({
  id, name: id, order, rules: { ageBandCodes, disciplines }, weighInClosed: false,
});
const MATIN = wave('matin', 0, ['poussin', 'pupille', 'benjamin', 'minime']);
const APREM = wave('aprem', 1, ['cadet', 'junior', 'senior', 'v1', 'v2', 'v3', 'v4', 'v5']);

test('règle : tranche la plus jeune', () => {
  expect(waveOfCategory({ key: key(['cadet', 'minime']), waveOverride: null }, [MATIN, APREM], grid)).toBe('matin');
  expect(waveOfCategory({ key: key(['senior']), waveOverride: null }, [MATIN, APREM], grid)).toBe('aprem');
  expect(waveOfCategory({ key: key(['espoir']), waveOverride: null }, [MATIN, APREM], grid)).toBeNull();
});

test('règle : discipline', () => {
  const kata = wave('kata', 0, [], ['kata']);
  const waves = [kata, { ...MATIN, order: 1 }, { ...APREM, order: 2 }];
  expect(waveOfCategory({ key: key(['senior'], 'kata'), waveOverride: null }, waves, grid)).toBe('kata');
  expect(waveOfCategory({ key: key(['minime'], 'kata'), waveOverride: null }, waves, grid)).toBe('kata');
  expect(waveOfCategory({ key: key(['minime']), waveOverride: null }, waves, grid)).toBe('matin');
});

test('règle vide : ne prend rien d’office', () => {
  expect(waveOfCategory({ key: key(['cadet']), waveOverride: null }, [wave('vide', 0, [])], grid)).toBeNull();
});

test('choix individuel prioritaire', () => {
  expect(waveOfCategory({ key: key(['minime']), waveOverride: 'aprem' }, [MATIN, APREM], grid)).toBe('aprem');
  expect(waveOfCategory({ key: key(['minime']), waveOverride: WAVE_NONE }, [MATIN, APREM], grid)).toBeNull();
  expect(waveOfCategory({ key: key(['minime']), waveOverride: 'disparue' }, [MATIN, APREM], grid)).toBe('matin');
});

test('ordre des vagues : la première qui correspond', () => {
  const both = wave('tout', 2, ['cadet']);
  expect(waveOfCategory({ key: key(['cadet']), waveOverride: null }, [both, APREM, MATIN], grid)).toBe('aprem');
});

test('conflits : catégorie couverte par deux vagues', () => {
  const large = wave('large', 2, ['cadet']);
  const cats = [{ id: 'c1', key: key(['cadet']), waveOverride: null }, { id: 'c2', key: key(['minime']), waveOverride: null }, { id: 'c3', key: key(['cadet']), waveOverride: 'large' }];
  expect(waveConflicts(cats, [MATIN, APREM, large], grid)).toEqual([{ categoryId: 'c1', waveIds: ['aprem', 'large'] }]);
});

test('validation des vagues', () => {
  const r = { ageBandCodes: [], disciplines: [] };
  expect(validateWaves([])).toEqual([]);
  expect(validateWaves([{ name: ' ', rules: r }])).toEqual(['Une vague n’a pas de nom.']);
  expect(validateWaves([{ name: 'Matin', rules: r }, { name: ' matin ', rules: r }])).toEqual(['Deux vagues portent le même nom : « Matin ».']);
  expect(validateWaves(Array.from({ length: 21 }, (_, i) => ({ name: `V${i}`, rules: r })))).toEqual(['Pas plus de 20 vagues.']);
  expect(validateWaves([{ id: 'w', name: 'A', rules: r }, { id: 'w', name: 'B', rules: r }])).toEqual(['La même vague apparaît deux fois dans la liste.']);
});
