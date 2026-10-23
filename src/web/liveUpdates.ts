import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { whenSaved } from './unsaved.js';

/**
 * Écrans mis à jour tout seuls : le serveur prévient quand la compétition change (un autre poste a écrit), et les données sont
 * relues, regroupées sur 300 ms, et seulement quand aucune saisie n'est en cours à l'écran (rien n'est effacé sous les doigts).
 * À la reconnexion (serveur redémarré, réseau revenu), tout est relu aussi.
 */
export function useCompetitionEvents(competitionId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!competitionId || typeof EventSource === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let opened = false;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        whenSaved(() => void qc.invalidateQueries());
      }, 300);
    };
    const source = new EventSource(`/api/competitions/${competitionId}/events`);
    source.addEventListener('change', refresh);
    source.onopen = () => {
      if (opened) refresh();
      opened = true;
    };
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [competitionId, qc]);
}
