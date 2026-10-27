import { expect, test } from 'vitest';
import type { LadderRow } from '../../src/domain/replacement/plan.js';
import type { RuleId } from '../../src/domain/settings.js';
import { ladderBars, rowBars } from '../../src/web/components/replacement/ladderBars.js';

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

test('rowBars : découpe dans l’ordre des lignes calculées, même si la liste affichée a été rangée autrement', () => {
  // Lignes calculées dans l'ordre weight puis ageUp ; l'écran montre déjà ageUp avant weight (rangement pas encore recalculé).
  const rows: LadderRow[] = [
    { rule: null, on: true, alone: 3, moves: 0, toValidate: 0, proven: true },
    { rule: 'return', on: true, alone: 6, moves: 0, toValidate: 0, proven: true },
    { rule: 'weight', on: true, alone: 4, moves: 2, toValidate: 0, proven: true },
    { rule: 'ageUp', on: true, alone: 3, moves: 3, toValidate: 1, proven: true },
    { rule: 'discipline', on: false, alone: null, moves: 0, toValidate: 0, proven: true },
  ];
  const band = (r: RuleId) => (r === 'ageUp' ? 1 : 0);
  const { start, bars } = rowBars(rows, band);
  expect(start).toBe(6);
  expect(bars.get('weight')).toEqual({ placed: [{ band: 0, count: 2 }], alone: 4, total: 6 });
  expect(bars.get('ageUp')).toEqual({ placed: [{ band: 0, count: 2 }, { band: 1, count: 1 }], alone: 3, total: 6 });
  expect(bars.has('discipline')).toBe(false);
});

test('rowBars : aucun combattant seul au départ, aucune barre pour les règles', () => {
  const rows: LadderRow[] = [
    { rule: 'return', on: true, alone: 0, moves: 0, toValidate: 0, proven: true },
    { rule: 'weight', on: true, alone: 0, moves: 0, toValidate: 0, proven: true },
  ];
  expect(rowBars(rows, () => 0)).toEqual({ start: 0, bars: new Map() });
});
