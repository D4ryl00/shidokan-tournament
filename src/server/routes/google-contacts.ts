import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isSingleEmail } from '../../domain/mail-template.js';
import type { SyncApply } from '../../domain/google-contacts.js';
import type { AppDb } from '../db/client.js';
import type { GoogleClient } from '../google/client.js';
import { applyGoogleContacts, googleContactsPreview } from '../repositories/google-contacts.js';
import { optionalEmail } from './fields.js';

// Mêmes limites que la fiche d'annuaire (routes/directory.ts).
const set = z
  .object({
    coachName: z.string().trim().min(1).max(120),
    coachPhone: z.string().trim().min(1).max(40),
    coachEmail: z.string().trim().min(1).max(160).refine(isSingleEmail, 'Adresse e-mail invalide (une seule adresse).'),
  })
  .partial()
  .strict();
const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const id = z.string().min(1).max(200);
const version = z.number().int().nullable();
const applySchema = z
  .object({
    updates: z.array(z.object({ clubId: id, version, set }).strict()).max(5000),
    links: z.array(z.object({ clubId: id, version, contact: id, set }).strict()).max(5000),
    creates: z.array(z.object({ contact: id, name: z.string().trim().min(1, 'Le nom du club est obligatoire.').max(120), coachName: text(120), coachPhone: text(40), coachEmail: optionalEmail }).strict()).max(5000),
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
