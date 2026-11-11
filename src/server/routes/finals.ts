import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { finalsView, setCategoryFinals, setFinalsZone } from '../repositories/wave-finals.js';

type P = { Params: { id: string } };
const zoneBody = z.object({ waveId: z.string().nullable(), finalsZoneId: z.string().nullable() }).strict();
const categoriesBody = z
  .object({ waveId: z.string().nullable(), categoryIds: z.array(z.string()).optional(), where: z.enum(['own', 'finals']).optional(), when: z.enum(['ready', 'end']).optional() })
  .strict();

/** Onglet « Finales » : zone des finales d'une session, « Où » et « Quand » des catégories. Chaque écriture prévient les autres postes (hook des routes d'écriture). */
export async function finalsRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P & { Querystring: { vague?: string } }>('/api/competitions/:id/finals', async (req) => finalsView(db, req.params.id, req.query.vague || null));
  app.put<P>('/api/competitions/:id/finals/zone', async (req) => {
    const { waveId, finalsZoneId } = zoneBody.parse(req.body);
    await setFinalsZone(db, req.params.id, waveId, finalsZoneId);
    return finalsView(db, req.params.id, waveId);
  });
  app.put<P>('/api/competitions/:id/finals/categories', async (req) => {
    const { waveId, ...patch } = categoriesBody.parse(req.body);
    await setCategoryFinals(db, req.params.id, waveId, patch);
    return finalsView(db, req.params.id, waveId);
  });
}
