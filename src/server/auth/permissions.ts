import type { FastifyInstance } from 'fastify';
import type { AppDb } from '../db/client.js';
import { passagePlan } from '../repositories/passages.js';
import { isPublicRoute, type InstanceRole } from './guard.js';
import type { SessionUser } from './sessions.js';

export class ForbiddenError extends Error {
  readonly statusCode = 403;
}

const FORBIDDEN = 'Votre compte ne permet pas cette action.';
const OTHER_COMPETITION = 'Votre compte donne accès à une autre compétition.';
const OTHER_ZONE = 'Ce combat ne se joue pas sur votre zone.';

const C = '/api/competitions/:id';
/** Saisies d'une zone : résultats, notes de kata, départage (permises à un compte Zone sur sa zone). */
const ZONE_WRITES = new Set([
  `PUT ${C}/categories/:cid/results/:matchId`, `DELETE ${C}/categories/:cid/results/:matchId`, `PUT ${C}/categories/:cid/kata/:rid/:round`, `PUT ${C}/categories/:cid/tie-break`,
]);
/** Écritures de la Table centrale : inscriptions, clubs, pesée, réaffectations, tableaux, lancement des sessions, et toutes les saisies. */
const TABLE_WRITES = new Set([
  ...[
    'POST /registrations', 'PUT /registrations/:rid', 'DELETE /registrations/:rid', 'POST /clubs', 'PATCH /clubs/:clubId',
    'PUT /weigh-in/:fighterId', 'POST /weigh-in/close',
    'POST /replacement/preview', 'POST /replacement/apply', 'POST /replacement/bulk', 'POST /replacement/refuse', 'POST /replacement/unrefuse', 'POST /replacement/undo', 'POST /replacement/move',
    'PATCH /categories/:cid', 'POST /categories/:cid/redraw', 'POST /categories/:cid/swap', 'POST /categories/:cid/move', 'POST /categories/:cid/move/preview', 'POST /categories/:cid/regenerate',
    'POST /launch', 'POST /launch/reopen', 'POST /launch/number', 'POST /launch/number/preview',
  ].map((r) => r.replace(' ', ` ${C}`)),
  ...ZONE_WRITES,
]);
/** Lectures d'une compétition réservées à l'organisateur (liens des clubs, copies reçues, export entier). */
const ORGANISER_GETS = new Set(['/invitations', '/invitations/preview', '/received-copies', '/export.json'].map((p) => `${C}${p}`));
/** Hors d'une compétition : sa liste, la déconnexion et son mot de passe. */
const COMMON = new Set(['GET /api/competitions', 'POST /api/auth/logout', 'PUT /api/users/me/password']);

const isCompetitionRoute = (route: string) => route === C || route.startsWith(`${C}/`);

/** Décision sans base de données : la route est-elle permise à ce rôle ? ('zone-check' : permise si la saisie est sur sa zone). */
export function routeAccess(user: SessionUser, method: string, route: string): 'allow' | 'deny' | 'zone-check' {
  if (user.role === 'organisateur' || isPublicRoute(route)) return 'allow';
  const verb = method === 'HEAD' ? 'GET' : method;
  const key = `${verb} ${route}`;
  if (COMMON.has(key)) return 'allow';
  if (verb === 'GET' && isCompetitionRoute(route)) return ORGANISER_GETS.has(route) ? 'deny' : 'allow';
  if (user.role === 'table') return TABLE_WRITES.has(key) ? 'allow' : 'deny';
  return ZONE_WRITES.has(key) ? 'zone-check' : 'deny';
}

/**
 * Zone(s) où se joue la saisie, d'après le plan de passage des écrans : un combat sur la zone de son passage (sinon celle de sa
 * catégorie) ; des notes de kata sur la zone de leur bloc (tour 1, finale, ou bloc entier) ; un départage sur la zone de la catégorie
 * ou sur une zone qui a un passage de la catégorie.
 */
export async function entryZones(
  db: AppDb,
  competitionId: string,
  categoryId: string,
  target: { matchId: string } | { kataRound: 'round1' | 'final' } | 'tie-break',
): Promise<Set<string>> {
  const plan = await passagePlan(db, competitionId);
  const passages = plan.zones.flatMap((z) => z.passages.filter((p) => p.categoryId === categoryId).map((p) => ({ zoneId: z.zoneId, matchId: p.matchId })));
  const categoryZone = plan.categories[categoryId]?.zoneId ?? null;
  const zonesOf = (matchIds: (string | null)[]) => passages.filter((p) => matchIds.includes(p.matchId)).map((p) => p.zoneId);
  let zones: string[];
  if (target === 'tie-break') zones = [...passages.map((p) => p.zoneId), ...(categoryZone ? [categoryZone] : [])];
  else if ('matchId' in target) zones = zonesOf([target.matchId]);
  else zones = [target.kataRound === 'round1' ? 'kata:tour1' : 'kata:finale', null].map((m) => zonesOf([m])).find((z) => z.length > 0) ?? [];
  if (zones.length === 0 && target !== 'tie-break' && categoryZone) zones = [categoryZone];
  return new Set(zones);
}

/** Rôle serveur : refuse ce que le rôle du compte connecté ne permet pas (après la protection par session). Rôle local : rien. */
export function registerPermissions(app: FastifyInstance, db: AppDb, role: InstanceRole): void {
  if (role !== 'serveur') return;
  app.addHook('preHandler', async (req) => {
    const user = req.user;
    if (!user || user.role === 'organisateur') return;
    const route = req.routeOptions.url ?? '';
    const params = (req.params ?? {}) as { id?: string; cid?: string; matchId?: string; round?: string };
    if (user.role === 'zone' && isCompetitionRoute(route) && params.id !== user.competitionId) throw new ForbiddenError(OTHER_COMPETITION);
    const access = routeAccess(user, req.method, route);
    if (access === 'deny') throw new ForbiddenError(FORBIDDEN);
    if (access === 'allow') return;
    const target = params.matchId ? { matchId: params.matchId } : params.round ? { kataRound: params.round === 'final' ? ('final' as const) : ('round1' as const) } : ('tie-break' as const);
    const zones = await entryZones(db, params.id!, params.cid!, target);
    if (!user.zoneId || !zones.has(user.zoneId)) throw new ForbiddenError(OTHER_ZONE);
  });
}
