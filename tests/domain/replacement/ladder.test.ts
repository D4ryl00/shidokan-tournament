import { expect, test } from 'vitest';
import { computePlan, planLadder, type LadderProgress, type PlanChoice } from '../../../src/domain/replacement/plan.js';
import { isRuleOn } from '../../../src/domain/replacement/rules.js';
import { makeState, member } from './fixtures.js';
import { greedyAlone } from './greedy-reference.js';
import { randomState } from './random-state.js';

test('diagramme : une ligne par règle, décroissante, règle coupée sans barre', () => {
  const s = randomState(7, 80);
  s.settings.replacementRules.off = ['ageDown'];
  const { rows, plan } = planLadder(s, { waveId: null, choices: [] });
  expect(rows.map((r) => r.rule)).toEqual([null, ...s.settings.replacementRules.order]);
  expect(rows.find((r) => r.rule === 'ageDown')).toMatchObject({ on: false, alone: null });
  // La ligne de départ est exclue : les corrections de poids obligatoires peuvent laisser un partenaire seul (13 → 17 ici).
  const values = rows.filter((r) => r.rule !== null && r.alone !== null).map((r) => r.alone!);
  expect(values).toEqual([...values].sort((x, y) => y - x));
  expect(plan.aloneAfter.length).toBe(rows.find((r) => r.rule === 'discipline')!.alone);
});
test('ligne « return » : détail des corrections imposées et des choix', () => {
  const kgM = (label: string, wc: string, kg: number) => member({ label, weightClassId: wc, approxWeightKg: kg });
  // R, déplacée parce qu'elle était seule en -47, peut y revenir ; W, pesée 58 kg en -54, passe en -61.
  const back = member({
    label: 'R', weightClassId: 'cadet:F:-54', approxWeightKg: 47, placementLocked: true, recasementType: 'A',
    original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47', reason: 'alone' },
  });
  const w = member({ label: 'W', weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
  const s = makeState([
    kgM('H1', 'cadet:F:-47', 45), kgM('H2', 'cadet:F:-47', 46), back, kgM('P1', 'cadet:F:-54', 50), kgM('P2', 'cadet:F:-54', 51), w,
    kgM('S1', 'cadet:F:-61', 58), kgM('S2', 'cadet:F:-61', 59),
  ]);
  const start = (choices: PlanChoice[]) => planLadder(s, { waveId: null, choices }).rows.find((r) => r.rule === 'return')!.start;
  expect(start([])).toEqual({ returns: 1, weights: 1, choices: 0 });
  // Un retour validé est compté parmi les choix, pas parmi les retours.
  expect(start([{ kind: 'validate', proposalId: `R:${back.registrationId}>${s.members.find((m) => m.label === 'H1')!.categoryId}`, caseId: `return:${back.registrationId}` }]))
    .toEqual({ returns: 0, weights: 1, choices: 1 });
  expect(planLadder(s, { waveId: null, choices: [] }).rows.filter((r) => r.rule !== 'return').every((r) => r.start === undefined)).toBe(true);
});
test('jamais pire que l’ancien calcul carte par carte', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = randomState(seed, 60);
    s.settings.replacementRules.cutAfter = 'minorsAdults';
    const plan = computePlan(s, { waveId: null, level: 'minorsAdults', choices: [] });
    expect(plan.aloneAfter.length, `seed ${seed}`).toBeLessThanOrEqual(greedyAlone(s, null));
  }
});
/** Toutes les règles actives, mélanges rares compris (filles / garçons dans toutes les tranches), ligne en bas. */
function allRules(seed: number, size: number) {
  const s = randomState(seed, size);
  s.settings.mixMinorsAdults = true;
  s.settings.shobuToJiyu = true;
  s.settings.mixSexes = { enabled: true, ageBandCodes: s.grid.ageBands.map((b) => b.code) };
  s.settings.replacementRules.cutAfter = 'minorsAdults';
  return s;
}
const fromFirstRule = (rows: { rule: string | null; alone: number | null }[]) => rows.filter((r) => r.rule !== null && r.alone !== null).map((r) => r.alone!);

test('règles rares : les barres ne remontent jamais, même sans preuve', () => {
  // Graine 4 : la recherche de la dernière règle n'allait pas au bout et laissait plus de seuls que la ligne au-dessus.
  const s = allRules(4, 150);
  const { rows, plan } = planLadder(s, { waveId: null, choices: [] });
  const values = fromFirstRule(rows);
  expect(values).toEqual([...values].sort((x, y) => y - x));
  expect(plan.aloneAfter.length).toBe(values[values.length - 1]);
  for (let seed = 1; seed <= 6; seed++) {
    const v = fromFirstRule(planLadder(allRules(seed, 60), { waveId: null, choices: [], nodeBudget: 300 }).rows);
    expect(v, `seed ${seed}`).toEqual([...v].sort((x, y) => y - x));
  }
});

test('nœuds par ligne : nodeBudget 0 rend toujours les rejeux, et deux appels identiques donnent le même diagramme', () => {
  const s = allRules(8, 150);
  // Aucun nœud : chaque ligne rend son rejeu (ou la ligne au-dessus), aucune ne se dit prouvée.
  const none = planLadder(s, { waveId: null, choices: [], nodeBudget: 0 });
  expect(none.rows.filter((r) => r.rule !== null && r.alone !== null).every((r) => !r.proven)).toBe(true);
  expect(none.plan.proven).toBe(false);
  expect(none.plan.aloneAfter.length).toBeLessThanOrEqual(greedyAlone(s, null));
  const a = planLadder(s, { waveId: null, choices: [], nodeBudget: 500 });
  const b = planLadder(s, { waveId: null, choices: [], nodeBudget: 500 });
  expect(a.rows).toEqual(b.rows);
  expect(a.plan.hash).toBe(b.plan.hash);
});

// Environ 45 s seul depuis le split élargi (étape 31), plus avec les autres fichiers en parallèle : la limite n'est qu'une sécurité.
test('la ligne de coupure n’est jamais moins bonne que le plan calculé seul', { timeout: 180_000 }, () => {
  for (const seed of [4, 6, 8]) {
    const s = randomState(seed, 250);
    const alone = computePlan(s, { waveId: null, level: s.settings.replacementRules.cutAfter, choices: [] }).aloneAfter.length;
    const ladder = planLadder(s, { waveId: null, choices: [] });
    expect(ladder.plan.aloneAfter.length, `seed ${seed}`).toBeLessThanOrEqual(alone);
  }
});

test('la progression suit les calculs', { timeout: 30_000 }, () => {
  const check = (s: ReturnType<typeof randomState>, extra: number) => {
    const seen: LadderProgress[] = [];
    const { rows } = planLadder(s, { waveId: null, choices: [] }, (p) => seen.push(p));
    const total = s.settings.replacementRules.order.filter((r) => isRuleOn(s.settings, r)).length + extra;
    expect(seen.map((p) => p.done)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(seen.every((p) => p.total === total)).toBe(true);
    expect(seen[seen.length - 1]!.rows).toEqual(rows);
  };
  check(allRules(3, 60), 0);
  // Les lignes disent la vérité sur le plan retenu : déplacements et déplacements à valider de la ligne de coupure.
  const cut = allRules(3, 60);
  const l = planLadder(cut, { waveId: null, choices: [] });
  const cutRow = l.rows.find((r) => r.rule === cut.settings.replacementRules.cutAfter)!;
  expect([cutRow.moves, cutRow.toValidate]).toEqual([l.plan.moves.length, l.plan.moves.filter((m) => m.manual && !m.validated).length]);
  expect(cutRow.alone).toBe(l.plan.aloneAfter.length);
  // Règle de coupure désactivée avec une ligne active au-dessus : son plan est réutilisé, aucun calcul de plus.
  const t = allRules(3, 60);
  t.settings.replacementRules.cutAfter = 'ageUp';
  t.settings.replacementRules.off = ['ageUp'];
  check(t, 0);
  const reused = planLadder(t, { waveId: null, choices: [] });
  const above = reused.rows.find((r) => r.rule === 'weightGap')!;
  expect([reused.plan.aloneAfter.length, reused.plan.moves.length, reused.plan.moves.filter((m) => m.manual && !m.validated).length, reused.plan.proven])
    .toEqual([above.alone, above.moves, above.toValidate, above.proven]);
  // Le plan réutilisé est celui de la ligne du dessus : même plan que la liste renvoyée sans coupure désactivée sur cette ligne.
  const sameCut = allRules(3, 60);
  sameCut.settings.replacementRules.cutAfter = 'weightGap';
  // (Les identifiants d'inscription changent d'un tirage à l'autre : on compare la forme du plan.)
  const shape = (r: typeof reused.plan) => [r.aloneAfter.length, r.proven, r.moves.map((m) => [m.type, m.rules, m.manual])];
  expect(shape(planLadder(sameCut, { waveId: null, choices: [] }).plan)).toEqual(shape(reused.plan));
  // Règle de coupure désactivée, aucune ligne active au-dessus : un calcul de plus.
  const u = allRules(3, 60);
  u.settings.replacementRules.order = ['weight', ...u.settings.replacementRules.order.filter((r) => r !== 'weight')];
  u.settings.replacementRules.cutAfter = 'weight';
  u.settings.replacementRules.off = ['weight'];
  check(u, 1);
});
