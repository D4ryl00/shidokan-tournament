import type { FastifyInstance } from 'fastify';
import { appSettingsPatchSchema, GOOGLE_NOT_CONFIGURED, SERVER_ONLY } from '../../domain/app-settings.js';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { cleanTemplate } from '../mail-html.js';
import { sendTestMail, type MailTransport } from '../mail.js';
import { getAppSettings, publicAppSettings, updateAppSettings } from '../repositories/app-settings.js';

class SettingsError extends Error {
  readonly statusCode = 400;
}

class ServerOnlyError extends Error {
  readonly statusCode = 403;
  constructor() {
    super(SERVER_ONLY);
  }
}

/** Réglages de l'application (pas d'une compétition). */
export async function appSettingsRoutes(app: FastifyInstance, { db, mailTransport, googleAvailable, clubServices }: { db: AppDb; mailTransport: MailTransport; googleAvailable: boolean; clubServices: boolean }) {
  app.get('/api/app-settings', async () => publicAppSettings(getAppSettings(db), googleAvailable));
  app.post('/api/app-settings/test-mail', async (req, reply) => {
    const { to } = z.object({ to: z.string().trim().email().max(200) }).parse(req.body);
    await sendTestMail(db, mailTransport, to);
    return reply.status(204).send();
  });
  app.patch('/api/app-settings', async (req) => {
    const patch = appSettingsPatchSchema.parse(req.body);
    // Sur un PC, les réglages de mail ne changent pas ; confidentialité, conservation et règles restent modifiables.
    if (!clubServices && (patch.smtp !== undefined || patch.mailMode !== undefined || patch.googleFromName !== undefined || patch.invitationMail !== undefined)) {
      throw new ServerOnlyError();
    }
    // Sans compte connecté, le dépôt répond « Connectez d’abord un compte Google. »
    if (patch.mailMode === 'google' && !googleAvailable && getAppSettings(db).google) throw new SettingsError(GOOGLE_NOT_CONFIGURED);
    // Le message est filtré avant d'être gardé : du code collé dans l'éditeur n'arrive jamais en base.
    if (patch.invitationMail) patch.invitationMail = cleanTemplate(patch.invitationMail);
    return publicAppSettings(updateAppSettings(db, patch), googleAvailable);
  });
}
