import { expect, test } from 'vitest';
import { freeKey, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { readStoredSettings } from '../../src/domain/settings.js';
import {
  ageGroupOf, combatTiming, defaultSchedule, fightSeconds, kataPassages, minSecText, parseMinSec, timingText,
} from '../../src/domain/schedule/durations.js';

const key = (p: Partial<CategoryKey>): CategoryKey => ({
  discipline: 'karate', ruleset: 'jiyu', sex: 'M', ageBandCodes: [], weightClassIds: [], ...p,
});

test('defaults follow the rulebook', () => {
  const s = defaultSchedule();
  expect(s.groups.under14).toEqual({ rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 });
  expect(s.groups.youth).toEqual({ rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 60 });
  expect(s.groups.adults).toEqual({ rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 120 });
  expect(s.groups.triathlon).toEqual({ rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 });
  expect(s.changeoverSec).toBe(60);
  expect(s.kataPassageSec).toBe(90);
});
test('age group comes from the highest band of the key', () => {
  // grille FFK : minime 12–13, cadet 14–15, junior 16–17, senior 18–34, v5 sans borne
  expect(ageGroupOf(key({ ageBandCodes: ['minime'] }), ffkDefaultGrid())).toBe('under14');
  expect(ageGroupOf(key({ ageBandCodes: ['minime', 'cadet'] }), ffkDefaultGrid())).toBe('youth');
  expect(ageGroupOf(key({ ageBandCodes: ['junior'] }), ffkDefaultGrid())).toBe('youth');
  expect(ageGroupOf(key({ ageBandCodes: ['senior'] }), ffkDefaultGrid())).toBe('adults');
  expect(ageGroupOf(key({ ageBandCodes: ['v5'] }), ffkDefaultGrid())).toBe('adults');
  expect(ageGroupOf(key({ discipline: 'triathlon', ageBandCodes: ['minime'] }), ffkDefaultGrid())).toBe('triathlon');
});
test('free tableau is adults', () => {
  expect(ageGroupOf(freeKey('Démo', 'karate', 'jiyu'), ffkDefaultGrid())).toBe('adults');
});
test('triathlon rounds follow the setting', () => {
  const t = combatTiming({ schedule: defaultSchedule(), triathlonRounds: 6 }, 'triathlon', null, null);
  expect(t.rounds).toBe(6);
  expect(fightSeconds(t)).toBe(6 * 120 + 5 * 60);
});
test('match beats bracket beats competition', () => {
  const s = { schedule: defaultSchedule(), triathlonRounds: 3 as const };
  const three = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 };
  const short = { rounds: 1, roundSec: 60, restSec: 0, overtimeSec: 0 };
  const d = { bracket: short, matches: { final: three } };
  expect(combatTiming(s, 'adults', d, 'final')).toEqual(three);
  expect(combatTiming(s, 'adults', d, 'm1')).toEqual(short);
  expect(combatTiming(s, 'adults', null, 'm1')).toEqual(defaultSchedule().groups.adults);
  // tableau en 6 rounds imposé : le réglage du triathlon ne l'écrase pas
  expect(combatTiming({ ...s, triathlonRounds: 6 }, 'triathlon', { bracket: three, matches: {} }, null).rounds).toBe(3);
});
test('fight seconds and texts', () => {
  expect(fightSeconds({ rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 })).toBe(210);
  expect(timingText({ rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 })).toBe('2 × 1 min 30');
  expect(timingText({ rounds: 1, roundSec: 120, restSec: 0, overtimeSec: 0 })).toBe('1 × 2 min');
  expect(minSecText(30)).toBe('30 s');
  expect(minSecText(65)).toBe('1 min 05');
  expect(parseMinSec('1:30')).toBe(90);
  expect(parseMinSec('2')).toBe(120); // minutes seules
  expect(parseMinSec('0:45')).toBe(45);
  expect(parseMinSec('1:75')).toBeNull();
  expect(parseMinSec('abc')).toBeNull();
  // Secondes toujours sur deux chiffres : « 1:5 » est ambigu (5 s ou 50 s), donc refusé.
  expect(parseMinSec('1:5')).toBeNull();
  expect(parseMinSec('1:05')).toBe(65);
  expect(parseMinSec('1:50')).toBe(110);
  expect(parseMinSec('1:7x')).toBeNull();
});
test('kata passages', () => {
  expect(kataPassages(5, 'whole')).toBe(7); // tour 1 (5) + finale (2)
  expect(kataPassages(2, 'whole')).toBe(2); // deux katakas : finale seule
  expect(kataPassages(5, 'tour1')).toBe(5);
  expect(kataPassages(5, 'finale')).toBe(2);
  expect(kataPassages(1, 'finale')).toBe(1);
});
test('stored settings without schedule fall back to defaults', () => {
  expect(readStoredSettings({}).schedule).toEqual(defaultSchedule());
  expect(readStoredSettings({ schedule: { changeoverSec: -5 } }).schedule).toEqual(defaultSchedule());
});
