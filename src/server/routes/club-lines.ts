import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { syncCategories } from '../repositories/categories.js';
import { deleteClubLine, fighterLine, saveClubLine } from '../repositories/club-entry.js';
import { getCompetition } from '../repositories/competitions.js';
import { NotFoundError } from '../repositories/registrations.js';
import { clubFormLineSchema } from './registrations.js';

type P = { Params: { id: string; clubId: string } };
type PF = { Params: { id: string; clubId: string; fighterId: string } };
const writer = { kind: 'organiser' } as const;

/** Lignes de combattants écrites par l'organisateur (écran Inscriptions) : les mêmes que celles du coach, sans le contrôle des inscriptions en ligne. */
export async function clubLineRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  const resync = async (competitionId: string) => {
    competitionChanged(competitionId);
    await syncCategories(db, competitionId).catch((e) => app.log.error(e));
  };
  const access = async (id: string, clubId: string) => {
    if (!(await getCompetition(db, id))) throw new NotFoundError('Compétition introuvable');
    return { competitionId: id, clubId };
  };

  app.get<{ Params: { id: string; fighterId: string } }>('/api/competitions/:id/fighters/:fighterId/line', async (req) => {
    await access(req.params.id, '');
    return fighterLine(db, req.params.id, req.params.fighterId);
  });

  app.post<P>('/api/competitions/:id/clubs/:clubId/lines', async (req, reply) => {
    const a = await access(req.params.id, req.params.clubId);
    const { line, publicNameHidden } = z.object({ line: clubFormLineSchema, publicNameHidden: z.boolean() }).parse(req.body);
    const saved = await saveClubLine(db, a, null, line, null, { writer, publicNameHidden });
    await resync(a.competitionId);
    return reply.status(201).send(saved);
  });

  app.put<PF>('/api/competitions/:id/clubs/:clubId/lines/:fighterId', async (req) => {
    const a = await access(req.params.id, req.params.clubId);
    const { line, version, publicNameHidden } = z.object({ line: clubFormLineSchema, version: z.string().min(1), publicNameHidden: z.boolean() }).parse(req.body);
    const saved = await saveClubLine(db, a, req.params.fighterId, line, version, { writer, publicNameHidden });
    await resync(a.competitionId);
    return saved;
  });

  app.delete<PF & { Querystring: { version?: string } }>('/api/competitions/:id/clubs/:clubId/lines/:fighterId', async (req, reply) => {
    const a = await access(req.params.id, req.params.clubId);
    const { version } = z.object({ version: z.string().min(1) }).parse(req.query);
    await deleteClubLine(db, a, req.params.fighterId, version, { writer });
    await resync(a.competitionId);
    return reply.status(204).send();
  });
}
