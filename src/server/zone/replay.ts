import type { MatchMethod } from '../../domain/brackets/index.js';
import type { AppDb } from '../db/client.js';
import { deleteResult, matchEntrants, putKataNotes, putResult, putTieBreak } from '../repositories/results.js';
import { kataRev, resultRev, tieBreakRev } from '../revisions.js';
import { targetKey, type ZoneEntry, type ZoneJournalFile } from './entry.js';

export type EntryStatus = 'applied' | 'present' | 'conflict' | 'waiting';

export const CHANGED_ENTRANTS = 'Les combattants de ce combat ont changé.';
export const OTHER_ENTRY = 'Une autre saisie a été faite sur le PC principal.';

const currentRev = (db: AppDb, e: ZoneEntry) =>
  (e.kind === 'result' || e.kind === 'delete' ? resultRev(db, e.categoryId, e.matchId!) : e.kind === 'kata' ? kataRev(db, e.categoryId, e.registrationId!, e.round!) : tieBreakRev(db, e.categoryId, e.scope!)) ?? 'none';

/** L'état actuel est-il déjà celui que la saisie donnerait ? */
function alreadyThere(db: AppDb, e: ZoneEntry, entrants: [string, string] | null): boolean {
  const q = db.$client;
  if (e.kind === 'result' || e.kind === 'delete') {
    const r = q.prepare('select winner, method, score, entrant_a as a, entrant_b as b from match_results where category_id = ? and match_id = ?').get(e.categoryId, e.matchId) as
      | { winner: string; method: string; score: string | null; a: string; b: string }
      | undefined;
    if (e.kind === 'delete') return !r;
    const d = e.data as { winner: string; method: string; score: string | null };
    return !!r && !!entrants && r.winner === d.winner && r.method === d.method && (r.score ?? null) === (d.score ?? null) && r.a === entrants[0] && r.b === entrants[1];
  }
  if (e.kind === 'kata') {
    const r = q.prepare('select notes_json as n from kata_scores where category_id = ? and registration_id = ? and round = ?').get(e.categoryId, e.registrationId, e.round) as { n: string } | undefined;
    return (r?.n ?? '[]') === JSON.stringify((e.data as { notes: number[] }).notes);
  }
  const r = q.prepare('select order_json as o from tie_breaks where category_id = ? and scope = ?').get(e.categoryId, e.scope) as { o: string } | undefined;
  if (!r) return false;
  // Un départage se fusionne avec le précédent : rien à faire si la fusion ne change rien.
  const previous = JSON.parse(r.o) as string[];
  const order = (e.data as { order: string[] }).order;
  return JSON.stringify([...previous.filter((id) => !order.includes(id)), ...order]) === r.o;
}

async function write(db: AppDb, competitionId: string, e: ZoneEntry): Promise<void> {
  if (e.kind === 'result') {
    const d = e.data as { winner: 'a' | 'b'; method: MatchMethod; score: string | null };
    await putResult(db, competitionId, e.categoryId, e.matchId!, d);
  } else if (e.kind === 'delete') await deleteResult(db, competitionId, e.categoryId, e.matchId!);
  else if (e.kind === 'kata') await putKataNotes(db, competitionId, e.categoryId, e.registrationId!, e.round!, (e.data as { notes: number[] }).notes);
  else await putTieBreak(db, competitionId, e.categoryId, e.scope!, (e.data as { order: string[] }).order);
}

/**
 * Une entrée contre l'état actuel : en attente derrière un conflit de sa catégorie, conflit si les combattants ont changé, déjà
 * présente, appliquée si la donnée est celle que la zone avait lue (ou celle de sa propre saisie précédente), sinon conflit.
 * `apply` : l'écrire si possible ; `ignoreRev` : « Garder celui de la zone » (sans contrôle de révision, mêmes combattants exigés).
 */
export async function evaluateEntry(
  db: AppDb,
  competitionId: string,
  e: ZoneEntry,
  ctx: { blockedCategories: Set<string>; lastAppliedRev: (e: ZoneEntry) => string | null; apply: boolean; ignoreRev?: boolean },
): Promise<{ status: EntryStatus; reason: string | null; appliedRev: string | null }> {
  const conflict = (reason: string) => ({ status: 'conflict' as const, reason, appliedRev: null });
  if (ctx.blockedCategories.has(e.categoryId)) return { status: 'waiting', reason: null, appliedRev: null };
  let entrants: [string, string] | null = null;
  try {
    if (e.kind === 'result' || e.kind === 'delete') {
      entrants = await matchEntrants(db, competitionId, e.categoryId, e.matchId!);
      if (JSON.stringify(entrants) !== JSON.stringify(e.entrants)) return conflict(CHANGED_ENTRANTS);
    }
  } catch (err) {
    return conflict((err as Error).message);
  }
  if (alreadyThere(db, e, entrants)) return { status: 'present', reason: null, appliedRev: null };
  const rev = currentRev(db, e);
  if (!ctx.ignoreRev && rev !== e.baseRev && rev !== ctx.lastAppliedRev(e)) return conflict(OTHER_ENTRY);
  if (!ctx.apply) return { status: 'applied', reason: null, appliedRev: null };
  try {
    await write(db, competitionId, e);
  } catch (err) {
    return conflict((err as Error).message);
  }
  return { status: 'applied', reason: null, appliedRev: currentRev(db, e) };
}

/** Une réception à la fois par compétition (réseau et fichier en même temps, ou une décision pendant une réception). */
const queues = new Map<string, Promise<unknown>>();
export function serialized<T>(competitionId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(competitionId) ?? Promise.resolve()).then(fn);
  queues.set(competitionId, run.catch(() => undefined));
  return run;
}

/** Révision laissée par la dernière saisie appliquée de ce portable sur la même donnée (sa propre correction n'est pas un conflit). */
export const lastAppliedRevOf = (db: AppDb, competitionId: string, fromInstanceId: string) => (e: ZoneEntry) =>
  (
    db.$client
      .prepare("select applied_rev as r from zone_entries where competition_id = ? and from_instance_id = ? and category_id = ? and target_key = ? and seq < ? and status in ('applied', 'kept-zone') order by seq desc limit 1")
      .get(competitionId, fromInstanceId, e.categoryId, targetKey(e), e.seq) as { r: string | null } | undefined
  )?.r ?? null;

/** Catégories bloquées pour ce portable : une de ses entrées y est encore à trancher. */
export const openCategories = (db: AppDb, competitionId: string, fromInstanceId: string) =>
  new Set(
    (db.$client.prepare("select distinct category_id as c from zone_entries where competition_id = ? and from_instance_id = ? and status in ('conflict', 'waiting')").all(competitionId, fromInstanceId) as { c: string }[]).map((r) => r.c),
  );

/** Rejoue un journal de zone dans l'ordre ; chaque entrée reçue est gardée avec son sort, et une entrée déjà reçue est ignorée. */
export function receiveJournal(db: AppDb, journal: ZoneJournalFile) {
  return serialized(journal.competitionId, async () => {
    const counts = { received: journal.entries.length, applied: 0, present: 0, conflicts: 0, waiting: 0, alreadyReceived: 0 };
    const from = journal.from.instanceId;
    const blocked = openCategories(db, journal.competitionId, from);
    const lastAppliedRev = lastAppliedRevOf(db, journal.competitionId, from);
    const known = db.$client.prepare('select 1 from zone_entries where id = ?');
    const insert = db.$client.prepare(
      'insert into zone_entries (id, competition_id, from_instance_id, zone_id, zone_name, seq, kind, category_id, target_key, entry_json, status, reason, applied_rev) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of [...journal.entries].sort((a, b) => a.seq - b.seq)) {
      if (known.get(e.id)) {
        counts.alreadyReceived++;
        continue;
      }
      const r = await evaluateEntry(db, journal.competitionId, e, { blockedCategories: blocked, lastAppliedRev, apply: true });
      insert.run(e.id, journal.competitionId, from, journal.zoneId, journal.zoneName, e.seq, e.kind, e.categoryId, targetKey(e), JSON.stringify(e), r.status, r.reason, r.appliedRev);
      if (r.status === 'conflict' || r.status === 'waiting') blocked.add(e.categoryId);
      counts[r.status === 'applied' ? 'applied' : r.status === 'present' ? 'present' : r.status === 'conflict' ? 'conflicts' : 'waiting']++;
    }
    return counts;
  });
}

export class CardError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

type EntryRow = { id: string; from: string; status: string; e: string };
const entryRow = (db: AppDb, competitionId: string, entryId: string) =>
  db.$client.prepare('select id, from_instance_id as "from", status, entry_json as e from zone_entries where competition_id = ? and id = ?').get(competitionId, entryId) as EntryRow | undefined;

/**
 * Carte « À trancher » : `zone` applique la saisie sans contrôle de révision (mêmes combattants exigés), `pc` garde le PC principal.
 * Ensuite, les entrées en attente de la catégorie (même portable) sont réexaminées dans l'ordre.
 */
export function decideCard(db: AppDb, competitionId: string, entryId: string, keep: 'zone' | 'pc'): Promise<void> {
  return serialized(competitionId, async () => {
    const row = entryRow(db, competitionId, entryId);
    if (!row) throw new CardError(404, 'Carte introuvable.');
    if (row.status !== 'conflict' && row.status !== 'waiting') throw new CardError(409, 'Cette carte a déjà été tranchée.');
    const e = JSON.parse(row.e) as ZoneEntry;
    const now = new Date().toISOString();
    const lastAppliedRev = lastAppliedRevOf(db, competitionId, row.from);
    if (keep === 'zone') {
      const r = await evaluateEntry(db, competitionId, e, { blockedCategories: new Set(), lastAppliedRev, apply: true, ignoreRev: true });
      if (r.status === 'conflict') {
        throw new CardError(409, r.reason === CHANGED_ENTRANTS ? 'Les combattants de ce combat ont changé : impossible de garder la saisie de la zone.' : (r.reason ?? 'Saisie refusée.'));
      }
      db.$client.prepare("update zone_entries set status = 'kept-zone', reason = null, applied_rev = ?, decided_at = ? where id = ?").run(r.appliedRev, now, entryId);
    } else {
      db.$client.prepare("update zone_entries set status = 'kept-pc', decided_at = ? where id = ?").run(now, entryId);
    }
    // Réexamen des entrées en attente de la catégorie : elles s'appliquent jusqu'au prochain conflit.
    const waiting = db.$client
      .prepare("select id, from_instance_id as \"from\", status, entry_json as e, seq from zone_entries where competition_id = ? and from_instance_id = ? and category_id = ? and status in ('conflict', 'waiting') order by seq")
      .all(competitionId, row.from, e.categoryId) as (EntryRow & { seq: number })[];
    for (const w of waiting) {
      if (w.status === 'conflict') break;
      const r = await evaluateEntry(db, competitionId, JSON.parse(w.e) as ZoneEntry, { blockedCategories: new Set(), lastAppliedRev, apply: true });
      db.$client.prepare('update zone_entries set status = ?, reason = ?, applied_rev = ? where id = ?').run(r.status, r.reason, r.appliedRev, w.id);
      if (r.status === 'conflict') break;
    }
  });
}
