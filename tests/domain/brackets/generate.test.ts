import { expect, test } from 'vitest';
import { compatibleFormats, defaultFormat, generateBracket } from '../../../src/domain/brackets/index.js';
import { defaultSettings } from '../../../src/domain/settings.js';
import { entrants } from './helpers.js';

const s = defaultSettings();
const opts = { repechage: false, thirdPlace: false, kataBronzeCount: 2 as const };

test('format par défaut selon le nombre', () => {
  expect(defaultFormat('karate', 2, s)).toBe('single_match');
  expect(defaultFormat('karate', 3, s)).toBe('round_robin');
  expect(defaultFormat('karate', 8, s)).toBe('single_elimination');
  expect(defaultFormat('kata', 8, s)).toBe('kata_two_rounds');
  expect(defaultFormat('karate', 4, { ...s, formats: { ...s.formats, fourPlus: 'pools_then_bracket' } })).toBe('single_elimination');
});

test('formats compatibles', () => {
  expect(compatibleFormats('karate', 2)).toContain('best_of_three');
  expect(compatibleFormats('karate', 3)).toContain('three_with_repechage');
  expect(compatibleFormats('karate', 4)).not.toContain('pools_then_bracket');
  expect(compatibleFormats('karate', 6)).toContain('pools_then_bracket');
  expect(compatibleFormats('kata', 5)).toEqual(['kata_two_rounds']);
});

test('reproductible avec la même graine, différent avec une autre', () => {
  const a = generateBracket('single_elimination', entrants(8), opts, 5);
  expect(generateBracket('single_elimination', entrants(8), opts, 5)).toEqual(a);
  expect(generateBracket('single_elimination', entrants(8), opts, 6)).not.toEqual(a);
});

test('kata', () => {
  const b = generateBracket('kata_two_rounds', entrants(4), opts, 1);
  expect(b.kind).toBe('kata');
});
