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
import { closedCategoryRoutes } from './routes/closed-categories.js';
import { replacementRoutes } from './routes/replacement.js';
import { resultRoutes } from './routes/results.js';
import { waveRoutes } from './routes/waves.js';
import { launchRoutes } from './routes/launches.js';
import { zoneRoutes } from './routes/zones.js';
import { backupRoutes } from './routes/backups.js';
import { directoryRoutes } from './routes/directory.js';
import { invitationRoutes } from './routes/invitations.js';
import { clubEntryRoutes } from './routes/club-entry.js';
import { loggerOptions } from './log.js';
import { registerGuard, type InstanceRole } from './auth/guard.js';
import { registerPermissions } from './auth/permissions.js';
import { getManagement, registerReadOnlyGuard } from './sync/ownership.js';
import { registerCategoryRevGuard } from './revisions.js';
import { registerCompetitionEvents } from './events.js';
import { syncRemoteRoutes } from './routes/sync-remote.js';
import { syncFileRoutes, syncLocalRoutes } from './routes/sync-local.js';
import { mirrorRoutes } from './routes/mirror.js';
import { startMirror } from './mirror.js';
import { startFollow } from './sync/follow.js';
import { zoneLinkRoutes } from './routes/zone-link.js';
import { zoneJournalRoutes } from './routes/zone-journal.js';
import { startZoneFollow } from './zone/link.js';
import { registerZoneJournal } from './zone/autonomous.js';
import { authRoutes } from './routes/auth.js';
import { appSettingsRoutes } from './routes/app-settings.js';
import { nodemailerTransport, type MailTransport } from './mail.js';
import { RestoreError, startAutoBackup } from './repositories/backups.js';
import { ensureInstance } from './repositories/instance.js';
import { startRetention } from './repositories/retention.js';
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
  /** `serveur` : en ligne, connexion obligatoire pour les organisateurs ; `local` (défaut) : le PC de la compétition, sans connexion. */
  role?: InstanceRole;
  /** Adresse publique du serveur (base des liens envoyés aux clubs) ; à défaut, l'origine de la requête. */
  publicUrl?: string;
  /** Envoi des mails (nodemailer par défaut ; remplacé dans les tests). */
  mailTransport?: MailTransport;
  /** Pause entre deux mails d'un envoi groupé (300 ms par défaut). */
  mailPauseMs?: number;
}

const NOT_FOUND = { error: 'Compétition introuvable' };

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const role = opts.role ?? 'local';
  // Rôle serveur : un seul intermédiaire de confiance (Caddy) ; l'adresse du client est la dernière qu'il ajoute à X-Forwarded-For.
  const trustProxy = role === 'serveur' ? (_addr: string, hop: number) => hop < 1 : false;
  const app = Fastify({ logger: loggerOptions(opts.logger ?? false), bodyLimit: 20 * 1024 * 1024, trustProxy });
  const db = openDb(opts.dbPath);
  registerGuard(app, db, role);
  registerPermissions(app, db, role);
  registerReadOnlyGuard(app, db);
  registerZoneJournal(app, db);
  registerCategoryRevGuard(app, db);
  registerCompetitionEvents(app);
  ensureInstance(db, opts.instanceName ?? 'PC');
  const stopBackups = startAutoBackup(db, opts.dbPath, opts.backupIntervalMin ?? 0, (e) => app.log.error(e));
  const stopRetention = startRetention(db, opts.dbPath, (e) => app.log.error(e));
  app.addHook('onClose', async () => {
    stopBackups();
    stopRetention();
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
    // Une erreur d'au moins 500 garde son message seulement s'il est fait pour l'écran (`expose`, par exemple le serveur injoignable).
    const expose = (error as { expose?: boolean }).expose === true;
    // `reason` : cas que l'écran traite à part (par exemple RESCUE_DIVERGED), renvoyé dans `code`.
    const reason = (error as { reason?: string }).reason;
    return reply.status(status).send({ error: status >= 500 && !expose ? 'Erreur interne du serveur' : (error as Error).message, ...(reason ? { code: reason } : {}) });
  });

  // Fichiers (fiches club, exports FFK) envoyés en corps brut.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/api/health', async () => ({ ok: true }));

  // Un compte Zone ne voit que la compétition de sa zone.
  // Liste de l'accueil : en plus, le nombre d'inscrits et l'état de la main (lecture seule).
  app.get('/api/competitions', async (req) => {
    const counts = new Map(
      (db.$client.prepare('select competition_id as id, count(*) as n from registrations group by competition_id').all() as { id: string; n: number }[]).map((r) => [r.id, r.n]),
    );
    return (await listCompetitions(db))
      .filter((c) => req.user?.role !== 'zone' || c.id === req.user.competitionId)
      .map((c) => {
        const { managedHere, ownerName } = getManagement(db, c.id);
        return { ...c, registrationCount: counts.get(c.id) ?? 0, management: { managedHere, ownerName } };
      });
  });

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
  await app.register(closedCategoryRoutes, { db });
  await app.register(replacementRoutes, { db });
  await app.register(resultRoutes, { db });
  await app.register(zoneRoutes, { db });
  await app.register(waveRoutes, { db });
  await app.register(launchRoutes, { db });
  await app.register(backupRoutes, { db, dbPath: opts.dbPath });
  await app.register(directoryRoutes, { db });
  const mailTransport = opts.mailTransport ?? nodemailerTransport;
  await app.register(invitationRoutes, { db, mailTransport, publicUrl: opts.publicUrl, mailPauseMs: opts.mailPauseMs, role });
  await app.register(clubEntryRoutes, { db });
  await app.register(authRoutes, { db, role });
  // Échanges de compétitions : les routes du serveur en ligne et celles du PC ne tournent que dans leur rôle.
  if (role === 'serveur') await app.register(syncRemoteRoutes, { db, dbPath: opts.dbPath });
  else {
    await app.register(syncLocalRoutes, { db, dbPath: opts.dbPath });
    // Copie de secours d'un autre PC : seulement entre PC de la compétition (le PC principal ne demande pas de connexion).
    await app.register(mirrorRoutes, { db, dbPath: opts.dbPath });
    const stopMirror = startMirror(db, opts.dbPath, (e) => app.log.error(e));
    app.addHook('onClose', async () => stopMirror());
    const stopFollow = startFollow(db, opts.dbPath, (e) => app.log.error(e));
    app.addHook('onClose', async () => stopFollow());
    // Portable de zone : suit le PC principal (réseau local).
    await app.register(zoneLinkRoutes, { db, dbPath: opts.dbPath });
    await app.register(zoneJournalRoutes, { db });
    const stopZoneFollow = startZoneFollow(db, opts.dbPath, (e) => app.log.error(e));
    app.addHook('onClose', async () => stopZoneFollow());
  }
  await app.register(syncFileRoutes, { db, dbPath: opts.dbPath, role });
  await app.register(appSettingsRoutes, { db, mailTransport });

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
