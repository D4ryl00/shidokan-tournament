import { weightClassesFor } from '../grid.js';
import type { CategoryGrid, WeightClass } from '../types.js';
import { weightClassForWeight } from '../weights.js';
import type { CategoryState, Member, State } from './types.js';

/** Poids retenu pour comparer : pesée, sinon poids approximatif, sinon limite de la catégorie (ouverte : limite précédente). */
export function effectiveWeight(m: Member, grid: CategoryGrid): number | null {
  if (m.weighInKg !== null) return m.weighInKg;
  if (m.approxWeightKg !== null) return m.approxWeightKg;
  if (!m.weightClassId) return null;
  const wc = grid.weightClasses.find((w) => w.id === m.weightClassId);
  if (!wc) return null;
  if (wc.maxKg !== null) return wc.maxKg;
  const limits = weightClassesFor(grid, wc.ageBandCode, wc.sex).map((w) => w.maxKg).filter((kg): kg is number => kg !== null);
  return limits.length ? Math.max(...limits) : null;
}

export function categoryWeightGap(members: Member[], grid: CategoryGrid): number {
  const weights = members.map((m) => effectiveWeight(m, grid)).filter((w): w is number => w !== null);
  return weights.length < 2 ? 0 : Math.max(...weights) - Math.min(...weights);
}

const isMinor = (m: Member, state: State) => state.grid.ageBands.find((b) => b.code === m.ageBandCode)?.isMinor ?? false;

/** Seuil enfants dès qu'un membre est mineur, sinon seuil adultes. */
export function gapThreshold(members: Member[], state: State): number {
  return members.some((m) => isMinor(m, state)) ? state.settings.weightGapMaxKg.children : state.settings.weightGapMaxKg.adults;
}

/**
 * Écart de poids toléré dans une catégorie : au moins la largeur de sa catégorie de poids (écart imposé par la grille) ;
 * infini sans limite basse (la plus légère) ou haute (« + »). Catégorie fusionnée ou libre : le seuil des réglages.
 */
export function categoryGapTolerance(category: CategoryState, members: Member[], state: State): number {
  const base = gapThreshold(members, state);
  if (category.key.weightClassIds.length !== 1) return base;
  const wc = state.grid.weightClasses.find((w) => w.id === category.key.weightClassIds[0]);
  if (!wc) return base;
  if (wc.maxKg === null) return Infinity;
  const classes = weightClassesFor(state.grid, wc.ageBandCode, wc.sex);
  const index = classes.findIndex((w) => w.id === wc.id);
  const previous = index > 0 ? classes[index - 1]!.maxKg : null;
  if (previous === null) return Infinity;
  return Math.max(base, wc.maxKg - previous);
}

/** Catégorie correspondant au poids pesé (tolérance du sexe) ; null si non pesé ou sans poids. */
export function weighInClass(m: Member, state: State): WeightClass | null {
  if (m.weighInKg === null || !m.weightClassId) return null;
  return weightClassForWeight(state.grid, m.ageBandCode, m.sex, m.weighInKg, state.settings.weighInToleranceKg[m.sex]);
}

/** Trop lourd pour sa catégorie (tolérance comprise) : seul ce cas est « hors catégorie » (un combattant plus léger reste). */
export function isOverweight(m: Member, state: State): WeightClass | null {
  const wic = weighInClass(m, state);
  if (!wic || wic.id === m.weightClassId) return null;
  const current = state.grid.weightClasses.find((w) => w.id === m.weightClassId);
  if (!current || current.maxKg === null) return null;
  return wic.maxKg === null || wic.maxKg > current.maxKg ? wic : null;
}

/**
 * Recasé : trop lourd pour la catégorie où il a été placé, c'est-à-dire au-delà de sa catégorie de poids la plus lourde
 * (une catégorie ouverte n'a pas de limite).
 */
export function overweightInCategory(m: Member, state: State): WeightClass | null {
  const wic = weighInClass(m, state);
  const cat = state.categories.find((c) => c.id === m.categoryId);
  if (!wic || !cat) return null;
  const limits = cat.key.weightClassIds.map((id) => state.grid.weightClasses.find((w) => w.id === id)?.maxKg);
  if (limits.length === 0 || limits.some((kg) => kg === null || kg === undefined)) return null;
  return wic.maxKg === null || wic.maxKg > Math.max(...(limits as number[])) ? wic : null;
}

export function activeMembers(state: State, categoryId: string): Member[] {
  return state.members.filter((m) => m.categoryId === categoryId && m.presence !== 'absent');
}
