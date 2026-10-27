import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DIRECTORY_LIMITS as MAX } from '../../domain/registration.js';
import { optionalEmail } from './fields.js';
import type { AppDb } from '../db/client.js';
import { createDirectoryEntry, listDirectory, mergeDirectoryEntries, updateDirectoryEntry } from '../repositories/directory.js';

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const directorySchema = z
  .object({
    name: z.string().trim().min(1, 'Le nom du club est obligatoire.').max(MAX.name),
    affiliationNumber: z.string().trim().regex(/^\d{7}$/, 'Le numéro d’affiliation FFK a 7 chiffres.').nullable(),
    coachName: text(MAX.coachName),
    coachPhone: text(MAX.coachPhone),
    coachEmail: optionalEmail,
    notes: text(MAX.notes),
  })
  .strict();

/** Annuaire des clubs, indépendant des compétitions. */
export async function directoryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get('/api/club-directory', async () => listDirectory(db));
  app.post('/api/club-directory', async (req, reply) => reply.status(201).send(createDirectoryEntry(db, directorySchema.parse(req.body))));
  app.patch<{ Params: { entryId: string } }>('/api/club-directory/:entryId', async (req) =>
    updateDirectoryEntry(db, req.params.entryId, directorySchema.partial().extend({ archived: z.boolean().optional(), googleContactId: z.null().optional() }).parse(req.body)),
  );
  app.post('/api/club-directory/merge', async (req) => {
    const { keepId, mergeId } = z.object({ keepId: z.string(), mergeId: z.string() }).parse(req.body);
    return mergeDirectoryEntries(db, keepId, mergeId);
  });
}
