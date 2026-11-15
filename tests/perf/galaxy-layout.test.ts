import { expect, test } from 'vitest';
import { galaxyLayout } from '../../src/domain/galaxy/layout.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

// Places de la galaxie (étape 48) : calculées sur toutes les cases possibles de la grille FFK (environ 790), elles ne
// doivent pas bloquer l'écran plus d'environ 1 s le jour J. Meilleur de trois essais, comme les autres tests de durée.
test('galaxyLayout(grille FFK) en moins de 1000 ms', () => {
  const grid = ffkDefaultGrid();
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = performance.now();
    galaxyLayout(grid);
    best = Math.min(best, performance.now() - t);
  }
  console.log(`galaxyLayout : ${best.toFixed(0)} ms`);
  expect(best).toBeLessThan(1000);
});
