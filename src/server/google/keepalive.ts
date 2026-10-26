import type { AppDb } from '../db/client.js';
import { getAppSettings, markGoogleRefreshed, markGoogleRevoked } from '../repositories/app-settings.js';
import { GoogleAccessRevokedError, type GoogleClient } from './client.js';

/** Google abandonne un jeton de renouvellement inutilisé pendant 6 mois : on s'en sert au moins tous les 30 jours. */
const KEEP_ALIVE_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

/** Un tour : renouvelle l'accès s'il n'a pas servi depuis 30 jours ; un retrait passe l'état à « à reconnecter ». */
export async function googleKeepAliveTick(db: AppDb, google: GoogleClient, now = new Date()): Promise<'skipped' | 'refreshed' | 'revoked' | 'failed'> {
  const sender = getAppSettings(db).google;
  if (!sender || sender.status === 'reconnect') return 'skipped';
  if (sender.lastRefreshAt && now.getTime() - Date.parse(sender.lastRefreshAt) < KEEP_ALIVE_DAYS * DAY_MS) return 'skipped';
  try {
    await google.accessToken(sender.refreshToken, { force: true });
  } catch (e) {
    if (!(e instanceof GoogleAccessRevokedError)) return 'failed';
    markGoogleRevoked(db, sender.refreshToken);
    return 'revoked';
  }
  markGoogleRefreshed(db, now.toISOString(), sender.refreshToken);
  return 'refreshed';
}

/** Un tour au démarrage, puis chaque jour. */
export function startGoogleKeepAlive(db: AppDb, google: GoogleClient, onError: (e: unknown) => void): () => void {
  const run = () => {
    googleKeepAliveTick(db, google).then((r) => r === 'failed' && onError(new Error('Renouvellement de l’accès Google impossible (nouvel essai demain).')), onError);
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
