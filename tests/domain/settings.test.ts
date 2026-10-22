import { expect, test } from 'vitest';
import { ZodError } from 'zod';
import { defaultSettings, mergeSettings } from '../../src/domain/settings.js';

test('réglages par défaut (spec §9.2, §8, §11.1, §12, §4.1)', () => {
  expect(defaultSettings()).toEqual({
    weightGapMaxKg: { children: 5, adults: 5 },
    weighInToleranceKg: { M: 0.3, F: 0.5 },
    mixMinorsAdults: false,
    mixSeniorsVeterans: true,
    mixSexes: { enabled: false, ageBandCodes: [] },
    multipleCombatDisciplinesPerDay: false,
    formats: { two: 'single_match', three: 'round_robin', fourPlus: 'single_elimination' },
    repechage: false,
    thirdPlaceMatch: false,
    kataBronzeCount: 2,
    triathlonRounds: 3,
  });
});

test('fusion d’un objet partiel avec les défauts', () => {
  const s = mergeSettings({ repechage: true, weightGapMaxKg: { children: 3 } });
  expect(s.repechage).toBe(true);
  expect(s.weightGapMaxKg).toEqual({ children: 3, adults: 5 });
  expect(s.formats.three).toBe('round_robin');
});

test.each([
  [{ weightGapMaxKg: { children: -1 } }],
  [{ weighInToleranceKg: { M: 50 } }],
  [{ kataBronzeCount: 3 }],
  [{ triathlonRounds: 4 }],
  [{ formats: { two: 'inconnu' } }],
])('réglage invalide refusé : %j', (partial) => {
  expect(() => mergeSettings(partial)).toThrow(ZodError);
});
