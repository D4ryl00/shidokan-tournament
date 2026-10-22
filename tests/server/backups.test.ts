import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
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

/** Base au niveau de migration `upTo` (index du journal), comme une sauvegarde faite avec une version antérieure de l'app. */
async function olderDb(upTo: number): Promise<string> {
  const os = await import('node:os');
  const { closeDb, openDb } = await import('../../src/server/db/client.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ancienne-'));
  const src = path.resolve('drizzle');
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  const kept = journal.entries.filter((e) => e.idx <= upTo);
  for (const e of kept) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: kept }));
  const file = path.join(dir, 'ancienne.sqlite');
  process.env.MIGRATIONS_DIR = dir;
  try {
    closeDb(openDb(file));
  } finally {
    delete process.env.MIGRATIONS_DIR;
  }
  return file;
}

test('restauration d’une sauvegarde d’une version antérieure : mise à niveau puis restaurée', async () => {
  const file = await olderDb(7);
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
