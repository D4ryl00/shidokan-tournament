import { EventEmitter } from 'node:events';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** « La compétition X a changé » : les postes qui l'affichent relisent leurs données. */
const bus = new EventEmitter();
bus.setMaxListeners(0);

const EVERYTHING = Symbol('toutes les compétitions');
/** N'importe quel changement, d'une compétition ou de toutes. */
const ANY = Symbol('une compétition');

/** `origin` : identifiant de l'onglet qui a écrit (il ne se recharge pas pour sa propre écriture). */
export function competitionChanged(competitionId: string, origin: string | null = null): void {
  bus.emit(competitionId, origin);
  bus.emit(ANY);
}
/** Toutes les compétitions ont pu changer (restauration d'une sauvegarde). */
export function everythingChanged(): void {
  bus.emit(EVERYTHING, null);
  bus.emit(ANY);
}

/** Chaque changement d'une compétition, quelle qu'elle soit (`competitionChanged` et `everythingChanged`). */
export function onAnyCompetitionChange(listener: () => void): () => void {
  bus.on(ANY, listener);
  return () => {
    bus.off(ANY, listener);
  };
}

export function onCompetitionChange(competitionId: string, listener: (origin: string | null) => void): () => void {
  bus.on(competitionId, listener);
  bus.on(EVERYTHING, listener);
  return () => {
    bus.off(competitionId, listener);
    bus.off(EVERYTHING, listener);
  };
}

/**
 * Ouvre un flux d'événements (Server-Sent Events) : `subscribe(write, end)` branche ses écouteurs et rend leur
 * désabonnement ; `end` ferme le flux.
 */
export type OpenStream = (req: FastifyRequest, reply: FastifyReply, subscribe: (write: (chunk: string) => void, end: () => void) => () => void) => void;

/**
 * Flux d'événements d'une application (en-tête, ping toutes les 25 s), fermés au début de l'arrêt : un flux ouvert
 * n'empêche pas le serveur de s'arrêter.
 */
export function eventStreams(app: FastifyInstance): OpenStream {
  const open = new Set<() => void>();
  // Fermés avant que Fastify attende la fin des connexions.
  app.addHook('preClose', async () => {
    for (const close of [...open]) close();
  });
  return (req, reply, subscribe) => {
    reply.hijack();
    const res = reply.raw;
    // « identity » : Caddy (encode gzip) ne compresse pas une réponse qui a déjà un Content-Encoding, donc ne la retient pas.
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Content-Encoding': 'identity', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connecté\n\n');
    let off: () => void = () => {};
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      if (!open.delete(close)) return;
      clearInterval(ping);
      off();
      res.end();
    };
    open.add(close);
    off = subscribe((chunk) => res.write(chunk), close);
    if (!open.has(close)) return off(); // fermé pendant l'abonnement
    req.raw.on('close', close);
  };
}

/** Flux d'événements d'une compétition (Server-Sent Events), et prévenir après chaque écriture réussie. */
export function registerCompetitionEvents(app: FastifyInstance): void {
  const openStream = eventStreams(app);
  app.get<{ Params: { id: string } }>('/api/competitions/:id/events', (req, reply) =>
    openStream(req, reply, (write) => onCompetitionChange(req.params.id, (origin) => write(`event: change\ndata: ${JSON.stringify({ origin })}\n\n`))),
  );
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 400) return;
    const route = req.routeOptions.url ?? '';
    // Les aperçus et le plan d'ensemble ne changent rien (et, relus à chaque changement, ils relanceraient les postes en boucle) ;
    // l'application du plan (`plan/apply`), elle, prévient.
    if (!route.startsWith('/api/competitions/:id') || route.endsWith('/preview') || route === '/api/competitions/:id/replacement/plan') return;
    const id = (req.params as { id?: string }).id;
    const origin = req.headers['x-poste-id'];
    if (id) competitionChanged(id, typeof origin === 'string' ? origin.slice(0, 64) : null);
  });
}
