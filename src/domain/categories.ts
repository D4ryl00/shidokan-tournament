import type { Bracket, BracketFormat } from './brackets/index.js';
import { DISCIPLINES, RULESETS } from './disciplines.js';
import type { Fighter, Registration } from './registration.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';

/** X = mixte (recasement). */
export type CategorySex = Sex | 'X';

/** Une catégorie peut réunir plusieurs tranches d'âge ou catégories de poids (recasement). Listes triées. */
export interface CategoryKey {
  discipline: DisciplineId;
  ruleset: Ruleset | null;
  sex: CategorySex;
  ageBandCodes: string[];
  weightClassIds: string[];
}

export function naturalKey(
  reg: Pick<Registration, 'discipline' | 'ruleset' | 'weightClassId'>,
  fighter: Pick<Fighter, 'sex' | 'ageBandCode'>,
): CategoryKey {
  return {
    discipline: reg.discipline,
    ruleset: reg.ruleset,
    sex: fighter.sex,
    ageBandCodes: [fighter.ageBandCode],
    weightClassIds: reg.weightClassId ? [reg.weightClassId] : [],
  };
}

export function keyString(k: CategoryKey): string {
  return [k.discipline, k.ruleset ?? '', k.sex, [...k.ageBandCodes].sort().join('+'), [...k.weightClassIds].sort().join('+')].join('|');
}

const bandIndex = (grid: CategoryGrid, code: string) => {
  const i = grid.ageBands.findIndex((b) => b.code === code);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};
const weightOf = (grid: CategoryGrid, id: string) => {
  const w = grid.weightClasses.find((x) => x.id === id);
  return w ? (w.maxKg ?? 1000) : Number.MAX_SAFE_INTEGER;
};
const bands = (k: CategoryKey, grid: CategoryGrid) => [...k.ageBandCodes].sort((a, b) => bandIndex(grid, a) - bandIndex(grid, b));
const weights = (k: CategoryKey, grid: CategoryGrid) => [...k.weightClassIds].sort((a, b) => weightOf(grid, a) - weightOf(grid, b));

export function categoryLabel(k: CategoryKey, grid: CategoryGrid): string {
  const parts = [DISCIPLINES[k.discipline].label];
  if (k.ruleset) parts.push(RULESETS[k.ruleset].label.split(' ')[0]!);
  const ageLabels = bands(k, grid).map((c) => grid.ageBands.find((b) => b.code === c)?.label ?? c);
  parts.push(`${ageLabels.join(' / ')} ${k.sex === 'X' ? 'F/M' : k.sex}`);
  if (k.weightClassIds.length) {
    parts.push(`${weights(k, grid).map((id) => grid.weightClasses.find((w) => w.id === id)?.label ?? '?').join(' / ')} kg`);
  }
  return parts.join(' · ');
}

const DISCIPLINE_ORDER: DisciplineId[] = ['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata'];
const SEX_ORDER: CategorySex[] = ['F', 'M', 'X'];

export function compareKeys(a: CategoryKey, b: CategoryKey, grid: CategoryGrid): number {
  const firstBand = (k: CategoryKey) => bandIndex(grid, bands(k, grid)[0] ?? '');
  const firstWeight = (k: CategoryKey) => (k.weightClassIds.length ? weightOf(grid, weights(k, grid)[0]!) : 0);
  return (
    DISCIPLINE_ORDER.indexOf(a.discipline) - DISCIPLINE_ORDER.indexOf(b.discipline) ||
    (a.ruleset ?? '').localeCompare(b.ruleset ?? '') ||
    firstBand(a) - firstBand(b) ||
    SEX_ORDER.indexOf(a.sex) - SEX_ORDER.indexOf(b.sex) ||
    firstWeight(a) - firstWeight(b)
  );
}

export type CategoryStatus = 'provisional' | 'ready' | 'started' | 'finished';

export interface Category {
  id: string;
  competitionId: string;
  key: CategoryKey;
  label: string;
  status: CategoryStatus;
  /** Format imposé ; null = automatique selon le nombre d'inscrits. */
  format: BracketFormat | null;
  repechage: boolean | null;
  thirdPlace: boolean | null;
  seed: number;
  bracket: Bracket | null;
  /** Zone de combat (null : pas encore affectée). */
  zoneId: string | null;
  /** Vague de la catégorie, calculée (règles des vagues ou choix individuel) ; null : en attente ou aucune vague. */
  waveId: string | null;
  /** Choix individuel : id d'une vague, « none » (en attente) ou null (règles). */
  waveOverride: string | null;
  /** Tranches des combattants d'origine (non recasés), qui décident de la vague. */
  waveBands: string[];
  /** Rang de passage sur la zone. */
  order: number;
  registrationIds: string[];
  /** Inscrits absents (exclus du tableau). */
  absentIds: string[];
  aliasKeys: string[];
  effectiveFormat: BracketFormat | null;
  /** Catégorie lancée dont les inscrits ont changé depuis (tableau non régénéré). */
  stale: boolean;
}

/** Combattants à disputer : présents avant le lancement, inscrits du tableau ensuite (un absent tardif ne compte pas). */
export const activeEntrantCount = (c: Pick<Category, 'status' | 'bracket' | 'registrationIds' | 'absentIds'>): number =>
  (c.status === 'started' || c.status === 'finished') && c.bracket ? c.bracket.entrants.length : c.registrationIds.length - c.absentIds.length;
