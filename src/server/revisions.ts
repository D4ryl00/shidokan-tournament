import type { AppDb } from './db/client.js';

/** Écriture faite sur une donnée qu'un autre poste a modifiée entre-temps. */
export class StaleWriteError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Modifié entre-temps par un autre poste : l’écran a été rechargé.');
  }
}

export const rowRev = (version: number | null | undefined) => String(version ?? 0);
/** Révision d'une liste (sessions, zones) : ses lignes et leurs versions. */
export const listRev = (rows: { id: string; version: number | null }[]) => rows.map((r) => `${r.id}:${r.version ?? 0}`).sort().join('|') || 'vide';

/**
 * Compare la révision envoyée par le poste (en-tête If-Match ; absent = pas de contrôle) à la révision actuelle
 * (`null` : la donnée n'existe pas, ce que le poste annonce par `none`).
 */
export function checkRev(ifMatch: string | string[] | undefined, current: string | null): void {
  if (ifMatch === undefined) return;
  const expected = (Array.isArray(ifMatch) ? ifMatch[0] : ifMatch)!.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (expected !== (current ?? 'none')) throw new StaleWriteError();
}

const one = (db: AppDb, sql: string, ...params: unknown[]) => db.$client.prepare(sql).get(...params) as { v: number | null } | undefined;

export const resultRev = (db: AppDb, categoryId: string, matchId: string) => {
  const r = one(db, 'select version as v from match_results where category_id = ? and match_id = ?', categoryId, matchId);
  return r ? rowRev(r.v) : null;
};
export const kataRev = (db: AppDb, categoryId: string, registrationId: string, round: string) => {
  const r = one(db, 'select version as v from kata_scores where category_id = ? and registration_id = ? and round = ?', categoryId, registrationId, round);
  return r ? rowRev(r.v) : null;
};
export const tieBreakRev = (db: AppDb, categoryId: string, scope: string) => {
  const r = one(db, 'select version as v from tie_breaks where category_id = ? and scope = ?', categoryId, scope);
  return r ? rowRev(r.v) : null;
};
export const categoryRev = (db: AppDb, categoryId: string) => {
  const r = one(db, 'select version as v from categories where id = ?', categoryId);
  return r ? rowRev(r.v) : null;
};
export const registrationRev = (db: AppDb, registrationId: string) => {
  const r = db.$client.prepare('select r.version as rv, f.version as fv from registrations r join fighters f on f.id = r.fighter_id where r.id = ?').get(registrationId) as
    | { rv: number | null; fv: number | null }
    | undefined;
  return r ? `${rowRev(r.rv)}:${rowRev(r.fv)}` : null;
};
export const tableListRev = (db: AppDb, table: 'zones' | 'waves', competitionId: string) =>
  listRev(db.$client.prepare(`select id, version from ${table} where competition_id = ?`).all(competitionId) as { id: string; version: number | null }[]);

/** Routes qui modifient le tableau d'une catégorie : contrôlées par la révision de la catégorie. */
const CATEGORY_WRITES = /^\/api\/competitions\/:id\/categories\/:cid(\/(move|swap|redraw|regenerate))?$/;

export function registerCategoryRevGuard(app: import('fastify').FastifyInstance, db: AppDb): void {
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || !CATEGORY_WRITES.test(req.routeOptions.url ?? '')) return;
    const cid = (req.params as { cid?: string }).cid;
    if (cid) checkRev(req.headers['if-match'], categoryRev(db, cid));
  });
}
