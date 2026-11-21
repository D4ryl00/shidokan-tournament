import { useMemo } from 'react';
import { organiserTimes, type OrganiserTimes } from '../domain/schedule/organiser-times.js';
import { useDayEstimate, useScheduleTimes } from './api.js';
import { readShift } from './components/DayEstimateCard.js';
import { useNow } from './components/public/useNow.js';

/** Heures présumées côté organisation : vue publique + débuts prévus de la journée + heure courante. */
export function useOrganiserTimes(competitionId: string): OrganiserTimes {
  const pub = useScheduleTimes(competitionId).data ?? null;
  const planned = useDayEstimate(competitionId, readShift()).data?.plannedStarts ?? null;
  const now = useNow(pub?.date ?? '');
  return useMemo(() => organiserTimes(pub, planned, now), [pub, planned, now]);
}
