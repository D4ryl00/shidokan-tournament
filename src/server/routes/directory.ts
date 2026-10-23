import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { createDirectoryEntry, listDirectory, mergeDirectoryEntries, updateDirectoryEntry } from '../repositories/directory.js';

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const directorySchema = z
  .object({
    name: z.string().trim().min(1, 'Le nom du club est obligatoire.').max(120),
    affiliationNumber: z.string().trim().regex(/^\d{1,12}$/, 'Le numéro d’affiliation ne contient que des chiffres.').nullable(),
    coachName: text(120),
    coachPhone: text(40),
    coachEmail: text(160),
    notes: text(1000),
  })
  .strict();

/** Annuaire des clubs, indépendant des compétitions. */
export async function directoryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get('/api/club-directory', async () => listDirectory(db));
  app.post('/api/club-directory', async (req, reply) => reply.status(201).send(createDirectoryEntry(db, directorySchema.parse(req.body))));
  app.patch<{ Params: { entryId: string } }>('/api/club-directory/:entryId', async (req) =>
    updateDirectoryEntry(db, req.params.entryId, directorySchema.partial().extend({ archived: z.boolean().optional() }).parse(req.body)),
  );
  app.post('/api/club-directory/merge', async (req) => {
    const { keepId, mergeId } = z.object({ keepId: z.string(), mergeId: z.string() }).parse(req.body);
    return mergeDirectoryEntries(db, keepId, mergeId);
  });
}
