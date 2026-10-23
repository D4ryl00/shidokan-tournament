import type { AppDb } from '../db/client.js';
import { competitionChanged } from '../events.js';
import { importPackage, type SyncPackage } from '../sync/package.js';

/** Portable de zone : le PC principal qu'il suit, la compétition et la zone ; `autonomous` : zone autonome en cours (réseau coupé). */
export interface ZoneLink {
  mainUrl: string;
  competitionId: string;
  zoneId: string;
  /** Identité du PC principal, apprise à la première copie (pour reconnaître ses copies). */
  mainInstanceId?: string;
  autonomous: { since: string; finals: boolean } | null;
}

export const MAIN_NAME = 'le PC principal';

/** Refus ou panne côté PC principal : le message est fait pour l'écran. */
export class ZoneLinkError extends Error {
  readonly expose = true;
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function getZoneLink(db: AppDb): ZoneLink | null {
  const row = db.$client.prepare("select value_json as v from app_settings where key = 'zoneLink'").get() as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as ZoneLink | null) : null;
}
export function setZoneLink(db: AppDb, value: ZoneLink | null): void {
  db.$client
    .prepare("insert into app_settings (key, value_json) values ('zoneLink', ?) on conflict (key) do update set value_json = excluded.value_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
    .run(JSON.stringify(value));
}

/** Appel du PC principal ; une panne réseau devient « PC principal injoignable », un refus garde son message. */
export async function fromMain<T>(mainUrl: string, path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${mainUrl}${path}`, { signal: AbortSignal.timeout(60_000), ...init });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new ZoneLinkError(502, `PC principal injoignable : ${cause?.code ?? cause?.message ?? (e as Error).message}.`);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ZoneLinkError(res.status >= 500 ? 502 : res.status, data.error ?? `Erreur ${res.status} du PC principal.`);
  }
  try {
    return (res.status === 204 ? undefined : await res.json()) as T;
  } catch (e) {
    throw new ZoneLinkError(502, `PC principal injoignable : ${(e as Error).message}.`);
  }
}

const status = new Map<string, { lastCopyAt: string | null; lastError: string | null; chain: Promise<unknown> }>();
const state = (dbPath: string) => {
  let s = status.get(dbPath);
  if (!s) status.set(dbPath, (s = { lastCopyAt: null, lastError: null, chain: Promise.resolve() }));
  return s;
};
export const zoneLinkStatus = (dbPath: string) => {
  const s = status.get(dbPath);
  return { lastCopyAt: s?.lastCopyAt ?? null, lastError: s?.lastError ?? null };
};
/** Nouveau réglage : l'état du précédent est oublié (une copie en cours le reste : la suivante l'attend). */
export const resetZoneLinkStatus = (dbPath: string) => {
  const s = state(dbPath);
  s.lastCopyAt = null;
  s.lastError = null;
};
export const recordZoneLinkError = (dbPath: string, error: string) => {
  state(dbPath).lastError = error;
};

const ownerOf = (db: AppDb, id: string) =>
  db.$client.prepare('select owner_instance_id as o, server_fingerprint as f from competitions where id = ?').get(id) as { o: string | null; f: string | null } | undefined;

/** Pourquoi la copie ne peut pas remplacer la compétition de ce PC (`mainId` : le PC principal, s'il est connu) ; null : elle le peut. */
function copyRefusal(db: AppDb, link: ZoneLink, mainId: string | undefined): string | null {
  const current = getZoneLink(db);
  if (!current || current.competitionId !== link.competitionId || current.mainUrl !== link.mainUrl) return 'Le réglage du PC principal a changé.';
  if (current.autonomous) return 'Zone autonome : la copie n’est plus mise à jour.';
  const r = ownerOf(db, link.competitionId);
  if (r && (r.o === null || (mainId !== undefined && r.o !== mainId))) return 'Cette compétition n’est plus une copie du PC principal sur ce PC : elle n’est plus mise à jour.';
  return null;
}

async function copyNow(db: AppDb, dbPath: string, fetchImpl: typeof fetch): Promise<{ ok: true } | { error: string }> {
  const link = getZoneLink(db);
  if (!link) return { error: 'Aucun PC principal relié.' };
  const s = state(dbPath);
  const fail = (error: string, record = true) => {
    if (record) s.lastError = error;
    return { error };
  };
  // Zone autonome : rien à signaler, la copie attend « Repasser en ligne ».
  const before = copyRefusal(db, link, link.mainInstanceId);
  if (before) return fail(before, !getZoneLink(db)?.autonomous);
  let pkg: SyncPackage;
  try {
    pkg = await fromMain<SyncPackage>(link.mainUrl, `/api/competitions/${encodeURIComponent(link.competitionId)}/export.json`, {}, fetchImpl);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (pkg?.competitionId !== link.competitionId) return fail('Le PC principal a renvoyé une autre compétition : vérifiez son adresse.');
  // Pendant l'échange, la zone a pu devenir autonome, ou la compétition être prise ici : la copie arrivée n'écrase rien.
  const after = copyRefusal(db, link, pkg.from.instanceId);
  if (after) return fail(after, !getZoneLink(db)?.autonomous);
  const current = getZoneLink(db)!;
  if (current.mainInstanceId !== pkg.from.instanceId) setZoneLink(db, { ...current, mainInstanceId: pkg.from.instanceId });
  const stored = ownerOf(db, link.competitionId);
  const now = new Date();
  try {
    if (stored && pkg.fingerprint && pkg.fingerprint === stored.f) {
      db.$client.prepare('update competitions set last_sync_at = ? where id = ?').run(now.toISOString(), link.competitionId);
      competitionChanged(link.competitionId);
    } else {
      // Sans sauvegarde quand elle remplace une copie : il n'y a rien à perdre ici. Aucune attente avant l'écriture : le contrôle tient.
      await importPackage(db, dbPath, pkg, { id: pkg.from.instanceId, name: MAIN_NAME }, now, { backup: !stored });
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  db.$client.prepare('update competitions set server_fingerprint = ? where id = ?').run(pkg.fingerprint ?? null, link.competitionId);
  s.lastCopyAt = now.toISOString();
  s.lastError = null;
  return { ok: true };
}

/** Une copie du PC principal (jamais deux à la fois : une demande pendant une copie attend la fin de celle-ci). */
export function copyFromMain(db: AppDb, dbPath: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { error: string }> {
  const s = state(dbPath);
  const run = s.chain.then(() => copyNow(db, dbPath, fetchImpl));
  s.chain = run.catch(() => undefined);
  return run;
}

const restarts = new Map<string, () => void>();
/** Réglage changé : le suivi se reconnecte tout de suite. */
export const restartZoneFollow = (dbPath: string) => restarts.get(dbPath)?.();

/**
 * Suivi du PC principal : son flux d'événements déclenche une copie après chaque changement (regroupés sur 1 s), plus une copie
 * chaque minute par sécurité ; le flux se reconnecte 5 s après une coupure.
 */
export function startZoneFollow(db: AppDb, dbPath: string, onError: (e: unknown) => void, fetchImpl: typeof fetch = fetch): () => void {
  let stopped = false;
  let debounce: NodeJS.Timeout | null = null;
  let reconnect: NodeJS.Timeout | null = null;
  let controller: AbortController | null = null;
  const requestCopy = () => {
    if (stopped || debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      const link = getZoneLink(db);
      if (link && !link.autonomous) copyFromMain(db, dbPath, fetchImpl).catch(onError);
    }, 1000);
    debounce.unref();
  };
  const connect = async () => {
    reconnect = null;
    const link = getZoneLink(db);
    if (stopped || !link) return;
    const mine = new AbortController();
    controller = mine;
    try {
      const res = await fetchImpl(`${link.mainUrl}/api/competitions/${encodeURIComponent(link.competitionId)}/events`, { signal: mine.signal });
      if (!res.ok || !res.body) throw new Error(`Erreur ${res.status} du PC principal.`);
      requestCopy();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
          if (/^event: change$/m.test(buffer.slice(0, i))) requestCopy();
          buffer = buffer.slice(i + 2);
        }
      }
    } catch (e) {
      if (mine.signal.aborted) return;
      const cause = (e as { cause?: { code?: string } }).cause;
      if (!getZoneLink(db)?.autonomous) recordZoneLinkError(dbPath, `PC principal injoignable : ${cause?.code ?? (e as Error).message}.`);
    }
    if (controller === mine && !stopped) {
      reconnect = setTimeout(() => void connect().catch(onError), 5000);
      reconnect.unref();
    }
  };
  const restart = () => {
    controller?.abort();
    controller = null;
    if (reconnect) clearTimeout(reconnect);
    void connect().catch(onError);
  };
  restarts.set(dbPath, restart);
  const minute = setInterval(requestCopy, 60_000);
  minute.unref();
  void connect().catch(onError);
  return () => {
    stopped = true;
    clearInterval(minute);
    if (debounce) clearTimeout(debounce);
    if (reconnect) clearTimeout(reconnect);
    controller?.abort();
    if (restarts.get(dbPath) === restart) restarts.delete(dbPath);
  };
}
