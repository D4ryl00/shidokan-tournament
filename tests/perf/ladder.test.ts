import { expect, test } from 'vitest';
import { planLadder } from '../../src/domain/replacement/plan.js';
import { randomState } from '../domain/replacement/random-state.js';

// Tests de durée : lancés à part (`npm run test:perf`, un fichier à la fois), sans les autres fichiers de test en parallèle
// qui rendaient la mesure instable sur la CI.
test('500 inscriptions : le diagramme en moins de 4 s, et prouvé', () => {
  const s = randomState(42, 500);
  // Une machine chargée peut allonger le temps mesuré : on garde le meilleur de trois essais
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
