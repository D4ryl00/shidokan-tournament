import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ensureRowVersions } from './row-versions.js';
import * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? path.resolve(import.meta.dirname, '../../../drizzle');
}

/** Ouvre (ou crée) la base, crée son dossier si besoin et applique les migrations. */
export function openDb(file: string): AppDb {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  ensureRowVersions(db);
  return db;
}

export function closeDb(db: AppDb): void {
  db.$client.close();
}
