import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JOURNAL_TYPES, type JournalType } from '../../domain/journal/types.js';
import type { AppDb } from '../db/client.js';
import { getCompetition } from '../repositories/competitions.js';
import { listJournal } from '../repositories/journal.js';

const querySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  q: z.string().max(200).optional(),
  types: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(JOURNAL_TYPES as [JournalType, ...JournalType[]]))),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/** Journal de la compétition : lecture (fil paginé, recherche, filtre par type). */
export async function journalRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get<{ Params: { id: string } }>('/api/competitions/:id/journal', async (req, reply) => {
    if (!(await getCompetition(db, req.params.id))) return reply.status(404).send({ error: 'Compétition introuvable' });
    const { before, q, types, limit } = querySchema.parse(req.query);
    return listJournal(db, req.params.id, { before, q, types, limit });
  });
}
