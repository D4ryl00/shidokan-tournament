import type { AppDb } from '../db/client.js';
import { getAppSettings } from './app-settings.js';
import { pruneOldBackups } from './backups.js';

export interface PurgeReport {
  competitions: number;
  directoryEntries: number;
  backups: number;
}

const minus = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

/**
 * Efface ce qui a dépassé les délais de conservation (réglages de l'application), sans prévenir : données d'organisation des
 * compétitions anciennes (le palmarès reste), coordonnées des clubs de l'annuaire inactifs, vieilles sauvegardes. Idempotente.
 */
export function purgeExpiredData(db: AppDb, dbPath: string, now = new Date()): PurgeReport {
  const { retentionMonths, directoryInactiveYears } = getAppSettings(db);
  const client = db.$client;
  const competitionCutoff = minus(now, retentionMonths).toISOString().slice(0, 10);
  const directoryCutoff = minus(now, directoryInactiveYears * 12).toISOString();
  const report = { competitions: 0, directoryEntries: 0, backups: 0 };

  client.transaction(() => {
    const expired = client.prepare('select id from competitions where purged_at is null and date < ?').all(competitionCutoff) as { id: string }[];
    for (const { id } of expired) {
      client.prepare('update fighters set weigh_in_kg = null, licence = null, grade = null where competition_id = ?').run(id);
      client.prepare('update registrations set approx_weight_kg = null where competition_id = ?').run(id);
      client.prepare('update clubs set coach_phone = null, coach_email = null where competition_id = ?').run(id);
      for (const table of ['club_invitations', 'mail_log', 'uploads']) client.prepare(`delete from ${table} where competition_id = ?`).run(id);
      client.prepare('update competitions set purged_at = ? where id = ?').run(now.toISOString(), id);
    }
    report.competitions = expired.length;

    // Fiche sans compétition depuis le délai (ou jamais, et créée avant) : archivée, coordonnées effacées.
    report.directoryEntries = client
      .prepare(
        `update club_directory set archived = 1, coach_name = null, coach_phone = null, coach_email = null, notes = null
         where coalesce((select max(c.date) from clubs k join competitions c on c.id = k.competition_id where k.directory_club_id = club_directory.id),
                        substr(created_at, 1, 10)) < ?
           and (archived = 0 or coach_name is not null or coach_phone is not null or coach_email is not null or notes is not null)`,
      )
      .run(directoryCutoff.slice(0, 10)).changes;
  })();

  report.backups = pruneOldBackups(dbPath, minus(now, retentionMonths));
  return report;
}

/** Effacement au démarrage, puis une fois par jour ; renvoie la fonction d'arrêt. */
export function startRetention(db: AppDb, dbPath: string, onError: (e: unknown) => void): () => void {
  const run = () => {
    try {
      purgeExpiredData(db, dbPath);
    } catch (e) {
      onError(e);
    }
  };
  run();
  const timer = setInterval(run, 24 * 3600 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
