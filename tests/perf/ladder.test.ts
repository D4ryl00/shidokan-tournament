import { expect, test } from 'vitest';
import { planLadder } from '../../src/domain/replacement/plan.js';
import { randomState } from '../domain/replacement/random-state.js';

// Tests de durée : lancés à part (`npm run test:perf`, un fichier à la fois), sans les autres fichiers de test en parallèle
// qui rendaient la mesure instable sur la CI.
// Depuis le split élargi (étape 31), un combattant seul a bien plus de propositions : 500 inscriptions prennent environ
// 6 s, et la ligne « autre discipline » (toutes les règles) peut s'arrêter sur le meilleur plan trouvé, non prouvé.
test('500 inscriptions : le diagramme en moins de 10 s, prouvé jusqu’aux seniors / vétérans', () => {
  const s = randomState(42, 500);
  // Une machine chargée peut allonger le temps mesuré : on garde le meilleur de trois essais
  // (le calcul est identique à chaque essai ; seule la charge de la machine change).
  let best = Number.POSITIVE_INFINITY;
  let rows = planLadder(s, { waveId: null, choices: [] }).rows;
  for (let attempt = 0; attempt < 3 && best >= 10000; attempt++) {
    const t = performance.now();
    rows = planLadder(s, { waveId: null, choices: [] }).rows;
    best = Math.min(best, performance.now() - t);
  }
  expect(best).toBeLessThan(10000);
  const upTo = rows.findIndex((r) => r.rule === 'seniorsVeterans');
  expect(rows.slice(0, upTo + 1).every((r) => r.alone === null || r.proven)).toBe(true);
});

// Depuis le split élargi (étape 31) : environ 1,5 à 1,9 s sur cet exemple (0,4 s avant) ; 3 s laisse une marge à la CI.
test('150 inscriptions : le diagramme en moins de 3 s', { timeout: 60_000 }, () => {
  const s = randomState(42, 150);
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = performance.now();
    planLadder(s, { waveId: null, choices: [] });
    best = Math.min(best, performance.now() - t);
  }
  expect(best).toBeLessThan(3000);
});
