import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
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
type PC = { Params: { id: string; clubId: string } };

/** Liens personnels des clubs, ouverture et gel des inscriptions en ligne (côté organisateur). */
export async function invitationRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
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

  app.get<P>('/api/competitions/:id/club-entry', async (req) => getClubEntrySettings(db, req.params.id));
  app.patch<P>('/api/competitions/:id/club-entry', async (req) => {
    const patch = z
      .object({ status: z.enum(['open', 'frozen']).optional(), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })
      .strict()
      .parse(req.body);
    return updateClubEntrySettings(db, req.params.id, patch);
  });
}
