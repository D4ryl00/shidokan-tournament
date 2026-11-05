import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAIL_IMAGE_LIMITS } from '../../domain/mail-images.js';
import { MAIL_HTML_MAX } from '../../domain/mail-template-schema.js';
import type { AppDb } from '../db/client.js';
import { cleanMailHtml } from '../mail-html.js';
import { addMailImage, MailImageError, readMailImage } from '../repositories/mail-images.js';
import { NotFoundError } from '../repositories/registrations.js';

/** Images du message aux clubs et vérification du filtre (organisateur seulement : la garde du rôle serveur refuse le reste). */
export async function mailImageRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.post('/api/mail-images', { bodyLimit: MAIL_IMAGE_LIMITS.fileBytes + 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw new MailImageError('Aucune image reçue.');
    return reply.status(201).send(addMailImage(db, req.body));
  });
  app.get<{ Params: { imageId: string } }>('/api/mail-images/:imageId', async (req, reply) => {
    const image = readMailImage(db, req.params.imageId);
    if (!image) throw new NotFoundError('Image introuvable');
    return reply.header('Content-Type', image.contentType).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, max-age=86400').send(image.data);
  });
  // Ce que le filtre garde d'un message et ce qu'il en retire (affiché à la sortie du mode code).
  app.post('/api/mail-html/check', async (req) => {
    const { html } = z.object({ html: z.string().max(MAIL_HTML_MAX) }).strict().parse(req.body);
    const { html: clean, removed } = cleanMailHtml(html);
    return { html: clean, removed };
  });
}
