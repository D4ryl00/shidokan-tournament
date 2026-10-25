import type { Tone } from './components/ui/StatusBadge.js';

export type PodiumState = 'À disputer' | 'En cours' | 'Terminée';

/** État d'une catégorie dans l'onglet Podiums : jamais commencée, en cours, ou podium complet. */
export function podiumState(c: { complete: boolean; status: 'not_started' | 'started' | 'finished' }): PodiumState {
  if (c.complete) return 'Terminée';
  return c.status === 'not_started' ? 'À disputer' : 'En cours';
}

export const PODIUM_TONES: Record<PodiumState, Tone> = { 'À disputer': 'neutral', 'En cours': 'warn', Terminée: 'ok' };
