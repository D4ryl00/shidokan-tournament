import { expect, test } from 'vitest';
import { activeMembers, categoryWeightGap, effectiveWeight, gapThreshold, overweightInCategory, weighInClass } from '../../../src/domain/replacement/weights.js';
import { makeState, member } from './fixtures.js';

const state = makeState([]);

test('poids effectif : pesée, sinon approx, sinon limite', () => {
  expect(effectiveWeight(member({ weighInKg: 55.2, approxWeightKg: 54 }), state.grid)).toBe(55.2);
  expect(effectiveWeight(member({ approxWeightKg: 54 }), state.grid)).toBe(54);
  expect(effectiveWeight(member(), state.grid)).toBe(54);
  expect(effectiveWeight(member({ weightClassId: 'cadet:F:+61' }), state.grid)).toBe(61);
  expect(effectiveWeight(member({ discipline: 'kata', ruleset: null, weightClassId: null }), state.grid)).toBeNull();
});

test('écart de poids et seuil enfants / adultes', () => {
  const ms = [member({ approxWeightKg: 50 }), member({ approxWeightKg: 54 }), member({ weighInKg: 55.2 })];
  expect(categoryWeightGap(ms, state.grid)).toBeCloseTo(5.2);
  expect(categoryWeightGap([ms[0]!], state.grid)).toBe(0);
  const s = makeState([], { settings: { ...state.settings, weightGapMaxKg: { children: 4, adults: 6 } } });
  expect(gapThreshold(ms, s)).toBe(4);
  expect(gapThreshold([member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55' })], s)).toBe(6);
});

test('catégorie du poids pesé, tolérance du sexe', () => {
  const m = (kg: number | null, sex: 'M' | 'F' = 'M', w = 'senior:M:-67') => member({ sex, ageBandCode: 'senior', weightClassId: w, weighInKg: kg });
  expect(weighInClass(m(67.3), state)?.label).toBe('-67');
  expect(weighInClass(m(67.31), state)?.label).toBe('-75');
  expect(weighInClass(m(55.5, 'F', 'senior:F:-55'), state)?.label).toBe('-55');
  expect(weighInClass(m(null), state)).toBeNull();
});

test('membres actifs : absents exclus', () => {
  const a = member();
  const b = member({ presence: 'absent' });
  const s = makeState([a, b]);
  expect(activeMembers(s, a.categoryId!).map((m) => m.registrationId)).toEqual([a.registrationId]);
});

test('réaffecté : trop lourd seulement au-delà de la catégorie la plus lourde de sa catégorie', () => {
  const m = member({ weightClassId: 'cadet:F:-47', placementLocked: true, presence: 'present', weighInKg: 52 });
  const s = makeState([m]);
  s.categories[0]!.key = { ...s.categories[0]!.key, weightClassIds: ['cadet:F:-47', 'cadet:F:-54'] };
  expect(overweightInCategory(m, s)).toBeNull();
  m.weighInKg = 58;
  expect(overweightInCategory(m, s)?.id).toBe('cadet:F:-61');
});
