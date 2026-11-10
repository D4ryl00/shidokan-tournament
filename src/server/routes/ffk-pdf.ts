import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FfkPdfRead } from '../../domain/ffk-pdf-plan.js';
import { translateFfkEntries } from '../../domain/ffk-pdf-plan.js';
import { parseFfkPdfLines } from '../../domain/ffk-pdf.js';
import type { AppDb } from '../db/client.js';
import { extractPdfLines } from '../ffk-pdf-text.js';
import { getCompetition, getGrid } from '../repositories/competitions.js';
import { NotFoundError } from '../repositories/registrations.js';

/** Taille maximale d'un PDF « État des inscriptions » de la FFK. */
export const FFK_PDF_MAX_BYTES = 5 * 1024 * 1024;

class FfkPdfError extends Error {
  readonly statusCode = 400;
}

const disciplineSchema = z.enum(['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata']);

/** Lit le PDF reçu en corps brut et en traduit les combattants dans la grille de la compétition. */
export async function ffkPdfRead(db: AppDb, competitionId: string, discipline: unknown, body: unknown): Promise<FfkPdfRead> {
  const parsed = disciplineSchema.safeParse(discipline);
  if (!parsed.success) throw new FfkPdfError('Choisissez la discipline de ce PDF.');
  const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  const { entries, duplicates } = parseFfkPdfLines(await extractPdfLines(data));
  const fighters = translateFfkEntries(entries, await getGrid(db, competitionId), parsed.data);
  if (!fighters.length) throw new FfkPdfError('Aucun combattant trouvé dans ce PDF.');
  return { fighters, duplicates };
}

/** Lecture du PDF de la FFK par l'organisateur (sans le contrôle d'ouverture des inscriptions en ligne). */
export async function ffkPdfOrganiserRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.post<{ Params: { id: string }; Querystring: { discipline?: string } }>('/api/competitions/:id/ffk-pdf', { bodyLimit: FFK_PDF_MAX_BYTES }, async (req) => {
    if (!(await getCompetition(db, req.params.id))) throw new NotFoundError('Compétition introuvable');
    return ffkPdfRead(db, req.params.id, req.query.discipline, req.body);
  });
}
