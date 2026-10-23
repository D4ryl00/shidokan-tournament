import type { AppDb } from './client.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
/** Déclencheurs de chaque table versionnée (préfixés du nom de la table). */
const TRIGGERS = ['version_insert', 'version_keep', 'version_update', 'version_set'];

const tableNames = (db: AppDb): string[] =>
  (db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
const columnNames = (db: AppDb, table: string): string[] =>
  (db.$client.prepare('select name from pragma_table_info(?)').all(table) as { name: string }[]).map((c) => c.name);

/**
 * Tables versionnées, calculées depuis sqlite_master : competitions, club_directory, et les tables qui ont competition_id sauf uploads
 * et users (un compte Zone porte la compétition où il saisit, mais les comptes sont propres à l'installation). Triées.
 */
export function versionedTables(db: AppDb): string[] {
  return tableNames(db)
    .filter((t) => t === 'competitions' || t === 'club_directory' || (t !== 'uploads' && t !== 'users' && columnNames(db, t).includes('competition_id')))
    .sort();
}

/**
 * Crée la ligne du compteur et (re)crée les déclencheurs — une définition corrigée remplace ainsi l'ancienne dans les bases existantes —,
 * puis donne une version aux lignes qui n'en ont pas. Idempotente.
 * Ne fait rien si la table change_counter n'existe pas (base d'avant 0014, ouverte par le helper de test olderDb).
 * Une ligne qui reçoit une version explicite (restauration, futur transfert) la garde, et le compteur est relevé à au moins cette valeur.
 * Une version vient d'un compteur unique pour toute la base : une ligne effacée puis recréée ne reprend jamais une ancienne version.
 */
export function ensureRowVersions(db: AppDb): void {
  if (!tableNames(db).includes('change_counter')) return;
  const client = db.$client;
  client.transaction(() => {
    client.exec('INSERT OR IGNORE INTO change_counter (id, value) VALUES (1, 0)');
    for (const t of versionedTables(db)) {
      // Une table de compétition oubliée par une migration reçoit ses colonnes ici : le démarrage ne doit jamais échouer pour ça
      // (le test « schéma drizzle : chaque table versionnée… » le signale avant).
      const cols = columnNames(db, t);
      if (!cols.includes('version')) client.exec(`ALTER TABLE "${t}" ADD COLUMN version integer`);
      if (!cols.includes('updated_at')) client.exec(`ALTER TABLE "${t}" ADD COLUMN updated_at text`);
      const next = `UPDATE change_counter SET value = value + 1 WHERE id = 1;`;
      const current = '(SELECT value FROM change_counter WHERE id = 1)';
      const raise = 'UPDATE change_counter SET value = max(value, NEW.version) WHERE id = 1;';
      // L'UPDATE fait par « version_insert » change la version : « version_update » ne se déclenche donc pas en plus.
      client.exec(`
        ${TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS "${t}__${name}";`).join('\n')}
        CREATE TRIGGER "${t}__version_insert" AFTER INSERT ON "${t}" WHEN NEW.version IS NULL BEGIN
          ${next}
          UPDATE "${t}" SET version = ${current}, updated_at = coalesce(NEW.updated_at, ${NOW}) WHERE rowid = NEW.rowid;
        END;
        CREATE TRIGGER "${t}__version_keep" AFTER INSERT ON "${t}" WHEN NEW.version IS NOT NULL BEGIN
          ${raise}
        END;
        CREATE TRIGGER "${t}__version_update" AFTER UPDATE ON "${t}" WHEN NEW.version IS OLD.version BEGIN
          ${next}
          UPDATE "${t}" SET version = ${current}, updated_at = ${NOW} WHERE rowid = NEW.rowid;
        END;
        CREATE TRIGGER "${t}__version_set" AFTER UPDATE ON "${t}" WHEN NEW.version IS NOT OLD.version AND NEW.version IS NOT NULL BEGIN
          ${raise}
        END;
        UPDATE "${t}" SET updated_at = updated_at WHERE version IS NULL;
      `);
    }
  })();
}

/** Retire version et updatedAt d'une ligne avant de la renvoyer par l'API. */
export function withoutRowMeta<T extends { version: unknown; updatedAt: unknown }>(row: T): Omit<T, 'version' | 'updatedAt'> {
  const { version: _v, updatedAt: _u, ...rest } = row;
  return rest;
}
