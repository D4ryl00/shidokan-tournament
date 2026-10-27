import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailList } from './fields.js';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { syncCategories } from '../repositories/categories.js';
import { deleteClubLine, getClubEntry, saveClubLine, updateClubEntryHeader, type ClubAccess } from '../repositories/club-entry.js';
import { invitationStatus, resolveInvitation } from '../repositories/invitations.js';
import { NotFoundError } from '../repositories/registrations.js';
import { clubFormLineSchema } from './registrations.js';

type T = { Params: { token: string } };

class ReplacedLinkError extends Error {
  readonly statusCode = 410;
  constructor() {
    super('Ce lien a été remplacé : utilisez celui du dernier mail reçu.');
  }
}
type TF = { Params: { token: string; fighterId: string } };

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable();
const headerSchema = z
  .object({
    coachName: text(120),
    coachPhone: text(40),
    coachEmails: emailList,
    preApproval: z.boolean(),
    affiliationNumber: z.string().trim().regex(/^(\d{7})?$/, 'Le numéro d’affiliation FFK a 7 chiffres.').transform((v) => v || null).nullable(),
  })
  .strict();

/** Page d'inscription d'un club, ouverte avec son lien personnel (sans compte). */
export async function clubEntryRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  // Routes publiques (sans compte) : petites requêtes seulement, au lieu des 20 Mo des imports de l'organisateur.
  app.addHook('onRoute', (route) => {
    route.bodyLimit = 64 * 1024;
  });
  // Les données sont déjà enregistrées : un échec du recalcul des catégories ne doit pas faire croire au coach que rien n'est passé.
  const resync = (competitionId: string) => {
    competitionChanged(competitionId);
    return syncCategories(db, competitionId).catch((e) => app.log.error(e));
  };
  const access = (token: string): ClubAccess => {
    const found = resolveInvitation(db, token);
    if (found) return found;
    if (invitationStatus(db, token) === 'revoked') throw new ReplacedLinkError();
    throw new NotFoundError('Lien inconnu ou expiré.');
  };

  app.get<T>('/api/inscription/:token', async (req) => getClubEntry(db, access(req.params.token)));

  app.patch<T>('/api/inscription/:token/club', async (req) => {
    const a = access(req.params.token);
    const club = await updateClubEntryHeader(db, a, headerSchema.parse(req.body));
    competitionChanged(a.competitionId);
    return club;
  });

  app.post<T>('/api/inscription/:token/lines', async (req, reply) => {
    const a = access(req.params.token);
    const { line } = z.object({ line: clubFormLineSchema }).parse(req.body);
    const saved = await saveClubLine(db, a, null, line, null);
    await resync(a.competitionId);
    return reply.status(201).send(saved);
  });

  app.put<TF>('/api/inscription/:token/lines/:fighterId', async (req) => {
    const a = access(req.params.token);
    const { line, version } = z.object({ line: clubFormLineSchema, version: z.string().min(1) }).parse(req.body);
    const saved = await saveClubLine(db, a, req.params.fighterId, line, version);
    await resync(a.competitionId);
    return saved;
  });

  app.delete<TF & { Querystring: { version?: string } }>('/api/inscription/:token/lines/:fighterId', async (req, reply) => {
    const a = access(req.params.token);
    const { version } = z.object({ version: z.string().min(1) }).parse(req.query);
    await deleteClubLine(db, a, req.params.fighterId, version);
    await resync(a.competitionId);
    return reply.status(204).send();
  });
}
