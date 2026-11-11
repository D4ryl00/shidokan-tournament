import { entryKey } from '../../../domain/closed-categories.js';
import { ageRangeText } from '../../../domain/grid.js';
import { useClosedCategories, useCompetition, useGrid, type ClubEntryView } from '../../api.js';

/** Ce que la fenêtre du combattant (et le parcours d'import du PDF FFK) attend de l'organisateur : tranches, poids, fermetures, règle des combats. */
export function useOrganiserLineInputs(competitionId: string): Pick<ClubEntryView, 'ageBands' | 'weightClasses' | 'closed' | 'multipleCombats'> {
  const { data: grid } = useGrid(competitionId);
  const { data: closedView } = useClosedCategories(competitionId);
  const { data: competition } = useCompetition(competitionId);
  return {
    ageBands: (grid?.ageBands ?? []).map((b) => ({ code: b.code, label: b.label, ages: ageRangeText(b), isMinor: b.isMinor })),
    weightClasses: [...(grid?.weightClasses ?? [])]
      .sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity))
      .map(({ id, ageBandCode, sex, label, maxKg }) => ({ id, ageBandCode, sex, label, maxKg })),
    closed: (closedView?.closed ?? []).map(entryKey),
    multipleCombats: competition?.settings.multipleCombatDisciplinesPerDay ?? false,
  };
}
