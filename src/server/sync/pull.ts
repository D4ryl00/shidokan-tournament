import type { AppDb } from '../db/client.js';
import { getInstance } from '../repositories/instance.js';
import { rememberServerInstance, remote } from './client.js';
import { getManagement } from './ownership.js';
import { importPackage, type SyncPackage } from './package.js';

export class SyncConflictError extends Error {
  readonly statusCode = 409;
}

export const SERVER_NAME = 'le serveur en ligne';
/** Nom affiché d'une copie du serveur : celui du serveur, et le PC qui a la main s'il y en a un. */
export const serverCopyName = (heldBy: string | null | undefined) => (heldBy ? `${SERVER_NAME} — la main est à ${heldBy}` : SERVER_NAME);

const exists = (db: AppDb, id: string) => !!db.$client.prepare('select 1 from competitions where id = ?').get(id);
export const migrationCount = (db: AppDb) => (db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
export const myIdentity = (db: AppDb) => {
  const i = getInstance(db);
  return { instanceId: i?.id ?? 'inconnue', instanceName: i?.name ?? 'PC' };
};

/**
 * Récupérer une copie du serveur (`take` : en prenant la main). La copie retient l'empreinte de la version du serveur. Une copie déjà
 * présente en lecture seule est remplacée sans sauvegarde (rien à perdre ici), et pas du tout si le serveur n'a pas changé.
 */
export async function pullCopy(db: AppDb, dbPath: string, competitionId: string, take: boolean): Promise<{ competitionId: string; created: boolean }> {
  const present = exists(db, competitionId);
  // Ce PC a la main : récupérer depuis le serveur écraserait son travail.
  if (present && getManagement(db, competitionId).managedHere) {
    throw new SyncConflictError('Ce PC a la main sur cette compétition : envoyez une copie au serveur ou rendez-lui la main.');
  }
  const path = `/competitions/${encodeURIComponent(competitionId)}`;
  const pkg = take
    ? await remote<SyncPackage>(db, 'POST', `${path}/take`, { ...myIdentity(db), migrations: migrationCount(db) })
    : await remote<SyncPackage>(db, 'GET', `${path}/package`);
  if (pkg?.competitionId !== competitionId) throw new SyncConflictError('Le serveur a renvoyé une autre compétition : vérifiez son adresse.');
  rememberServerInstance(db, pkg.from.instanceId);
  const copyHere = present && getManagement(db, competitionId).copyOfServer;
  const stored = (db.$client.prepare('select server_fingerprint as f from competitions where id = ?').get(competitionId) as { f: string | null } | undefined)?.f;
  const owner = take ? null : { id: pkg.from.instanceId, name: serverCopyName(pkg.heldBy) };
  let result = { competitionId, created: false };
  if (!take && copyHere && pkg.fingerprint && pkg.fingerprint === stored) {
    db.$client.prepare('update competitions set owner_name = ?, last_sync_at = ? where id = ?').run(owner!.name, new Date().toISOString(), competitionId);
  } else {
    result = await importPackage(db, dbPath, pkg, owner, new Date(), { backup: !(copyHere && !take) });
  }
  db.$client.prepare('update competitions set server_fingerprint = ? where id = ?').run(pkg.fingerprint ?? null, competitionId);
  return result;
}
