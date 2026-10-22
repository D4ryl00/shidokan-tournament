import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { listCategories, redraw, swapEntrants, updateCategory } from '../repositories/categories.js';
import { getCompetition } from '../repositories/competitions.js';

const FORMATS = ['single_match', 'best_of_three', 'round_robin', 'three_with_repechage', 'single_elimination', 'double_elimination', 'pools_then_bracket', 'kata_two_rounds'] as const;
const patchSchema = z
  .object({
    format: z.enum(FORMATS).nullable().optional(),
    repechage: z.boolean().nullable().optional(),
    thirdPlace: z.boolean().nullable().optional(),
    status: z.enum(['provisional', 'ready', 'started', 'finished']).optional(),
    zoneId: z.string().nullable().optional(),
    order: z.number().int().min(0).max(1000).optional(),
    unlock: z.boolean().optional(),
  })
  .strict();

type P = { Params: { id: string; cid: string } };

export async function categoryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<{ Params: { id: string } }>('/api/competitions/:id/categories', async (req) => listCategories(db, req.params.id));
  app.patch<P>('/api/competitions/:id/categories/:cid', async (req) => updateCategory(db, req.params.id, req.params.cid, patchSchema.parse(req.body)));
  app.post<P>('/api/competitions/:id/categories/:cid/redraw', async (req) => redraw(db, req.params.id, req.params.cid));
  app.post<P>('/api/competitions/:id/categories/:cid/swap', async (req) => {
    const { a, b } = z.object({ a: z.string(), b: z.string() }).parse(req.body);
    return swapEntrants(db, req.params.id, req.params.cid, a, b);
  });
}
