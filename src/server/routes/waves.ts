import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { checkRev, tableListRev } from '../revisions.js';
import { getCompetition } from '../repositories/competitions.js';
import { freezeSessions, unfreezeSessions } from '../repositories/session-freeze.js';
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
  app.get<P>('/api/competitions/:id/waves', async (req, reply) => {
    reply.header('ETag', `"${tableListRev(db, 'waves', req.params.id)}"`);
    return listWaves(db, req.params.id);
  });
  app.put<P>('/api/competitions/:id/waves', async (req, reply) => {
    const body = wavesSchema.parse(req.body);
    checkRev(req.headers['if-match'], tableListRev(db, 'waves', req.params.id));
    reply.header('Cache-Control', 'no-store');
    return Array.isArray(body) ? replaceWaves(db, req.params.id, body) : replaceWaves(db, req.params.id, body.waves, body.knownIds);
  });
  /** « Figer les sessions » : chaque catégorie garde sa session actuelle (mêmes droits que l'enregistrement des sessions). */
  app.post<P>('/api/competitions/:id/waves/freeze', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return freezeSessions(db, req.params.id);
  });
  /** « Ne plus figer » : les catégories reprennent la session de la majorité de leurs combattants. */
  app.post<P>('/api/competitions/:id/waves/unfreeze', async (req, reply) => {
    await unfreezeSessions(db, req.params.id);
    return reply.status(204).send();
  });
}
