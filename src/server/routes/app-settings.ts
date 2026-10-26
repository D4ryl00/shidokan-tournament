import type { FastifyInstance } from 'fastify';
import { appSettingsPatchSchema, GOOGLE_NOT_CONFIGURED } from '../../domain/app-settings.js';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { sendTestMail, type MailTransport } from '../mail.js';
import { getAppSettings, publicAppSettings, updateAppSettings } from '../repositories/app-settings.js';

class SettingsError extends Error {
  readonly statusCode = 400;
}

/** Réglages de l'application (pas d'une compétition). */
export async function appSettingsRoutes(app: FastifyInstance, { db, mailTransport, googleAvailable }: { db: AppDb; mailTransport: MailTransport; googleAvailable: boolean }) {
  app.get('/api/app-settings', async () => publicAppSettings(getAppSettings(db), googleAvailable));
  app.post('/api/app-settings/test-mail', async (req, reply) => {
    const { to } = z.object({ to: z.string().trim().email().max(200) }).parse(req.body);
    await sendTestMail(db, mailTransport, to);
    return reply.status(204).send();
  });
  app.patch('/api/app-settings', async (req) => {
    const patch = appSettingsPatchSchema.parse(req.body);
    // Sans compte connecté, le dépôt répond « Connectez d’abord un compte Google. »
    if (patch.mailMode === 'google' && !googleAvailable && getAppSettings(db).google) throw new SettingsError(GOOGLE_NOT_CONFIGURED);
    return publicAppSettings(updateAppSettings(db, patch), googleAvailable);
  });
}
