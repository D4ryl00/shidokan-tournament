import type { AppDb } from '../db/client.js';

/** Serveur auquel ce PC est relié (réglage de l'application ; le jeton ne quitte jamais l'installation). */
export interface SyncServerSettings {
  url: string;
  token: string | null;
  /** Identité du serveur, apprise au premier échange (pour reconnaître ses copies). */
  serverInstanceId?: string;
}

class RemoteError extends Error {
  readonly expose = true;
  constructor(
    readonly statusCode: number,
    message: string,
    /** Code d'un refus du serveur (par exemple RESCUE_DIVERGED), relayé à l'écran du PC. */
    readonly reason?: string,
  ) {
    super(message);
  }
}

export function getSyncServer(db: AppDb): SyncServerSettings | null {
  const row = db.$client.prepare("select value_json as v from app_settings where key = 'syncServer'").get() as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as SyncServerSettings) : null;
}

function saveSyncServer(db: AppDb, value: SyncServerSettings): void {
  db.$client
    .prepare("insert into app_settings (key, value_json) values ('syncServer', ?) on conflict (key) do update set value_json = excluded.value_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
    .run(JSON.stringify(value));
}

/** HTTPS obligatoire, sauf pour un serveur sur cette machine (essais). */
export function syncUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

/**
 * Adresse et jeton : `token` null = inchangé, '' = effacé. Une nouvelle adresse sans nouveau jeton efface l'ancien jeton :
 * il ne doit jamais partir vers une autre adresse que celle pour laquelle il a été donné.
 */
export function setSyncServer(db: AppDb, patch: { url: string; token: string | null }): void {
  const current = getSyncServer(db);
  const url = patch.url.trim().replace(/\/+$/, '');
  const sameServer = current?.url === url;
  const token = patch.token === null ? (sameServer ? (current?.token ?? null) : null) : patch.token || null;
  saveSyncServer(db, { url, token, serverInstanceId: sameServer ? current?.serverInstanceId : undefined });
}

/** Délie ce PC du serveur (adresse et jeton effacés). */
export function clearSyncServer(db: AppDb): void {
  db.$client.prepare("delete from app_settings where key = 'syncServer'").run();
}

export function rememberServerInstance(db: AppDb, instanceId: string): void {
  const current = getSyncServer(db);
  if (current && current.serverInstanceId !== instanceId) saveSyncServer(db, { ...current, serverInstanceId: instanceId });
}

/** Appel d'une route du serveur pour les PC reliés ; ses refus sont relayés avec leur code et leur message. */
export async function remote<T>(db: AppDb, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const server = getSyncServer(db);
  if (!server?.url || !server.token) throw new RemoteError(400, 'Reliez d’abord ce PC au serveur (Réglages de l’application).');
  let res: Response;
  try {
    res = await fetch(`${server.url}/api/sync/remote${path}`, {
      method,
      headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new RemoteError(502, `Serveur injoignable : ${cause?.code ?? cause?.message ?? (e as Error).message}.`);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new RemoteError(res.status, data.error ?? `Erreur ${res.status} du serveur.`, data.code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
