import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { listHistory, undoHistory } from '../repositories/history.js';
import { knownWave } from '../repositories/replacement.js';
import { listWaves } from '../repositories/waves.js';

type P = { Params: { id: string } };

/** Historique annulable des tableaux : lecture (par session) et annulation en cascade. */
export async function historyRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });

  app.get<P & { Querystring: { waveId?: string } }>('/api/competitions/:id/history', async (req) => {
    const waveId = knownWave(await listWaves(db, req.params.id), req.query.waveId || undefined);
    return listHistory(db, req.params.id, waveId);
  });

  /** `expect` : le lot affiché (actions et cascade) ; un lot différent (autre poste) est refusé, rien n'est annulé. */
  app.post<P>('/api/competitions/:id/history/undo', async (req) => {
    const { ids, expect } = z.object({ ids: z.array(z.string()).min(1).max(1000), expect: z.array(z.string()).max(1000) }).strict().parse(req.body);
    return undoHistory(db, req.params.id, ids, expect);
  });
}
