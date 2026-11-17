import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JournalActor } from '../../domain/journal/types.js';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { getManagement } from '../sync/ownership.js';
import { journalStore, type JournalContext } from './context.js';
import { JOURNAL_COVERED, JOURNAL_EXEMPT } from './coverage.js';
import { recordJournal } from './write.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Contexte du journal de la requête (le même objet que celui de `journalStore`), relu après la réponse. */
    journal: JournalContext | null;
  }
}

/** Qui fait la requête : le compte connecté ; sinon le poste que le navigateur déclare (en-tête `x-poste`, rôle local) ; sinon « poste inconnu ». */
function requestActor(db: AppDb, req: FastifyRequest): JournalActor {
  if (req.user) return { kind: 'account', email: req.user.email, role: req.user.role };
  const poste = req.headers['x-poste'];
  const value = typeof poste === 'string' ? poste.trim() : '';
  if (value === 'organisation' || value === 'table') return { kind: 'poste', poste: value };
  if (value.startsWith('zone:')) {
    const zone = db.$client.prepare('select name from zones where id = ?').get(value.slice('zone:'.length)) as { name: string } | undefined;
    return zone ? { kind: 'poste', poste: 'zone', zoneName: zone.name } : { kind: 'poste', poste: 'zone' };
  }
  return { kind: 'poste', poste: 'inconnu' };
}

/** Écriture d'une compétition (ou du lien d'un club) : celles que le filet de sécurité surveille. */
const isCompetitionWrite = (method: string, route: string) =>
  route.startsWith('/api/competitions/:id') || route.startsWith('/api/inscription/:token') || (method === 'POST' && route === '/api/competitions');

/**
 * Qui et comment pour chaque requête (contexte du journal), et filet de sécurité : une écriture réussie d'une compétition
 * laisse une entrée brute « Opération non détaillée » (méthode, route, paramètres sans jeton), sauf une route détaillée
 * (`JOURNAL_COVERED`) qui a écrit une entrée ou s'est marquée notée (`markJournalHandled`).
 * À enregistrer après `registerGuard` (qui pose `req.user`).
 */
export function registerJournalHooks(app: FastifyInstance, db: AppDb): void {
  app.decorateRequest('journal', null);
  // Forme à rappel : le gestionnaire (et ce qu'il attend) s'exécute dans `journalStore.run`, donc voit le contexte.
  app.addHook('preHandler', (req, _reply, done) => {
    const id = (req.params as { id?: unknown } | undefined)?.id;
    const ctx: JournalContext = { actor: requestActor(db, req), via: 'autre', competitionId: typeof id === 'string' ? id : null, parentId: null, written: 0, handled: false };
    req.journal = ctx;
    journalStore.run(ctx, done);
  });
  app.addHook('onResponse', async (req, reply) => {
    const ctx = req.journal;
    if (!ctx || req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 400) return;
    const route = req.routeOptions.url ?? '';
    const key = `${req.method} ${route}`;
    if (!isCompetitionWrite(req.method, route) || JOURNAL_EXEMPT.has(key)) return;
    const id = ctx.competitionId;
    if (!id) return;
    // Une route détaillée (COVERED) qui a noté elle-même (même « rien n'a changé ») n'a pas d'entrée brute.
    // Une route pas encore détaillée (PENDING) a toujours la sienne, en plus des entrées détaillées qu'elle a pu écrire
    // (import FFK : les cartes sont détaillées, pas les orphelins supprimés ni les catégories créées).
    if (JOURNAL_COVERED.has(key) && (ctx.written > 0 || ctx.handled)) return;
    // Supprimée pendant la requête, ou main passée ailleurs : une copie n'écrit pas dans le journal.
    if (!db.$client.prepare('select 1 from competitions where id = ?').get(id) || !getManagement(db, id).managedHere) return;
    const params = Object.fromEntries(Object.entries((req.params ?? {}) as Record<string, string>).filter(([k]) => k !== 'token'));
    try {
      journalStore.run(ctx, () => recordJournal(db, id, { type: 'non-detaille', action: 'raw', data: { method: req.method, route, params } }));
      // Sous /api/competitions/:id, `registerCompetitionEvents` prévient déjà, juste après ce crochet (enregistré avant lui) :
      // un seul événement. Le lien d'un club, lui, a prévenu avant que l'entrée existe.
      if (!route.startsWith('/api/competitions/:id')) competitionChanged(id);
    } catch (e) {
      app.log.error(e);
    }
  });
}
