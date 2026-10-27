import { expect, test } from 'vitest';
import { RULE_IDS, defaultSettings, isValidRuleOrder, type RuleId } from '../../../src/domain/settings.js';
import { ffkDefaultGrid } from '../../../src/domain/grid-ffk.js';
import { PRE_APPROVAL_RULES, allowedAt, applyRulesView, costBand, isRuleOn, ruleNumber, ruleRank, rulesView, rulesViewSchema, withAllRules } from '../../../src/domain/replacement/rules.js';

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

test('withAllRules : tout actif, toutes les tranches ouvertes au mélange filles / garçons', () => {
  const grid = ffkDefaultGrid();
  const s = defaultSettings();
  s.replacementRules.off = ['ageDown', 'weightGap'];
  const t = withAllRules(s, grid);
  expect(RULE_IDS.every((r) => isRuleOn(t, r))).toBe(true);
  expect(t.mixSexes).toEqual({ enabled: true, ageBandCodes: grid.ageBands.map((b) => b.code) });
  // L'ordre et la ligne de coupure restent ceux des réglages.
  expect([t.replacementRules.order, t.replacementRules.cutAfter]).toEqual([s.replacementRules.order, s.replacementRules.cutAfter]);
  expect(s.replacementRules.off).toEqual(['ageDown', 'weightGap']);
});

test('ordre des règles : permutation commençant par « return », sinon refusé', () => {
  const ok = [...RULE_IDS];
  expect(isValidRuleOrder(ok)).toBe(true);
  expect(isValidRuleOrder(['weight', 'return', ...ok.slice(2)])).toBe(false);
  expect(isValidRuleOrder(ok.slice(0, -1))).toBe(false);
  expect(isValidRuleOrder([...ok.slice(0, -1), 'weight'])).toBe(false);
  const view = rulesView(defaultSettings());
  expect(rulesViewSchema.safeParse(view).success).toBe(true);
  expect(rulesViewSchema.safeParse({ ...view, order: ['weight', 'return', ...ok.slice(2)] }).success).toBe(false);
  expect(rulesViewSchema.safeParse({ ...view, on: { ...view.on, return: false } }).success).toBe(false);
  expect(rulesViewSchema.safeParse({ ...view, cutAfter: 'inconnue' }).success).toBe(false);
  expect(rulesViewSchema.safeParse({ ...view, extra: 1 }).success).toBe(false);
  const { weight: _w, ...missing } = view.on;
  expect(rulesViewSchema.safeParse({ ...view, on: missing }).success).toBe(false);
  expect(rulesViewSchema.safeParse({ ...view, on: { ...view.on, extra: true } }).success).toBe(false);
});

test('applyRulesView : « return » est remis en tête, et seuls les interrupteurs propres vont dans « off »', () => {
  const s = defaultSettings();
  const v = rulesView(s);
  const order = [...v.order.filter((r) => r !== 'return'), 'return' as RuleId];
  const t = applyRulesView(s, { ...v, order, on: { ...v.on, weight: false, mixSexes: true } });
  expect(t.replacementRules.order).toEqual(['return', ...v.order.filter((r) => r !== 'return')]);
  expect(t.replacementRules.off).toEqual(['weight']);
  expect(t.mixSexes.enabled).toBe(true);
});

test('accord préalable du club : poids et âge seulement', () => {
  expect([...PRE_APPROVAL_RULES].sort()).toEqual(['ageDown', 'ageUp', 'minorsAdults', 'seniorsVeterans', 'weightGap']);
});

test('bandes de coût : ligne de coupure sur une règle désactivée', () => {
  const s = defaultSettings();
  // ageDown coupe la liste (weightGap, ageUp, ageDown, seniorsVeterans, discipline) ; la règle coupée étant éteinte,
  // la liste des règles à valider ne la compte plus mais garde celles du dessus.
  s.replacementRules.cutAfter = 'ageDown';
  s.replacementRules.off = ['ageDown'];
  expect(['weightGap', 'ageUp'].map((r) => costBand(s, r as RuleId, true))).toEqual([1, 3]);
  expect(['ageDown', 'seniorsVeterans', 'discipline'].map((r) => costBand(s, r as RuleId, true))).toEqual([4, 4, 4]);
});

test('ruleNumber : « Retour » sans numéro, les autres à partir de 1', () => {
  const order: RuleId[] = ['return', 'weight', 'split'];
  expect(ruleNumber(order, 'return')).toBeNull();
  expect(ruleNumber(order, 'weight')).toBe(1);
  expect(ruleNumber(order, 'split')).toBe(2);
});
