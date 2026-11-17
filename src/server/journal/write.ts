import type { JournalActor, JournalAction, JournalData, JournalType, JournalVia } from '../../domain/journal/types.js';
import { journalSearchText } from '../../domain/journal/text.js';
import type { AppDb } from '../db/client.js';
import { currentJournal } from './context.js';

export interface NewJournalEntry {
  type: JournalType;
  action: JournalAction;
  data: JournalData;
  via?: JournalVia;
  /** Heure du poste, si le client l'a donnée. */
  clientAt?: string;
  actor?: JournalActor;
}

/** Écrit une entrée (synchrone, dans la transaction en cours). Renvoie son identifiant. */
export function recordJournal(db: AppDb, competitionId: string, e: NewJournalEntry): string {
  const ctx = currentJournal();
  const actor = e.actor ?? ctx?.actor ?? { kind: 'app' };
  const via = e.via ?? ctx?.via ?? 'autre';
  const id = crypto.randomUUID();
  db.$client
    .prepare(
      `insert into journal_entries (id, competition_id, seq, parent_id, type, action, via, at, client_at, actor_json, data_json, search_text)
       values (?, ?, (select coalesce(max(seq), 0) + 1 from journal_entries where competition_id = ?), ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, ?)`,
    )
    .run(id, competitionId, competitionId, ctx?.parentId ?? null, e.type, e.action, via, e.clientAt ?? null, JSON.stringify(actor), JSON.stringify(e.data), journalSearchText({ action: e.action, data: e.data, actor, via }));
  if (ctx) ctx.written += 1;
  return id;
}

/** Écrit `parent`, puis les entrées de `fn` en deviennent les lignes de détail. */
export function withJournalGroup<T>(db: AppDb, competitionId: string, parent: NewJournalEntry, fn: () => T): T {
  const ctx = currentJournal();
  const id = recordJournal(db, competitionId, parent);
  if (!ctx) return fn();
  const before = ctx.parentId;
  ctx.parentId = id;
  try {
    return fn();
  } finally {
    ctx.parentId = before;
  }
}
