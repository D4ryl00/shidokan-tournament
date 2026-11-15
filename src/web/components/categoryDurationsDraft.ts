import { combatTiming, type AgeGroup, type CombatTiming, type ScheduleSettings } from '../../domain/schedule/durations.js';

/**
 * Brouillon d'un tableau qui passe de « Comme la compétition » à « Autre » : la ligne des combats prend la durée du
 * groupe d'âge, la finale celle de la compétition si elle en a une (sinon elle suit les autres combats).
 */
export function draftFromCompetition(
  base: { schedule: ScheduleSettings; triathlonRounds: 3 | 6 },
  group: AgeGroup,
): { bracket: CombatTiming; finals: CombatTiming | null } {
  return { bracket: combatTiming(base, group, null, null, false), finals: base.schedule.finals[group] };
}
