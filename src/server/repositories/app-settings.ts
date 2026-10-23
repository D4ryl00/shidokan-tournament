import { DEFAULT_APP_SETTINGS, type AppSettings, type AppSettingsPatch, type PublicAppSettings } from '../../domain/app-settings.js';
import type { AppDb } from '../db/client.js';
import { appSettings } from '../db/schema.js';

/** Réglages enregistrés, complétés par les valeurs par défaut. */
export function getAppSettings(db: AppDb): AppSettings {
  const stored = Object.fromEntries(db.select().from(appSettings).all().map((r) => [r.key, JSON.parse(r.valueJson) as unknown]));
  return { ...DEFAULT_APP_SETTINGS, ...stored } as AppSettings;
}

/** Réglages tels que renvoyés à l'écran : jamais le mot de passe SMTP. */
export function publicAppSettings(s: AppSettings): PublicAppSettings {
  if (!s.smtp) return { ...s, smtp: null };
  const { password, ...smtp } = s.smtp;
  return { ...s, smtp: { ...smtp, hasPassword: !!password } };
}

export function updateAppSettings(db: AppDb, patch: AppSettingsPatch): AppSettings {
  const current = getAppSettings(db);
  const next: Partial<AppSettings> = { ...patch } as Partial<AppSettings>;
  if (patch.smtp) {
    // Mot de passe : null = inchangé, '' = effacé.
    const password = patch.smtp.password === null ? (current.smtp?.password ?? null) : patch.smtp.password || null;
    next.smtp = { ...patch.smtp, password };
  }
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(next)) {
      const valueJson = JSON.stringify(value);
      tx.insert(appSettings).values({ key, valueJson }).onConflictDoUpdate({ target: appSettings.key, set: { valueJson, updatedAt: new Date().toISOString() } }).run();
    }
  });
  return getAppSettings(db);
}
