import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { closeDb, openDb, type AppDb } from '../db/client.js';
import { attachmentDir, sweepAttachmentFiles } from './mail-attachments.js';

export class RestoreError extends Error {
  constructor(message = "Ce fichier n'est pas une sauvegarde de l'application") {
    super(message);
  }
}

/** 200 fichiers : plus d'une journée entière toutes les 5 minutes (petites sans images ; chacune porte toutes les images du message). */
const KEEP = 200;
const NAME = /^shidokan-\d{8}-\d{6}-\d{3}\.sqlite$/;
const quote = (p: string) => `'${p.replace(/'/g, "''")}'`;

export const backupDir = (dbPath: string) => path.join(path.dirname(path.resolve(dbPath)), 'sauvegardes');

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

/**
 * Tables jamais copiées par une restauration : l'identité de l'installation, son compteur de versions (qui ne recule jamais) et ce qui
 * est éphémère (sessions, jetons de synchronisation). Les comptes et les réglages ont leurs propres règles : voir `restoreAccounts` et `restoreSettings`.
 */
export const INSTALLATION_TABLES = ['instance', 'change_counter', 'sessions', 'sync_tokens'];
const SPECIAL_TABLES = ['users', 'app_settings'];

/** Réglages qui lient cette machine à une autre : une restauration ne doit pas la rebrancher sur la mauvaise installation. */
const INSTALLATION_SETTINGS = ['syncServer', 'syncFollow', 'zoneLink', 'mirror'];
/** Réglages qui portent un secret absent des sauvegardes : voir `restoreSettings`. */
const SETTINGS_WITH_SECRET = ['smtp', 'google'];

/**
 * Tables fusionnées par une restauration, sans rien supprimer : les identifiants sont des UUID et une image ne change jamais, et une
 * image plus récente que la sauvegarde peut encore servir. Le nettoyage retire les orphelines.
 */
const MERGED_TABLES = ['mail_images'];

/** Dans une copie seulement : le contenu des pièces jointes, rangées à côté de la base dans l'installation. */
const ATTACHMENT_FILES_TABLE = 'sauvegarde_pieces_jointes';
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ajoute à une copie le contenu des pièces jointes qu'elle cite : la sauvegarde reste un seul fichier. */
function embedAttachmentFiles(file: string, dbPath: string): void {
  const copy = new Database(file);
  try {
    if (!copy.prepare("select 1 from sqlite_master where type = 'table' and name = 'mail_attachments'").get()) return;
    copy.exec(`CREATE TABLE ${ATTACHMENT_FILES_TABLE} (id TEXT PRIMARY KEY, data BLOB NOT NULL)`);
    const add = copy.prepare(`INSERT INTO ${ATTACHMENT_FILES_TABLE} (id, data) VALUES (?, ?)`);
    for (const { id } of copy.prepare('select id from mail_attachments').all() as { id: string }[]) {
      const content = path.join(attachmentDir(dbPath), id);
      if (fs.existsSync(content)) add.run(id, fs.readFileSync(content));
    }
  } finally {
    copy.close();
  }
}

/** Retire d'une copie de base ce qui est éphémère ou secret : sessions, jetons, mot de passe d'envoi, clé Google (effacés pour de bon). */
function stripSecrets(file: string): void {
  const copy = new Database(file);
  try {
    copy.pragma('secure_delete = ON');
    const has = (t: string) => !!copy.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t);
    let changes = 0;
    for (const t of ['sessions', 'sync_tokens']) if (has(t)) changes += copy.prepare(`DELETE FROM ${t}`).run().changes;
    if (has('app_settings')) {
      changes += copy.prepare("UPDATE app_settings SET value_json = json_remove(value_json, '$.password') WHERE key = 'smtp' AND json_extract(value_json, '$.password') IS NOT NULL").run().changes;
      changes += copy.prepare("UPDATE app_settings SET value_json = json_remove(value_json, '$.token') WHERE key = 'syncServer' AND json_extract(value_json, '$.token') IS NOT NULL").run().changes;
      changes += copy.prepare("UPDATE app_settings SET value_json = json_remove(value_json, '$.refreshToken') WHERE key = 'google' AND json_extract(value_json, '$.refreshToken') IS NOT NULL").run().changes;
    }
    // Recompactée seulement s'il y avait un secret à effacer (jamais sur le PC de la compétition, sans comptes).
    if (changes) copy.exec('VACUUM');
  } finally {
    copy.close();
  }
}

/** Copie cohérente de la base (VACUUM INTO), sans secrets, avec le contenu des pièces jointes, puis rotation (KEEP fichiers). */
export async function backupNow(db: AppDb, dbPath: string): Promise<string> {
  const dir = backupDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `shidokan-${stamp()}.sqlite`);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `shidokan-${stamp(new Date(Date.now() + i))}.sqlite`);
  // Écrite sous un nom provisoire, débarrassée de ses secrets, puis renommée : jamais de sauvegarde avec secrets dans le dossier.
  const partial = `${file}.partiel`;
  db.$client.exec(`VACUUM INTO ${quote(partial)}`);
  stripSecrets(partial);
  embedAttachmentFiles(partial, dbPath);
  fs.renameSync(partial, file);
  const all = (await listBackups(dbPath)).map((b) => b.name).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

/** Date d'une sauvegarde d'après son nom (`shidokan-AAAAMMJJ-HHMMSS-mmm.sqlite`, heure locale), ou null. */
function backupDate(name: string): Date | null {
  const m = name.match(/^shidokan-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : null;
}

/** Supprime les sauvegardes plus anciennes que `before`, sauf la plus récente de toutes. Renvoie le nombre supprimé. */
export function pruneOldBackups(dbPath: string, before: Date): number {
  const dir = backupDir(dbPath);
  if (!fs.existsSync(dir)) return 0;
  const dated = fs
    .readdirSync(dir)
    .map((name) => ({ name, date: backupDate(name) }))
    .filter((b): b is { name: string; date: Date } => b.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const old = dated.slice(0, -1).filter((b) => b.date < before);
  for (const b of old) fs.rmSync(path.join(dir, b.name), { force: true });
  return old.length;
}

export async function listBackups(dbPath: string): Promise<{ name: string; size: number; createdAt: string }[]> {
  const dir = backupDir(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Chemin d'une sauvegarde existante, ou null (nom invalide ou absent). */
export function backupFile(dbPath: string, name: string): string | null {
  if (!NAME.test(name)) return null;
  const file = path.join(backupDir(dbPath), name);
  return fs.existsSync(file) ? file : null;
}

/** Copie fraîche de la base courante (fichier temporaire). */
export function freshCopy(db: AppDb, dbPath: string): Buffer {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shidokan-copie-')), 'copie.sqlite');
  db.$client.exec(`VACUUM INTO ${quote(tmp)}`);
  stripSecrets(tmp);
  embedAttachmentFiles(tmp, dbPath);
  const buf = fs.readFileSync(tmp);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  return buf;
}

type Client = AppDb['$client'];
const hasSourceTable = (client: Client, table: string) => !!client.prepare("select 1 from src.sqlite_master where type = 'table' and name = ?").get(table);

/**
 * Comptes : ceux du fichier, sessions des comptes gardés comprises. Un fichier sans organisateur (ancienne sauvegarde, PC) ne remplace
 * rien, pour que personne ne soit bloqué dehors.
 */
function restoreAccounts(client: Client): void {
  if (!hasSourceTable(client, 'users') || !client.prepare("select 1 from src.users where role = 'organisateur'").get()) return;
  const cols = (client.prepare("select name from pragma_table_info('users')").all() as { name: string }[]).map((c) => `"${c.name}"`).join(', ');
  client.exec('DELETE FROM main.sessions WHERE user_id NOT IN (SELECT id FROM src.users)');
  client.exec('DELETE FROM main.users');
  client.exec(`INSERT INTO main.users (${cols}) SELECT ${cols} FROM src.users`);
}

/**
 * Réglages : ceux du fichier, sauf les liens de cette machine. Le mot de passe d'envoi et la clé Google ne viennent jamais du fichier :
 * ceux de l'installation restent s'il désigne le même compte. Sinon le mot de passe est à ressaisir et Google à reconnecter.
 */
function restoreSettings(client: Client): void {
  if (!hasSourceTable(client, 'app_settings')) return;
  const read = (schema: string) => new Map((client.prepare(`select key, value_json as v from ${schema}.app_settings`).all() as { key: string; v: string }[]).map((r) => [r.key, r.v]));
  const source = read('src');
  const current = read('main');
  const put = client.prepare('INSERT INTO main.app_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json');
  const parsed = (json: string | undefined) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);
  for (const key of current.keys()) {
    if (!INSTALLATION_SETTINGS.includes(key) && !SETTINGS_WITH_SECRET.includes(key)) client.prepare('DELETE FROM main.app_settings WHERE key = ?').run(key);
  }
  for (const [key, json] of source) {
    if (!INSTALLATION_SETTINGS.includes(key) && !SETTINGS_WITH_SECRET.includes(key)) put.run(key, json);
  }
  const smtp = parsed(source.get('smtp'));
  if (smtp) {
    const mine = parsed(current.get('smtp'));
    const { password: _ignored, ...rest } = smtp;
    const same = mine?.password && mine.host === smtp.host && mine.user === smtp.user;
    put.run('smtp', JSON.stringify(same ? { ...rest, password: mine.password } : rest));
  }
  const google = parsed(source.get('google'));
  if (google) {
    const mine = parsed(current.get('google'));
    const { refreshToken: _ignored, ...rest } = google;
    if (mine?.refreshToken && mine.email === google.email) put.run('google', JSON.stringify({ ...rest, refreshToken: mine.refreshToken }));
    else client.prepare("DELETE FROM main.app_settings WHERE key = 'google'").run();
  }
}

/** Remet en place le contenu des pièces jointes d'une sauvegarde ; une pièce absente du fichier garde le fichier de l'installation. */
function restoreAttachmentFiles(client: Client, dbPath: string, files: { id: string; data: Buffer }[]): void {
  const known = new Set((client.prepare('select id from main.mail_attachments').all() as { id: string }[]).map((r) => r.id));
  const dir = attachmentDir(dbPath);
  for (const { id, data } of files) {
    // L'identifiant vient d'un fichier reçu : il ne doit jamais désigner un autre chemin.
    if (!ATTACHMENT_ID.test(id) || !known.has(id)) continue;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${id}.tmp`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, path.join(dir, id));
  }
}

/**
 * Restaure une sauvegarde : contrôle qu'elle vient de l'application ; une sauvegarde d'une version antérieure est
 * d'abord mise à niveau (migrations appliquées à la copie temporaire), une d'une version plus récente est refusée.
 * Une sauvegarde de l'état actuel est faite juste avant. Puis le contenu de chaque table est remplacé dans une seule transaction (les
 * images du message sont fusionnées, voir `MERGED_TABLES`) ; en cas d'erreur, la base courante est intacte. Enfin les pièces jointes sont remises en place.
 */
export async function restoreFrom(db: AppDb, dbPath: string, file: Buffer): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shidokan-restauration-'));
  const tmp = path.join(dir, 'restauration.sqlite');
  fs.writeFileSync(tmp, file);
  const client = db.$client;
  try {
    const count = () => {
      try {
        const src = new Database(tmp, { readonly: true, fileMustExist: true });
        const c = (src.prepare('select count(*) as c from __drizzle_migrations').get() as { c: number }).c;
        src.close();
        return c;
      } catch {
        throw new RestoreError();
      }
    };
    const current = (client.prepare('select count(*) as c from __drizzle_migrations').get() as { c: number }).c;
    let migrations = count();
    if (migrations > current) {
      throw new RestoreError("Cette sauvegarde vient d'une version plus récente de l'application : mettez l'application à jour avant de la restaurer.");
    }
    if (migrations < current) {
      try {
        closeDb(openDb(tmp)); // mise à niveau de la copie, comme au démarrage de l'app
      } catch {
        throw new RestoreError();
      }
      migrations = count();
      if (migrations !== current) throw new RestoreError();
    }
    await backupNow(db, dbPath); // sauvegarde de sécurité, seulement pour un fichier valide
    // Les tables propres à l'installation ne sont jamais copiées (INSTALLATION_TABLES).
    const tables = (
      client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]
    )
      .map((t) => t.name)
      .filter((t) => t !== '__drizzle_migrations' && !INSTALLATION_TABLES.includes(t) && !SPECIAL_TABLES.includes(t));
    client.pragma('foreign_keys = OFF');
    client.exec(`ATTACH DATABASE ${quote(tmp)} AS src`);
    let attachmentFiles: { id: string; data: Buffer }[] = [];
    try {
      client.transaction(() => {
        restoreAccounts(client);
        restoreSettings(client);
        for (const t of tables) {
          // Colonnes nommées : l'ordre peut différer entre une base mise à niveau et une base créée d'un coup.
          const cols = (client.prepare(`select name from pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => `"${c.name}"`).join(', ');
          const merged = MERGED_TABLES.includes(t);
          if (!merged) client.exec(`DELETE FROM main."${t}"`);
          client.exec(`INSERT ${merged ? 'OR IGNORE ' : ''}INTO main."${t}" (${cols}) SELECT ${cols} FROM src."${t}"`);
        }
        // Restaurer, c'est reprendre la main sur ce que gérait l'installation d'origine ; et une installation n'est jamais « l'autre » pour elle-même.
        if (client.prepare("select 1 from src.sqlite_master where type = 'table' and name = 'instance'").get()) {
          client.exec('UPDATE main.competitions SET owner_instance_id = NULL WHERE owner_instance_id IN (SELECT id FROM src.instance UNION SELECT id FROM main.instance)');
        }
      })();
      if (hasSourceTable(client, ATTACHMENT_FILES_TABLE)) attachmentFiles = client.prepare(`select id, data from src.${ATTACHMENT_FILES_TABLE}`).all() as { id: string; data: Buffer }[];
    } finally {
      client.exec('DETACH DATABASE src');
      client.pragma('foreign_keys = ON');
    }
    restoreAttachmentFiles(client, dbPath, attachmentFiles);
    sweepAttachmentFiles(db, dbPath); // fichiers dont la pièce n'existe pas dans la sauvegarde
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const lastChanges = new WeakMap<AppDb, number>();

/** Sauvegarde seulement si la base a changé depuis la précédente (évite de pousser dehors les bonnes sauvegardes). */
export async function backupIfChanged(db: AppDb, dbPath: string): Promise<string | null> {
  const changes = (db.$client.prepare('select total_changes() as c').get() as { c: number }).c;
  if (lastChanges.get(db) === changes) return null;
  const file = await backupNow(db, dbPath);
  lastChanges.set(db, changes);
  return file;
}

/** Sauvegarde périodique ; renvoie la fonction d'arrêt. 0 minute = désactivée. */
export function startAutoBackup(db: AppDb, dbPath: string, intervalMin: number, onError: (e: unknown) => void): () => void {
  if (!(intervalMin > 0)) return () => undefined;
  const timer = setInterval(() => {
    backupIfChanged(db, dbPath).catch(onError);
  }, intervalMin * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
