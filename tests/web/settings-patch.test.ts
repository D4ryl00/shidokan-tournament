import { expect, test } from 'vitest';
import { applyRulesView, rulesView } from '../../src/domain/replacement/rules.js';
import { defaultSettings, mergeSettings } from '../../src/domain/settings.js';
import { queriesAfterCompetitionPatch, settingsPatch } from '../../src/web/settingsPatch.js';

test('réglages : seuls les changements de la page partent, jamais la liste des règles', () => {
  const loaded = defaultSettings();
  const edited = { ...loaded, shobuToJiyu: true, mixSexes: { ...loaded.mixSexes, ageBandCodes: ['cadet'] }, replacementRules: { ...loaded.replacementRules, cutAfter: 'weight' as const } };
  expect(settingsPatch(loaded, edited)).toEqual({ shobuToJiyu: true, mixSexes: { ageBandCodes: ['cadet'] } });
  expect(settingsPatch(loaded, loaded)).toEqual({});

  // Entre-temps, la Table centrale a rangé la liste et activé le mélange filles / garçons dans Réaffectation.
  const view = rulesView(loaded);
  const table = applyRulesView(loaded, { ...view, order: ['return', 'ageUp', ...view.order.filter((r) => r !== 'return' && r !== 'ageUp')], cutAfter: 'ageUp', on: { ...view.on, mixSexes: true } });
  const saved = mergeSettings(settingsPatch(loaded, edited), table);
  expect(saved.replacementRules).toEqual(table.replacementRules);
  expect(saved.mixSexes).toEqual({ enabled: true, ageBandCodes: ['cadet'] });
  expect(saved.shobuToJiyu).toBe(true);
});

test('après modification de la compétition : cocher une fiche club ne recharge que la compétition', () => {
  expect(queriesAfterCompetitionPatch('c1', { settings: { clubFormAttachments: { pdf: false } } })).toEqual([['competitions']]);
  const all = [['competitions'], ['categories', 'c1'], ['schedule', 'c1']];
  expect(queriesAfterCompetitionPatch('c1', { settings: { shobuToJiyu: true } })).toEqual(all);
  expect(queriesAfterCompetitionPatch('c1', { settings: { clubFormAttachments: { pdf: false }, shobuToJiyu: true } })).toEqual(all);
  expect(queriesAfterCompetitionPatch('c1', { date: '2026-12-01' })).toEqual(all);
});

test('réglages : une finale modifiée part en entier, même si un autre poste l’a remise à « comme les autres »', () => {
  const loaded = defaultSettings();
  const t = { rounds: 3, roundSec: 120, restSec: 30, overtimeSec: 60 };
  const a = { ...loaded, schedule: { ...loaded.schedule, finals: { ...loaded.schedule.finals, adults: t } } };
  const edited = { ...a, schedule: { ...a.schedule, finals: { ...a.schedule.finals, adults: { ...t, rounds: 4 } } } };
  // Chargée comme une durée : le poste envoie la durée entière, pas la seule feuille « rounds ».
  expect(settingsPatch(a, edited)).toEqual({ schedule: { finals: { adults: { ...t, rounds: 4 } } } });
  // Passée à « comme les autres » : null.
  expect(settingsPatch(a, { ...a, schedule: { ...a.schedule, finals: { ...a.schedule.finals, adults: null } } })).toEqual({ schedule: { finals: { adults: null } } });
  // Autre poste : null entre-temps ; la feuille seule serait rejetée, la durée entière s’applique.
  const saved = mergeSettings(settingsPatch(a, edited), loaded);
  expect(saved.schedule.finals.adults).toEqual({ ...t, rounds: 4 });
});
