import { expect, test } from 'vitest';
import { applyRulesView, rulesView } from '../../src/domain/replacement/rules.js';
import { defaultSettings, mergeSettings } from '../../src/domain/settings.js';
import { settingsPatch } from '../../src/web/settingsPatch.js';

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
