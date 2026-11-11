import { expect, test } from 'vitest';
import { ZodError } from 'zod';
import { RULE_IDS, defaultSettings, mergeSettings, readStoredSettings } from '../../src/domain/settings.js';
import { defaultSchedule } from '../../src/domain/schedule/durations.js';

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
    schedule: defaultSchedule(),
    invitationMail: null,
    clubFormAttachments: { pdf: true, ods: true },
    replacementRules: { order: [...RULE_IDS], off: [], cutAfter: 'discipline' },
  });
});

test('fiches club jointes au mail : les deux par défaut, aussi pour une compétition enregistrée avant ce réglage', () => {
  expect(readStoredSettings({}).clubFormAttachments).toEqual({ pdf: true, ods: true });
  expect(mergeSettings({ clubFormAttachments: { pdf: false } }).clubFormAttachments).toEqual({ pdf: false, ods: true });
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

test('mergeSettings : le message aux clubs est remplacé en entier, jamais fusionné', () => {
  const base = mergeSettings({ invitationMail: { subject: 'S', body: '<p>riche</p>', format: 'html' } });
  // Un message texte sur un message mis en forme : le format ne colle pas.
  expect(mergeSettings({ invitationMail: { subject: 'T', body: 'a < b' } }, base).invitationMail).toEqual({ subject: 'T', body: 'a < b' });
  // Un message partiel ne se complète pas avec l'ancien : il est invalide.
  expect(() => mergeSettings({ invitationMail: { body: '<p>x</p>', format: 'html' } }, base)).toThrow(ZodError);
  // Un autre réglage ne touche pas au message, et null le retire.
  expect(mergeSettings({ repechage: true }, base).invitationMail).toEqual(base.invitationMail);
  expect(mergeSettings({ invitationMail: null }, base).invitationMail).toBeNull();
});

test('zone des finales : plus dans les réglages (par session, onglet Finales)', () => {
  const stored = readStoredSettings({ finalsZoneId: 'z2', kataFinalsOnFinalsZone: true, repechage: true });
  expect(stored).not.toHaveProperty('finalsZoneId');
  expect(stored).not.toHaveProperty('kataFinalsOnFinalsZone');
  expect(stored.repechage).toBe(true);
  expect(() => mergeSettings({ finalsZoneId: 'z2' })).toThrow(ZodError);
});
