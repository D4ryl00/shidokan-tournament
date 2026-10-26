import { currentInvitationMail, DEFAULT_APP_SETTINGS, GOOGLE_CONNECT_FIRST, type AppSettings, type AppSettingsPatch, type GoogleSender, type MailMode, type PublicAppSettings } from '../../domain/app-settings.js';
import type { AppDb } from '../db/client.js';
import { appSettings } from '../db/schema.js';

/** Réglages enregistrés, complétés par les valeurs par défaut. */
export function getAppSettings(db: AppDb): AppSettings {
  const stored = Object.fromEntries(db.select().from(appSettings).all().map((r) => [r.key, JSON.parse(r.valueJson) as unknown]));
  const settings = { ...DEFAULT_APP_SETTINGS, ...stored } as AppSettings;
  return { ...settings, invitationMail: currentInvitationMail(settings.invitationMail) };
}

class SettingsError extends Error {
  readonly statusCode = 400;
}

/** Réglages tels que renvoyés à l'écran : jamais le mot de passe SMTP ni le jeton Google. */
export function publicAppSettings(full: AppSettings, googleAvailable: boolean): PublicAppSettings {
  // Le serveur relié (et son jeton) ne passe que par /api/sync/settings.
  const { syncServer: _sync, smtp, google, ...s } = full as AppSettings & { syncServer?: unknown };
  const publicGoogle = google ? (({ refreshToken: _token, ...g }) => g)(google) : null;
  const publicSmtp = smtp ? (({ password, ...rest }) => ({ ...rest, hasPassword: !!password }))(smtp) : null;
  return { ...s, smtp: publicSmtp, google: publicGoogle, googleAvailable };
}

function writeSettings(db: AppDb, next: Partial<AppSettings>): void {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(next)) {
      const valueJson = JSON.stringify(value);
      tx.insert(appSettings).values({ key, valueJson }).onConflictDoUpdate({ target: appSettings.key, set: { valueJson, updatedAt: new Date().toISOString() } }).run();
    }
  });
}

export function updateAppSettings(db: AppDb, patch: AppSettingsPatch): AppSettings {
  const current = getAppSettings(db);
  const { googleFromName, ...rest } = patch;
  const next: Partial<AppSettings> = { ...rest } as Partial<AppSettings>;
  if (patch.smtp) {
    // Mot de passe : null = inchangé, '' = effacé.
    const password = patch.smtp.password === null ? (current.smtp?.password ?? null) : patch.smtp.password || null;
    next.smtp = { ...patch.smtp, password };
  }
  if ((patch.mailMode === 'google' || googleFromName !== undefined) && !current.google) throw new SettingsError(GOOGLE_CONNECT_FIRST);
  if (googleFromName !== undefined) next.google = { ...current.google!, fromName: googleFromName };
  writeSettings(db, next);
  return getAppSettings(db);
}

/** Compte Google connecté (ou déconnecté : null) et mode d'envoi. */
export function setGoogleSender(db: AppDb, google: GoogleSender | null, mailMode: MailMode): AppSettings {
  writeSettings(db, { google, mailMode });
  return getAppSettings(db);
}

/** Google a retiré l'accès de ce jeton : il faut se reconnecter (sans effet si un autre compte a été connecté depuis). */
export function markGoogleRevoked(db: AppDb, refreshToken: string): void {
  const { google } = getAppSettings(db);
  if (google?.refreshToken === refreshToken) writeSettings(db, { google: { ...google, status: 'reconnect' } });
}

/** Accès de ce jeton renouvelé avec succès (sans effet si un autre compte a été connecté depuis). */
export function markGoogleRefreshed(db: AppDb, at: string, refreshToken: string): void {
  const { google } = getAppSettings(db);
  if (google?.refreshToken === refreshToken) writeSettings(db, { google: { ...google, status: 'ok', lastRefreshAt: at } });
}
