import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { launchStatus, launchWave, numberPending, reopenWave } from '../repositories/launches.js';

type P = { Params: { id: string } };
const wave = z.object({ waveId: z.string().nullable() });
const number = wave.extend({ categoryIds: z.array(z.string()).optional() }).strict();

export async function launchRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P & { Querystring: { vague?: string; restart?: string } }>('/api/competitions/:id/launch', async (req) =>
    launchStatus(db, req.params.id, req.query.vague || null, req.query.restart === '1'),
  );
  app.post<P>('/api/competitions/:id/launch', async (req, reply) => {
    const body = wave.extend({ restart: z.boolean().optional() }).strict().parse(req.body);
    await launchWave(db, req.params.id, body.waveId, { restart: body.restart ?? false });
    return reply.status(204).send();
  });
  app.post<P>('/api/competitions/:id/launch/reopen', async (req, reply) => {
    await reopenWave(db, req.params.id, wave.strict().parse(req.body).waveId);
    return reply.status(204).send();
  });
  app.post<P>('/api/competitions/:id/launch/number', async (req) => {
    const body = number.parse(req.body);
    return numberPending(db, req.params.id, body.waveId, body.categoryIds);
  });
  app.post<P>('/api/competitions/:id/launch/number/preview', async (req) => {
    const body = number.parse(req.body);
    return numberPending(db, req.params.id, body.waveId, body.categoryIds, true);
  });
}
