import { expect, test } from 'vitest';
import { clockToSeconds, isoToDaySeconds, nowOnDay, secondsToClock } from '../../src/domain/schedule/clock.js';

test('isoToDaySeconds uses Paris winter offset', () => {
  expect(isoToDaySeconds('2026-11-22T08:41:00.000Z', '2026-11-22')).toBe(9 * 3600 + 41 * 60);
  expect(isoToDaySeconds('2026-06-14T07:30:00Z', '2026-06-14')).toBe(9 * 3600 + 30 * 60);
});

test('isoToDaySeconds gives out-of-range values for another day, null for garbage', () => {
  expect(isoToDaySeconds('2026-11-21T08:00:00Z', '2026-11-22')).toBeLessThan(0);
  expect(isoToDaySeconds('2026-11-23T08:00:00Z', '2026-11-22')).toBeGreaterThanOrEqual(86400);
  expect(isoToDaySeconds('pas une date', '2026-11-22')).toBeNull();
});

test('now is null on another day', () => {
  expect(nowOnDay(new Date('2026-11-21T10:00:00Z'), '2026-11-22')).toBeNull();
  expect(nowOnDay(new Date('2026-11-22T10:00:00Z'), '2026-11-22')).toBe(11 * 3600);
});

test('clock round trip', () => {
  expect(clockToSeconds('09:30')).toBe(34200);
  expect(secondsToClock(34200 + 29)).toBe('9:30');
  expect(secondsToClock(34200 + 30)).toBe('9:31');
  expect(secondsToClock(14 * 3600)).toBe('14:00');
});
