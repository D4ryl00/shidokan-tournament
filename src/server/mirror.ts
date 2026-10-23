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
const status = new Map<string, MirrorStatus & { lastSuccessMs: number; running: boolean }>();

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
  const current = status.get(dbPath) ?? { lastSuccessAt: null, lastError: null, lastSuccessMs: 0, running: false };
  if (!settings) return { error: 'Aucune copie de secours réglée.' };
  if (current.running) return { error: 'Une copie est déjà en cours.' };
  status.set(dbPath, { ...current, running: true });
  const done = (patch: Partial<MirrorStatus & { lastSuccessMs: number }>) => status.set(dbPath, { ...status.get(dbPath)!, ...patch, running: false });
  const fail = (error: string) => {
    done({ lastError: error });
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
  const file = `copie-${stamp(now)}.sqlite`;
  const partial = path.join(dir, `${file}.partiel`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(partial, data);
    fs.renameSync(partial, path.join(dir, file));
  } catch (e) {
    fs.rmSync(partial, { force: true });
    return fail(`Copie impossible à écrire sur ce PC : ${(e as Error).message}.`);
  }
  for (const old of fs.readdirSync(dir).filter(isCopyName).sort().slice(0, -KEEP)) fs.rmSync(path.join(dir, old), { force: true });
  done({ lastSuccessAt: now.toISOString(), lastError: null, lastSuccessMs: now.getTime() });
  return { file };
}

/** Une copie est-elle due ? Pas pendant une copie en cours ; après un échec, dès le tour suivant. */
export function mirrorDue(dbPath: string, intervalMin: number, nowMs = Date.now()): boolean {
  const s = status.get(dbPath);
  if (s?.running) return false;
  return nowMs - (s?.lastSuccessMs ?? 0) >= intervalMin * 60_000;
}

/** Tâche de fond : vérifie chaque minute s'il est temps de faire une copie (le réglage est relu à chaque tour). */
export function startMirror(db: AppDb, dbPath: string, onError: (e: unknown) => void): () => void {
  const tick = () => {
    const settings = getMirror(db);
    if (!settings || !mirrorDue(dbPath, settings.intervalMin)) return;
    mirrorOnce(db, dbPath).catch(onError);
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
