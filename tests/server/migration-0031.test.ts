import Database from 'better-sqlite3';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { mergeDirectoryEntries } from '../../src/server/repositories/directory.js';
import { purgeExpiredData } from '../../src/server/repositories/retention.js';
import { buildPackage, importPackage, unclassifiedTables } from '../../src/server/sync/package.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb | null = null;
afterEach(() => {
  if (db) closeDb(db);
  db = null;
});

const seed = (d: AppDb) =>
  d.$client.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}'), ('vieille', 'Ancienne', '2020-01-01', '{}');
    INSERT INTO club_directory (id, name, name_key) VALUES ('d1', 'Dojo', 'DOJO'), ('d2', 'Dojo bis', 'DOJO BIS');
    INSERT INTO clubs (id, competition_id, name, name_key, pre_approval, directory_club_id, affiliation_number) VALUES
      ('k1', 'c1', 'Dojo', 'DOJO', 0, 'd1', '0123'), ('k2', 'vieille', 'Dojo', 'DOJO', 0, 'd2', NULL);
    INSERT INTO club_changes (club_id, competition_id, directory_id, origin, values_json, changed_at, ignored) VALUES
      ('k1', 'c1', 'd1', 'club', '{"coachPhone":"06"}', '2026-11-01T00:00:00.000Z', 0),
      ('k2', 'vieille', 'd2', 'competition', '{}', '2020-01-01T00:00:00.000Z', 0);
  `);
const count = (d: AppDb, sql: string) => (d.$client.prepare(sql).get() as { n: number }).n;

test('migration 0031 : clubs intacts, numéro d’affiliation nul, aucun changement en attente', () => {
  const file = olderDb(30);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, coach_phone, pre_approval) VALUES ('k1', 'c1', 'Dojo', 'DOJO', '06', 0);
  `);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  expect(check.prepare('select id, name, coach_phone, affiliation_number from clubs').all()).toEqual([{ id: 'k1', name: 'Dojo', coach_phone: '06', affiliation_number: null }]);
  expect((check.prepare('select count(*) as n from club_changes').get() as { n: number }).n).toBe(0);
  check.close();
});

test('un changement disparaît avec son club et avec sa fiche d’annuaire', () => {
  db = openDb(tmpDbPath());
  seed(db);
  db.$client.exec("delete from clubs where id = 'k1'");
  expect(count(db, "select count(*) as n from club_changes where club_id = 'k1'")).toBe(0);
  db.$client.exec("delete from club_directory where id = 'd2'");
  expect(count(db, 'select count(*) as n from club_changes')).toBe(0);
});

test('fusion de fiches : le changement suit la fiche gardée', () => {
  db = openDb(tmpDbPath());
  seed(db);
  mergeDirectoryEntries(db, 'd1', 'd2');
  expect(db.$client.prepare('select club_id, directory_id from club_changes order by club_id').all()).toEqual([
    { club_id: 'k1', directory_id: 'd1' }, { club_id: 'k2', directory_id: 'd1' },
  ]);
});

test('purge : les changements des compétitions purgées sont supprimés, les autres restent', () => {
  const path = tmpDbPath();
  db = openDb(path);
  seed(db);
  purgeExpiredData(db, path, new Date('2026-11-05T00:00:00Z'));
  expect(db.$client.prepare('select competition_id from club_changes').all()).toEqual([{ competition_id: 'c1' }]);
});

test('club_changes est classée : propre à l’installation, absente d’un paquet, le numéro du club y voyage', () => {
  db = openDb(tmpDbPath());
  seed(db);
  expect(unclassifiedTables(db)).toEqual([]);
  const pkg = buildPackage(db, 'c1', { handOver: false, role: 'local' });
  expect(Object.keys(pkg.tables)).not.toContain('club_changes');
  expect(pkg.tables.clubs![0]!.affiliation_number).toBe('0123');
});

test('un paquet d’avant cette colonne se charge, le numéro du club restant nul', async () => {
  const source = tmpDbPath();
  db = openDb(source);
  seed(db);
  const pkg = JSON.parse(JSON.stringify(buildPackage(db, 'c1', { handOver: false, role: 'local' })));
  for (const r of pkg.tables.clubs) delete r.affiliation_number;
  const targetPath = tmpDbPath();
  const target = openDb(targetPath);
  try {
    await importPackage(target, targetPath, pkg, null, new Date(), { backup: false });
    expect(target.$client.prepare('select id, affiliation_number from clubs').all()).toEqual([{ id: 'k1', affiliation_number: null }]);
  } finally {
    closeDb(target);
  }
});

test('passage de main aller et retour : le changement et le numéro du club sont gardés', async () => {
  const p = tmpDbPath();
  const d = openDb(p);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  const srv = await buildApp({ dbPath: p, role: 'serveur', publicUrl: 'https://competitions.example.org' });
  try {
    const cookie = String((await srv.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
    const orga = (method: 'GET' | 'POST', url: string, payload?: unknown) => srv.inject({ method, url, headers: { cookie }, payload: payload as object });
    const cid = (await orga('POST', '/api/competitions', { name: 'Coupe', date: '2026-11-22' })).json().id as string;
    const dir = (await orga('POST', '/api/club-directory', { name: 'Tani Dojo', affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null })).json().id as string;
    await orga('POST', `/api/competitions/${cid}/invitations`, { directoryIds: [dir] });
    const clubId = (await orga('GET', `/api/competitions/${cid}/invitations`)).json()[0].clubId as string;
    const raw = new Database(p);
    raw.prepare("update clubs set affiliation_number = '' where id = ?").run(clubId);
    raw.prepare("insert into club_changes (club_id, competition_id, directory_id, origin, values_json, changed_at, ignored) values (?, ?, ?, 'club', '{\"coachPhone\":\"06\"}', '2026-11-01T00:00:00.000Z', 0)").run(clubId, cid, dir);
    raw.close();

    const jeton = (await orga('POST', '/api/sync/tokens', { name: 'PC' })).json().token as string;
    const remote = (path: string, payload: unknown) => srv.inject({ method: 'POST', url: `/api/sync/remote${path}`, headers: { authorization: `Bearer ${jeton}` }, payload: payload as object });
    const pkg = (await remote(`/competitions/${cid}/take`, { instanceId: 'pc-1', instanceName: 'PC-SALLE' })).json();
    expect(pkg.tables.club_changes).toBeUndefined();
    expect(pkg.tables.clubs[0].affiliation_number).toBe('');
    const back = await remote(`/competitions/${cid}/return`, { ...pkg, from: { instanceId: 'pc-1', instanceName: 'PC-SALLE', role: 'local' }, handOver: true });
    expect(back.statusCode).toBe(200);

    const check = new Database(p, { readonly: true });
    expect(check.prepare('select affiliation_number from clubs where id = ?').get(clubId)).toEqual({ affiliation_number: '' });
    expect(check.prepare('select values_json from club_changes where club_id = ?').all(clubId)).toEqual([{ values_json: '{"coachPhone":"06"}' }]);
    check.close();
  } finally {
    await srv.close();
  }
});
