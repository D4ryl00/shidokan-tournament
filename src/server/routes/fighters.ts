import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { fighters } from '../db/schema.js';
import { getCompetition } from '../repositories/competitions.js';
import { NotFoundError } from '../repositories/errors.js';

const bodySchema = z.object({ hidden: z.boolean() }).strict();

export async function fighterRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  /** Masque (ou réaffiche) le nom du combattant sur la page publique ; vaut pour toutes ses inscriptions. */
  app.put<{ Params: { id: string; fighterId: string } }>('/api/competitions/:id/fighters/:fighterId/public-name', async (req, reply) => {
    const { hidden } = bodySchema.parse(req.body);
    const { id, fighterId } = req.params;
    if (!(await getCompetition(db, id))) throw new NotFoundError('Compétition introuvable');
    const found = db.update(fighters).set({ publicNameHidden: hidden }).where(and(eq(fighters.id, fighterId), eq(fighters.competitionId, id))).returning({ id: fighters.id }).all();
    if (!found.length) throw new NotFoundError('Combattant introuvable');
    return reply.status(204).send();
  });
}
