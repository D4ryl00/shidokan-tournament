import type { FastifyInstance } from 'fastify';
import { frenchDate } from '../../domain/mail-template.js';
import type { AppDb } from '../db/client.js';

/** Où est la main sur une compétition, pour le bandeau des écrans. */
export interface Management {
  managedHere: boolean;
  ownerName: string | null;
  ownerSince: string | null;
  lastSyncAt: string | null;
  /** Copie en lecture seule reçue du serveur auquel ce PC est relié. */
  copyOfServer: boolean;
}

const row = (db: AppDb, competitionId: string) =>
  db.$client.prepare('select owner_instance_id as ownerId, owner_name as ownerName, owner_since as ownerSince, last_sync_at as lastSyncAt from competitions where id = ?').get(competitionId) as
    | { ownerId: string | null; ownerName: string | null; ownerSince: string | null; lastSyncAt: string | null }
    | undefined;

export function getManagement(db: AppDb, competitionId: string): Management {
  const r = row(db, competitionId);
  if (!r) return { managedHere: true, ownerName: null, ownerSince: null, lastSyncAt: null, copyOfServer: false };
  const sync = db.$client.prepare("select value_json as v from app_settings where key = 'syncServer'").get() as { v: string } | undefined;
  const serverId = sync ? (JSON.parse(sync.v) as { serverInstanceId?: string }).serverInstanceId : undefined;
  return { managedHere: r.ownerId === null, ownerName: r.ownerName, ownerSince: r.ownerSince, lastSyncAt: r.lastSyncAt, copyOfServer: !!r.ownerId && r.ownerId === serverId };
}

export class ReadOnlyCompetitionError extends Error {
  readonly statusCode = 409;
}

/** Message affiché quand une compétition est gérée ailleurs. */
export function readOnlyMessage(m: Pick<Management, 'ownerName' | 'ownerSince'>): string {
  return `Compétition gérée par ${m.ownerName ?? 'une autre installation'}${m.ownerSince ? ` depuis le ${frenchDate(m.ownerSince)}` : ''} : lecture seule ici.`;
}

/** Routes d'une compétition qui restent possibles quand la main est ailleurs : les échanges eux-mêmes, et l'export. */
const EXEMPT = [/\/sync\//, /\/take-back$/, /\/export\.json$/];

/** Une compétition dont la main est ailleurs refuse toute écriture d'organisateur. */
export function registerReadOnlyGuard(app: FastifyInstance, db: AppDb): void {
  app.addHook('preHandler', async (req) => {
    const route = req.routeOptions.url ?? '';
    if (req.method === 'GET' || req.method === 'HEAD' || !route.startsWith('/api/competitions/:id') || EXEMPT.some((e) => e.test(route))) return;
    const id = (req.params as { id?: string }).id;
    const r = id ? row(db, id) : undefined;
    if (r?.ownerId) throw new ReadOnlyCompetitionError(readOnlyMessage(r));
  });
  app.get<{ Params: { id: string } }>('/api/competitions/:id/management', async (req) => getManagement(db, req.params.id));
}
