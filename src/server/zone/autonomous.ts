import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { entryZones } from '../auth/permissions.js';
import type { AppDb } from '../db/client.js';
import { launchedCategoryIds } from '../repositories/launch-state.js';
import { matchEntrants } from '../repositories/results.js';
import { kataRev, resultRev, tieBreakRev } from '../revisions.js';
import { targetKey, type ZoneEntry } from './entry.js';
import { getZoneLink, type ZoneLink } from './link.js';

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

/** Décision de la garde en zone autonome : null = permis, sinon le message de refus. */
export async function autonomousRefusal(db: AppDb, link: ZoneLink, method: string, route: string, params: Record<string, string>): Promise<string | null> {
  const name = zoneName(db, link);
  if (!ZONE_WRITES[`${method} ${route}`] || !params.cid) return `Zone autonome : seules les saisies de la zone ${name} sont possibles sur ce PC.`;
  // Une session pas encore lancée sur la copie peut changer de zone au lancement sur le PC principal.
  if (!launchedCategoryIds(db, link.competitionId).has(params.cid)) return 'Session suivante pas encore lancée sur cette copie.';
  const target = params.matchId ? { matchId: params.matchId } : params.round ? { kataRound: params.round === 'final' ? ('final' as const) : ('round1' as const) } : ('tie-break' as const);
  const zones = await entryZones(db, link.competitionId, params.cid, target);
  return zones.has(link.zoneId) ? null : `Ce combat ne se joue pas sur la zone ${name}.`;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Saisie de zone autonome en préparation (révision lue, combattants), notée si l'écriture réussit. */
    zoneEntry?: Omit<ZoneEntry, 'id' | 'seq' | 'data' | 'at'>;
  }
}

const dataOf = (kind: ZoneEntry['kind'], body: unknown): ZoneEntry['data'] => {
  const b = (body ?? {}) as { winner?: 'a' | 'b'; method?: string; score?: string | null; notes?: number[]; order?: string[] };
  if (kind === 'result') return { winner: b.winner!, method: b.method!, score: typeof b.score === 'string' ? b.score.trim() : null };
  if (kind === 'kata') return { notes: b.notes ?? [] };
  if (kind === 'tie-break') return { order: b.order ?? [] };
  return null;
};

/** Prépare l'entrée (révision lue, combattants) avant l'écriture ; l'enregistre si l'écriture a réussi. */
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
    req.zoneEntry = {
      kind, categoryId: p.cid, zoneId: link.zoneId, baseRev: baseRev ?? 'none', entrants, categoryVersion: version,
      ...(p.matchId ? { matchId: p.matchId } : {}), ...(p.rid ? { registrationId: p.rid } : {}), ...(round ? { round } : {}), ...(scope !== undefined ? { scope } : {}),
    };
  });
  // Avant l'envoi de la réponse : une saisie confirmée à l'écran est toujours dans le journal.
  app.addHook('onSend', async (req, reply, payload) => {
    const pre = req.zoneEntry;
    if (!pre || reply.statusCode >= 400) return payload;
    const competitionId = (req.params as Params).id!;
    const seq = ((db.$client.prepare('select max(seq) as s from zone_journal where competition_id = ?').get(competitionId) as { s: number | null }).s ?? 0) + 1;
    const entry: ZoneEntry = { id: randomUUID(), seq, ...pre, data: dataOf(pre.kind, req.body), at: new Date().toISOString() };
    db.$client
      .prepare('insert into zone_journal (id, competition_id, zone_id, seq, kind, category_id, target_key, entry_json) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.id, competitionId, entry.zoneId, entry.seq, entry.kind, entry.categoryId, targetKey(entry), JSON.stringify(entry));
    return payload;
  });
}

/** Saisies pas encore envoyées au PC principal, dans l'ordre. */
export function pendingEntries(db: AppDb, competitionId: string): ZoneEntry[] {
  return (db.$client.prepare('select entry_json as e from zone_journal where competition_id = ? and sent_at is null order by seq').all(competitionId) as { e: string }[]).map(
    (r) => JSON.parse(r.e) as ZoneEntry,
  );
}
