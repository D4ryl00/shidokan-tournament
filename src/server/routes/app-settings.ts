import type { FastifyInstance } from 'fastify';
import { appSettingsPatchSchema } from '../../domain/app-settings.js';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { sendTestMail, type MailTransport } from '../mail.js';
import { getAppSettings, publicAppSettings, updateAppSettings } from '../repositories/app-settings.js';

/** Réglages de l'application (pas d'une compétition). */
export async function appSettingsRoutes(app: FastifyInstance, { db, mailTransport }: { db: AppDb; mailTransport: MailTransport }) {
  app.get('/api/app-settings', async () => publicAppSettings(getAppSettings(db)));
  app.post('/api/app-settings/test-mail', async (req, reply) => {
    const { to } = z.object({ to: z.string().trim().email().max(200) }).parse(req.body);
    await sendTestMail(db, mailTransport, to);
    return reply.status(204).send();
  });
  app.patch('/api/app-settings', async (req) => publicAppSettings(updateAppSettings(db, appSettingsPatchSchema.parse(req.body))));
}
