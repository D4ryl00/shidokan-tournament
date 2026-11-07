import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { createFreeTableau, deleteFreeTableau, updateFreeTableau } from '../repositories/free-tableaux.js';

const discipline = z.enum(Object.keys(DISCIPLINES) as [DisciplineId, ...DisciplineId[]]);
const ruleset = z.enum(['jiyu', 'shobu']).nullable();
// Longueur vérifiée après normalisation des espaces (message en français) : ici, seulement une borne large.
const name = z.string().max(500);

type P = { Params: { id: string; cid: string } };

/** Tableaux libres : créés, renommés, changés de discipline et supprimés à la main (la session : `PATCH /categories/:cid`). */
export async function freeTableauRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.post<{ Params: { id: string } }>('/api/competitions/:id/free-tableaux', async (req, reply) => {
    const input = z.object({ name, discipline, ruleset }).strict().parse(req.body);
    return reply.status(201).send(await createFreeTableau(db, req.params.id, input));
  });
  app.patch<P>('/api/competitions/:id/free-tableaux/:cid', async (req) => {
    const patch = z.object({ name: name.optional(), discipline: discipline.optional(), ruleset: ruleset.optional() }).strict().parse(req.body);
    return updateFreeTableau(db, req.params.id, req.params.cid, patch);
  });
  app.delete<P>('/api/competitions/:id/free-tableaux/:cid', async (req) => deleteFreeTableau(db, req.params.id, req.params.cid));
}
