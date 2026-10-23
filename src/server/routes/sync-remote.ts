import type { FastifyInstance, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { competitions, receivedCopies } from '../db/schema.js';
import { NotFoundError } from '../repositories/registrations.js';
import { getManagement } from '../sync/ownership.js';
import { buildPackage, competitionFingerprint, importPackage, validatePackage } from '../sync/package.js';
import { getInstance } from '../repositories/instance.js';
import { checkSyncToken, createSyncToken, listSyncTokens, revokeSyncToken } from '../sync/tokens.js';

class SyncConflictError extends Error {
  readonly statusCode = 409;
}
class SyncAuthError extends Error {
  readonly statusCode = 401;
  constructor() {
    super('Jeton de synchronisation invalide.');
  }
}
class SyncPackageError extends Error {
  readonly statusCode = 400;
}

const NOT_OWNER = 'Ce PC n’a pas la main sur cette compétition : exportez-la en fichier et demandez à un organisateur de l’importer en ligne.';
const KEPT_COPIES = 5;
export const FILE_OWNER = { id: 'file', name: 'un PC (par fichier)' };

/** Serveur en ligne : routes pour les PC reliés (jeton de synchronisation), jetons, reprises, export en donnant la main. */
export async function syncRemoteRoutes(app: FastifyInstance, { db, dbPath }: { db: AppDb; dbPath: string }) {
  const competitionRow = (id: string) => {
    const c = db.select().from(competitions).where(eq(competitions.id, id)).get();
    if (!c) throw new NotFoundError('Compétition introuvable');
    return c;
  };
  const migrations = () => (db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
  const dropCopies = (id: string) => db.delete(receivedCopies).where(eq(receivedCopies.competitionId, id)).run();
  const handBack = (id: string) =>
    db.update(competitions).set({ ownerInstanceId: null, ownerName: null, ownerSince: null, ownerTokenId: null }).where(eq(competitions.id, id)).run();

  // Organisateur (connecté) : jetons, copies reçues, reprise forcée, export en donnant la main.
  app.get('/api/sync/tokens', async () => listSyncTokens(db));
  app.post('/api/sync/tokens', async (req, reply) => reply.status(201).send(createSyncToken(db, z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body).name)));
  app.delete<{ Params: { tokenId: string } }>('/api/sync/tokens/:tokenId', async (req, reply) => {
    revokeSyncToken(db, req.params.tokenId);
    return reply.status(204).send();
  });
  app.get<{ Params: { id: string } }>('/api/competitions/:id/received-copies', async (req) =>
    db.select({ id: receivedCopies.id, fromName: receivedCopies.fromName, receivedAt: receivedCopies.receivedAt }).from(receivedCopies)
      .where(eq(receivedCopies.competitionId, req.params.id)).orderBy(desc(receivedCopies.receivedAt)).all(),
  );
  app.post<{ Params: { id: string } }>('/api/competitions/:id/take-back', async (req, reply) => {
    const { source } = z.object({ source: z.enum(['server', 'lastCopy']) }).parse(req.body);
    const c = competitionRow(req.params.id);
    if (source === 'lastCopy') {
      const copy = db.select().from(receivedCopies).where(eq(receivedCopies.competitionId, c.id)).orderBy(desc(receivedCopies.receivedAt)).get();
      if (!copy) throw new SyncConflictError('Aucune copie reçue pour cette compétition.');
      const pkg = JSON.parse(copy.packageJson) as { competitionId?: string };
      if (pkg.competitionId !== c.id) throw new SyncPackageError('Cette copie est celle d’une autre compétition.');
      await importPackage(db, dbPath, pkg, null);
    }
    handBack(c.id);
    dropCopies(c.id);
    return reply.status(204).send();
  });
  /** Fichier pour un PC sans internet : la compétition passe en lecture seule ici jusqu'à son retour (par fichier). */
  app.post<{ Params: { id: string } }>('/api/competitions/:id/export-handover', async (req) => {
    const c = competitionRow(req.params.id);
    const now = new Date().toISOString();
    db.update(competitions)
      .set({ ownerInstanceId: FILE_OWNER.id, ownerName: FILE_OWNER.name, ownerSince: now, ownerTokenId: null, lastSyncAt: now, clubEntryStatus: 'frozen' })
      .where(eq(competitions.id, c.id))
      .run();
    return buildPackage(db, c.id, { handOver: true, role: 'serveur' });
  });

  // PC relié : routes ouvertes par le jeton de synchronisation (pas de session). La main est liée au jeton qui l'a prise.
  await app.register(async (remote) => {
    const tokenOf = new WeakMap<FastifyRequest, string>();
    remote.addHook('preHandler', async (req) => {
      const tokenId = checkSyncToken(db, req.headers.authorization);
      if (!tokenId) throw new SyncAuthError();
      tokenOf.set(req, tokenId);
    });
    /** Le PC qui écrit est-il celui qui a la main (même installation, même jeton) ? */
    const holds = (req: FastifyRequest, c: ReturnType<typeof competitionRow>, instanceId: unknown) =>
      !!c.ownerInstanceId && c.ownerInstanceId === instanceId && c.ownerTokenId === tokenOf.get(req);
    const checked = (body: unknown, id: string) => {
      const pkg = validatePackage(db, body);
      if (pkg.competitionId !== id) throw new SyncPackageError('Ce paquet est celui d’une autre compétition.');
      return pkg;
    };

    remote.get('/api/sync/remote/competitions', async () =>
      db.select({ id: competitions.id, name: competitions.name, date: competitions.date, clubEntryStatus: competitions.clubEntryStatus }).from(competitions)
        .orderBy(desc(competitions.date)).all()
        .map((c) => ({ ...c, ...(({ managedHere, ownerName }) => ({ managedHere, ownerName }))(getManagement(db, c.id)) })),
    );
    remote.get<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/package', async (req) => {
      const c = competitionRow(req.params.cid);
      return { ...buildPackage(db, c.id, { handOver: false, role: 'serveur' }), heldBy: c.ownerInstanceId ? c.ownerName : null, fingerprint: competitionFingerprint(db, c.id) };
    });
    remote.post<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/take', async (req) => {
      const body = z.object({ instanceId: z.string().min(1).max(100), instanceName: z.string().min(1).max(100), migrations: z.number().int().optional() }).parse(req.body);
      const c = competitionRow(req.params.cid);
      // Le PC refuserait un paquet trop récent : on le dit avant de changer quoi que ce soit ici.
      if (body.migrations !== undefined && body.migrations < migrations()) {
        throw new SyncConflictError('Mettez d’abord ce PC à jour : il a une version plus ancienne de l’application que le serveur.');
      }
      if (c.ownerInstanceId && !holds(req, c, body.instanceId)) throw new SyncConflictError(`Cette compétition est déjà gérée par ${c.ownerName ?? 'une autre installation'}.`);
      const now = new Date().toISOString();
      db.update(competitions)
        .set({ ownerInstanceId: body.instanceId, ownerName: body.instanceName, ownerSince: c.ownerInstanceId ? c.ownerSince : now, ownerTokenId: tokenOf.get(req)!, lastSyncAt: now, clubEntryStatus: 'frozen' })
        .where(eq(competitions.id, c.id))
        .run();
      competitionChanged(c.id);
      return buildPackage(db, c.id, { handOver: true, role: 'serveur' });
    });
    remote.post<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/copy', async (req, reply) => {
      const c = competitionRow(req.params.cid);
      const pkg = checked(req.body, c.id);
      if (!holds(req, c, pkg.from?.instanceId)) throw new SyncConflictError(NOT_OWNER);
      db.insert(receivedCopies).values({ id: crypto.randomUUID(), competitionId: c.id, fromInstanceId: pkg.from.instanceId, fromName: c.ownerName ?? pkg.from.instanceId, packageJson: JSON.stringify(pkg) }).run();
      const old = db.select({ id: receivedCopies.id }).from(receivedCopies).where(eq(receivedCopies.competitionId, c.id)).orderBy(desc(receivedCopies.receivedAt)).all().slice(KEPT_COPIES);
      for (const o of old) db.delete(receivedCopies).where(eq(receivedCopies.id, o.id)).run();
      return reply.status(204).send();
    });
    remote.post<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/return', async (req) => {
      const c = competitionRow(req.params.cid);
      const pkg = checked(req.body, c.id);
      if (!holds(req, c, pkg.from?.instanceId)) throw new SyncConflictError(NOT_OWNER);
      await importPackage(db, dbPath, pkg, null);
      handBack(c.id);
      dropCopies(c.id);
      return { instanceId: getInstance(db)?.id ?? 'serveur' };
    });
  });
}
