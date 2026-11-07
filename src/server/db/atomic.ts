import type { AppDb } from './client.js';

/**
 * Tout ou rien : `fn` s'exécute dans une transaction (BEGIN IMMEDIATE / COMMIT, ROLLBACK sur erreur). Si une transaction est
 * déjà ouverte, `fn` s'y emboîte (les `db.transaction` de drizzle deviennent des points de sauvegarde) et c'est l'appelant qui décide.
 * Base synchrone : aucune autre requête ne passe entre-temps.
 */
export async function atomically<T>(db: AppDb, fn: () => Promise<T>): Promise<T> {
  const raw = db.$client;
  if (raw.inTransaction) return fn();
  raw.exec('BEGIN IMMEDIATE');
  try {
    const out = await fn();
    raw.exec('COMMIT');
    return out;
  } catch (e) {
    if (raw.inTransaction) raw.exec('ROLLBACK');
    throw e;
  }
}

/** Exécute `fn` puis annule toujours ses écritures (essai à blanc) ; rend sa valeur, ou relance son erreur. */
export async function dryRun<T>(db: AppDb, fn: () => Promise<T>): Promise<T> {
  const raw = db.$client;
  if (raw.inTransaction) {
    raw.exec('SAVEPOINT dry_run');
    try {
      return await fn();
    } finally {
      raw.exec('ROLLBACK TO dry_run');
      raw.exec('RELEASE dry_run');
    }
  }
  raw.exec('BEGIN IMMEDIATE');
  try {
    return await fn();
  } finally {
    if (raw.inTransaction) raw.exec('ROLLBACK');
  }
}
