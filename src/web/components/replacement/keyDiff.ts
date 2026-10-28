import { categoryLabelParts, type CategoryKey, type CategoryLabelParts } from '../../../domain/categories.js';
import type { MoveWhy } from '../../../domain/replacement/view.js';
import type { CategoryGrid } from '../../../domain/types.js';

/** Un morceau du libellé d'une catégorie ; `sep` le précède (« · » entre groupes, espace entre tranches et sexe). */
export interface KeyPart {
  text: string;
  changed: boolean;
  sep: string;
}

/** Morceaux du libellé de `key` (joints, ils donnent `categoryLabel`) ; `changed` : différent dans `other`. */
export function keyParts(key: CategoryKey, other: CategoryKey | null, grid: CategoryGrid): KeyPart[] {
  const a = categoryLabelParts(key, grid);
  const b = other ? categoryLabelParts(other, grid) : null;
  const part = (field: keyof CategoryLabelParts, sep: string): KeyPart[] => {
    const text = a[field];
    return text === null ? [] : [{ text, changed: b !== null && b[field] !== text, sep }];
  };
  return [...part('discipline', ''), ...part('ruleset', ' · '), ...part('ages', ' · '), ...part('sex', ' '), ...part('weights', ' · ')];
}

const kg = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

/** La ligne « Pourquoi » d'une proposition, accordée au sexe du combattant qui bouge. */
export function whyText(why: MoveWhy, sex: 'F' | 'M'): string {
  const e = sex === 'F' ? 'e' : '';
  switch (why.kind) {
    case 'weight_out':
      return `Pesé${e} à ${kg(why.weighInKg)} kg : trop lourd${e} pour ${why.limitLabel} kg (tolérance ${kg(why.toleranceKg)} kg)`;
    case 'alone':
      return `Seul${e} dans sa catégorie`;
    case 'weight_gap':
      return 'Écart de poids trop grand dans sa catégorie';
    case 'split':
      return `Donner ${why.count > 1 ? 'une poule' : 'un adversaire'} à ${why.forLabel}, seul${why.forSex === 'F' ? 'e' : ''} en ${why.forCategoryLabel}`;
    case 'return':
      return 'Retour dans sa catégorie d’origine (elle a de nouveau des combattants)';
    case 'closed':
      return `Inscrit${e} dans une catégorie fermée`;
    case 'manual':
      return 'Choisi à la main';
  }
}
