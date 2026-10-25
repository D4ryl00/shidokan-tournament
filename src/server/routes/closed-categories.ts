import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { getClosedCategories, setClosedCategories } from '../repositories/closed-categories.js';
import { getCompetition } from '../repositories/competitions.js';

const cellSchema = z
  .object({
    ageBandCode: z.string().min(1),
    sex: z.enum(['M', 'F']),
    discipline: z.enum(['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata']),
    ruleset: z.enum(['jiyu', 'shobu']).nullable(),
  })
  .strict();
const putSchema = z.object({ cells: z.array(cellSchema).min(1), closed: z.boolean() }).strict();

type P = { Params: { id: string } };

/** Tableau « Catégories ouvertes » de la grille (organisateur). */
export async function closedCategoryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P>('/api/competitions/:id/closed-categories', async (req) => getClosedCategories(db, req.params.id));
  app.put<P>('/api/competitions/:id/closed-categories', async (req, reply) => {
    const { cells, closed } = putSchema.parse(req.body);
    await setClosedCategories(db, req.params.id, cells, closed);
    return reply.status(204).send();
  });
}
