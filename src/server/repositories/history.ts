import { asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { CHANGED_REASON, compositionChanged, lockedReason, undoSet, type CascadeEntry } from '../../domain/history/cascade.js';
import type { HistoryEntryView, HistoryKind, HistorySummary } from '../../domain/history/types.js';
import { atomically } from '../db/atomic.js';
import type { AppDb } from '../db/client.js';
import { categories, fighters, historyEntries, recasements, registrations, zones } from '../db/schema.js';
import { CategoryLockedError, syncCategories } from './categories.js';
import { launchedCategoryIds } from './launch-state.js';
import { NotFoundError } from './registrations.js';
import { loadState, recomputeKeys, restoreSnapshot, snapshotTouches, StaleProposalError, type RecasementSnapshot } from './replacement.js';

/** Ce qu'une action écrit dans l'historique (le reste — catégories touchées, état d'avant — est calculé par `recorded`). */
export interface EntrySpec {
  kind: HistoryKind;
  groupId?: string | null;
  waveId: string | null;
  summary: HistorySummary;
  recasementIds?: string[];
  /** Inscriptions dont discipline, règlement et catégorie de poids d'avant sont rétablis par l'annulation. */
  registrations?: string[];
}

const STALE = 'Un autre poste a modifié ces tableaux : la liste est mise à jour.';

type CategoryRow = typeof categories.$inferSelect;
/** Ligne de catégorie gardée pour l'annulation : toutes les colonnes sauf la version de la ligne. */
type StoredCategory = Omit<CategoryRow, 'version' | 'updatedAt'>;
type RegistrationValues = { id: string; discipline: string; ruleset: string | null; weightClassId: string | null };
/** De quoi remettre l'état d'avant une action. */
interface Before {
  /** Lignes d'avant des catégories changées ou supprimées par l'action. */
  categories: StoredCategory[];
  /** Catégories créées par l'action. */
  created: string[];
  registrations: RegistrationValues[];
}

const storedCategory = ({ version: _version, updatedAt: _updatedAt, ...row }: CategoryRow): StoredCategory => row;
const categoryRows = (db: AppDb, competitionId: string) =>
  new Map(db.select().from(categories).where(eq(categories.competitionId, competitionId)).all().map((r) => [r.id, storedCategory(r)]));
const registrationRows = (db: AppDb, competitionId: string) =>
  db
    .select({ id: registrations.id, categoryId: registrations.categoryId, presence: registrations.presence, discipline: registrations.discipline, ruleset: registrations.ruleset, weightClassId: registrations.weightClassId })
    .from(registrations)
    .where(eq(registrations.competitionId, competitionId))
    .all();
/** Inscrits présents (non absents) de chaque catégorie, triés : ceux qui figurent dans son tableau. */
function presentMembers(rows: { id: string; categoryId: string | null; presence: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) if (r.categoryId && r.presence !== 'absent') out.set(r.categoryId, [...(out.get(r.categoryId) ?? []), r.id]);
  for (const ids of out.values()) ids.sort();
  return out;
}
const sameIds = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join('\n') === (b ?? []).join('\n');

/**
 * Exécute une action dans une transaction et l'inscrit à l'historique avec de quoi la défaire. Catégories touchées : lignes
 * changées (hors version), créées ou supprimées, et celles dont les inscrits présents ont changé. Sans `sync: false`, les
 * catégories sont synchronisées après l'action (tableaux refaits) ; un plan, lui, synchronise une fois à la fin.
 * Rien de changé et aucun recasement : rien n'est écrit (`historyId` nul).
 */
export async function recorded<T>(
  db: AppDb,
  competitionId: string,
  spec: EntrySpec | ((result: T) => EntrySpec),
  action: () => Promise<T>,
  opts: { sync?: boolean } = {},
): Promise<{ result: T; historyId: string | null }> {
  return atomically(db, async () => {
    const rows0 = categoryRows(db, competitionId);
    const regs0 = registrationRows(db, competitionId);
    const members0 = presentMembers(regs0);
    const result = await action();
    if (opts.sync !== false) await syncCategories(db, competitionId);
    const rows1 = categoryRows(db, competitionId);
    const members1 = presentMembers(registrationRows(db, competitionId));
    const s = typeof spec === 'function' ? spec(result) : spec;
    const changed = [...rows0.keys()].filter((id) => !rows1.has(id) || JSON.stringify(rows0.get(id)) !== JSON.stringify(rows1.get(id)));
    const created = [...rows1.keys()].filter((id) => !rows0.has(id));
    const regrouped = [...new Set([...members0.keys(), ...members1.keys()])].filter((id) => !sameIds(members0.get(id), members1.get(id)));
    const touched = [...new Set([...changed, ...created, ...regrouped])];
    const recasementIds = s.recasementIds ?? [];
    if (touched.length === 0 && recasementIds.length === 0) return { result, historyId: null };
    const wanted = new Set(s.registrations ?? []);
    const before: Before = {
      categories: changed.map((id) => rows0.get(id)!),
      created,
      registrations: regs0.filter((r) => wanted.has(r.id)).map(({ id, discipline, ruleset, weightClassId }) => ({ id, discipline, ruleset, weightClassId })),
    };
    const afterMembers = Object.fromEntries(touched.filter((id) => rows1.has(id)).map((id) => [id, members1.get(id) ?? []]));
    const id = crypto.randomUUID();
    db.insert(historyEntries)
      .values({
        id,
        competitionId,
        kind: s.kind,
        groupId: s.groupId ?? null,
        waveId: s.waveId,
        summaryJson: JSON.stringify(s.summary),
        recasementIds: JSON.stringify(recasementIds),
        categoryIds: JSON.stringify(touched),
        beforeJson: JSON.stringify(before),
        afterMembersJson: JSON.stringify(afterMembers),
      })
      .run();
    return { result, historyId: id };
  });
}

export interface Loaded extends CascadeEntry {
  row: typeof historyEntries.$inferSelect;
  summary: HistorySummary;
  recasementIds: string[];
  before: Before;
  /** Reprise de l'ancien journal : sans état d'avant des catégories (touchées d'après l'instantané du recasement). */
  legacy: boolean;
  /** Catégories qui bloquent l'annulation si elles sont lancées : touchées, plus la catégorie actuelle des inscrits déplacés. */
  lockCategories: string[];
}

/** Entrées de la compétition (ordre d'insertion), avec ce qu'il faut pour la cascade et les blocages. */
export function loadEntries(db: AppDb, competitionId: string): Loaded[] {
  const rows = db
    .select({ ...getTableColumns(historyEntries), seq: sql<number>`rowid` })
    .from(historyEntries)
    .where(eq(historyEntries.competitionId, competitionId))
    .orderBy(asc(sql`rowid`))
    .all();
  const recs = new Map(db.select().from(recasements).where(eq(recasements.competitionId, competitionId)).all().map((r) => [r.id, r]));
  const current = new Map(registrationRows(db, competitionId).map((r) => [r.id, r.categoryId]));
  return rows.map(({ seq, ...row }) => {
    const recasementIds = JSON.parse(row.recasementIds) as string[];
    const stored = JSON.parse(row.categoryIds) as string[];
    const moved = recasementIds.map((id) => recs.get(id)).filter((r) => r !== undefined);
    const legacy = stored.length === 0 && moved.length > 0;
    const categoryIds = legacy
      ? [...new Set(moved.flatMap((r) => snapshotTouches(current.get(r.registrationId) ?? null, JSON.parse(r.snapshotJson) as RecasementSnapshot)))]
      : stored;
    const nowIn = moved.map((r) => current.get(r.registrationId)).filter((c): c is string => !!c);
    return {
      id: row.id,
      seq,
      active: row.status === 'active',
      kind: row.kind as HistoryKind,
      categoryIds,
      afterMembers: JSON.parse(row.afterMembersJson) as Record<string, string[]>,
      row,
      summary: JSON.parse(row.summaryJson) as HistorySummary,
      recasementIds,
      before: JSON.parse(row.beforeJson) as Before,
      legacy,
      lockCategories: [...new Set([...categoryIds, ...nowIn])],
    };
  });
}

interface BlockContext {
  /** Catégories lancées ou terminées, ou d'une session lancée. */
  locked: Set<string>;
  labels: Map<string, string>;
  members: Map<string, string[]>;
}

/**
 * Catégories fermées à l'annulation, même règle qu'aujourd'hui : lancées ou terminées, à numéros figés d'une session lancée,
 * ou d'une session lancée (`frozen` de l'état du recasement, y compris sans combat ni passage). Synchronise les catégories
 * (via `loadState`) : à appeler avant de lire les entrées.
 */
async function blockContext(db: AppDb, competitionId: string): Promise<BlockContext> {
  const frozen = new Set((await loadState(db, competitionId)).categories.filter((c) => c.frozen).map((c) => c.id));
  const cats = db.select({ id: categories.id, label: categories.label, status: categories.status }).from(categories).where(eq(categories.competitionId, competitionId)).all();
  const launched = launchedCategoryIds(db, competitionId);
  return {
    locked: new Set(cats.filter((c) => c.status === 'started' || c.status === 'finished' || launched.has(c.id) || frozen.has(c.id)).map((c) => c.id)),
    labels: new Map(cats.map((c) => [c.id, c.label])),
    members: presentMembers(registrationRows(db, competitionId)),
  };
}

/** Raison pour laquelle le lot ne peut pas être annulé, ou `null`. */
function blockReason(set: Loaded[], ctx: BlockContext): string | null {
  for (const e of set) for (const c of e.lockCategories) if (ctx.locked.has(c)) return lockedReason(ctx.labels.get(c) ?? '');
  return compositionChanged(set, ctx.members) ? CHANGED_REASON : null;
}

/** Entrée de l'historique qui porte une réaffectation (journal des recasements), ou `undefined`. */
export function entryOfRecasement(db: AppDb, competitionId: string, recasementId: string): string | undefined {
  return db
    .select({ id: historyEntries.id })
    .from(historyEntries)
    .where(sql`${historyEntries.competitionId} = ${competitionId} AND EXISTS (SELECT 1 FROM json_each(${historyEntries.recasementIds}) WHERE value = ${recasementId})`)
    .get()?.id;
}

/**
 * Historique de la compétition, plus récent d'abord ; `waveId` : seulement les actions faites depuis cette session (null :
 * toutes). La cascade et les blocages sont calculés sur toutes les entrées.
 */
export async function listHistory(db: AppDb, competitionId: string, waveId: string | null): Promise<{ entries: HistoryEntryView[] }> {
  const ctx = await blockContext(db, competitionId);
  const all = loadEntries(db, competitionId);
  const names = new Map(
    db
      .select({ id: registrations.id, lastName: fighters.lastName, firstName: fighters.firstName })
      .from(registrations)
      .innerJoin(fighters, eq(fighters.id, registrations.fighterId))
      .where(eq(registrations.competitionId, competitionId))
      .all()
      .map((r) => [r.id, `${r.lastName} ${r.firstName}`.trim()]),
  );
  const entries = all
    .filter((e) => waveId === null || e.row.waveId === waveId)
    .sort((a, b) => b.seq - a.seq)
    .map((e): HistoryEntryView => {
      const set = e.active ? undoSet(all, [e.id]) : [];
      return {
        id: e.id,
        seq: e.seq,
        kind: e.kind,
        groupId: e.row.groupId,
        status: e.row.status,
        createdAt: e.row.createdAt,
        undoneAt: e.row.undoneAt,
        waveId: e.row.waveId,
        names: e.summary.registrationIds.map((id) => names.get(id) ?? '—'),
        summary: e.summary,
        categoryIds: e.categoryIds,
        afterMembers: e.afterMembers,
        blocked: e.active ? blockReason(set, ctx) : null,
        cascade: set.filter((x) => x.id !== e.id).map((x) => x.id),
      };
    });
  return { entries };
}

/** Réécrit l'état d'avant une entrée (dans la transaction de l'appelant). */
function undoEntry(t: AppDb, e: Loaded, undoneAt: string): void {
  // Lignes de catégorie d'abord (même id) : une catégorie supprimée par l'action revient avant que ses inscrits y retournent.
  for (const c of e.before.categories) {
    const { id, ...values } = c;
    if (t.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get()) {
      // Ligne existante : seulement ce qu'une action de l'historique change (statut, zone, session et ordre restent ceux d'aujourd'hui).
      const { keyString, keyJson, label, aliasKeys, format, repechage, thirdPlace, seed, bracketJson, stale, arranged } = values;
      t.update(categories).set({ keyString, keyJson, label, aliasKeys, format, repechage, thirdPlace, seed, bracketJson, stale, arranged }).where(eq(categories.id, id)).run();
    } else {
      const zoneId = c.zoneId && t.select({ id: zones.id }).from(zones).where(eq(zones.id, c.zoneId)).get() ? c.zoneId : null;
      t.insert(categories).values({ ...c, zoneId }).run();
    }
  }
  for (const rid of [...e.recasementIds].reverse()) {
    const rec = t.select().from(recasements).where(eq(recasements.id, rid)).get();
    if (!rec || rec.status !== 'validated') continue;
    restoreSnapshot(t, rec.registrationId, JSON.parse(rec.snapshotJson) as RecasementSnapshot);
    t.update(recasements).set({ status: 'undone' }).where(eq(recasements.id, rid)).run();
  }
  for (const r of e.before.registrations) {
    t.update(registrations)
      .set({ discipline: r.discipline as typeof registrations.$inferInsert.discipline, ruleset: r.ruleset as typeof registrations.$inferInsert.ruleset, weightClassId: r.weightClassId })
      .where(eq(registrations.id, r.id))
      .run();
  }
  t.update(historyEntries).set({ status: 'undone', undoneAt }).where(eq(historyEntries.id, e.id)).run();
}

/**
 * Annule `ids` et leur cascade (actions plus récentes qui touchent, de proche en proche, les mêmes catégories), de la plus
 * récente à la plus ancienne, tout ou rien. `expect` : le lot affiché (null : pas de contrôle) ; s'il diffère, un autre poste
 * a agi entre-temps et rien n'est annulé.
 */
export async function undoHistory(db: AppDb, competitionId: string, ids: string[], expect: string[] | null): Promise<{ undone: string[] }> {
  return atomically(db, async () => {
    const ctx = await blockContext(db, competitionId);
    const all = loadEntries(db, competitionId);
    const known = new Set(all.map((e) => e.id));
    if (ids.some((id) => !known.has(id))) throw new NotFoundError('Action introuvable dans l’historique');
    const set = undoSet(all, ids);
    if (set.length === 0) throw new StaleProposalError(STALE);
    if (expect !== null && [...expect].sort().join('\n') !== set.map((e) => e.id).sort().join('\n')) throw new StaleProposalError(STALE);
    const reason = blockReason(set, ctx);
    if (reason) throw new CategoryLockedError(reason);
    await undoEntries(db, competitionId, set);
    return { undone: set.map((e) => e.id) };
  });
}

/**
 * Annule un lot déjà calculé (`undoSet`, plus récente d'abord) sans contrôle (blocages vérifiés par l'appelant), puis
 * synchronise. Dans la transaction de l'appelant s'il y en a une.
 */
export async function undoEntries(db: AppDb, competitionId: string, set: Loaded[]): Promise<void> {
  const undoneAt = new Date().toISOString();
  db.transaction((tx) => {
    for (const e of set) undoEntry(tx as unknown as AppDb, e, undoneAt);
  });
  // Reprises de l'ancien journal : leurs catégories n'ont pas d'état d'avant, leurs clés sont recalculées d'après leurs membres.
  const legacy = [...new Set(set.filter((e) => e.legacy).flatMap((e) => e.categoryIds))];
  if (legacy.length) await recomputeKeys(db, competitionId, () => legacy);
  else await syncCategories(db, competitionId);
}
