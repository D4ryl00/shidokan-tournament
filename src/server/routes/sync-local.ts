import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InstanceRole } from '../auth/guard.js';
import type { AppDb } from '../db/client.js';
import { getInstance } from '../repositories/instance.js';
import { NotFoundError } from '../repositories/registrations.js';
import { getSyncServer, rememberServerInstance, remote, setSyncServer } from '../sync/client.js';
import { getManagement } from '../sync/ownership.js';
import { buildPackage, importPackage, type SyncPackage } from '../sync/package.js';

class SyncConflictError extends Error {
  readonly statusCode = 409;
}

const SERVER_NAME = 'le serveur en ligne';
const FILE_OWNER = { id: 'file', name: 'un PC (par fichier)' };

/** Côté PC : relier au serveur et faire les gestes ; dans les deux rôles : échange par fichier. */
export async function syncLocalRoutes(app: FastifyInstance, { db, dbPath, role }: { db: AppDb; dbPath: string; role: InstanceRole }) {
  const exists = (id: string) => !!db.$client.prepare('select 1 from competitions where id = ?').get(id);
  const me = () => {
    const i = getInstance(db);
    return { instanceId: i?.id ?? 'inconnue', instanceName: i?.name ?? 'PC' };
  };
  const mustManageHere = (id: string) => {
    if (!exists(id)) throw new NotFoundError('Compétition introuvable');
    if (!getManagement(db, id).managedHere) throw new SyncConflictError('Ce PC n’a pas la main sur cette compétition.');
  };

  app.get('/api/sync/settings', async () => {
    const s = getSyncServer(db);
    return { url: s?.url ?? null, hasToken: !!s?.token };
  });
  app.patch('/api/sync/settings', async (req) => {
    const patch = z.object({ url: z.string().trim().url().max(300), token: z.string().trim().max(200).nullable() }).strict().parse(req.body);
    setSyncServer(db, patch);
    const s = getSyncServer(db);
    return { url: s?.url ?? null, hasToken: !!s?.token };
  });

  app.get('/api/sync/server-competitions', async () => remote(db, 'GET', '/competitions'));

  app.post('/api/sync/pull', async (req) => {
    const { competitionId, take } = z.object({ competitionId: z.string().min(1), take: z.boolean() }).parse(req.body);
    // Ce PC a la main : récupérer depuis le serveur écraserait son travail.
    if (exists(competitionId) && getManagement(db, competitionId).managedHere) {
      throw new SyncConflictError('Ce PC a la main sur cette compétition : envoyez une copie au serveur ou rendez-lui la main.');
    }
    const pkg = take
      ? await remote<SyncPackage>(db, 'POST', `/competitions/${competitionId}/take`, me())
      : await remote<SyncPackage>(db, 'GET', `/competitions/${competitionId}/package`);
    rememberServerInstance(db, pkg.from.instanceId);
    return importPackage(db, dbPath, pkg, take ? null : { id: pkg.from.instanceId, name: SERVER_NAME });
  });

  app.post<{ Params: { id: string } }>('/api/competitions/:id/sync/copy', async (req) => {
    mustManageHere(req.params.id);
    await remote(db, 'POST', `/competitions/${req.params.id}/copy`, buildPackage(db, req.params.id, { handOver: false, role }));
    const sentAt = new Date().toISOString();
    db.$client.prepare('update competitions set last_sync_at = ? where id = ?').run(sentAt, req.params.id);
    return { sentAt };
  });

  app.post<{ Params: { id: string } }>('/api/competitions/:id/sync/return', async (req, reply) => {
    mustManageHere(req.params.id);
    await remote(db, 'POST', `/competitions/${req.params.id}/return`, buildPackage(db, req.params.id, { handOver: true, role }));
    const serverId = getSyncServer(db)?.serverInstanceId ?? 'serveur';
    const now = new Date().toISOString();
    db.$client.prepare('update competitions set owner_instance_id = ?, owner_name = ?, owner_since = ?, last_sync_at = ? where id = ?').run(serverId, SERVER_NAME, now, now, req.params.id);
    return reply.status(204).send();
  });

  // Fichier (sans internet) : export et import, dans les deux rôles.
  app.get<{ Params: { id: string }; Querystring: { handOver?: string } }>('/api/competitions/:id/export.json', async (req, reply) => {
    if (!exists(req.params.id)) throw new NotFoundError('Compétition introuvable');
    const handOver = role === 'serveur' && req.query.handOver === '1';
    if (handOver) {
      if (!getManagement(db, req.params.id).managedHere) throw new SyncConflictError('Cette compétition est déjà gérée ailleurs.');
      const now = new Date().toISOString();
      db.$client
        .prepare("update competitions set owner_instance_id = ?, owner_name = ?, owner_since = ?, last_sync_at = ?, club_entry_status = 'frozen' where id = ?")
        .run(FILE_OWNER.id, FILE_OWNER.name, now, now, req.params.id);
    }
    const pkg = buildPackage(db, req.params.id, { handOver, role });
    if (handOver) pkg.tables.competitions![0] = { ...pkg.tables.competitions![0], owner_instance_id: null, owner_name: null, owner_since: null };
    const name = String(pkg.tables.competitions![0]!.name).normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
    return reply.header('Content-Disposition', `attachment; filename="competition-${name}.json"`).send(pkg);
  });

  app.post<{ Querystring: { replace?: string; takeOver?: string } }>('/api/competitions/import', async (req) => {
    const pkg = req.body as Partial<SyncPackage> | null;
    const id = typeof pkg?.competitionId === 'string' ? pkg.competitionId : null;
    const present = id !== null && exists(id);
    if (present) {
      const m = getManagement(db, id!);
      if (m.managedHere && req.query.replace !== '1') throw new SyncConflictError('Cette compétition existe déjà ici : confirmez son remplacement.');
      if (!m.managedHere && req.query.takeOver !== '1') throw new SyncConflictError(`Cette compétition est gérée par ${m.ownerName ?? 'une autre installation'} : confirmez la reprise de la main avec ce fichier.`);
    }
    // Copie simple venue du serveur (sans la main) : gardée en lecture seule ; tout le reste est géré ici.
    const readOnly = !present && pkg?.handOver === false && pkg.from?.role === 'serveur';
    return importPackage(db, dbPath, pkg, readOnly ? { id: pkg!.from!.instanceId, name: SERVER_NAME } : null);
  });
}
