import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotAClubFormError } from '../../domain/club-form.js';
import { LEGACY_FORM_REFUSED, readClubFormLines } from '../../domain/club-form-read.js';
import { DIRECTORY_LIMITS as MAX } from '../../domain/registration.js';
import type { AppDb } from '../db/client.js';
import { writeClubFormHeader } from '../repositories/club-changes.js';
import { getCompetition } from '../repositories/competitions.js';
import { NotFoundError } from '../repositories/errors.js';
import { emailList } from './fields.js';
import { readUploadedClubForm } from './registrations.js';

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
/** Valeurs validées à l'étape « coordonnées ». */
const headerValues = z.object({ coachName: text(MAX.coachName), coachPhone: text(MAX.coachPhone), coachEmails: emailList, preApproval: z.boolean() }).strict();
/** Valeurs du club telles que l'étape les affichait (comparées, jamais écrites). */
const shownValues = z.object({ coachName: z.string().nullable(), coachPhone: z.string().nullable(), coachEmails: z.array(z.string()), preApproval: z.boolean() }).strict();

/** Fiche renvoyée par un club, importée fiche par fiche par l'organisateur : lecture (rien n'est écrit) et coordonnées validées. */
export async function clubFormReadRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  const competition = async (id: string) => {
    if (!(await getCompetition(db, id))) throw new NotFoundError('Compétition introuvable');
  };

  app.post<{ Params: { id: string } }>('/api/competitions/:id/club-forms/read', async (req, reply) => {
    await competition(req.params.id);
    try {
      return await readUploadedClubForm(db, req.params.id, req.body, (cells, grid, settings) => readClubFormLines(cells, grid, settings.weighInToleranceKg));
    } catch (e) {
      // L'ancien modèle est reconnu : son message dit quoi faire, à la place de l'intitulé générique.
      if (e instanceof NotAClubFormError && e.message === LEGACY_FORM_REFUSED) return reply.status(400).send({ error: LEGACY_FORM_REFUSED });
      throw e;
    }
  });

  app.post<{ Params: { id: string; clubId: string } }>('/api/competitions/:id/clubs/:clubId/club-form-header', async (req) => {
    await competition(req.params.id);
    const input = z.object({ values: headerValues, expected: shownValues }).strict().parse(req.body);
    return writeClubFormHeader(db, req.params.id, req.params.clubId, input);
  });
}
