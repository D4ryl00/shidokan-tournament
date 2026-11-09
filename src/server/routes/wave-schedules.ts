import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { listWaveSchedules, setWaveSchedule } from '../repositories/wave-schedules.js';

type P = { Params: { id: string } };
// Le format HH:MM est vérifié par le dépôt (400 avec un message lisible).
const clock = z.string().nullable().optional();
const bodySchema = z.object({ waveId: z.string().nullable(), plannedStart: clock, actualStart: clock, finalsStart: clock }).strict();

export async function waveScheduleRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P>('/api/competitions/:id/wave-schedules', async (req) => listWaveSchedules(db, req.params.id));
  app.put<P>('/api/competitions/:id/wave-schedules', async (req) => {
    const { waveId, ...patch } = bodySchema.parse(req.body);
    return setWaveSchedule(db, req.params.id, waveId, patch);
  });
}
