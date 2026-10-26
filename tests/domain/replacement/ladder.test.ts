import { expect, test } from 'vitest';
import { computePlan, planLadder, type LadderProgress } from '../../../src/domain/replacement/plan.js';
import { isRuleOn } from '../../../src/domain/replacement/rules.js';
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
test('jamais pire que l’ancien calcul carte par carte', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = randomState(seed, 60);
    s.settings.replacementRules.cutAfter = 'minorsAdults';
    const plan = computePlan(s, { waveId: null, level: 'minorsAdults', choices: [] });
    expect(plan.aloneAfter.length, `seed ${seed}`).toBeLessThanOrEqual(greedyAlone(s, null));
  }
});
test('500 inscriptions : le diagramme en moins de 4 s, et prouvé', () => {
  const s = randomState(42, 500);
  // Les autres fichiers de test tournent en parallèle et peuvent doubler le temps mesuré : on garde le meilleur de trois essais
  // (le calcul est identique à chaque essai ; seule la charge de la machine change).
  let best = Number.POSITIVE_INFINITY;
  let rows = planLadder(s, { waveId: null, choices: [] }).rows;
  for (let attempt = 0; attempt < 3 && best >= 4000; attempt++) {
    const t = performance.now();
    rows = planLadder(s, { waveId: null, choices: [] }).rows;
    best = Math.min(best, performance.now() - t);
  }
  expect(best).toBeLessThan(4000);
  expect(rows.every((r) => r.alone === null || r.proven)).toBe(true);
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

test('la ligne de coupure n’est jamais moins bonne que le plan calculé seul', { timeout: 60_000 }, () => {
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

test('150 inscriptions : le diagramme en moins de 2 s', { timeout: 60_000 }, () => {
  const s = randomState(42, 150);
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = performance.now();
    planLadder(s, { waveId: null, choices: [] });
    best = Math.min(best, performance.now() - t);
  }
  expect(best).toBeLessThan(2000);
});
