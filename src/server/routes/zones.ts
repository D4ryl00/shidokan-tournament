import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { listZones, replaceZones } from '../repositories/zones.js';

type P = { Params: { id: string } };
const zonesSchema = z.array(z.object({ id: z.string().optional(), name: z.string() }).strict()).max(20);

export async function zoneRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P>('/api/competitions/:id/zones', async (req) => listZones(db, req.params.id));
  app.put<P>('/api/competitions/:id/zones', async (req) => replaceZones(db, req.params.id, zonesSchema.parse(req.body)));
}
