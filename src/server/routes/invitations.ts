import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import type { InstanceRole } from '../auth/guard.js';
import { invitationMessage, mailtoInvitation, sendInvitations, type MailTransport } from '../mail.js';
import { getCompetition } from '../repositories/competitions.js';
import {
  getClubEntrySettings,
  inviteClubs,
  listInvitations,
  regenerateInvitation,
  revokeInvitation,
  updateClubEntrySettings,
} from '../repositories/invitations.js';

type P = { Params: { id: string } };

class PublicUrlMissingError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('L’adresse publique du serveur (PUBLIC_URL) n’est pas réglée.');
  }
}
type PC = { Params: { id: string; clubId: string } };

/** Liens personnels des clubs, ouverture et gel des inscriptions en ligne (côté organisateur). */
export async function invitationRoutes(app: FastifyInstance, { db, mailTransport, publicUrl, mailPauseMs, role }: { db: AppDb; mailTransport: MailTransport; publicUrl?: string; mailPauseMs?: number; role: InstanceRole }) {
  /**
   * Base des liens envoyés : l'adresse publique du serveur. En rôle local seulement, à défaut, celle par laquelle l'organisateur est
   * venu ; en ligne, les en-têtes de la requête ne décident pas de l'adresse des liens envoyés aux clubs.
   */
  const baseUrl = (req: FastifyRequest) => {
    if (publicUrl) return publicUrl;
    if (role === 'serveur') throw new PublicUrlMissingError();
    return `${req.protocol}://${req.host}`;
  };
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string }).id;
    if (id && !(await getCompetition(db, id))) return reply.status(404).send({ error: 'Compétition introuvable' });
  });

  app.get<P>('/api/competitions/:id/invitations', async (req) => listInvitations(db, req.params.id));
  app.post<P>('/api/competitions/:id/invitations', async (req) => {
    const { directoryIds } = z.object({ directoryIds: z.array(z.string()).max(500) }).parse(req.body);
    return inviteClubs(db, req.params.id, directoryIds);
  });
  app.post<PC>('/api/competitions/:id/invitations/:clubId/regenerate', async (req) => regenerateInvitation(db, req.params.id, req.params.clubId));
  app.delete<PC>('/api/competitions/:id/invitations/:clubId', async (req, reply) => {
    revokeInvitation(db, req.params.id, req.params.clubId);
    return reply.status(204).send();
  });

  app.post<P>('/api/competitions/:id/invitations/send', async (req) => {
    const { clubIds } = z.object({ clubIds: z.array(z.string()).min(1).max(500) }).parse(req.body);
    return sendInvitations(db, mailTransport, req.params.id, clubIds, baseUrl(req), mailPauseMs);
  });
  app.post<PC>('/api/competitions/:id/invitations/:clubId/mailto', async (req) => mailtoInvitation(db, req.params.id, req.params.clubId, baseUrl(req)));
  app.get<P & { Querystring: { clubId?: string } }>('/api/competitions/:id/invitations/preview', async (req) => {
    const { clubId } = z.object({ clubId: z.string().min(1) }).parse(req.query);
    return invitationMessage(db, req.params.id, clubId, '{lien}');
  });

  app.get<P>('/api/competitions/:id/club-entry', async (req) => getClubEntrySettings(db, req.params.id));
  app.patch<P>('/api/competitions/:id/club-entry', async (req) => {
    const patch = z
      .object({ status: z.enum(['open', 'frozen']).optional(), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })
      .strict()
      .parse(req.body);
    return updateClubEntrySettings(db, req.params.id, patch);
  });
}
