import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { ignoreClubChange, listClubChanges, resolveClubChange } from '../repositories/club-changes.js';
import { directoryValuesSchema } from './directory.js';

/** Changements de coordonnées à examiner entre les clubs des compétitions et l'annuaire. */
export async function clubChangeRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get('/api/club-changes', async (req) => listClubChanges(db, z.object({ competitionId: z.string().optional() }).parse(req.query).competitionId));
  app.post<{ Params: { clubId: string } }>('/api/club-changes/:clubId/resolve', async (req, reply) => {
    resolveClubChange(db, req.params.clubId, z.object({ directoryVersion: z.number(), changedAt: z.string(), values: directoryValuesSchema, applyToClub: z.boolean() }).strict().parse(req.body));
    return reply.status(204).send();
  });
  app.post<{ Params: { clubId: string } }>('/api/club-changes/:clubId/ignore', async (req, reply) => {
    ignoreClubChange(db, req.params.clubId, z.object({ changedAt: z.string() }).strict().parse(req.body).changedAt);
    return reply.status(204).send();
  });
}
