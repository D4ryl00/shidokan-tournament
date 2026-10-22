import type { CategoryGrid } from './types.js';

export type AgeMove = { kind: 'same' } | { kind: 'C' | 'D'; crossesMinorAdult: boolean } | { kind: 'forbidden' };

/** Type de passage d'une tranche d'âge à une autre, d'après les liens de la grille (spec §4.3). */
export function ageMove(grid: CategoryGrid, fromCode: string, toCode: string): AgeMove {
  if (fromCode === toCode) return { kind: 'same' };
  const link = grid.ageLinks.find((l) => l.from === fromCode && l.to === toCode);
  if (!link) return { kind: 'forbidden' };
  const isMinor = (code: string) => grid.ageBands.find((b) => b.code === code)?.isMinor ?? false;
  return { kind: link.kind, crossesMinorAdult: isMinor(fromCode) !== isMinor(toCode) };
}
