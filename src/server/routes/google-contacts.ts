import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AFFILIATION_PATTERN, isAcceptableCoachValue, type SyncApply, type TextField } from '../../domain/google-contacts.js';
import { DIRECTORY_LIMITS as MAX } from '../../domain/registration.js';
import type { AppDb } from '../db/client.js';
import type { GoogleClient } from '../google/client.js';
import { applyGoogleContacts, googleContactsPreview } from '../repositories/google-contacts.js';
import { emailList } from './fields.js';

// Mêmes limites que la fiche d'annuaire (DIRECTORY_LIMITS), et la même règle que l'aperçu pour écarter une valeur Google.
const coach = (field: TextField) => z.string().trim().refine((v) => isAcceptableCoachValue(field, v), 'Valeur invalide.');
const number = z.string().trim().regex(AFFILIATION_PATTERN, 'Le numéro d’affiliation FFK a 7 chiffres.');
const set = z
  .object({ coachName: coach('coachName'), coachPhone: coach('coachPhone'), affiliationNumber: number, addEmails: emailList.refine((l) => l.length > 0, 'Aucune adresse à ajouter.') })
  .partial()
  .strict();
const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const id = z.string().min(1).max(200);
const version = z.number().int().nullable();
const applySchema = z
  .object({
    updates: z.array(z.object({ clubId: id, version, set }).strict()).max(5000),
    links: z.array(z.object({ clubId: id, version, contact: id, set }).strict()).max(5000),
    creates: z.array(z.object({ contact: id, name: z.string().trim().min(1, 'Le nom du club est obligatoire.').max(MAX.name), coachName: text(MAX.coachName), coachPhone: text(MAX.coachPhone), coachEmails: emailList, affiliationNumber: number.nullable() }).strict()).max(5000),
    later: z.array(id).max(5000),
  })
  .strict();

/** Synchronisation des coachs de l'annuaire avec Google Contacts (organisateur seulement, voir permissions.ts). */
export async function googleContactsRoutes(app: FastifyInstance, { db, google }: { db: AppDb; google: GoogleClient }) {
  app.post('/api/club-directory/google/preview', async (req) => {
    const { label } = z.object({ label: z.string().max(200).nullable().optional() }).strict().parse(req.body ?? {});
    return googleContactsPreview(db, google, label);
  });
  app.post('/api/club-directory/google/apply', async (req) => applyGoogleContacts(db, applySchema.parse(req.body) as SyncApply));
}
