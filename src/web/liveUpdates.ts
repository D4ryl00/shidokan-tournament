import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { PLAN_KEY, refreshPlansLive, TAB_ID } from './api.js';
import { whenSaved } from './unsaved.js';

/**
 * Écrans mis à jour tout seuls : le serveur prévient quand la compétition change (un autre poste a écrit), et les données affichées
 * sont relues — regroupées, une seule relecture en attente à la fois, et seulement quand aucune saisie n'est en cours à l'écran.
 * - Les écritures de cet onglet sont ignorées (il relit déjà ses données après chaque écriture).
 * - Flux fermé (serveur redémarré, session expirée, proxy en erreur) : reconnexion après une attente croissante, puis relecture.
 * - Onglet caché : flux fermé (le navigateur n'ouvre que 6 connexions vers un même PC) ; rouvert, avec relecture, quand il revient.
 * - Plan d'ensemble : un calcul en cours n'est pas relancé, un plan annulé non plus (voir `refreshPlansLive`).
 */
export function useCompetitionEvents(competitionId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!competitionId || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let waiting = false;
    let delay = 2000;
    let stopped = false;
    const refresh = () => {
      if (timer || waiting) return;
      timer = setTimeout(() => {
        timer = null;
        waiting = true;
        whenSaved(() => {
          waiting = false;
          if (stopped) return;
          void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== PLAN_KEY });
          refreshPlansLive(qc);
        });
      }, 300);
    };
    const close = () => {
      source?.close();
      source = null;
      if (retry) clearTimeout(retry);
      retry = null;
    };
    const open = (reload: boolean) => {
      close();
      if (stopped || document.visibilityState === 'hidden') return;
      const s = new EventSource(`/api/competitions/${competitionId}/events`);
      source = s;
      s.addEventListener('change', (e) => {
        let origin: string | null = null;
        try {
          origin = (JSON.parse((e as MessageEvent<string>).data) as { origin?: string | null }).origin ?? null;
        } catch {
          origin = null;
        }
        if (origin !== TAB_ID) refresh();
      });
      s.onopen = () => {
        delay = 2000;
        if (reload) refresh();
        reload = true;
      };
      s.onerror = () => {
        // Le navigateur réessaie de lui-même, sauf s'il a abandonné (réponse autre que 200) : on réessaie nous-mêmes.
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
}
