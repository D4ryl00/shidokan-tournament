import { expect, test } from 'vitest';
import { freeKey, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { readStoredSettings } from '../../src/domain/settings.js';
import {
  ageGroupOf, categoryDurationsSchema, combatTiming, defaultSchedule, fightSeconds, isEmptyDurations, kataPassages,
  minSecText, parseMinSec, timingLongText, timingText,
} from '../../src/domain/schedule/durations.js';

const s = { schedule: defaultSchedule(), triathlonRounds: 3 as const };
const three = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 };
const short = { rounds: 1, roundSec: 60, restSec: 0, overtimeSec: 0 };

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
  const t = combatTiming({ schedule: defaultSchedule(), triathlonRounds: 6 }, 'triathlon', null, null, false);
  expect(t.rounds).toBe(6);
  expect(fightSeconds(t)).toBe(6 * 120 + 5 * 60);
});
test('match beats bracket beats competition', () => {
  const d = { bracket: short, finals: null, matches: { final: three } };
  expect(combatTiming(s, 'adults', d, 'final', false)).toEqual(three);
  expect(combatTiming(s, 'adults', d, 'm1', false)).toEqual(short);
  expect(combatTiming(s, 'adults', null, 'm1', false)).toEqual(defaultSchedule().groups.adults);
  // tableau en 6 rounds imposé : le réglage du triathlon ne l'écrase pas
  expect(combatTiming({ ...s, triathlonRounds: 6 }, 'triathlon', { bracket: three, finals: null, matches: {} }, null, false).rounds).toBe(3);
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

const fin = { rounds: 4, roundSec: 90, restSec: 30, overtimeSec: 60 };

test('defaults have no finals duration', () => {
  expect(defaultSchedule().finals).toEqual({ under14: null, youth: null, adults: null, triathlon: null });
});
test('finals precedence: match, bracket finals, bracket, competition finals, group', () => {
  const comp = { ...s, schedule: { ...s.schedule, finals: { ...s.schedule.finals, adults: fin } } };
  expect(combatTiming(comp, 'adults', null, 'w2-0', true)).toEqual(fin);
  expect(combatTiming(comp, 'adults', null, 'w1-0', false)).toEqual(defaultSchedule().groups.adults);
  expect(combatTiming(comp, 'youth', null, 'w2-0', true)).toEqual(defaultSchedule().groups.youth); // autre groupe : pas de finale propre
  expect(combatTiming(comp, 'adults', { bracket: short, finals: null, matches: {} }, 'w2-0', true)).toEqual(short); // tableau « Autre » sans finale propre
  expect(combatTiming(comp, 'adults', { bracket: short, finals: three, matches: {} }, 'w2-0', true)).toEqual(three);
  expect(combatTiming(comp, 'adults', { bracket: short, finals: three, matches: {} }, 'w1-0', false)).toEqual(short);
  expect(combatTiming(comp, 'adults', { bracket: short, finals: three, matches: { 'w2-0': fin } }, 'w2-0', true)).toEqual(fin);
});
test('triathlon finals keep their own rounds', () => {
  const two = { rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 120 };
  const comp = { schedule: { ...defaultSchedule(), finals: { ...defaultSchedule().finals, triathlon: two } }, triathlonRounds: 6 as const };
  expect(combatTiming(comp, 'triathlon', null, 'w2-0', true).rounds).toBe(2);
  expect(combatTiming(comp, 'triathlon', null, 'w1-0', false).rounds).toBe(6);
});
test('stored data from before finals stays readable', () => {
  const old = { groups: defaultSchedule().groups, changeoverSec: 60, kataPassageSec: 90 };
  expect(readStoredSettings({ schedule: old }).schedule.finals).toEqual(defaultSchedule().finals);
  expect(readStoredSettings({ schedule: { ...old, groups: { ...old.groups, adults: three } } }).schedule.groups.adults).toEqual(three);
  expect(categoryDurationsSchema.parse({ bracket: short, matches: {} })).toEqual({ bracket: short, finals: null, matches: {} });
  expect(readStoredSettings({ schedule: { finals: { adults: fin } } }).schedule.finals.adults).toEqual(fin);
});
test('empty durations', () => {
  expect(isEmptyDurations({ bracket: null, finals: null, matches: {} })).toBe(true);
  expect(isEmptyDurations({ bracket: null, finals: fin, matches: {} })).toBe(false);
});
test('timingLongText : rounds, durée, prolongation', () => {
  expect(timingLongText({ rounds: 2, roundSec: 120, restSec: 30, overtimeSec: 60 })).toBe('2 rounds de 2 min · prolongation 1 min');
  expect(timingLongText({ rounds: 1, roundSec: 180, restSec: 0, overtimeSec: 0 })).toBe('1 round de 3 min');
  expect(timingLongText({ rounds: 3, roundSec: 90, restSec: 30, overtimeSec: 45 })).toBe('3 rounds de 1 min 30 · prolongation 45 s');
});
