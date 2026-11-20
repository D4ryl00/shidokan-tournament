import type { Category } from '../domain/categories.js';
import type { CategoryGrid as Grid } from '../domain/types.js';
import { finalMatchIds } from '../domain/passages/index.js';
import { ageGroupOf, combatTiming, timingLongText, type ScheduleSettings } from '../domain/schedule/durations.js';

/** Durée de chaque combat d'un tableau (texte long), selon la précédence combat / finale / tableau / compétition. Vide pour un kata ou sans tableau. */
export function matchTimings(
  category: Pick<Category, 'bracket' | 'key' | 'durations'>,
  settings: { schedule: ScheduleSettings; triathlonRounds: 3 | 6 },
  grid: Grid,
): Map<string, string> {
  const out = new Map<string, string>();
  const bracket = category.bracket;
  if (category.key.discipline === 'kata' || bracket?.kind !== 'combat') return out;
  const group = ageGroupOf(category.key, grid);
  const finals = finalMatchIds(bracket);
  for (const m of bracket.matches) {
    out.set(m.id, timingLongText(combatTiming(settings, group, category.durations ?? null, m.id, finals.includes(m.id))));
  }
  return out;
}
