import type { AppDb } from '../db/client.js';
import { getManagement } from './ownership.js';
import { pullCopy } from './pull.js';

/** PC relié : copie en lecture seule d'une compétition du serveur, récupérée de nouveau toutes les N minutes (dans un seul sens). */
export interface SyncFollow {
  competitionId: string;
  intervalMin: number;
}

const HELD_HERE = 'Ce PC a la main : la copie n’est plus mise à jour.';
const DELETED = 'La compétition a été supprimée sur le serveur : cette copie n’est plus mise à jour ; vous pouvez la supprimer.';
const status = new Map<string, { lastSuccessAt: string | null; lastError: string | null; lastAttemptMs: number; running: boolean }>();

export function getFollow(db: AppDb): SyncFollow | null {
  const row = db.$client.prepare("select value_json as v from app_settings where key = 'syncFollow'").get() as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as SyncFollow | null) : null;
}
export function setFollow(db: AppDb, value: SyncFollow | null): void {
  db.$client
    .prepare("insert into app_settings (key, value_json) values ('syncFollow', ?) on conflict (key) do update set value_json = excluded.value_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
    .run(JSON.stringify(value));
}
/** Nouveau réglage : l'état du réglage précédent est oublié (et la prochaine copie est due tout de suite). */
export const resetFollowStatus = (dbPath: string) => {
  // Une mise à jour en cours le reste : une seconde ne doit pas démarrer en même temps.
  const s = status.get(dbPath);
  if (s) status.set(dbPath, { lastSuccessAt: null, lastError: null, lastAttemptMs: 0, running: s.running });
};
export const followStatus = (dbPath: string) => {
  const s = status.get(dbPath);
  return { lastSuccessAt: s?.lastSuccessAt ?? null, lastError: s?.lastError ?? null };
};

/** Un tour : récupère la copie si la compétition est encore une copie du serveur ; jamais quand ce PC a la main. */
export async function followOnce(db: AppDb, dbPath: string, now = new Date()): Promise<{ ok: true } | { error: string }> {
  const follow = getFollow(db);
  if (!follow) return { error: 'Aucune copie à tenir à jour.' };
  const current = status.get(dbPath) ?? { lastSuccessAt: null, lastError: null, lastAttemptMs: 0, running: false };
  if (current.running) return { error: 'Une mise à jour est déjà en cours.' };
  const done = (patch: { lastSuccessAt?: string; lastError: string | null }) =>
    status.set(dbPath, { ...current, ...patch, lastAttemptMs: now.getTime(), running: false });
  if (!db.$client.prepare('select 1 from competitions where id = ?').get(follow.competitionId)) {
    const error = 'Cette compétition n’est pas sur ce PC : récupérez-en d’abord une copie.';
    done({ lastError: error });
    return { error };
  }
  if (!getManagement(db, follow.competitionId).copyOfServer) {
    done({ lastError: HELD_HERE });
    return { error: HELD_HERE };
  }
  status.set(dbPath, { ...current, running: true });
  try {
    await pullCopy(db, dbPath, follow.competitionId, false);
  } catch (e) {
    const gone = (e as { statusCode?: number }).statusCode === 404;
    const error = getManagement(db, follow.competitionId).managedHere ? HELD_HERE : gone ? DELETED : (e as Error).message;
    done({ lastError: error });
    return { error };
  }
  done({ lastSuccessAt: now.toISOString(), lastError: null });
  return { ok: true };
}

/** Tâche de fond : vérifie chaque minute s'il est temps de récupérer la copie (le réglage est relu à chaque tour). */
export function startFollow(db: AppDb, dbPath: string, onError: (e: unknown) => void): () => void {
  const tick = () => {
    const follow = getFollow(db);
    const s = status.get(dbPath);
    if (!follow || s?.running || Date.now() - (s?.lastAttemptMs ?? 0) < follow.intervalMin * 60_000) return;
    followOnce(db, dbPath).catch(onError);
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
