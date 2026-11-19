import { expect, test } from 'vitest';
import { clockToSeconds, isoToDaySeconds, nowOnDay, secondsToClock, secondsToDuration } from '../../src/domain/schedule/clock.js';

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

test('durations in French: minutes under an hour, « 2 h 30 » above, rounded to the minute', () => {
  expect(secondsToDuration(0)).toBe('0 min');
  expect(secondsToDuration(45 * 60 + 20)).toBe('45 min');
  expect(secondsToDuration(59 * 60 + 40)).toBe('1 h');
  expect(secondsToDuration(2 * 3600 + 30 * 60)).toBe('2 h 30');
  expect(secondsToDuration(9 * 3600 + 5 * 60)).toBe('9 h 05');
});
