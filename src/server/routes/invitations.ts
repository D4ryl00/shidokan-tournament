import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EMAIL_LIMITS } from '../../domain/emails.js';
import type { AppDb } from '../db/client.js';
import type { InstanceRole } from '../auth/guard.js';
import { MAIL_ATTACHMENT_LIMITS } from '../../domain/mail-attachments.js';
import { invitationMessage, mailtoInvitation, sendInvitations, type MailTransport } from '../mail.js';
import { addMailAttachment, AttachmentError, deleteMailAttachment, listMailAttachments, readMailAttachment, setMailAttachmentIncluded } from '../repositories/mail-attachments.js';
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

/** Adresses choisies parmi celles du club (le serveur vérifie qu'elles en sont). */
const chosenEmails = z.array(z.string().trim().max(EMAIL_LIMITS.length)).min(1, 'Choisissez au moins une adresse.').max(EMAIL_LIMITS.count);

class PublicUrlMissingError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('L’adresse publique du serveur (PUBLIC_URL) n’est pas réglée.');
  }
}
type PC = { Params: { id: string; clubId: string } };
type PA = { Params: { id: string; attachmentId: string } };

/** Téléchargement sous le nom exact (RFC 5987), avec un nom ASCII de secours pour les vieux navigateurs. */
const contentDisposition = (fileName: string) =>
  `attachment; filename="${fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/** Liens personnels des clubs, ouverture et gel des inscriptions en ligne (côté organisateur). */
export async function invitationRoutes(
  app: FastifyInstance,
  { db, dbPath, mailTransport, publicUrl, mailPauseMs, role }: { db: AppDb; dbPath: string; mailTransport: MailTransport; publicUrl?: string; mailPauseMs?: number; role: InstanceRole },
) {
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
    const { clubs } = z.object({ clubs: z.array(z.object({ clubId: z.string(), emails: chosenEmails.optional() }).strict()).min(1).max(500) }).strict().parse(req.body);
    return sendInvitations(db, dbPath, mailTransport, req.params.id, clubs, baseUrl(req), mailPauseMs);
  });
  app.post<PC>('/api/competitions/:id/invitations/:clubId/mailto', async (req) => {
    const { emails } = z.object({ emails: chosenEmails.optional() }).strict().parse(req.body ?? {});
    return mailtoInvitation(db, req.params.id, req.params.clubId, baseUrl(req), emails);
  });
  app.get<P & { Querystring: { clubId?: string } }>('/api/competitions/:id/invitations/preview', async (req) => {
    const { clubId } = z.object({ clubId: z.string().min(1) }).parse(req.query);
    return invitationMessage(db, req.params.id, clubId, '{lien}');
  });

  // Pièces jointes ajoutées au mail aux clubs (affiche, règlement…).
  app.get<P>('/api/competitions/:id/mail-attachments', async (req) => listMailAttachments(db, dbPath, req.params.id));
  app.post<P>('/api/competitions/:id/mail-attachments', { bodyLimit: MAIL_ATTACHMENT_LIMITS.fileBytes + 1024 * 1024 }, async (req, reply) => {
    const header = req.headers['x-file-name'];
    if (typeof header !== 'string' || !header.trim()) throw new AttachmentError('Nom de fichier manquant.');
    let name: string;
    try {
      name = decodeURIComponent(header);
    } catch {
      throw new AttachmentError('Nom de fichier illisible.');
    }
    if (!Buffer.isBuffer(req.body)) throw new AttachmentError('Aucun fichier reçu.');
    return reply.status(201).send(await addMailAttachment(db, dbPath, req.params.id, name, req.body));
  });
  app.get<PA>('/api/competitions/:id/mail-attachments/:attachmentId', async (req, reply) => {
    const { info, data } = readMailAttachment(db, dbPath, req.params.id, req.params.attachmentId);
    return reply
      .header('Content-Type', info.contentType)
      .header('Content-Disposition', contentDisposition(info.fileName))
      .header('X-Content-Type-Options', 'nosniff')
      .send(data);
  });
  app.patch<PA>('/api/competitions/:id/mail-attachments/:attachmentId', async (req, reply) => {
    const { included } = z.object({ included: z.boolean() }).strict().parse(req.body);
    setMailAttachmentIncluded(db, req.params.id, req.params.attachmentId, included);
    return reply.status(204).send();
  });
  app.delete<PA>('/api/competitions/:id/mail-attachments/:attachmentId', async (req, reply) => {
    deleteMailAttachment(db, dbPath, req.params.id, req.params.attachmentId);
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
