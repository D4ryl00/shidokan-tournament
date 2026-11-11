import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
});
afterEach(async () => app.close());

const names = async () => (await app.inject({ method: 'GET', url: '/api/competitions' })).json().map((c: { name: string }) => c.name);

test('sauvegarde maintenant, liste, téléchargement', async () => {
  await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe sauvegardée', date: '2026-11-22' } });
  const res = await app.inject({ method: 'POST', url: '/api/backups' });
  expect(res.statusCode).toBe(201);
  const list = (await app.inject({ method: 'GET', url: '/api/backups' })).json() as { name: string; size: number }[];
  expect(list).toHaveLength(1);
  expect(list[0]!.name).toMatch(/^shidokan-\d{8}-\d{6}-\d{3}\.sqlite$/);
  const file = (await app.inject({ method: 'GET', url: `/api/backups/${list[0]!.name}` })).rawPayload;
  const copy = path.join(path.dirname(dbPath), 'copie.sqlite');
  fs.writeFileSync(copy, file);
  expect(new Database(copy, { readonly: true }).prepare('select name from competitions').all()).toEqual([{ name: 'Coupe sauvegardée' }]);
  expect((await app.inject({ method: 'GET', url: '/api/backups/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(404);
});

test('restauration : l’état revient exactement', async () => {
  await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Avant', date: '2026-11-22' } });
  const snapshot = (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Après', date: '2026-11-22' } });
  expect((await names()).sort()).toEqual(['Après', 'Avant']);
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  expect(await names()).toEqual(['Avant']);
});

test('restauration refusée : image, base quelconque ; la base courante reste intacte', async () => {
  await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Intacte', date: '2026-11-22' } });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const r1 = await app.inject({ method: 'POST', url: '/api/restore', payload: png, headers: { 'content-type': 'application/octet-stream' } });
  expect(r1.statusCode).toBe(400);
  expect(r1.json().error).toBe("Ce fichier n'est pas une sauvegarde de l'application");
  const other = path.join(path.dirname(dbPath), 'autre.sqlite');
  const d = new Database(other);
  d.exec('create table t(x)');
  d.close();
  const r2 = await app.inject({ method: 'POST', url: '/api/restore', payload: fs.readFileSync(other), headers: { 'content-type': 'application/octet-stream' } });
  expect(r2.statusCode).toBe(400);
  expect(await names()).toEqual(['Intacte']);
});

test('rotation : 200 sauvegardes au plus', async () => {
  for (let i = 0; i < 203; i++) await app.inject({ method: 'POST', url: '/api/backups' });
  const list = (await app.inject({ method: 'GET', url: '/api/backups' })).json() as unknown[];
  expect(list).toHaveLength(200);
});

test('restauration refusée : aucune sauvegarde de sécurité inutile', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await app.inject({ method: 'POST', url: '/api/restore', payload: png, headers: { 'content-type': 'application/octet-stream' } });
  expect((await app.inject({ method: 'GET', url: '/api/backups' })).json()).toEqual([]);
});

test('sauvegarde automatique ignorée si rien n’a changé', async () => {
  const { backupIfChanged } = await import('../../src/server/repositories/backups.js');
  const { openDb } = await import('../../src/server/db/client.js');
  const db = openDb(dbPath + '.auto.sqlite');
  expect(await backupIfChanged(db, dbPath + '.auto.sqlite')).not.toBeNull();
  expect(await backupIfChanged(db, dbPath + '.auto.sqlite')).toBeNull();
  db.$client.exec("insert into grid_templates (id, name, grid_json) values ('t', 'x', '{}')");
  expect(await backupIfChanged(db, dbPath + '.auto.sqlite')).not.toBeNull();
});

test('modèles de grille : enregistrer, charger, créer une compétition à partir d’un modèle', async () => {
  const a = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'A', date: '2026-11-22' } })).json();
  const grid = (await app.inject({ method: 'GET', url: `/api/competitions/${a.id}/grid` })).json();
  const wc = grid.weightClasses.find((w: { id: string }) => w.id === 'poussin:F:-25');
  wc.label = '-20';
  wc.maxKg = 20;
  await app.inject({ method: 'PUT', url: `/api/competitions/${a.id}/grid`, payload: grid });
  const saved = await app.inject({ method: 'POST', url: `/api/competitions/${a.id}/grid/save-template`, payload: { name: 'Grille shidokan' } });
  expect(saved.statusCode).toBe(201);
  const templates = (await app.inject({ method: 'GET', url: '/api/grid-templates' })).json() as { id: string; name: string }[];
  expect(templates.map((t) => t.name)).toEqual(['Grille shidokan']);

  const b = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'B', date: '2026-11-22' } })).json();
  await app.inject({ method: 'POST', url: `/api/competitions/${b.id}/grid/load-template`, payload: { templateId: templates[0]!.id } });
  expect((await app.inject({ method: 'GET', url: `/api/competitions/${b.id}/grid` })).json()).toEqual(grid);

  const c = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'C', date: '2026-11-22', templateId: templates[0]!.id } })).json();
  expect((await app.inject({ method: 'GET', url: `/api/competitions/${c.id}/grid` })).json()).toEqual(grid);
});

test('restauration d’une sauvegarde d’une version antérieure : mise à niveau puis restaurée', async () => {
  const file = olderDb(7);
  const raw = new Database(file);
  raw.prepare("INSERT INTO competitions (id, name, date, tatami_count, settings_json) VALUES ('c1', 'Ancienne coupe', '2026-11-22', 2, '{}')").run();
  raw.prepare("INSERT INTO categories (id, competition_id, key_string, key_json, label, status, seed, tatami) VALUES ('k1', 'c1', 'k', '{}', 'Cat', 'ready', 1, 2)").run();
  raw.close();
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  expect(await names()).toEqual(['Ancienne coupe']);
  const zones = (await app.inject({ method: 'GET', url: '/api/competitions/c1/zones' })).json() as { id: string; name: string }[];
  expect(zones.map((z) => z.name)).toEqual(['Tatami 1', 'Tatami 2']);
});

test('restauration d’une sauvegarde d’une version plus récente : refus explicite', async () => {
  await app.inject({ method: 'POST', url: '/api/backups' });
  const name = ((await app.inject({ method: 'GET', url: '/api/backups' })).json() as { name: string }[])[0]!.name;
  const file = path.join(path.dirname(dbPath), 'recente.sqlite');
  fs.writeFileSync(file, (await app.inject({ method: 'GET', url: `/api/backups/${name}` })).rawPayload);
  const raw = new Database(file);
  raw.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('futur', 99999999999999)").run();
  raw.close();
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toContain('version plus récente');
});

/** Base d'une autre installation : une compétition par valeur de owner_instance_id, et la sauvegarde de cette base. */
async function otherInstallBackup(owners: (instanceIds: { source: string; local: string }) => Record<string, string | null>): Promise<Buffer> {
  const otherPath = tmpDbPath();
  const other = await buildApp({ dbPath: otherPath, instanceName: 'SERVEUR' });
  for (const name of ['Source', 'Locale', 'Tierce']) {
    await other.inject({ method: 'POST', url: '/api/competitions', payload: { name, date: '2026-11-22' } });
  }
  const snapshot = (await other.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  await other.close();
  const file = path.join(path.dirname(otherPath), 'modifiee.sqlite');
  fs.writeFileSync(file, snapshot);
  const r = new Database(file);
  const source = (r.prepare('select id from instance').get() as { id: string }).id;
  const local = (new Database(dbPath, { readonly: true }).prepare('select id from instance').get() as { id: string }).id;
  for (const [name, owner] of Object.entries(owners({ source, local }))) r.prepare('update competitions set owner_instance_id = ? where name = ?').run(owner, name);
  r.close();
  return fs.readFileSync(file);
}

const localInstance = () => new Database(dbPath, { readonly: true }).prepare('select id, name from instance').get();

test("restauration : l'identité locale ne change pas", async () => {
  const before = localInstance();
  const backup = await otherInstallBackup(() => ({}));
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: backup, headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  expect(localInstance()).toEqual(before);
});

test('restauration : une compétition gérée par l’installation d’origine ou locale redevient « gérée ici » ; une tierce garde sa valeur', async () => {
  const backup = await otherInstallBackup(({ source, local }) => ({ Source: source, Locale: local, Tierce: 'pc-tiers' }));
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: backup, headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  const owners = new Database(dbPath, { readonly: true }).prepare('select name, owner_instance_id as owner from competitions order by name').all();
  expect(owners).toEqual([
    { name: 'Locale', owner: null },
    { name: 'Source', owner: null },
    { name: 'Tierce', owner: 'pc-tiers' },
  ]);
});

test("restauration d'une sauvegarde de l'étape 14 (olderDb(13), avec un club) : mise à niveau, lignes versionnées, club relié à l'annuaire", async () => {
  const before = localInstance();
  const file = olderDb(13);
  const r = new Database(file);
  r.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Ancienne', '2025-11-22', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, ffk_entity, pre_approval) VALUES ('k1', 'c1', 'Tani Dojo', 'TANI DOJO', '0060893 TANI DOJO', 0);
  `);
  r.close();
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  const db = new Database(dbPath, { readonly: true });
  expect(db.prepare('select count(*) as n from competitions where version is null').get()).toEqual({ n: 0 });
  expect(db.prepare('select e.affiliation_number as number from clubs c join club_directory e on e.id = c.directory_club_id').all()).toEqual([{ number: '0060893' }]);
  db.close();
  expect(localInstance()).toEqual(before);
});

test('restauration d’une sauvegarde plus ancienne : le compteur de versions ne recule pas, une ligne recréée a une version plus grande', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Compteur', date: '2026-11-22' } });
  const id = created.json().id as string;
  const snapshot = (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  for (let i = 0; i < 20; i++) await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { location: `Salle ${i}` } });
  const read = () => new Database(dbPath, { readonly: true });
  let d = read();
  const counterBefore = (d.prepare('select value from change_counter').get() as { value: number }).value;
  const maxBefore = (d.prepare('select max(version) as v from competitions').get() as { v: number }).v;
  d.close();
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Après', date: '2026-11-22' } });
  d = read();
  expect((d.prepare('select value from change_counter').get() as { value: number }).value).toBeGreaterThan(counterBefore);
  expect((d.prepare("select version from competitions where name = 'Après'").get() as { version: number }).version).toBeGreaterThan(maxBefore);
  d.close();
});

test('une sauvegarde garde les comptes et les réglages, mais ni session, ni jeton, ni mot de passe SMTP, ni clé Google', async () => {
  const { createUser, createSession } = await import('../../src/server/auth/sessions.js');
  await app.close();
  const db = (await import('../../src/server/db/client.js')).openDb(dbPath);
  const user = createUser(db, 'orga@example.org', 'mot-de-passe-long');
  createSession(db, user.id);
  db.$client.prepare("insert into app_settings (key, value_json) values ('smtp', ?)").run(JSON.stringify({ host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'u', password: 'SECRET-SMTP', fromName: 'X', fromEmail: 'x@example.org' }));
  db.$client.prepare("insert into app_settings (key, value_json) values ('google', ?)").run(JSON.stringify({ email: 'x@gmail.com', fromName: 'X', refreshToken: 'SECRET-GOOGLE', status: 'ok', lastRefreshAt: null }));
  (await import('../../src/server/db/client.js')).closeDb(db);
  app = await buildApp({ dbPath });
  const files = [
    (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload,
    (await app.inject({ method: 'GET', url: `/api/backups/${(await app.inject({ method: 'POST', url: '/api/backups' })).json().file}` })).rawPayload,
  ];
  for (const file of files) {
    const copy = path.join(path.dirname(dbPath), `copie-${Math.random()}.sqlite`);
    fs.writeFileSync(copy, file);
    const r = new Database(copy, { readonly: true });
    expect(r.prepare('select email from users').all()).toEqual([{ email: 'orga@example.org' }]);
    expect(r.prepare('select count(*) as n from sessions').get()).toEqual({ n: 0 });
    expect(r.prepare('select count(*) as n from sync_tokens').get()).toEqual({ n: 0 });
    expect(JSON.stringify(r.prepare('select * from app_settings').all())).not.toContain('SECRET-SMTP');
    expect(JSON.stringify(r.prepare('select * from app_settings').all())).not.toContain('SECRET-GOOGLE');
    expect(JSON.stringify(r.prepare('select * from app_settings').all())).toContain('x@gmail.com');
    r.close();
    expect(file.includes(Buffer.from('SECRET-SMTP'))).toBe(false);
    expect(file.includes(Buffer.from('SECRET-GOOGLE'))).toBe(false);
  }
});

/** Une installation à part, préparée, dont on prend une sauvegarde complète. */
async function snapshotOf(prepare: (db: Database.Database, createUser: (email: string, role?: 'organisateur' | 'table') => { id: string }) => void): Promise<Buffer> {
  const { createUser } = await import('../../src/server/auth/sessions.js');
  const client = await import('../../src/server/db/client.js');
  const otherPath = tmpDbPath();
  const otherDb = client.openDb(otherPath);
  prepare(otherDb.$client, (email) => createUser(otherDb, email, 'mot-de-passe-long'));
  client.closeDb(otherDb);
  const other = await buildApp({ dbPath: otherPath });
  const snapshot = (await other.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  await other.close();
  return snapshot;
}
/** L'installation testée, préparée pendant que l'application est arrêtée. */
async function prepareLocal(prepare: (db: Database.Database, createUser: (email: string) => { id: string }, createSession: (id: string) => unknown) => void): Promise<void> {
  const { createUser, createSession } = await import('../../src/server/auth/sessions.js');
  const client = await import('../../src/server/db/client.js');
  await app.close();
  const db = client.openDb(dbPath);
  prepare(db.$client, (email) => createUser(db, email, 'mot-de-passe-long'), (id) => createSession(db, id));
  client.closeDb(db);
  app = await buildApp({ dbPath });
}
const restored = async (snapshot: Buffer) => (await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } })).statusCode;
const setting = (db: Database.Database, key: string, value: unknown) => db.prepare('insert into app_settings (key, value_json) values (?, ?) on conflict (key) do update set value_json = excluded.value_json').run(key, JSON.stringify(value));
const settingOf = (key: string) => {
  const r = new Database(dbPath, { readonly: true });
  const row = r.prepare('select value_json as v from app_settings where key = ?').get(key) as { v: string } | undefined;
  r.close();
  return row ? JSON.parse(row.v) : undefined;
};

test('restaurer reprend les comptes et les réglages du fichier ; un compte absent perd sa session, un compte gardé non', async () => {
  let keptId = '';
  const snapshot = await snapshotOf((db, createUser) => {
    keptId = createUser('garde@example.org').id;
    createUser('nouveau@example.org');
    setting(db, 'privacyContact', 'fichier@example.org');
  });
  await prepareLocal((db, createUser, createSession) => {
    const gone = createUser('parti@example.org');
    createSession(gone.id);
    db.prepare("insert into users (id, email, password_hash) values (?, 'garde@example.org', 'x')").run(keptId);
    createSession(keptId);
    setting(db, 'privacyContact', 'local@example.org');
    setting(db, 'seulementIci', 'à effacer');
  });
  expect(await restored(snapshot)).toBe(204);
  const r = new Database(dbPath, { readonly: true });
  expect((r.prepare('select email from users order by email').all() as { email: string }[]).map((u) => u.email)).toEqual(['garde@example.org', 'nouveau@example.org']);
  expect(r.prepare('select user_id from sessions').all()).toEqual([{ user_id: keptId }]);
  r.close();
  expect(settingOf('privacyContact')).toBe('fichier@example.org');
  expect(settingOf('seulementIci')).toBeUndefined();
});

test('restaurer un fichier sans organisateur (ancienne sauvegarde, PC) garde les comptes actuels', async () => {
  const snapshot = await snapshotOf(() => undefined);
  await prepareLocal((_db, createUser) => { createUser('local@example.org'); });
  expect(await restored(snapshot)).toBe(204);
  const r = new Database(dbPath, { readonly: true });
  expect(r.prepare('select email from users').all()).toEqual([{ email: 'local@example.org' }]);
  r.close();
});

test('restaurer ne reprend jamais les liens de la machine, ni un secret qui serait dans le fichier', async () => {
  const smtp = { host: 'smtp.exemple.fr', user: 'moi', port: 465, security: 'tls', fromName: 'X', fromEmail: 'x@exemple.fr' };
  const google = { email: 'moi@gmail.com', fromName: 'Moi', status: 'ok' };
  // Fichier fabriqué : il porte un mot de passe, une clé et un lien vers une autre machine.
  const client = await import('../../src/server/db/client.js');
  const crafted = tmpDbPath();
  const craftedDb = client.openDb(crafted);
  const { createUser } = await import('../../src/server/auth/sessions.js');
  createUser(craftedDb, 'orga@example.org', 'mot-de-passe-long');
  setting(craftedDb.$client, 'smtp', { ...smtp, password: 'DU-FICHIER' });
  setting(craftedDb.$client, 'google', { ...google, refreshToken: 'DU-FICHIER' });
  setting(craftedDb.$client, 'mirror', { url: 'http://autre-machine', intervalMin: 5 });
  client.closeDb(craftedDb);
  await prepareLocal((db) => {
    setting(db, 'smtp', { ...smtp, password: 'LOCAL-SMTP' });
    setting(db, 'google', { ...google, refreshToken: 'LOCAL-GOOGLE' });
    setting(db, 'mirror', { url: 'http://ma-machine', intervalMin: 5 });
  });
  expect(await restored(fs.readFileSync(crafted))).toBe(204);
  expect(settingOf('smtp').password).toBe('LOCAL-SMTP');
  expect(settingOf('google').refreshToken).toBe('LOCAL-GOOGLE');
  expect(settingOf('mirror').url).toBe('http://ma-machine');
});

test('restaurer un autre compte d’envoi : mot de passe à ressaisir, Google à reconnecter ; un fichier sans ces réglages les laisse en place', async () => {
  const other = await snapshotOf((db) => {
    setting(db, 'smtp', { host: 'autre.fr', user: 'autre', port: 465, security: 'tls', fromName: 'A', fromEmail: 'a@autre.fr', password: 'A' });
    setting(db, 'google', { email: 'autre@gmail.com', fromName: 'A', status: 'ok', refreshToken: 'A' });
  });
  await prepareLocal((db) => {
    setting(db, 'smtp', { host: 'smtp.exemple.fr', user: 'moi', port: 465, security: 'tls', fromName: 'X', fromEmail: 'x@exemple.fr', password: 'LOCAL-SMTP' });
    setting(db, 'google', { email: 'moi@gmail.com', fromName: 'Moi', status: 'ok', refreshToken: 'LOCAL-GOOGLE' });
  });
  const empty = await snapshotOf(() => undefined);
  expect(await restored(empty)).toBe(204);
  expect(settingOf('smtp').password).toBe('LOCAL-SMTP');
  expect(settingOf('google').refreshToken).toBe('LOCAL-GOOGLE');
  expect(await restored(other)).toBe(204);
  expect(settingOf('smtp')).toMatchObject({ host: 'autre.fr' });
  expect(settingOf('smtp').password).toBeUndefined();
  expect(settingOf('google')).toBeUndefined();
});

test('les pièces jointes sont dans la sauvegarde, reviennent à la restauration ; un identifiant fabriqué n’écrit nulle part', async () => {
  await app.close();
  app = await buildApp({ dbPath, clubServices: true });
  const cid = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe pièces', date: '2026-11-22' } })).json().id as string;
  const add = await app.inject({ method: 'POST', url: `/api/competitions/${cid}/mail-attachments`, payload: Buffer.from('CONTENU-AFFICHE'), headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'affiche.pdf' } });
  expect(add.statusCode).toBe(201);
  const id = add.json().id as string;
  const snapshot = (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  const onDisk = path.join(path.dirname(dbPath), 'pieces-jointes', id);
  fs.rmSync(onDisk);
  expect(await restored(snapshot)).toBe(204);
  expect(fs.readFileSync(onDisk, 'utf8')).toBe('CONTENU-AFFICHE');

  // Copie modifiée à la main : une ligne au nom piégé ne doit rien créer hors du dossier.
  const crafted = path.join(path.dirname(dbPath), 'piege.sqlite');
  fs.writeFileSync(crafted, snapshot);
  const raw = new Database(crafted);
  raw.prepare('insert into sauvegarde_pieces_jointes (id, data) values (?, ?)').run('../evade', Buffer.from('X'));
  raw.prepare("insert into mail_attachments (id, competition_id, file_name, content_type, size) values ('../evade', ?, 'x.pdf', 'application/pdf', 1)").run(cid);
  raw.close();
  expect(await restored(fs.readFileSync(crafted))).toBe(204);
  expect(fs.existsSync(path.join(path.dirname(dbPath), 'evade'))).toBe(false);
});

test('une ancienne sauvegarde sans contenu de pièce jointe laisse le fichier déjà présent', async () => {
  await app.close();
  app = await buildApp({ dbPath, clubServices: true });
  const cid = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe ancienne', date: '2026-11-22' } })).json().id as string;
  const id = (await app.inject({ method: 'POST', url: `/api/competitions/${cid}/mail-attachments`, payload: Buffer.from('ICI'), headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'a.pdf' } })).json().id as string;
  const old = path.join(path.dirname(dbPath), 'ancienne.sqlite');
  fs.writeFileSync(old, (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload);
  const raw = new Database(old);
  raw.exec('drop table sauvegarde_pieces_jointes');
  raw.close();
  expect(await restored(fs.readFileSync(old))).toBe(204);
  expect(fs.readFileSync(path.join(path.dirname(dbPath), 'pieces-jointes', id), 'utf8')).toBe('ICI');
});

test('restauration : les images du message restent, celles de la sauvegarde reviennent (le message de l’application n’est pas restauré)', async () => {
  const raw = new Database(dbPath);
  const addImage = (id: string) => raw.prepare('insert into mail_images (id, content_type, size, data) values (?, ?, ?, ?)').run(id, 'image/png', 1, Buffer.from([1]));
  const ids = () => (raw.prepare('select id from mail_images order by id').all() as { id: string }[]).map((r) => r.id);
  try {
    addImage('avant');
    const snapshot = (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
    raw.prepare('delete from mail_images').run();
    addImage('apres');
    const res = await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } });
    expect(res.statusCode).toBe(204);
    expect(ids()).toEqual(['apres', 'avant']);
    // Déjà présente : gardée sans doublon ni erreur.
    expect((await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } })).statusCode).toBe(204);
    expect(ids()).toEqual(['apres', 'avant']);
  } finally {
    raw.close();
  }
});

test('restauration : une sauvegarde de plus de 20 Mio (images comprises) n’est pas refusée pour sa taille', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: Buffer.alloc(21 * 1024 * 1024, 1), headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe("Ce fichier n'est pas une sauvegarde de l'application");
});

test('sauvegarde complète puis restauration : zone des finales et choix des finales présents', async () => {
  const otherPath = tmpDbPath();
  const other = await buildApp({ dbPath: otherPath, instanceName: 'SERVEUR' });
  await other.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Avec finales', date: '2026-11-22' } });
  const snapshot = (await other.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  await other.close();
  const file = path.join(path.dirname(otherPath), 'avec-finales.sqlite');
  fs.writeFileSync(file, snapshot);
  const r = new Database(file);
  const c = (r.prepare('select id from competitions').get() as { id: string }).id;
  r.exec(`
    INSERT INTO zones (id, competition_id, name, sort_order) VALUES ('z1', '${c}', 'Tatami 1', 0);
    INSERT INTO waves (id, competition_id, name, sort_order, rules_json) VALUES ('w1', '${c}', 'Matin', 0, '{}');
    INSERT INTO wave_finals (competition_id, wave_key, finals_zone_id, where_default, when_default) VALUES ('${c}', 'w1', 'z1', 'finals', 'after');
    INSERT INTO categories (id, competition_id, key_string, key_json, label, seed, finals_where, finals_when) VALUES ('k1', '${c}', 'k', '{"discipline":"kata"}', 'Kata', 1, 'own', 'ready');
    INSERT INTO frozen_passages (competition_id, wave_key, zone_id, number, category_id, match_id, finals_choice) VALUES ('${c}', 'w1', 'z1', 1, 'k1', 'w1-0', 'own|ready');
  `);
  r.close();
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  const check = new Database(dbPath, { readonly: true });
  expect(check.prepare('select wave_key, finals_zone_id, where_default, when_default from wave_finals').all()).toEqual([
    { wave_key: 'w1', finals_zone_id: 'z1', where_default: 'finals', when_default: 'after' },
  ]);
  expect(check.prepare('select finals_where, finals_when from categories where id = ?').get('k1')).toEqual({ finals_where: 'own', finals_when: 'ready' });
  expect(check.prepare('select finals_choice from frozen_passages').get()).toEqual({ finals_choice: 'own|ready' });
  check.close();
});
