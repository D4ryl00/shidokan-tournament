import { useMemo } from 'react';
import { NO_ORGANISER_TIMES, organiserTimes, type OrganiserTimes } from '../domain/schedule/organiser-times.js';
import { useDayEstimate, useScheduleTimes } from './api.js';
import { readShift } from './components/DayEstimateCard.js';
import { useNow } from './components/public/useNow.js';

/**
 * Heures présumées côté organisation : vue publique + débuts prévus de la journée + heure courante. L'estimation de la journée
 * n'est lue que tant qu'une session n'est pas lancée (ses heures ne servent qu'à celles-là).
 */
export function useOrganiserTimes(competitionId: string): OrganiserTimes {
  const pub = useScheduleTimes(competitionId).data ?? null;
  const needPlanned = pub !== null && pub.phase !== 'past' && pub.waves.some((w) => !w.launched);
  const estimate = useDayEstimate(competitionId, readShift(), { enabled: needPlanned }).data;
  const planned = needPlanned ? (estimate?.plannedStarts ?? null) : null;
  const now = useNow(pub?.date ?? '');
  return useMemo(() => {
    // Jour de compétition : une erreur inattendue du calcul ne fait jamais tomber Combats ni Tableaux (pas d'heure, c'est tout).
    try {
      return guarded(organiserTimes(pub, planned, now));
    } catch (err) {
      console.error('Heures présumées : calcul impossible', err);
      return NO_ORGANISER_TIMES;
    }
  }, [pub, planned, now]);
}

/** Chaque lecture protégée aussi : une erreur rend « pas d'heure » (null / false) au lieu de faire tomber l'écran. */
export function guarded(t: OrganiserTimes): OrganiserTimes {
  const safe = <A extends unknown[], R>(name: keyof OrganiserTimes, f: (...args: A) => R, fallback: R) => (...args: A): R => {
    try {
      return f(...args);
    } catch (err) {
      console.error(`Heures présumées : ${name} impossible`, err);
      return fallback;
    }
  };
  return {
    passage: safe('passage', t.passage, null),
    onCall: safe('onCall', t.onCall, null),
    category: safe('category', t.category, null),
    drift: safe('drift', t.drift, null),
    waveLaunched: safe('waveLaunched', t.waveLaunched, false),
  };
}
