import { useQuery } from '@tanstack/react-query';
import type { PublicCompetition, PublicCompetitionSummary } from '../domain/public/types.js';
import { api, ApiError } from './api.js';

/** Réponse de la liste publique : trois blocs. */
export interface PublicList {
  today: PublicCompetitionSummary[];
  upcoming: PublicCompetitionSummary[];
  past: PublicCompetitionSummary[];
}

/** Une compétition inconnue ou redevenue privée : `{ gone: true }` plutôt qu'une erreur. */
export type PublicCompetitionResult = PublicCompetition | { gone: true };
export const isGone = (r: PublicCompetitionResult | undefined): r is { gone: true } => !!r && 'gone' in r;

/** Liste des compétitions affichées (sans compte). */
export const usePublicList = () =>
  useQuery({ queryKey: ['public', 'list'], queryFn: () => api<PublicList>('GET', '/api/public/competitions') });

/** Vue publique d'une compétition ; le navigateur gère l'ETag (304) tout seul. */
export const usePublicCompetition = (id: string) =>
  useQuery({
    queryKey: ['public', id],
    queryFn: async (): Promise<PublicCompetitionResult> => {
      try {
        return await api<PublicCompetition>('GET', `/api/public/competitions/${encodeURIComponent(id)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { gone: true };
        throw e;
      }
    },
  });
