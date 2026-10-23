import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';

/** « La compétition X a changé » : les postes qui l'affichent relisent leurs données. */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function competitionChanged(competitionId: string): void {
  bus.emit(competitionId);
}

export function onCompetitionChange(competitionId: string, listener: () => void): () => void {
  bus.on(competitionId, listener);
  return () => bus.off(competitionId, listener);
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
    const off = onCompetitionChange(req.params.id, () => res.write('event: change\ndata: {}\n\n'));
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
  // Les flux ouverts ne doivent pas empêcher l'arrêt du serveur.
  app.addHook('onClose', async () => {
    for (const close of [...open]) close();
  });
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 400) return;
    if (!(req.routeOptions.url ?? '').startsWith('/api/competitions/:id')) return;
    const id = (req.params as { id?: string }).id;
    if (id) competitionChanged(id);
  });
}
