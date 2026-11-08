import { ApiError } from './apiError.js';

/** Message des pages publiques quand le serveur ne répond pas (réseau coupé, serveur redémarré derrière Caddy). */
export const NETWORK_ERROR_TEXT = 'Impossible de joindre le serveur, nouvel essai…';

/** Le serveur n'a pas été joint : `fetch` rejeté (« Failed to fetch », « Load failed »…) ou 502 / 503 / 504 de l'intermédiaire. */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ApiError && [502, 503, 504].includes(e.status));
}

/**
 * Texte d'erreur d'une page publique : rien tant que des données sont à l'écran (le bandeau « Connexion perdue » suffit),
 * un message en français pour une erreur de réseau, sinon le message du serveur.
 */
export function publicErrorText(error: unknown, hasData: boolean): string | null {
  if (!error || hasData) return null;
  if (isNetworkError(error)) return NETWORK_ERROR_TEXT;
  return error instanceof Error ? error.message : 'Erreur inconnue';
}

/** Lectures publiques : une erreur de réseau est réessayée sans fin (attente croissante, 30 s au plus) ; une autre ne l'est pas. */
export const publicRetry = (_failures: number, e: unknown) => isNetworkError(e);
export const publicRetryDelay = (failures: number) => Math.min(1000 * 2 ** failures, 30_000);

/** Dernières données reçues et leur heure d'arrivée. */
export interface Received<T> {
  data: T;
  at: Date;
}

/**
 * Heure des dernières données **nouvelles** : une relecture qui rend les mêmes données (304, ou rien de changé — React Query
 * garde alors le même objet) ne change pas l'heure.
 */
export function received<T>(prev: Received<T> | null, data: T | undefined, now: Date): Received<T> | null {
  if (data === undefined) return prev;
  if (prev && prev.data === data) return prev;
  return { data, at: now };
}
