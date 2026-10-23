import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InstanceRole } from '../auth/guard.js';
import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { NotFoundError } from '../repositories/registrations.js';
import { clearSyncServer, getSyncServer, rememberServerInstance, remote, setSyncServer, syncUrlAllowed } from '../sync/client.js';
import { followStatus, getFollow, resetFollowStatus, setFollow } from '../sync/follow.js';
import { getManagement } from '../sync/ownership.js';
import { buildPackage, importPackage, type SyncPackage } from '../sync/package.js';
import { myIdentity, pullCopy, SERVER_NAME, serverCopyName, SyncConflictError } from '../sync/pull.js';

const exists = (db: AppDb, id: string) => !!db.$client.prepare('select 1 from competitions where id = ?').get(id);

/** PC de la compétition (rôle local) : relier au serveur et faire les gestes. */
export async function syncLocalRoutes(app: FastifyInstance, { db, dbPath }: { db: AppDb; dbPath: string }) {
  const mustManageHere = (id: string) => {
    if (!exists(db, id)) throw new NotFoundError('Compétition introuvable');
    if (!getManagement(db, id).managedHere) throw new SyncConflictError('Ce PC n’a pas la main sur cette compétition.');
  };
  const settingsView = () => {
    const s = getSyncServer(db);
    return { url: s?.url ?? null, hasToken: !!s?.token };
  };
  const setOwner = (id: string, owner: { id: string; name: string } | null) => {
    const now = new Date().toISOString();
    db.$client.prepare('update competitions set owner_instance_id = ?, owner_name = ?, owner_since = ?, last_sync_at = ? where id = ?').run(owner?.id ?? null, owner?.name ?? null, owner ? now : null, now, id);
  };

  app.get('/api/sync/settings', async () => settingsView());
  app.patch('/api/sync/settings', async (req) => {
    const patch = z
      .object({
        url: z.string().trim().max(300).refine(syncUrlAllowed, 'L’adresse du serveur doit commencer par https://'),
        token: z.string().trim().max(200).nullable(),
      })
      .strict()
      .parse(req.body);
    setSyncServer(db, patch);
    return settingsView();
  });
  app.delete('/api/sync/settings', async (_req, reply) => {
    clearSyncServer(db);
    return reply.status(204).send();
  });

  app.get('/api/sync/server-competitions', async () => remote(db, 'GET', '/competitions'));

  app.post('/api/sync/pull', async (req) => {
    const { competitionId, take } = z.object({ competitionId: z.string().min(1).max(100), take: z.boolean() }).parse(req.body);
    return pullCopy(db, dbPath, competitionId, take);
  });

  // Copie tenue à jour : « Récupérer une copie » refait toutes les N minutes, tant que la compétition est une copie du serveur.
  const followView = () => ({ competitionId: getFollow(db)?.competitionId ?? null, intervalMin: getFollow(db)?.intervalMin ?? 5, ...followStatus(dbPath) });
  app.get('/api/sync/follow', async () => followView());
  app.put('/api/sync/follow', async (req) => {
    const value = z.object({ competitionId: z.string().min(1).max(100), intervalMin: z.number().int().min(1).max(60) }).strict().nullable().parse(req.body ?? null); // corps vide ou null : arrêter
    setFollow(db, value);
    resetFollowStatus(dbPath);
    return followView();
  });

  /** Internet coupé : la copie du serveur devient modifiable ici, sans demander au serveur (il sera prévenu plus tard). */
  app.post<{ Params: { id: string } }>('/api/competitions/:id/sync/rescue', async (req, reply) => {
    if (!exists(db, req.params.id)) throw new NotFoundError('Compétition introuvable');
    if (!getManagement(db, req.params.id).copyOfServer) throw new SyncConflictError('Seule une copie du serveur peut être prise en secours.');
    db.$client
      .prepare('update competitions set owner_instance_id = null, owner_name = null, owner_since = null, rescue_since = ? where id = ?')
      .run(new Date().toISOString(), req.params.id);
    competitionChanged(req.params.id);
    return reply.status(204).send();
  });

  /** Internet revenu : le serveur reçoit la compétition et la main passe à ce PC (refus si elle a changé en ligne, sauf `replace`). */
  app.post<{ Params: { id: string } }>('/api/competitions/:id/sync/rescue/notify', async (req, reply) => {
    const { replace } = z.object({ replace: z.boolean() }).strict().parse(req.body);
    mustManageHere(req.params.id);
    const row = db.$client.prepare('select rescue_since as since, server_fingerprint as base from competitions where id = ?').get(req.params.id) as { since: string | null; base: string | null };
    if (!row.since) throw new SyncConflictError('Cette compétition n’a pas été prise en secours.');
    const res = await remote<{ instanceId?: string }>(db, 'POST', `/competitions/${encodeURIComponent(req.params.id)}/rescue`, {
      ...myIdentity(db), baseFingerprint: row.base, replace, package: buildPackage(db, req.params.id, { handOver: false, role: 'local' }),
    });
    if (res?.instanceId) rememberServerInstance(db, res.instanceId);
    db.$client.prepare('update competitions set rescue_since = null, last_sync_at = ? where id = ?').run(new Date().toISOString(), req.params.id);
    competitionChanged(req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/competitions/:id/sync/copy', async (req) => {
    mustManageHere(req.params.id);
    await remote(db, 'POST', `/competitions/${encodeURIComponent(req.params.id)}/copy`, buildPackage(db, req.params.id, { handOver: false, role: 'local' }));
    const sentAt = new Date().toISOString();
    db.$client.prepare('update competitions set last_sync_at = ? where id = ?').run(sentAt, req.params.id);
    return { sentAt };
  });

  app.post<{ Params: { id: string } }>('/api/competitions/:id/sync/return', async (req, reply) => {
    mustManageHere(req.params.id);
    // Lecture seule d'abord : une saisie faite pendant l'envoi serait perdue. En cas d'échec, la main revient au PC.
    const serverId = getSyncServer(db)?.serverInstanceId ?? 'serveur';
    setOwner(req.params.id, { id: serverId, name: SERVER_NAME });
    try {
      const pkg = buildPackage(db, req.params.id, { handOver: true, role: 'local' });
      const res = await remote<{ instanceId?: string }>(db, 'POST', `/competitions/${encodeURIComponent(req.params.id)}/return`, pkg);
      if (res?.instanceId) {
        rememberServerInstance(db, res.instanceId);
        setOwner(req.params.id, { id: res.instanceId, name: SERVER_NAME });
      }
    } catch (e) {
      setOwner(req.params.id, null);
      throw e;
    }
    return reply.status(204).send();
  });
}

/** Les deux rôles : échange d'une compétition par fichier (sans internet). */
export async function syncFileRoutes(app: FastifyInstance, { db, dbPath, role }: { db: AppDb; dbPath: string; role: InstanceRole }) {
  app.get<{ Params: { id: string } }>('/api/competitions/:id/export.json', async (req, reply) => {
    if (!exists(db, req.params.id)) throw new NotFoundError('Compétition introuvable');
    const pkg = buildPackage(db, req.params.id, { handOver: false, role });
    const name = String(pkg.tables.competitions![0]!.name).normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
    return reply.header('Content-Disposition', `attachment; filename="competition-${name}.json"`).send(pkg);
  });

  app.post<{ Querystring: { replace?: string; takeOver?: string } }>('/api/competitions/import', async (req) => {
    const pkg = req.body as Partial<SyncPackage> | null;
    const id = typeof pkg?.competitionId === 'string' ? pkg.competitionId : null;
    const present = id !== null && exists(db, id);
    const plainServerCopy = pkg?.handOver === false && pkg.from?.role === 'serveur';
    if (present) {
      const m = getManagement(db, id!);
      if (m.managedHere && req.query.replace !== '1') throw new SyncConflictError('Cette compétition existe déjà ici : confirmez son remplacement.');
      if (!m.managedHere) {
        // Sur le PC, une simple copie du serveur ne donne pas la main : sinon la compétition serait modifiable des deux côtés.
        if (role === 'local' && plainServerCopy) {
          throw new SyncConflictError('Ce fichier est une simple copie du serveur : il ne donne pas la main. Prenez la main depuis le serveur, ou exportez-la en ligne en donnant la main au PC.');
        }
        if (req.query.takeOver !== '1') throw new SyncConflictError(`Cette compétition est gérée par ${m.ownerName ?? 'une autre installation'} : confirmez la reprise de la main avec ce fichier.`);
      }
    }
    // Copie simple venue du serveur (sans la main) : gardée en lecture seule ; tout le reste est géré ici.
    const readOnly = role === 'local' && plainServerCopy;
    return importPackage(db, dbPath, pkg, readOnly ? { id: pkg!.from!.instanceId, name: serverCopyName(pkg!.heldBy) } : null);
  });
}
