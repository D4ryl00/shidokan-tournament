import { expect, test } from 'vitest';
import { ageMove } from '../../src/domain/ages.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const g = ffkDefaultGrid();

test.each([
  ['cadet', 'cadet', { kind: 'same' }],
  ['cadet', 'junior', { kind: 'C', crossesMinorAdult: false }],
  ['junior', 'senior', { kind: 'C', crossesMinorAdult: true }],
  ['junior', 'espoir', { kind: 'C', crossesMinorAdult: true }],
  ['senior', 'v1', { kind: 'D', crossesMinorAdult: false }],
  ['v3', 'v2', { kind: 'C', crossesMinorAdult: false }],
  ['junior', 'cadet', { kind: 'forbidden' }],
  ['minime', 'junior', { kind: 'forbidden' }],
  ['senior', 'v2', { kind: 'forbidden' }],
] as const)('ageMove(%s → %s)', (a, b, expected) => {
  expect(ageMove(g, a, b)).toEqual(expected);
});
