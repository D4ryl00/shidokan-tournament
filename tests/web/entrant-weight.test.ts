import { expect, test } from 'vitest';
import { entrantWeight } from '../../src/web/labels.js';

test('pesé, sinon déclaré, sinon rien ; jamais en kata', () => {
  expect(entrantWeight({ discipline: 'karate', weighInKg: 68.5, approxWeightKg: 70 })).toBe('68,5 kg');
  expect(entrantWeight({ discipline: 'karate', weighInKg: null, approxWeightKg: 68 })).toBe('≈ 68 kg');
  expect(entrantWeight({ discipline: 'karate', weighInKg: null, approxWeightKg: null })).toBeNull();
  expect(entrantWeight({ discipline: 'kata', weighInKg: 60, approxWeightKg: 60 })).toBeNull();
});
