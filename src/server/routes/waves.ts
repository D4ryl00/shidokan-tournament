import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { listWaves, replaceWaves } from '../repositories/waves.js';

type P = { Params: { id: string } };
const disciplines = Object.keys(DISCIPLINES) as [DisciplineId, ...DisciplineId[]];
const wave = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    rules: z.object({ ageBandCodes: z.array(z.string()), disciplines: z.array(z.enum(disciplines)) }).strict(),
  })
  .strict();
const list = z.array(wave).max(200);
/** Liste seule, ou avec les identifiants que l'écran connaissait (refus si les vagues ont changé entre-temps). */
const wavesSchema = z.union([list, z.object({ waves: list, knownIds: z.array(z.string()) }).strict()]);

export async function waveRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });
  app.get<P>('/api/competitions/:id/waves', async (req) => listWaves(db, req.params.id));
  app.put<P>('/api/competitions/:id/waves', async (req) => {
    const body = wavesSchema.parse(req.body);
    return Array.isArray(body) ? replaceWaves(db, req.params.id, body) : replaceWaves(db, req.params.id, body.waves, body.knownIds);
  });
}
