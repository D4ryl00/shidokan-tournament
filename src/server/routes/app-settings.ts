import type { FastifyInstance } from 'fastify';
import { appSettingsPatchSchema } from '../../domain/app-settings.js';
import type { AppDb } from '../db/client.js';
import { getAppSettings, publicAppSettings, updateAppSettings } from '../repositories/app-settings.js';

/** Réglages de l'application (pas d'une compétition). */
export async function appSettingsRoutes(app: FastifyInstance, { db }: { db: AppDb }) {
  app.get('/api/app-settings', async () => publicAppSettings(getAppSettings(db)));
  app.patch('/api/app-settings', async (req) => publicAppSettings(updateAppSettings(db, appSettingsPatchSchema.parse(req.body))));
}
