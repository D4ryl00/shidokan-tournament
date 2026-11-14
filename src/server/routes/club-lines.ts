import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { syncCategories } from '../repositories/categories.js';
import { clubLines, deleteClubLine, fighterLine, reloadLine, saveClubLine } from '../repositories/club-entry.js';
import { getCompetition } from '../repositories/competitions.js';
import { NotFoundError } from '../repositories/registrations.js';
import { clubFormLineSchema } from './registrations.js';

type P = { Params: { id: string; clubId: string } };
type PF = { Params: { id: string; clubId: string; fighterId: string } };
const writer = { kind: 'organiser' } as const;
/** Origine des inscriptions créées par une écriture : « sur place » par défaut, `club_form` depuis une fiche renvoyée. */
const source = z.enum(['club_form']).optional();

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

  app.get<P>('/api/competitions/:id/clubs/:clubId/lines', async (req) => {
    const a = await access(req.params.id, req.params.clubId);
    return clubLines(db, a, 'organiser');
  });

  app.post<P>('/api/competitions/:id/clubs/:clubId/lines', async (req, reply) => {
    const a = { competitionId: req.params.id, clubId: req.params.clubId }; // saveClubLine vérifie la compétition
    const body = z.object({ line: clubFormLineSchema, publicNameHidden: z.boolean(), source }).parse(req.body);
    const saved = await saveClubLine(db, a, null, body.line, null, { writer, publicNameHidden: body.publicNameHidden, source: body.source });
    await resync(a.competitionId);
    return reply.status(201).send(reloadLine(db, saved, 'organiser'));
  });

  app.put<PF>('/api/competitions/:id/clubs/:clubId/lines/:fighterId', async (req) => {
    const a = { competitionId: req.params.id, clubId: req.params.clubId }; // saveClubLine vérifie la compétition
    const body = z.object({ line: clubFormLineSchema, version: z.string().min(1), publicNameHidden: z.boolean(), source }).parse(req.body);
    const saved = await saveClubLine(db, a, req.params.fighterId, body.line, body.version, { writer, publicNameHidden: body.publicNameHidden, source: body.source });
    await resync(a.competitionId);
    return reloadLine(db, saved, 'organiser');
  });

  app.delete<PF & { Querystring: { version?: string } }>('/api/competitions/:id/clubs/:clubId/lines/:fighterId', async (req, reply) => {
    const a = await access(req.params.id, req.params.clubId);
    const { version } = z.object({ version: z.string().min(1) }).parse(req.query);
    await deleteClubLine(db, a, req.params.fighterId, version, { writer });
    await resync(a.competitionId);
    return reply.status(204).send();
  });
}
