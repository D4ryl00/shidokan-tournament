import { expect, test } from 'vitest';
import { ZodError } from 'zod';
import { RULE_IDS, defaultSettings, mergeSettings, readStoredSettings } from '../../src/domain/settings.js';

test('réglages par défaut (spec §9.2, §8, §11.1, §12, §4.1)', () => {
  expect(defaultSettings()).toEqual({
    weightGapMaxKg: { children: 5, adults: 5 },
    weighInToleranceKg: { M: 0.3, F: 0.5 },
    mixMinorsAdults: false,
    mixSeniorsVeterans: true,
    mixSexes: { enabled: false, ageBandCodes: [] },
    shobuToJiyu: false,
    multipleCombatDisciplinesPerDay: false,
    formats: { two: 'single_match', three: 'round_robin', fourPlus: 'single_elimination' },
    repechage: false,
    thirdPlaceMatch: false,
    kataBronzeCount: 2,
    triathlonRounds: 3,
    passageOrder: 'rounds',
    finalsZoneId: null,
    kataFinalsOnFinalsZone: false,
    invitationMail: null,
    replacementRules: { order: [...RULE_IDS], off: [], cutAfter: 'discipline' },
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

test('réglages : liste par défaut, et lecture tolérante d’une compétition existante', () => {
  expect(defaultSettings().replacementRules).toEqual({ order: [...RULE_IDS], off: [], cutAfter: 'discipline' });
  expect(readStoredSettings({ mixSexes: { enabled: true, ageBandCodes: [] } }).replacementRules.cutAfter).toBe('discipline');
  expect(readStoredSettings({ replacementRules: { order: ['weight'], off: [], cutAfter: 'weight' } }).replacementRules).toEqual(defaultSettings().replacementRules);
});
