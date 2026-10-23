import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { importPackage, PackageError, validatePackage, type SyncPackage } from '../sync/package.js';
import { pendingEntries } from './autonomous.js';
import { targetKey } from './entry.js';
import { getZoneLink, MAIN_NAME } from './link.js';
import { evaluateEntry } from './replay.js';

/**
 * Remplace la copie par `raw` (sauvegarde d'abord), puis réapplique localement les entrées non envoyées avec evaluateEntry (apply: true,
 * sans rien écrire dans zone_entries ni dans le journal) ; les entrées restent à renvoyer. Une entrée en conflit (ou en attente derrière
 * un conflit) n'écrase pas la nouvelle copie : le PC principal en fera une carte.
 */
export async function rebaseOnto(db: AppDb, dbPath: string, raw: unknown): Promise<{ reapplied: number; present: number; conflicts: number }> {
  const link = getZoneLink(db);
  if (!link?.autonomous) throw new PackageError('Ce PC n’est pas en zone autonome.');
  if ((raw as Partial<SyncPackage> | null)?.competitionId !== link.competitionId) {
    throw new PackageError((raw as Partial<SyncPackage> | null)?.format === 'shidokan-competition' ? 'Ce fichier est celui d’une autre compétition.' : 'Ce fichier n’est pas une compétition exportée par l’application.');
  }
  const pkg = validatePackage(db, raw);
  if (link.mainInstanceId && pkg.from.instanceId !== link.mainInstanceId) throw new PackageError('Cette copie ne vient pas du PC principal relié à ce portable.');
  await importPackage(db, dbPath, pkg, { id: pkg.from.instanceId, name: MAIN_NAME });
  const counts = { reapplied: 0, present: 0, conflicts: 0 };
  const blocked = new Set<string>();
  // Révisions laissées par les saisies déjà réappliquées (ou déjà présentes), par catégorie et cible.
  const own = new Map<string, string>();
  for (const e of pendingEntries(db, link.competitionId)) {
    const r = await evaluateEntry(db, link.competitionId, e, { blockedCategories: blocked, ownRev: (x) => own.get(`${x.categoryId}|${targetKey(x)}`) ?? null, apply: true });
    for (const [k, rev] of Object.entries(r.ownRevs ?? {})) own.set(`${e.categoryId}|${k}`, rev);
    if (r.status === 'applied') counts.reapplied++;
    else if (r.status === 'present') counts.present++;
    else {
      blocked.add(e.categoryId);
      counts.conflicts++;
    }
  }
  // Avec des saisies réappliquées, la copie n'est plus exactement celle du PC principal.
  db.$client.prepare('update competitions set server_fingerprint = ? where id = ?').run(counts.reapplied === 0 ? (pkg.fingerprint ?? null) : null, link.competitionId);
  competitionChanged(link.competitionId);
  return counts;
}
