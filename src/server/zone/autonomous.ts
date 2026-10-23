import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { entryZones } from '../auth/permissions.js';
import type { AppDb } from '../db/client.js';
import type { Bracket } from '../../domain/brackets/index.js';
import { finalMatchIds } from '../../domain/passages/index.js';
import { launchedCategoryIds } from '../repositories/launch-state.js';
import { passagePlan } from '../repositories/passages.js';
import { matchEntrants } from '../repositories/results.js';
import { kataRev, resultRev, tieBreakRev } from '../revisions.js';
import { myIdentity } from '../sync/pull.js';
import { targetKey, type ZoneEntry, type ZoneJournalFile } from './entry.js';
import { getZoneLink, ZoneLinkError, type ZoneLink } from './link.js';

const C = '/api/competitions/:id';
/** Saisies permises en zone autonome (les mêmes que celles d'un compte Zone). */
const ZONE_WRITES: Record<string, ZoneEntry['kind']> = {
  [`PUT ${C}/categories/:cid/results/:matchId`]: 'result',
  [`DELETE ${C}/categories/:cid/results/:matchId`]: 'delete',
  [`PUT ${C}/categories/:cid/kata/:rid/:round`]: 'kata',
  [`PUT ${C}/categories/:cid/tie-break`]: 'tie-break',
};

type Params = { id?: string; cid?: string; matchId?: string; rid?: string; round?: string };

export const zoneName = (db: AppDb, link: Pick<ZoneLink, 'zoneId' | 'competitionId'>) =>
  (db.$client.prepare('select name from zones where id = ? and competition_id = ?').get(link.zoneId, link.competitionId) as { name: string } | undefined)?.name ?? link.zoneId;

/** La zone autonome de ce PC porte sur cette compétition (copie du PC principal) : son réglage, sinon null. */
export function autonomousLink(db: AppDb, competitionId: string | undefined): ZoneLink | null {
  const link = getZoneLink(db);
  if (!link?.autonomous || !competitionId || link.competitionId !== competitionId) return null;
  const owner = db.$client.prepare('select owner_instance_id as o from competitions where id = ?').get(competitionId) as { o: string | null } | undefined;
  return owner?.o && owner.o === link.mainInstanceId ? link : null;
}

/**
 * Compétitions dont le journal part au PC principal, ou qui reçoivent une copie plus récente : aucune saisie pendant ce temps
 * (elle ne serait pas dans le journal envoyé, ou serait remplacée par la copie). La valeur est le message de refus.
 */
const busy = new Map<string, string>();
export async function whileBusy<T>(competitionId: string, message: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(competitionId)) throw new ZoneLinkError(409, busy.get(competitionId)!);
  busy.set(competitionId, message);
  try {
    return await fn();
  } finally {
    busy.delete(competitionId);
  }
}
export const SENDING = 'Envoi du journal en cours : réessayez dans un instant.';
export const REFRESHING = 'Nouvelle copie en cours de réception : réessayez dans un instant.';

/** Décision de la garde en zone autonome : null = permis, sinon le message de refus. */
export async function autonomousRefusal(db: AppDb, link: ZoneLink, method: string, route: string, params: Record<string, string>): Promise<string | null> {
  const pause = busy.get(link.competitionId);
  if (pause) return pause;
  const name = zoneName(db, link);
  if (!ZONE_WRITES[`${method} ${route}`] || !params.cid) return `Zone autonome : seules les saisies de la zone ${name} sont possibles sur ce PC.`;
  // Une session pas encore lancée sur la copie peut changer de zone au lancement sur le PC principal.
  if (!launchedCategoryIds(db, link.competitionId).has(params.cid)) return 'Session suivante pas encore lancée sur cette copie.';
  const target = params.matchId ? { matchId: params.matchId } : params.round ? { kataRound: params.round === 'final' ? ('final' as const) : ('round1' as const) } : ('tie-break' as const);
  const zones = await entryZones(db, link.competitionId, params.cid, target);
  if (zones.has(link.zoneId)) return null;
  // « Jouer ici les finales de mes catégories » : les finales des catégories de sa zone, même prévues sur la zone des finales.
  if (link.autonomous?.finals && (await isFinalOfMyCategory(db, link, params.cid, target))) return null;
  return `Ce combat ne se joue pas sur la zone ${name}.`;
}

async function isFinalOfMyCategory(db: AppDb, link: ZoneLink, categoryId: string, target: { matchId: string } | { kataRound: 'round1' | 'final' } | 'tie-break'): Promise<boolean> {
  if (target === 'tie-break') return false;
  const plan = await passagePlan(db, link.competitionId);
  if (plan.categories[categoryId]?.zoneId !== link.zoneId) return false;
  if ('kataRound' in target) return target.kataRound === 'final';
  const row = db.$client.prepare('select bracket_json as b from categories where id = ?').get(categoryId) as { b: string | null } | undefined;
  const bracket = row?.b ? (JSON.parse(row.b) as Bracket) : null;
  return bracket?.kind === 'combat' && finalMatchIds(bracket).includes(target.matchId);
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Saisie de zone autonome notée au journal avant l'écriture ; retirée si l'écriture échoue. */
    zoneEntryId?: string;
  }
}

const dataOf = (kind: ZoneEntry['kind'], body: unknown): ZoneEntry['data'] => {
  const b = (body ?? {}) as { winner?: 'a' | 'b'; method?: string; score?: string | null; notes?: number[]; order?: string[] };
  if (kind === 'result') return { winner: b.winner!, method: b.method!, score: typeof b.score === 'string' ? b.score.trim() : null };
  if (kind === 'kata') return { notes: b.notes ?? [] };
  if (kind === 'tie-break') return { order: b.order ?? [] };
  return null;
};

/**
 * Note la saisie au journal (révision lue, combattants) avant l'écriture, et la retire si l'écriture échoue : une saisie faite est
 * toujours dans le journal, même si le journal ne peut pas être écrit (la saisie est alors refusée) ou si le PC s'arrête entre les deux.
 */
export function registerZoneJournal(app: FastifyInstance, db: AppDb): void {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const kind = ZONE_WRITES[`${req.method} ${req.routeOptions.url ?? ''}`];
    const p = (req.params ?? {}) as Params;
    const link = kind ? autonomousLink(db, p.id) : null;
    if (!kind || !link || !p.cid) return;
    const scope = kind === 'tie-break' ? String((req.body as { scope?: unknown } | null)?.scope ?? '') : undefined;
    const round = kind === 'kata' ? (p.round as 'round1' | 'final') : undefined;
    const baseRev =
      kind === 'result' || kind === 'delete' ? resultRev(db, p.cid, p.matchId!) : kind === 'kata' ? kataRev(db, p.cid, p.rid!, p.round!) : tieBreakRev(db, p.cid, scope!);
    const entrants = kind === 'result' || kind === 'delete' ? await matchEntrants(db, link.competitionId, p.cid, p.matchId!).catch(() => null) : null;
    const version = (db.$client.prepare('select version as v from categories where id = ?').get(p.cid) as { v: number | null } | undefined)?.v ?? null;
    // Numéro d'ordre et insertion d'un seul tenant (sans attente entre les deux) : deux saisies simultanées ont deux numéros.
    const seq = ((db.$client.prepare('select max(seq) as s from zone_journal where competition_id = ?').get(link.competitionId) as { s: number | null }).s ?? 0) + 1;
    const entry: ZoneEntry = {
      id: randomUUID(), seq, kind, categoryId: p.cid, zoneId: link.zoneId, baseRev: baseRev ?? 'none', entrants, categoryVersion: version, data: dataOf(kind, req.body),
      at: new Date().toISOString(),
      ...(p.matchId ? { matchId: p.matchId } : {}), ...(p.rid ? { registrationId: p.rid } : {}), ...(round ? { round } : {}), ...(scope !== undefined ? { scope } : {}),
    };
    db.$client
      .prepare('insert into zone_journal (id, competition_id, zone_id, seq, kind, category_id, target_key, entry_json) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.id, link.competitionId, entry.zoneId, entry.seq, entry.kind, entry.categoryId, targetKey(entry), JSON.stringify(entry));
    // La copie n'est plus celle du PC principal : la prochaine copie la remplace même si le PC principal n'a pas changé.
    db.$client.prepare('update competitions set server_fingerprint = null where id = ?').run(link.competitionId);
    req.zoneEntryId = entry.id;
  });
  // Écriture refusée (règles, données invalides, panne) : l'entrée est retirée.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.zoneEntryId && reply.statusCode >= 400) db.$client.prepare('delete from zone_journal where id = ?').run(req.zoneEntryId);
    return payload;
  });
}

/** Le journal des saisies pas encore envoyées, tel qu'il part au PC principal (réseau ou fichier). */
export function journalFile(db: AppDb, link: ZoneLink): ZoneJournalFile {
  return {
    format: 'shidokan-zone-journal', formatVersion: 1, competitionId: link.competitionId, zoneId: link.zoneId, zoneName: zoneName(db, link),
    from: myIdentity(db), entries: pendingEntries(db, link.competitionId),
  };
}

/** Saisies marquées envoyées (réseau réussi, ou fichier exporté). */
export function markSent(db: AppDb, ids: string[]): void {
  const now = new Date().toISOString();
  const mark = db.$client.prepare('update zone_journal set sent_at = ? where id = ? and sent_at is null');
  db.$client.transaction(() => ids.forEach((id) => mark.run(now, id)))();
}

/** Saisies pas encore envoyées au PC principal, dans l'ordre. */
export function pendingEntries(db: AppDb, competitionId: string): ZoneEntry[] {
  return (db.$client.prepare('select entry_json as e from zone_journal where competition_id = ? and sent_at is null order by seq').all(competitionId) as { e: string }[]).map(
    (r) => JSON.parse(r.e) as ZoneEntry,
  );
}
