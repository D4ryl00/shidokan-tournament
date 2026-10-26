import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';

/** « La compétition X a changé » : les postes qui l'affichent relisent leurs données. */
const bus = new EventEmitter();
bus.setMaxListeners(0);

const EVERYTHING = Symbol('toutes les compétitions');

/** `origin` : identifiant de l'onglet qui a écrit (il ne se recharge pas pour sa propre écriture). */
export function competitionChanged(competitionId: string, origin: string | null = null): void {
  bus.emit(competitionId, origin);
}
/** Toutes les compétitions ont pu changer (restauration d'une sauvegarde). */
export function everythingChanged(): void {
  bus.emit(EVERYTHING, null);
}

export function onCompetitionChange(competitionId: string, listener: (origin: string | null) => void): () => void {
  bus.on(competitionId, listener);
  bus.on(EVERYTHING, listener);
  return () => {
    bus.off(competitionId, listener);
    bus.off(EVERYTHING, listener);
  };
}

/** Flux d'événements d'une compétition (Server-Sent Events), et prévenir après chaque écriture réussie. */
export function registerCompetitionEvents(app: FastifyInstance): void {
  const open = new Set<() => void>();
  app.get<{ Params: { id: string } }>('/api/competitions/:id/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    // « identity » : Caddy (encode gzip) ne compresse pas une réponse qui a déjà un Content-Encoding, donc ne la retient pas.
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Content-Encoding': 'identity', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connecté\n\n');
    const off = onCompetitionChange(req.params.id, (origin) => res.write(`event: change\ndata: ${JSON.stringify({ origin })}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(ping);
      off();
      open.delete(close);
      res.end();
    };
    open.add(close);
    req.raw.on('close', close);
  });
  // Les flux ouverts ne doivent pas empêcher l'arrêt du serveur : fermés avant que Fastify attende la fin des connexions.
  app.addHook('preClose', async () => {
    for (const close of [...open]) close();
  });
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
