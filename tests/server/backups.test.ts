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

test('une sauvegarde ne contient ni compte, ni session, ni mot de passe SMTP', async () => {
  const { createUser, createSession } = await import('../../src/server/auth/sessions.js');
  await app.close();
  const db = (await import('../../src/server/db/client.js')).openDb(dbPath);
  const user = createUser(db, 'orga@example.org', 'mot-de-passe-long');
  createSession(db, user.id);
  db.$client.prepare("insert into app_settings (key, value_json) values ('smtp', ?)").run(JSON.stringify({ host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'u', password: 'SECRET-SMTP', fromName: 'X', fromEmail: 'x@example.org' }));
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
    expect(r.prepare('select count(*) as n from users').get()).toEqual({ n: 0 });
    expect(r.prepare('select count(*) as n from sessions').get()).toEqual({ n: 0 });
    expect(JSON.stringify(r.prepare('select * from app_settings').all())).not.toContain('SECRET-SMTP');
    r.close();
    expect(file.includes(Buffer.from('SECRET-SMTP'))).toBe(false);
  }
});

test('restaurer une sauvegarde d’une autre installation ne touche pas aux comptes, sessions ni réglages', async () => {
  const { createUser } = await import('../../src/server/auth/sessions.js');
  const otherPath = tmpDbPath();
  const otherDb = (await import('../../src/server/db/client.js')).openDb(otherPath);
  createUser(otherDb, 'autre@example.org', 'mot-de-passe-long');
  otherDb.$client.prepare("insert into app_settings (key, value_json) values ('privacyContact', '\"autre@example.org\"')").run();
  (await import('../../src/server/db/client.js')).closeDb(otherDb);
  const other = await buildApp({ dbPath: otherPath });
  const snapshot = (await other.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  await other.close();
  await app.close();
  const db = (await import('../../src/server/db/client.js')).openDb(dbPath);
  createUser(db, 'local@example.org', 'mot-de-passe-long');
  db.$client.prepare("insert into app_settings (key, value_json) values ('privacyContact', '\"local@example.org\"')").run();
  (await import('../../src/server/db/client.js')).closeDb(db);
  app = await buildApp({ dbPath });
  expect((await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } })).statusCode).toBe(204);
  const r = new Database(dbPath, { readonly: true });
  expect(r.prepare('select email from users').all()).toEqual([{ email: 'local@example.org' }]);
  expect(r.prepare("select value_json from app_settings where key = 'privacyContact'").get()).toEqual({ value_json: '"local@example.org"' });
  r.close();
});
