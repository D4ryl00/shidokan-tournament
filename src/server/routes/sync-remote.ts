import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { InstanceRole } from '../auth/guard.js';
import type { AppDb } from '../db/client.js';
import { competitions, receivedCopies } from '../db/schema.js';
import { NotFoundError } from '../repositories/registrations.js';
import { getManagement } from '../sync/ownership.js';
import { buildPackage, importPackage, type SyncPackage } from '../sync/package.js';
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

const NOT_OWNER = 'Ce PC n’a pas la main sur cette compétition : exportez-la en fichier et demandez à un organisateur de l’importer en ligne.';
const KEPT_COPIES = 5;

/** Routes du serveur pour un PC relié (jeton de synchronisation), et gestion des jetons et des reprises par l'organisateur. */
export async function syncRemoteRoutes(app: FastifyInstance, { db, dbPath, role }: { db: AppDb; dbPath: string; role: InstanceRole }) {
  const competitionRow = (id: string) => {
    const c = db.select().from(competitions).where(eq(competitions.id, id)).get();
    if (!c) throw new NotFoundError('Compétition introuvable');
    return c;
  };
  const fromOf = (body: unknown) => (body as Partial<SyncPackage> | null)?.from?.instanceId;

  // Organisateur (connecté) : jetons et reprises.
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
    competitionRow(req.params.id);
    if (source === 'lastCopy') {
      const copy = db.select().from(receivedCopies).where(eq(receivedCopies.competitionId, req.params.id)).orderBy(desc(receivedCopies.receivedAt)).get();
      if (!copy) throw new SyncConflictError('Aucune copie reçue pour cette compétition.');
      await importPackage(db, dbPath, JSON.parse(copy.packageJson), null);
    } else {
      db.update(competitions).set({ ownerInstanceId: null, ownerName: null, ownerSince: null }).where(eq(competitions.id, req.params.id)).run();
    }
    return reply.status(204).send();
  });

  // PC relié : routes ouvertes par le jeton de synchronisation (pas de session).
  await app.register(async (remote) => {
    remote.addHook('preHandler', async (req) => {
      if (!checkSyncToken(db, req.headers.authorization)) throw new SyncAuthError();
    });
    remote.get('/api/sync/remote/competitions', async () =>
      db.select({ id: competitions.id, name: competitions.name, date: competitions.date }).from(competitions).orderBy(desc(competitions.date)).all()
        .map((c) => ({ ...c, ...(({ managedHere, ownerName }) => ({ managedHere, ownerName }))(getManagement(db, c.id)) })),
    );
    remote.get<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/package', async (req) => {
      competitionRow(req.params.cid);
      return buildPackage(db, req.params.cid, { handOver: false, role });
    });
    remote.post<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/take', async (req) => {
      const { instanceId, instanceName } = z.object({ instanceId: z.string().min(1).max(100), instanceName: z.string().min(1).max(100) }).parse(req.body);
      const c = competitionRow(req.params.cid);
      if (c.ownerInstanceId && c.ownerInstanceId !== instanceId) throw new SyncConflictError(`Cette compétition est déjà gérée par ${c.ownerName ?? 'une autre installation'}.`);
      const now = new Date().toISOString();
      db.update(competitions)
        .set({ ownerInstanceId: instanceId, ownerName: instanceName, ownerSince: c.ownerInstanceId ? c.ownerSince : now, lastSyncAt: now, clubEntryStatus: 'frozen' })
        .where(eq(competitions.id, c.id))
        .run();
      const pkg = buildPackage(db, c.id, { handOver: true, role });
      // Le PC reçoit la compétition gérée chez lui : les colonnes de main du paquet sont celles d'une compétition « gérée ici ».
      pkg.tables.competitions![0] = { ...pkg.tables.competitions![0], owner_instance_id: null, owner_name: null, owner_since: null };
      return pkg;
    });
    remote.post<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/copy', async (req, reply) => {
      const c = competitionRow(req.params.cid);
      const from = fromOf(req.body);
      if (!from || c.ownerInstanceId !== from) throw new SyncConflictError(NOT_OWNER);
      db.insert(receivedCopies).values({ id: crypto.randomUUID(), competitionId: c.id, fromInstanceId: from, fromName: c.ownerName ?? from, packageJson: JSON.stringify(req.body) }).run();
      const old = db.select({ id: receivedCopies.id }).from(receivedCopies).where(eq(receivedCopies.competitionId, c.id)).orderBy(desc(receivedCopies.receivedAt)).all().slice(KEPT_COPIES);
      for (const o of old) db.delete(receivedCopies).where(eq(receivedCopies.id, o.id)).run();
      return reply.status(204).send();
    });
    remote.post<{ Params: { cid: string } }>('/api/sync/remote/competitions/:cid/return', async (req, reply) => {
      const c = competitionRow(req.params.cid);
      const from = fromOf(req.body);
      if (!from || c.ownerInstanceId !== from) throw new SyncConflictError(NOT_OWNER);
      if ((req.body as Partial<SyncPackage>).competitionId !== c.id) throw new SyncConflictError('Ce paquet est celui d’une autre compétition.');
      await importPackage(db, dbPath, req.body, null);
      return reply.status(204).send();
    });
  });
}
