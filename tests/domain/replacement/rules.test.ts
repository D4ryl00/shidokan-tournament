import { expect, test } from 'vitest';
import { RULE_IDS, defaultSettings, type RuleId } from '../../../src/domain/settings.js';
import { allowedAt, applyRulesView, costBand, isRuleOn, ruleRank, rulesView } from '../../../src/domain/replacement/rules.js';

test('interrupteurs : les quatre mélanges sont les réglages existants', () => {
  const s = defaultSettings();
  expect(RULE_IDS.filter((r) => !isRuleOn(s, r))).toEqual(['shobuToJiyu', 'mixSexes', 'minorsAdults']);
  const t = applyRulesView(s, { ...rulesView(s), on: { ...rulesView(s).on, minorsAdults: true, ageDown: false, return: false } });
  expect([t.mixMinorsAdults, t.replacementRules.off, isRuleOn(t, 'return')]).toEqual([true, ['ageDown'], true]);
});

test('rang : jiyu préféré pour un shobu qui l’accepte en priorité', () => {
  const s = defaultSettings();
  expect([ruleRank(s, 'discipline', { ruleset: 'jiyu', acceptsJiyuFirst: null }), ruleRank(s, 'shobuToJiyu', { ruleset: 'jiyu', acceptsJiyuFirst: null })]).toEqual([7, 8]);
  expect([ruleRank(s, 'discipline', { ruleset: 'shobu', acceptsJiyuFirst: true }), ruleRank(s, 'shobuToJiyu', { ruleset: 'shobu', acceptsJiyuFirst: true })]).toEqual([8, 7]);
});

test('règles permises jusqu’à une ligne, et bandes de coût', () => {
  const s = defaultSettings();
  expect([...allowedAt(s, 'ageUp')]).toEqual(['return', 'weight', 'split', 'weightGap', 'ageUp']);
  // À valider au-dessus de la ligne : weightGap, ageUp, ageDown, seniorsVeterans, discipline (5).
  expect(['weightGap', 'ageUp', 'ageDown', 'seniorsVeterans', 'discipline'].map((r) => costBand(s, r as RuleId, true))).toEqual([1, 1, 2, 3, 4]);
  expect([costBand(s, 'weight', false), costBand(s, 'mixSexes', true), costBand(s, null, true)]).toEqual([0, 4, 4]);
});
