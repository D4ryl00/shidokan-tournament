import { expect, test } from 'vitest';
import { generateBracket } from '../../src/domain/brackets/index.js';
import { freeKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { defaultSettings } from '../../src/domain/settings.js';
import type { CategoryDurations } from '../../src/domain/schedule/durations.js';
import { matchTimings } from '../../src/web/matchTimings.js';

const settings = defaultSettings();
const grid = ffkDefaultGrid();
const entrants = [1, 2, 3, 4].map((i) => ({ registrationId: `e${i}`, clubId: null, label: `E${i}` }));
const combat = generateBracket('single_elimination', entrants, { repechage: false, thirdPlace: false, kataBronzeCount: 2 }, 1);
const semi1 = 'w1-0';
const finalId = 'w2-0';
const cat4 = (over: { durations: CategoryDurations | null }) => ({ key: freeKey('Démo', 'karate', 'jiyu'), bracket: combat, ...over });
const kataCat = { key: freeKey('Démo', 'kata', 'jiyu'), bracket: null, durations: null };

test('matchTimings : chaque combat, la finale avec sa durée de finale, une exception', () => {
  const t = matchTimings(cat4({ durations: { bracket: null, finals: { rounds: 3, roundSec: 120, restSec: 30, overtimeSec: 60 }, matches: { [semi1]: { rounds: 1, roundSec: 60, restSec: 0, overtimeSec: 0 } } } }), settings, grid);
  expect(t.get(semi1)).toBe('1 round de 1 min');
  expect(t.get(finalId)).toBe('3 rounds de 2 min · prolongation 1 min');
  expect(matchTimings(kataCat, settings, grid).size).toBe(0);
});
