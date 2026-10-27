import { expect, test } from 'vitest';
import { ladderBars } from '../../src/web/components/replacement/ladderBars.js';

test('ladderBars : 6 → 4 → 4 → 2, chaque règle peint ce qu’elle case', () => {
  const bars = ladderBars(6, [
    { rule: 'weight', alone: 4, band: 0 },
    { rule: 'split', alone: 4, band: 0 },
    { rule: 'ageUp', alone: 2, band: 1 },
  ]);
  expect(bars.get('weight')).toEqual({ placed: [{ band: 0, count: 2 }], alone: 4, total: 6 });
  expect(bars.get('split')).toEqual({ placed: [{ band: 0, count: 2 }], alone: 4, total: 6 });
  expect(bars.get('ageUp')).toEqual({ placed: [{ band: 0, count: 2 }, { band: 1, count: 2 }], alone: 2, total: 6 });
});

test('ladderBars : une règle qui ne case personne ne peint rien', () => {
  const bars = ladderBars(6, [
    { rule: 'weight', alone: 4, band: 0 },
    { rule: 'ageUp', alone: 2, band: 1 },
    { rule: 'discipline', alone: 2, band: 4 },
  ]);
  expect(bars.get('discipline')).toEqual({ placed: [{ band: 0, count: 2 }, { band: 1, count: 2 }], alone: 2, total: 6 });
});

test('ladderBars : voisins de même couleur fusionnés', () => {
  const bars = ladderBars(6, [
    { rule: 'weight', alone: 5, band: 0 },
    { rule: 'split', alone: 3, band: 0 },
  ]);
  expect(bars.get('split')!.placed).toEqual([{ band: 0, count: 3 }]);
});

test('ladderBars : lignes non calculées ou désactivées sautées', () => {
  const bars = ladderBars(6, [
    { rule: 'weight', alone: 4, band: 0 },
    { rule: 'split', alone: null, band: 0 },
    { rule: 'ageUp', alone: 3, band: 1 },
  ]);
  expect(bars.has('split')).toBe(false);
  expect(bars.get('ageUp')).toEqual({ placed: [{ band: 0, count: 2 }, { band: 1, count: 1 }], alone: 3, total: 6 });
});

test('ladderBars : une remontée (garde-fou) n’ajoute rien', () => {
  const bars = ladderBars(6, [
    { rule: 'weight', alone: 2, band: 0 },
    { rule: 'ageUp', alone: 3, band: 1 },
  ]);
  expect(bars.get('ageUp')).toEqual({ placed: [{ band: 0, count: 4 }], alone: 3, total: 7 });
});

test('ladderBars : aucun combattant seul au départ', () => {
  const bars = ladderBars(0, [{ rule: 'weight', alone: 0, band: 0 }]);
  expect(bars.get('weight')).toEqual({ placed: [], alone: 0, total: 0 });
});
