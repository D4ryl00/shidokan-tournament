import { DISCIPLINES, RULESETS } from '../domain/disciplines.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from '../domain/types.js';

export const SEX_LABELS: Record<Sex, string> = { F: 'Féminin', M: 'Masculin' };
export const disciplineLabel = (d: DisciplineId) => DISCIPLINES[d].label;
export const rulesetShort = (r: Ruleset | null) => (r === null ? '—' : r === 'jiyu' ? 'Jiyu' : 'Shobu');
export const RULESET_LABELS = RULESETS;
export const DISCIPLINE_OPTIONS = (Object.keys(DISCIPLINES) as DisciplineId[]).map((d) => ({ value: d, label: DISCIPLINES[d].label }));

export function ageBandLabel(grid: CategoryGrid | undefined, code: string): string {
  return grid?.ageBands.find((b) => b.code === code)?.label ?? code;
}
/** « Seniors · Masculin · -90 kg » : une catégorie de poids nommée en clair (tranche d’âge, sexe, poids). */
export function weightClassTitle(grid: CategoryGrid | undefined, w: { ageBandCode: string; sex: Sex; label: string }): string {
  return `${ageBandLabel(grid, w.ageBandCode)} · ${SEX_LABELS[w.sex]} · ${w.label} kg`;
}
export function weightLabel(grid: CategoryGrid | undefined, id: string | null): string {
  if (!id) return '—';
  return grid?.weightClasses.find((w) => w.id === id)?.label ?? '?';
}
/** Poids en kilos à la française : « 68,5 kg ». */
export function kgLabel(kg: number): string {
  return `${kg.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
}
/** Poids affiché sur une pastille : pesé, sinon « ≈ déclaré », sinon rien (jamais en kata). */
export function entrantWeight(r: { discipline: DisciplineId; weighInKg: number | null; approxWeightKg: number | null }): string | null {
  if (!DISCIPLINES[r.discipline].hasWeight) return null;
  if (r.weighInKg !== null) return kgLabel(r.weighInKg);
  return r.approxWeightKg !== null ? `≈ ${kgLabel(r.approxWeightKg)}` : null;
}
export function prefsLabel(prefs: DisciplineId[]): string {
  return prefs.length ? prefs.map((d) => DISCIPLINES[d].label).join(' › ') : '—';
}
