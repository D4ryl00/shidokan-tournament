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
export function weightLabel(grid: CategoryGrid | undefined, id: string | null): string {
  if (!id) return '—';
  return grid?.weightClasses.find((w) => w.id === id)?.label ?? '?';
}
export function prefsToCodes(prefs: DisciplineId[]): string {
  return prefs.map((d) => DISCIPLINES[d].clubFormCode ?? '').join('');
}
export function prefsLabel(prefs: DisciplineId[]): string {
  return prefs.length ? prefs.map((d) => DISCIPLINES[d].label).join(' › ') : '—';
}
