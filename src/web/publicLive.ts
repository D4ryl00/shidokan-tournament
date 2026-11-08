import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isGone, type PublicCompetitionResult } from './publicApi.js';

/**
 * Page publique mise à jour toute seule : le serveur prévient quand la compétition change, et les données `['public', …]` sont
 * relues après une attente aléatoire de 0 à 2 s (des centaines de téléphones ne relisent pas au même instant).
 * - Flux fermé par le serveur (compétition redevenue privée ou supprimée) : la relecture donne 404 (`gone`), on ne se reconnecte plus.
 * - Flux en erreur sans reprise du navigateur : reconnexion après une attente croissante, puis relecture.
 * - Onglet caché : flux fermé ; rouvert, avec relecture, quand il revient.
 */
export function usePublicEvents(competitionId: string): { connected: boolean; lastUpdate: Date | null } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  useEffect(() => {
    if (!competitionId || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 2000;
    let stopped = false;
    const close = () => {
      source?.close();
      source = null;
      if (retry) clearTimeout(retry);
      retry = null;
    };
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (stopped) return;
        void qc.invalidateQueries({ queryKey: ['public'] }).then(() => {
          if (stopped) return;
          setLastUpdate(new Date());
          if (isGone(qc.getQueryData<PublicCompetitionResult>(['public', competitionId]))) {
            stopped = true;
            close();
            setConnected(true);
          }
        });
      }, Math.random() * 2000);
    };
    const open = (reload: boolean) => {
      close();
      if (stopped || document.visibilityState === 'hidden') return;
      const s = new EventSource(`/api/public/competitions/${encodeURIComponent(competitionId)}/events`);
      source = s;
      s.addEventListener('change', () => refresh());
      s.onopen = () => {
        delay = 2000;
        setConnected(true);
        if (reload) refresh();
        reload = true;
      };
      s.onerror = () => {
        setConnected(false);
        // Fermé par le serveur (ou réponse 404) : relire pour savoir si la compétition est toujours affichée.
        refresh();
        if (s.readyState === EventSource.CLOSED) {
          close();
          retry = setTimeout(() => open(true), delay);
          delay = Math.min(delay * 2, 30_000);
        }
      };
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? close() : open(true));
    document.addEventListener('visibilitychange', onVisibility);
    open(false);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      close();
      if (timer) clearTimeout(timer);
    };
  }, [competitionId, qc]);
  return { connected, lastUpdate };
}
