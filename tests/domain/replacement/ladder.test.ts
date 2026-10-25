import { expect, test } from 'vitest';
import { computePlan, planLadder } from '../../../src/domain/replacement/plan.js';
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
test('500 inscriptions : le diagramme en moins de 3 s, et prouvé', () => {
  const s = randomState(42, 500);
  // Les autres fichiers de test tournent en parallèle et peuvent doubler le temps mesuré : on garde le meilleur de trois essais
  // (le calcul est identique à chaque essai ; seule la charge de la machine change).
  let best = Number.POSITIVE_INFINITY;
  let rows = planLadder(s, { waveId: null, choices: [] }).rows;
  for (let attempt = 0; attempt < 3 && best >= 3000; attempt++) {
    const t = performance.now();
    rows = planLadder(s, { waveId: null, choices: [] }).rows;
    best = Math.min(best, performance.now() - t);
  }
  console.log(`ladder 500: ${Math.round(best)} ms`);
  expect(best).toBeLessThan(3000);
  expect(rows.every((r) => r.alone === null || r.proven)).toBe(true);
});
