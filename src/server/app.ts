import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  categoryGridSchema,
  competitionPatchSchema,
  zodIssuesFr,
} from '../domain/api-schemas.js';
import { NotAClubFormError } from '../domain/club-form.js';
import { closeDb, openDb } from './db/client.js';
import {
  GridValidationError,
  getCompetition,
  getGrid,
  listCompetitions,
  replaceGrid,
  updateCompetition,
} from './repositories/competitions.js';
import { NotFoundError, RegistrationLockedError, RegistrationValidationError } from './repositories/registrations.js';
import { CategoryLockedError, syncCategories } from './repositories/categories.js';
import { StaleProposalError } from './repositories/replacement.js';
import { categoryRoutes } from './routes/categories.js';
import { replacementRoutes } from './routes/replacement.js';
import { resultRoutes } from './routes/results.js';
import { waveRoutes } from './routes/waves.js';
import { launchRoutes } from './routes/launches.js';
import { zoneRoutes } from './routes/zones.js';
import { backupRoutes } from './routes/backups.js';
import { directoryRoutes } from './routes/directory.js';
import { RestoreError, startAutoBackup } from './repositories/backups.js';
import { ensureInstance } from './repositories/instance.js';
import { ffkImportRoutes } from './routes/ffk-import.js';
import { registrationRoutes } from './routes/registrations.js';
import { UnreadableFileError } from './spreadsheet/read.js';

export interface AppOptions {
  dbPath: string;
  /** Minutes entre deux sauvegardes automatiques (0 ou absent = désactivé). */
  backupIntervalMin?: number;
  webDistDir?: string;
  logger?: boolean;
  /** Nom de cette installation (« Gérée par le PC … »), utilisé à sa création seulement. */
  instanceName?: string;
}

const NOT_FOUND = { error: 'Compétition introuvable' };

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  const db = openDb(opts.dbPath);
  ensureInstance(db, opts.instanceName ?? 'PC');
  const stopBackups = startAutoBackup(db, opts.dbPath, opts.backupIntervalMin ?? 0, (e) => app.log.error(e));
  app.addHook('onClose', async () => {
    stopBackups();
    closeDb(db);
  });

  app.setErrorHandler((error, _req, reply: FastifyReply) => {
    if (error instanceof ZodError) return reply.status(400).send({ error: 'Données invalides', issues: zodIssuesFr(error) });
    if (error instanceof GridValidationError || error instanceof RegistrationValidationError) {
      return reply.status(400).send({ error: 'Données invalides', issues: error.errors });
    }
    if (error instanceof NotAClubFormError || error instanceof UnreadableFileError) {
      return reply.status(400).send({ error: "Ce fichier n'est pas une fiche club", issues: [error.message] });
    }
    if (error instanceof NotFoundError) return reply.status(404).send({ error: error.message });
    if (error instanceof RestoreError) return reply.status(400).send({ error: error.message });
    if (error instanceof CategoryLockedError || error instanceof StaleProposalError || error instanceof RegistrationLockedError) {
      return reply.status(409).send({ error: error.message });
    }
    const code = (error as { code?: string }).code ?? '';
    const FASTIFY_FR: Record<string, string> = {
      FST_ERR_CTP_INVALID_JSON_BODY: 'Requête mal formée (JSON invalide)',
      FST_ERR_CTP_EMPTY_JSON_BODY: 'Corps de la requête manquant',
      FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Type de contenu non pris en charge',
      FST_ERR_CTP_BODY_TOO_LARGE: 'Fichier trop volumineux',
    };
    if (FASTIFY_FR[code]) return reply.status((error as { statusCode?: number }).statusCode ?? 400).send({ error: FASTIFY_FR[code] });
    // Le corps JSON illisible arrive en SyntaxError marquée 400 par Fastify ; toute autre SyntaxError est un bug serveur.
    if (error instanceof SyntaxError && (error as { statusCode?: number }).statusCode === 400) return reply.status(400).send({ error: 'Requête mal formée (JSON invalide)' });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.status(status).send({ error: status >= 500 ? 'Erreur interne du serveur' : (error as Error).message });
  });

  // Fichiers (fiches club, exports FFK) envoyés en corps brut.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/competitions', async () => await listCompetitions(db));


  app.get<{ Params: { id: string } }>('/api/competitions/:id', async (req, reply) => {
    const c = await getCompetition(db, req.params.id);
    return c ?? reply.status(404).send(NOT_FOUND);
  });

  app.patch<{ Params: { id: string } }>('/api/competitions/:id', async (req, reply) => {
    if (!(await getCompetition(db, req.params.id))) return reply.status(404).send(NOT_FOUND);
    const patch = competitionPatchSchema.parse(req.body);
    return await updateCompetition(db, req.params.id, patch);
  });

  app.get<{ Params: { id: string } }>('/api/competitions/:id/grid', async (req, reply) => {
    if (!(await getCompetition(db, req.params.id))) return reply.status(404).send(NOT_FOUND);
    return await getGrid(db, req.params.id);
  });

  app.put<{ Params: { id: string } }>('/api/competitions/:id/grid', async (req, reply) => {
    if (!(await getCompetition(db, req.params.id))) return reply.status(404).send(NOT_FOUND);
    await replaceGrid(db, req.params.id, categoryGridSchema.parse(req.body));
    return reply.status(204).send();
  });

  await app.register(registrationRoutes, { db });
  await app.register(ffkImportRoutes, { db });
  await app.register(categoryRoutes, { db });
  await app.register(replacementRoutes, { db });
  await app.register(resultRoutes, { db });
  await app.register(zoneRoutes, { db });
  await app.register(waveRoutes, { db });
  await app.register(launchRoutes, { db });
  await app.register(backupRoutes, { db, dbPath: opts.dbPath });
  await app.register(directoryRoutes, { db });

  // Après toute écriture réussie qui touche aux inscriptions ou aux réglages : catégories et tableaux à jour.
  app.addHook('onResponse', async (req, reply) => {
    const id = (req.params as { id?: string } | undefined)?.id;
    if (!id || req.method === 'GET' || reply.statusCode >= 400) return;
    if (/\/(registrations|club-forms\/(entry\/)?import|ffk-imports\/[^/]+\/commit|grid)(\/|$)|^\/api\/competitions\/[^/]+$/.test(req.url)) {
      await syncCategories(db, id).catch((e) => app.log.error(e));
    }
  });

  if (!opts.webDistDir || !fs.existsSync(opts.webDistDir)) {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Route inconnue' }));
  }
  if (opts.webDistDir && fs.existsSync(opts.webDistDir)) {
    await app.register(fastifyStatic, { root: path.resolve(opts.webDistDir) });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Route inconnue' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
