import { expect, test } from 'vitest';
import { defaultSchedule } from '../../src/domain/schedule/durations.js';
import { draftFromCompetition } from '../../src/web/components/categoryDurationsDraft.js';

const DEFAULT_SCHEDULE = defaultSchedule();
const base = { schedule: DEFAULT_SCHEDULE, triathlonRounds: 3 as const };

test('sans finale de compétition, le brouillon n’a pas de finale propre', () => {
  const d = draftFromCompetition(base, 'youth');
  expect(d.finals).toBeNull();
  expect(d.bracket).toEqual(DEFAULT_SCHEDULE.groups.youth);
});

test('avec une finale de compétition, le brouillon la reprend', () => {
  const finals = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 60 };
  const schedule = { ...DEFAULT_SCHEDULE, finals: { ...DEFAULT_SCHEDULE.finals, youth: finals } };
  expect(draftFromCompetition({ ...base, schedule }, 'youth').finals).toEqual(finals);
  expect(draftFromCompetition({ ...base, schedule }, 'adults').finals).toBeNull();
});
