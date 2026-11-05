import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DIRECTORY_LIMITS as MAX } from '../../domain/registration.js';
import { emailList } from './fields.js';
import type { AppDb } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { CLUB_FIELDS } from '../../domain/club-changes.js';
import { clubDirectory } from '../db/schema.js';
import { applyDirectoryToClubs, directoryValues, upcomingDifferences } from '../repositories/club-changes.js';
import { createDirectoryEntry, listDirectory, mergeDirectoryEntries, updateDirectoryEntry } from '../repositories/directory.js';

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
export const directoryValuesSchema = directorySchema.omit({ notes: true });

/** Annuaire des clubs, indépendant des compétitions. */
export async function directoryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get('/api/club-directory', async () => listDirectory(db));
  app.post('/api/club-directory', async (req, reply) => reply.status(201).send(createDirectoryEntry(db, directorySchema.parse(req.body))));
  // Les valeurs d'avant sont lues dans la même transaction que l'enregistrement ; `upcoming` : ce que la fiche change dans les compétitions à venir.
  app.patch<{ Params: { entryId: string } }>('/api/club-directory/:entryId', async (req) => {
    const patch = directorySchema.partial().extend({ archived: z.boolean().optional(), googleContactId: z.null().optional() }).parse(req.body);
    return db.transaction((tx) => {
      const t = tx as unknown as AppDb;
      const row = t.select().from(clubDirectory).where(eq(clubDirectory.id, req.params.entryId)).get();
      const before = row ? directoryValues(row) : null;
      const entry = updateDirectoryEntry(t, req.params.entryId, patch);
      // `db` (même connexion, donc la transaction en cours) : la lecture de la main sur la compétition passe par son client SQLite.
      return { ...entry, upcoming: before ? upcomingDifferences(db, entry.id, before) : [] };
    });
  });
  app.post<{ Params: { entryId: string } }>('/api/club-directory/:entryId/apply-to-clubs', async (req) => {
    const { items } = z.object({ items: z.array(z.object({ clubId: z.string(), fields: z.array(z.enum(CLUB_FIELDS)) })) }).parse(req.body);
    return applyDirectoryToClubs(db, req.params.entryId, items);
  });
  app.post('/api/club-directory/merge', async (req) => {
    const { keepId, mergeId } = z.object({ keepId: z.string(), mergeId: z.string() }).parse(req.body);
    return mergeDirectoryEntries(db, keepId, mergeId);
  });
}
