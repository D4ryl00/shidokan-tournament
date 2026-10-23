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

/** Adresse et jeton : `token` null = inchangé, '' = effacé. */
export function setSyncServer(db: AppDb, patch: { url: string; token: string | null }): void {
  const current = getSyncServer(db);
  const token = patch.token === null ? (current?.token ?? null) : patch.token || null;
  saveSyncServer(db, { url: patch.url.trim().replace(/\/+$/, ''), token, serverInstanceId: current?.url === patch.url.trim().replace(/\/+$/, '') ? current?.serverInstanceId : undefined });
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
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new RemoteError(res.status, data.error ?? `Erreur ${res.status} du serveur.`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
