import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotAClubFormError, parseClubForm } from '../../domain/club-form.js';
import { buildClubFormTemplate } from '../club-form-template.js';
import type { AppDb } from '../db/client.js';
import { getCompetition, getGrid } from '../repositories/competitions.js';
import {
  createRegistration,
  deleteRegistration,
  clubFormRemovals,
  importClubForm,
  listClubs,
  listRegistrations,
  updateClub,
  updateRegistration,
  upsertClub,
} from '../repositories/registrations.js';
import { UnreadableFileError, readWorkbook } from '../spreadsheet/read.js';
import { writeOds } from '../spreadsheet/ods.js';

const discipline = z.enum(['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata']);
export const registrationInputSchema = z
  .object({
    clubId: z.string().nullable(),
    lastName: z.string().trim().min(1).max(80),
    firstName: z.string().trim().max(80),
    sex: z.enum(['M', 'F']),
    ageBandCode: z.string().min(1),
    licence: z.string().trim().max(30).nullable().optional(),
    grade: z.string().trim().max(30).nullable().optional(),
    discipline,
    ruleset: z.enum(['jiyu', 'shobu']).nullable(),
    weightClassId: z.string().nullable(),
    approxWeightKg: z.number().positive().max(250).nullable().optional(),
    otherDisciplines: z.array(discipline).optional(),
    acceptsJiyuFirst: z.boolean().nullable().optional(),
    source: z.enum(['club_form', 'ffk', 'manual', 'onsite']),
  })
  .strict();

const clubSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    ffkEntity: z.string().trim().max(160).nullable().optional(),
    coachName: z.string().trim().max(120).nullable().optional(),
    coachPhone: z.string().trim().max(40).nullable().optional(),
    coachEmail: z.string().trim().max(160).nullable().optional(),
    preApproval: z.boolean().optional(),
  })
  .strict();

type P = { Params: { id: string } };

export async function registrationRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  const NOT_FOUND = { error: 'Compétition introuvable' };

  async function parseUpload(competitionId: string, body: unknown) {
    if (!Buffer.isBuffer(body)) throw new UnreadableFileError('Aucun fichier reçu.');
    let sheets: { cells: unknown[][] }[];
    try {
      sheets = readWorkbook(body).sheets;
    } catch (e) {
      if (e instanceof UnreadableFileError) throw new NotAClubFormError(e.message);
      throw e;
    }
    // Premier onglet qui est une fiche club (un coach peut ajouter des onglets). Un onglet reconnu (titre trouvé)
    // mais cassé est signalé : on ne lit pas à sa place un onglet suivant (copie ancienne, par exemple).
    const grid = await getGrid(db, competitionId);
    const tolerance = (await getCompetition(db, competitionId))!.settings.weighInToleranceKg;
    const GENERIC = "Ce fichier n'est pas une fiche club.";
    for (const sheet of sheets) {
      try {
        return parseClubForm(sheet.cells, grid, tolerance);
      } catch (e) {
        if (!(e instanceof NotAClubFormError) || e.message !== GENERIC) throw e;
      }
    }
    throw new NotAClubFormError(GENERIC);
  }

  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send(NOT_FOUND);
  });

  app.get<P>('/api/competitions/:id/clubs', async (req) => listClubs(db, req.params.id));

  app.post<P>('/api/competitions/:id/clubs', async (req, reply) => {
    const data = clubSchema.parse(req.body);
    const club = await upsertClub(db, req.params.id, data);
    return reply.status(201).send(club);
  });

  app.patch<{ Params: { id: string; clubId: string } }>('/api/competitions/:id/clubs/:clubId', async (req) =>
    updateClub(db, req.params.id, req.params.clubId, clubSchema.partial().parse(req.body)),
  );

  app.get<P>('/api/competitions/:id/registrations', async (req) => listRegistrations(db, req.params.id));

  app.post<P>('/api/competitions/:id/registrations', async (req, reply) => {
    const result = await createRegistration(db, req.params.id, registrationInputSchema.parse(req.body));
    return reply.status(201).send(result);
  });

  app.put<{ Params: { id: string; rid: string } }>('/api/competitions/:id/registrations/:rid', async (req) =>
    updateRegistration(db, req.params.id, req.params.rid, registrationInputSchema.parse(req.body)),
  );

  app.delete<{ Params: { id: string; rid: string } }>('/api/competitions/:id/registrations/:rid', async (req, reply) => {
    await deleteRegistration(db, req.params.id, req.params.rid);
    return reply.status(204).send();
  });

  app.get<P>('/api/competitions/:id/club-form.ods', async (req, reply) => {
    const competition = (await getCompetition(db, req.params.id))!;
    const buf = await writeOds(buildClubFormTemplate(competition, await getGrid(db, req.params.id)));
    return reply
      .header('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet')
      .header('Content-Disposition', `attachment; filename="fiche-club-${competition.date}.ods"`)
      .send(buf);
  });

  app.post<P>('/api/competitions/:id/club-forms/preview', async (req) => {
    const parse = await parseUpload(req.params.id, req.body);
    return { ...parse, removals: await clubFormRemovals(db, req.params.id, parse) };
  });

  app.post<P>('/api/competitions/:id/club-forms/import', async (req) => {
    const parse = await parseUpload(req.params.id, req.body);
    return { ...(await importClubForm(db, req.params.id, parse)), parse };
  });
}
