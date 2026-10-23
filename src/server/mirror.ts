import fs from 'node:fs';
import path from 'node:path';
import type { AppDb } from './db/client.js';
import { backupDir } from './repositories/backups.js';

/** Copie de secours régulière de la base d'un autre PC (le PC principal), rangée à part dans les sauvegardes. */
export interface MirrorSettings {
  url: string;
  intervalMin: number;
}
export interface MirrorStatus {
  lastSuccessAt: string | null;
  lastError: string | null;
}

const KEEP = 100;
const NAME = /^copie-\d{8}-\d{6}\.sqlite$/;
const status = new Map<string, MirrorStatus & { lastAttemptAt: number }>();

export const copiesDir = (dbPath: string) => path.join(backupDir(dbPath), 'copies');
export const isCopyName = (name: string) => NAME.test(name);

export function getMirror(db: AppDb): MirrorSettings | null {
  const row = db.$client.prepare("select value_json as v from app_settings where key = 'mirror'").get() as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as MirrorSettings | null) : null;
}
export function setMirror(db: AppDb, value: MirrorSettings | null): void {
  db.$client
    .prepare("insert into app_settings (key, value_json) values ('mirror', ?) on conflict (key) do update set value_json = excluded.value_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
    .run(JSON.stringify(value));
}
export const mirrorStatus = (dbPath: string): MirrorStatus => {
  const s = status.get(dbPath);
  return { lastSuccessAt: s?.lastSuccessAt ?? null, lastError: s?.lastError ?? null };
};

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function listCopies(dbPath: string): { name: string; size: number; createdAt: string }[] {
  const dir = copiesDir(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(isCopyName)
    .sort()
    .reverse()
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    });
}

/** Une copie : téléchargée sous un nom provisoire, vérifiée (base SQLite), puis renommée ; on garde les 100 dernières. */
export async function mirrorOnce(db: AppDb, dbPath: string, now = new Date()): Promise<{ file: string } | { error: string }> {
  const settings = getMirror(db);
  const entry = status.get(dbPath) ?? { lastSuccessAt: null, lastError: null, lastAttemptAt: 0 };
  status.set(dbPath, { ...entry, lastAttemptAt: now.getTime() });
  if (!settings) return { error: 'Aucune copie de secours réglée.' };
  const fail = (error: string) => {
    status.set(dbPath, { ...status.get(dbPath)!, lastError: error });
    return { error };
  };
  let data: Buffer;
  try {
    const res = await fetch(`${settings.url.replace(/\/+$/, '')}/api/backup.sqlite`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return fail(`Le PC principal a répondu ${res.status}.`);
    data = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    return fail(`PC principal injoignable : ${cause?.code ?? (e as Error).message}.`);
  }
  if (data.subarray(0, 15).toString() !== 'SQLite format 3') return fail('La réponse du PC principal n’est pas une base de l’application.');
  const dir = copiesDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const file = `copie-${stamp(now)}.sqlite`;
  const partial = path.join(dir, `${file}.partiel`);
  fs.writeFileSync(partial, data);
  fs.renameSync(partial, path.join(dir, file));
  for (const old of fs.readdirSync(dir).filter(isCopyName).sort().slice(0, -KEEP)) fs.rmSync(path.join(dir, old), { force: true });
  status.set(dbPath, { ...status.get(dbPath)!, lastSuccessAt: now.toISOString(), lastError: null });
  return { file };
}

/** Tâche de fond : vérifie chaque minute s'il est temps de faire une copie (le réglage est relu à chaque tour). */
export function startMirror(db: AppDb, dbPath: string, onError: (e: unknown) => void): () => void {
  const tick = () => {
    const settings = getMirror(db);
    if (!settings) return;
    const last = status.get(dbPath)?.lastAttemptAt ?? 0;
    if (Date.now() - last < settings.intervalMin * 60_000) return;
    mirrorOnce(db, dbPath).catch(onError);
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
