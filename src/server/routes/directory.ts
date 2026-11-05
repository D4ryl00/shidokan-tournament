import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DIRECTORY_LIMITS as MAX } from '../../domain/registration.js';
import { emailList } from './fields.js';
import type { AppDb } from '../db/client.js';
import { CLUB_FIELDS } from '../../domain/club-changes.js';
import { applyDirectoryToClubs, updateDirectoryEntryWithUpcoming } from '../repositories/club-changes.js';
import { createDirectoryEntry, listDirectory, mergeDirectoryEntries } from '../repositories/directory.js';

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const directorySchema = z
  .object({
    name: z.string().trim().min(1, 'Le nom du club est obligatoire.').max(MAX.name),
    affiliationNumber: z.string().trim().regex(/^\d{7}$/, 'Le numéro d’affiliation FFK a 7 chiffres.').nullable(),
    coachName: text(MAX.coachName),
    coachPhone: text(MAX.coachPhone),
    coachEmails: emailList,
    notes: text(MAX.notes),
  })
  .strict();

/** Coordonnées d'une fiche, comparées à celles d'un club de compétition (sans les notes). */
export const directoryValuesSchema = directorySchema.omit({ notes: true }).extend({ affiliationNumber: z.string().trim().regex(/^\d+$/, 'Le numéro d’affiliation FFK ne comporte que des chiffres.').nullable() });

const shownValue = z.union([z.string(), z.array(z.string()), z.null()]);
const shownField = z.object({ field: z.enum(CLUB_FIELDS), clubValue: shownValue, directoryValue: shownValue }).strict();

/** Annuaire des clubs, indépendant des compétitions. */
export async function directoryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get('/api/club-directory', async () => listDirectory(db));
  app.post('/api/club-directory', async (req, reply) => reply.status(201).send(createDirectoryEntry(db, directorySchema.parse(req.body))));
  // `upcoming` : ce que la fiche change dans les compétitions à venir (voir `updateDirectoryEntryWithUpcoming`).
  app.patch<{ Params: { entryId: string } }>('/api/club-directory/:entryId', async (req) =>
    updateDirectoryEntryWithUpcoming(db, req.params.entryId, directorySchema.partial().extend({ archived: z.boolean().optional(), googleContactId: z.null().optional() }).parse(req.body)),
  );
  app.post<{ Params: { entryId: string } }>('/api/club-directory/:entryId/apply-to-clubs', async (req) => {
    const { items } = z.object({ items: z.array(z.object({ clubId: z.string(), fields: z.array(shownField) })) }).strict().parse(req.body);
    return applyDirectoryToClubs(db, req.params.entryId, items);
  });
  app.post('/api/club-directory/merge', async (req) => {
    const { keepId, mergeId } = z.object({ keepId: z.string(), mergeId: z.string() }).parse(req.body);
    return mergeDirectoryEntries(db, keepId, mergeId);
  });
}
