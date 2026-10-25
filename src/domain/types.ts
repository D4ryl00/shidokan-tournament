export type Sex = 'M' | 'F';
export type DisciplineId = 'karate' | 'shido-boxing' | 'shido-mix' | 'triathlon' | 'kata';
export type Ruleset = 'jiyu' | 'shobu';

export interface AgeBand {
  code: string;
  label: string;
  minAge: number;
  maxAge: number | null;
  isMinor: boolean;
  sortOrder: number;
}

/** maxKg null = catégorie ouverte (« +X »). */
export interface WeightClass {
  /** Identifiant stable : les inscriptions et tableaux y font référence. */
  id: string;
  ageBandCode: string;
  sex: Sex;
  label: string;
  maxKg: number | null;
  sortOrder: number;
}

export type AgeLinkKind = 'C' | 'D';

/** Passage autorisé de la tranche `from` vers la tranche `to`. */
export interface AgeLink {
  from: string;
  to: string;
  kind: AgeLinkKind;
}

export interface CategoryGrid {
  ageBands: AgeBand[];
  weightClasses: WeightClass[];
  ageLinks: AgeLink[];
}
