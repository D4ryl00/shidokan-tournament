import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { versionedTables } from '../../src/server/db/row-versions.js';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

const GLOBAL_TABLES = ['competitions', 'instance', 'change_counter', 'club_directory', 'club_aliases', 'import_mappings', 'grid_templates', '__drizzle_migrations'];

let db: AppDb | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  if (db) closeDb(db);
  if (app) await app.close();
  db = null;
  app = null;
});

const raw = (d: AppDb) => d.$client;
const tables = (d: AppDb) =>
  (raw(d).prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
const columns = (d: AppDb, t: string) => (raw(d).prepare(`select name from pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
const triggers = (d: AppDb, t: string) =>
  (raw(d).prepare("select name from sqlite_master where type = 'trigger' and tbl_name = ?").all(t) as { name: string }[]).map((r) => r.name).sort();
const counter = (d: AppDb) => (raw(d).prepare('select value from change_counter where id = 1').get() as { value: number }).value;

function freshDb(): AppDb {
  db = openDb(tmpDbPath());
  raw(db).exec("INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}')");
  return db;
}

const result = (d: AppDb) =>
  raw(d).prepare("select version, updated_at from match_results where category_id = 'cat1' and match_id = 'w1-0'").get() as { version: number; updated_at: string };
const insertResult = (d: AppDb) =>
  raw(d).exec("INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b) VALUES ('c1', 'cat1', 'w1-0', 'a', 'ko', 'r1', 'r2')");

test('versionedTables : liste exacte', () => {
  expect(versionedTables(freshDb())).toEqual([
    'age_bands', 'age_links', 'categories', 'club_directory', 'clubs', 'competitions', 'fighters', 'frozen_passages', 'kata_scores',
    'match_results', 'recasements', 'refusals', 'registrations', 'tie_breaks', 'wave_launches', 'waves', 'weight_classes', 'zones',
  ]);
});

test('règle de garde : chaque table a competition_id ou est déclarée globale', () => {
  const d = freshDb();
  const missing = tables(d).filter((t) => !GLOBAL_TABLES.includes(t) && !columns(d, t).includes('competition_id'));
  expect(missing).toEqual([]);
});

test('chaque table versionnée a version, updated_at et ses quatre déclencheurs', () => {
  const d = freshDb();
  for (const t of versionedTables(d)) {
    expect(columns(d, t), t).toEqual(expect.arrayContaining(['version', 'updated_at']));
    expect(triggers(d, t), t).toEqual([`${t}__version_insert`, `${t}__version_keep`, `${t}__version_set`, `${t}__version_update`]);
  }
});

test('insertion → version et updated_at renseignés ; modification → version strictement plus grande, updated_at mis à jour', () => {
  const d = freshDb();
  insertResult(d);
  const first = result(d);
  expect(first.version).toBeGreaterThan(0);
  expect(first.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  raw(d).exec("UPDATE match_results SET updated_at = '2000-01-01T00:00:00.000Z' WHERE match_id = 'w1-0'"); // date ancienne, remplacée par le déclencheur
  raw(d).exec("UPDATE match_results SET method = 'points' WHERE match_id = 'w1-0'");
  const second = result(d);
  expect(second.version).toBeGreaterThan(first.version);
  expect(second.updated_at > '2000-01-01T00:00:00.000Z').toBe(true);
});

test('résultat effacé puis ressaisi (même category_id, match_id) → version strictement supérieure à toutes ses versions précédentes', () => {
  const d = freshDb();
  insertResult(d);
  raw(d).exec("UPDATE match_results SET method = 'points' WHERE match_id = 'w1-0'");
  const before = result(d).version;
  raw(d).exec("DELETE FROM match_results WHERE match_id = 'w1-0'");
  insertResult(d);
  expect(result(d).version).toBeGreaterThan(before);
});

test('ligne insérée avec sa version → version gardée ; le compteur passe au moins à cette valeur', () => {
  const d = freshDb();
  raw(d).exec(
    "INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b, version, updated_at) VALUES ('c1', 'cat1', 'w1-0', 'a', 'ko', 'r1', 'r2', 5000, '2026-01-01T00:00:00.000Z')",
  );
  expect(result(d)).toEqual({ version: 5000, updated_at: '2026-01-01T00:00:00.000Z' });
  expect(counter(d)).toBeGreaterThanOrEqual(5000);
  raw(d).exec("UPDATE match_results SET method = 'points' WHERE match_id = 'w1-0'");
  expect(result(d).version).toBeGreaterThan(5000);
});

test('déclencheur supprimé (DROP TRIGGER) → recréé à l’ouverture suivante', () => {
  const file = tmpDbPath();
  closeDb(openDb(file));
  const r = new Database(file);
  r.exec('DROP TRIGGER "match_results__version_update"');
  r.close();
  db = openDb(file);
  expect(triggers(db, 'match_results')).toContain('match_results__version_update');
});

test("une base de l'étape 14 (olderDb(13)) : après ouverture, toutes les lignes existantes ont une version et un updated_at", () => {
  const file = olderDb(13);
  const r = new Database(file);
  r.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO zones (id, competition_id, name, sort_order) VALUES ('z1', 'c1', 'Tatami 1', 0);
    INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b) VALUES ('c1', 'cat1', 'w1-0', 'a', 'ko', 'r1', 'r2');
  `);
  r.close();
  db = openDb(file);
  for (const t of ['competitions', 'zones', 'match_results']) {
    expect(raw(db).prepare(`select count(*) as n from ${t} where version is null or updated_at is null`).get(), t).toEqual({ n: 0 });
  }
});

test('API inchangée : aucune nouvelle colonne dans les réponses', async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  const created = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } });
  const base = `/api/competitions/${created.json().id}`;
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const filled = fillClubForm(tpl, ['Tani Dojo', 'Jean', null, null, 'Oui'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Karaté', 'Shobu', null, 'Oui', null],
  ]);
  const imported = await app.inject({ method: 'POST', url: `${base}/club-forms/import`, payload: filled, headers: { 'content-type': 'application/octet-stream' } });
  expect(imported.statusCode).toBe(200);
  const categories = (await app.inject({ method: 'GET', url: `${base}/categories` })).json() as { id: string }[];
  expect(categories.length).toBeGreaterThan(0);
  const urls = [
    '/api/competitions', '/api/grid-templates', base, `${base}/grid`, `${base}/clubs`, `${base}/registrations`, `${base}/categories`, `${base}/zones`,
    `${base}/waves`, `${base}/launch`, `${base}/passages`, `${base}/podiums`, `${base}/replacement`, `${base}/schedule`, `${base}/weigh-in`,
    `${base}/categories/${categories[0]!.id}/results`,
  ];
  for (const url of urls) {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode, url).toBe(200);
    for (const key of ['version', 'updatedAt', 'directoryClubId', 'ownerInstanceId', 'lastSyncAt', 'clubEntryStatus', 'clubEntryDeadline']) {
      expect(res.body, `${url} : ${key}`).not.toContain(`"${key}"`);
    }
  }
});

test('API inchangée : journal des réaffectations sans version ni updatedAt', async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  const created = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } });
  const id = created.json().id as string;
  await app.close();
  const r = new Database(dbPath);
  r.prepare(
    "INSERT INTO recasements (id, competition_id, registration_id, proposal_id, type, from_label, to_label, manual, pre_approved, bulk, snapshot_json) VALUES ('x1', ?, 'r1', 'p1', 'weight', 'A', 'B', 0, 0, 0, '{}')",
  ).run(id);
  r.close();
  app = await buildApp({ dbPath });
  const res = await app.inject({ method: 'GET', url: `/api/competitions/${id}/replacement` });
  expect(res.statusCode).toBe(200);
  expect(res.json().recasements).toHaveLength(1);
  expect(res.body).not.toContain('"version"');
  expect(res.body).not.toContain('"updatedAt"');
});

test('déclencheur à l’ancienne définition → remplacé par la définition actuelle à l’ouverture suivante', () => {
  const file = tmpDbPath();
  closeDb(openDb(file));
  const r = new Database(file);
  const current = (r.prepare("select sql from sqlite_master where name = 'zones__version_update'").get() as { sql: string }).sql;
  r.exec('DROP TRIGGER "zones__version_update"');
  r.exec('CREATE TRIGGER "zones__version_update" AFTER UPDATE ON "zones" BEGIN SELECT 1; END');
  r.close();
  db = openDb(file);
  expect((raw(db).prepare("select sql from sqlite_master where name = 'zones__version_update'").get() as { sql: string }).sql).toBe(current);
});

test('insertion sans version : une seule valeur du compteur consommée, updated_at fourni gardé', () => {
  const d = freshDb();
  const before = counter(d);
  raw(d).exec(
    "INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b, updated_at) VALUES ('c1', 'cat1', 'w1-0', 'a', 'ko', 'r1', 'r2', '2026-01-01T00:00:00.000Z')",
  );
  expect(counter(d)).toBe(before + 1);
  expect(result(d)).toEqual({ version: before + 1, updated_at: '2026-01-01T00:00:00.000Z' });
});

test('modification qui fixe la version (futur transfert) : version gardée, compteur relevé', () => {
  const d = freshDb();
  insertResult(d);
  raw(d).exec("UPDATE match_results SET method = 'points', version = 9000 WHERE match_id = 'w1-0'");
  expect(result(d).version).toBe(9000);
  expect(counter(d)).toBeGreaterThanOrEqual(9000);
});

test('table de compétition sans version ni updated_at : colonnes ajoutées à l’ouverture, pas d’erreur au démarrage', () => {
  const file = tmpDbPath();
  closeDb(openDb(file));
  const r = new Database(file);
  r.exec('CREATE TABLE extra (competition_id text, note text)');
  r.close();
  db = openDb(file);
  expect(columns(db, 'extra')).toEqual(expect.arrayContaining(['version', 'updated_at']));
  expect(triggers(db, 'extra')).toHaveLength(4);
});

test('schéma drizzle : chaque table versionnée déclare version et updatedAt', async () => {
  const schema = await import('../../src/server/db/schema.js');
  const { getTableConfig, SQLiteTable } = await import('drizzle-orm/sqlite-core');
  const missing = (Object.values(schema) as unknown[])
    .filter((t) => t instanceof SQLiteTable)
    .map((t) => getTableConfig(t as Parameters<typeof getTableConfig>[0]))
    .filter((c) => c.name === 'competitions' || c.name === 'club_directory' || (c.name !== 'uploads' && c.columns.some((col) => col.name === 'competition_id')))
    .filter((c) => !['version', 'updated_at'].every((n) => c.columns.some((col) => col.name === n)))
    .map((c) => c.name);
  expect(missing).toEqual([]);
});

test('API inchangée : réponses des créations et modifications sans nouvelle colonne', async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  const keys = ['version', 'updatedAt', 'directoryClubId', 'ownerInstanceId', 'lastSyncAt', 'clubEntryStatus', 'clubEntryDeadline'];
  const check = (label: string, res: { statusCode: number; body: string }) => {
    expect(res.statusCode, label).toBeLessThan(300);
    for (const key of keys) expect(res.body, `${label} : ${key}`).not.toContain(`"${key}"`);
  };
  const created = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } });
  check('POST compétition', created);
  const base = `/api/competitions/${created.json().id}`;
  check('PATCH compétition', await app.inject({ method: 'PATCH', url: base, payload: { location: 'Nice' } }));
  const club = await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Tani Dojo' } });
  check('POST club', club);
  check('PATCH club', await app.inject({ method: 'PATCH', url: `${base}/clubs/${club.json().id}`, payload: { coachName: 'Jean' } }));
  const input = { clubId: club.json().id, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' };
  const reg = await app.inject({ method: 'POST', url: `${base}/registrations`, payload: input });
  check('POST inscription', reg);
  const regId = reg.json().row.id as string;
  check('PUT inscription', await app.inject({ method: 'PUT', url: `${base}/registrations/${regId}`, payload: { ...input, firstName: 'Lea' } }));
});
