import Database from 'better-sqlite3';
import type { LightMyRequestResponse as Res } from 'fastify';
import { expect } from 'vitest';

type Call = (method: 'GET' | 'POST', url: string, payload?: object) => Promise<Res>;

/** Lecture directe (seule) de la base de test, refermée aussitôt. */
function read<T>(dbPath: string, sql: string, ...params: unknown[]): T | undefined {
  const raw = new Database(dbPath, { readonly: true });
  try {
    return raw.prepare(sql).get(...params) as T | undefined;
  } finally {
    raw.close();
  }
}

/** Entrée de l'historique qui porte la réaffectation `recasementId`. */
export function entryOfRecasement(dbPath: string, recasementId: string): string {
  const row = read<{ id: string }>(dbPath, 'SELECT id FROM history_entries WHERE EXISTS (SELECT 1 FROM json_each(recasement_ids) WHERE value = ?)', recasementId);
  expect(row, `entrée de l'historique de la réaffectation ${recasementId}`).toBeDefined();
  return row!.id;
}

/** Entrée du dernier déplacement validé d'une inscription (ordre d'insertion des réaffectations). */
export function lastMoveEntry(dbPath: string, registrationId: string): string {
  const rec = read<{ id: string }>(dbPath, "SELECT id FROM recasements WHERE registration_id = ? AND status = 'validated' ORDER BY rowid DESC LIMIT 1", registrationId);
  expect(rec, `réaffectation validée de ${registrationId}`).toBeDefined();
  return entryOfRecasement(dbPath, rec!.id);
}

/**
 * Annule l'entrée `entryId` par l'historique, comme le fait l'interface : le lot affiché (elle et sa cascade, lus dans
 * GET /history) est renvoyé en `expect`.
 */
export async function undoEntry(call: Call, entryId: string): Promise<Res> {
  const { entries } = (await call('GET', '/history')).json() as { entries: { id: string; cascade: string[] }[] };
  const shown = entries.find((e) => e.id === entryId);
  return call('POST', '/history/undo', { ids: [entryId], expect: [entryId, ...(shown?.cascade ?? [])] });
}

/** Annule une réaffectation (et sa cascade) par l'historique. */
export const undoRecasement = (call: Call, dbPath: string, recasementId: string) => undoEntry(call, entryOfRecasement(dbPath, recasementId));

/** Annule le dernier déplacement validé d'une inscription (et sa cascade) par l'historique. */
export const undoLastMove = (call: Call, dbPath: string, registrationId: string) => undoEntry(call, lastMoveEntry(dbPath, registrationId));

/** « Repartir de zéro » comme l'interface : le lot de l'aperçu (GET /replacement) est renvoyé en `expect`. */
export async function resetAsShown(call: Call, waveId?: string): Promise<Res> {
  const preview = (await call('GET', `/replacement${waveId ? `?vague=${encodeURIComponent(waveId)}` : ''}`)).json() as { reset: { lot: string[] } };
  return call('POST', '/replacement/reset', { ...(waveId ? { waveId } : {}), expect: preview.reset.lot });
}
