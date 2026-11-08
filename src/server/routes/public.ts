import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDb } from '../db/client.js';
import { eventStreams, onCompetitionChange } from '../events.js';
import { forgetPublicCache, publicCompetition, publicList, type CachedBody } from '../public/cache.js';
import { isPublicCompetition } from '../public/load.js';

/** Même réponse pour une compétition privée et une inconnue : rien ne dit qu'elle existe. */
const NOT_FOUND = { error: 'Compétition introuvable.' };

/** L'empreinte envoyée par le navigateur (`If-None-Match`, une ou plusieurs, faibles ou non) correspond-elle ? */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });
}

/** Réponse en cache : 304 sans corps si le navigateur a déjà cette version, sinon le JSON. Toujours revalidée. */
function sendCached(req: FastifyRequest, reply: FastifyReply, cached: CachedBody) {
  reply.header('ETag', cached.etag).header('Cache-Control', 'no-cache');
  if (matches(req.headers['if-none-match'], cached.etag)) return reply.status(304).send();
  return reply.type('application/json; charset=utf-8').send(cached.body);
}

/**
 * Mode spectateur : lecture seule, sans connexion, des compétitions publiques (liste blanche des champs, voir
 * `toPublicCompetition`). Réponses calculées une fois et gardées jusqu'au prochain changement ; le flux prévient seulement.
 */
export async function publicRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  const openStream = eventStreams(app);
  app.addHook('onClose', async () => forgetPublicCache(db));

  app.get('/api/public/competitions', async (req, reply) => sendCached(req, reply, await publicList(db)));

  app.get<{ Params: { id: string } }>('/api/public/competitions/:id', async (req, reply) => {
    const cached = await publicCompetition(db, req.params.id);
    if (!cached) return reply.status(404).send(NOT_FOUND);
    return sendCached(req, reply, cached);
  });

  // Seulement « change », sans l'identifiant du poste qui a écrit ; redevenue privée (ou supprimée) : prévenue puis fermée.
  app.get<{ Params: { id: string } }>('/api/public/competitions/:id/events', (req, reply) => {
    const { id } = req.params;
    if (!isPublicCompetition(db, id)) return reply.status(404).send(NOT_FOUND);
    openStream(req, reply, (write, end) =>
      onCompetitionChange(id, () => {
        write('event: change\ndata: {}\n\n');
        if (!isPublicCompetition(db, id)) end();
      }),
    );
  });
}
