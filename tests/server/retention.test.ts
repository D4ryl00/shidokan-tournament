import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { backupDir } from '../../src/server/repositories/backups.js';
import { purgeExpiredData } from '../../src/server/repositories/retention.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb | null = null;
afterEach(() => {
  if (db) closeDb(db);
  db = null;
});

const NOW = new Date('2027-12-31T12:00:00Z');

/** Une compétition complète à la date donnée : club, combattant, inscriptions, lien, mail, fichier, résultat, notes de kata. */
function seedCompetition(d: AppDb, id: string, date: string) {
  d.$client.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('${id}', 'Coupe ${id}', '${date}', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, coach_name, coach_phone, coach_emails, pre_approval) VALUES ('${id}-k', '${id}', 'Tani Dojo', 'TANI DOJO', 'Jean', '0600000000', '["jean@tani.example"]', 0);
    INSERT INTO fighters (id, competition_id, club_id, last_name, first_name, name_key, sex, age_band_code, licence, grade, weigh_in_kg)
      VALUES ('${id}-f', '${id}', '${id}-k', 'MARTIN', 'Léa', 'MARTIN LEA', 'F', 'cadet', 'L001', '1er kyu', 53.8);
    INSERT INTO registrations (id, competition_id, fighter_id, discipline, source, approx_weight_kg) VALUES ('${id}-r', '${id}', '${id}-f', 'karate', 'online', 54);
    INSERT INTO club_invitations (id, competition_id, club_id, token_hash) VALUES ('${id}-i', '${id}', '${id}-k', 'hash-${id}');
    INSERT INTO mail_log (id, competition_id, club_id, email, status) VALUES ('${id}-m', '${id}', '${id}-k', 'jean@tani.example', 'sent');
    INSERT INTO uploads (id, competition_id, file_name, data) VALUES ('${id}-u', '${id}', 'fiche.ods', x'00');
    INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b) VALUES ('${id}', 'cat-${id}', 'w1-0', 'a', 'ko', '${id}-r', 'x');
    INSERT INTO kata_scores (competition_id, category_id, registration_id, round, notes_json) VALUES ('${id}', 'kata-${id}', '${id}-r', 'round1', '[8,8,8]');
  `);
}
const one = (d: AppDb, sql: string) => d.$client.prepare(sql).get() as Record<string, unknown>;
const count = (d: AppDb, table: string, id: string) => (one(d, `select count(*) as n from ${table} where competition_id = '${id}'`).n as number);

test('compétition de plus de 13 mois : données d’organisation effacées, palmarès gardé, purged_at noté', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  seedCompetition(db, 'old', '2026-11-22');
  const report = purgeExpiredData(db, dbPath, NOW);
  expect(report.competitions).toBe(1);
  expect(one(db, "select weigh_in_kg, licence, grade, last_name, first_name from fighters where id = 'old-f'")).toEqual({ weigh_in_kg: null, licence: null, grade: null, last_name: 'MARTIN', first_name: 'Léa' });
  expect(one(db, "select approx_weight_kg, discipline from registrations where id = 'old-r'")).toEqual({ approx_weight_kg: null, discipline: 'karate' });
  expect(one(db, "select coach_phone, coach_emails, name from clubs where id = 'old-k'")).toEqual({ coach_phone: null, coach_emails: '[]', name: 'Tani Dojo' });
  for (const t of ['club_invitations', 'mail_log', 'uploads']) expect(count(db, t, 'old'), t).toBe(0);
  for (const t of ['match_results', 'kata_scores']) expect(count(db, t, 'old'), t).toBe(1);
  expect(one(db, "select purged_at from competitions where id = 'old'").purged_at).not.toBeNull();
});

test('compétition de 12 mois : rien', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  seedCompetition(db, 'recent', '2027-01-10');
  expect(purgeExpiredData(db, dbPath, NOW).competitions).toBe(0);
  expect(one(db, "select weigh_in_kg from fighters where id = 'recent-f'").weigh_in_kg).toBe(53.8);
  expect(count(db, 'club_invitations', 'recent')).toBe(1);
});

test('second passage : rien (purged_at)', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  seedCompetition(db, 'old', '2026-11-22');
  purgeExpiredData(db, dbPath, NOW);
  expect(purgeExpiredData(db, dbPath, NOW)).toEqual({ competitions: 0, directoryEntries: 0, backups: 0 });
});

test('annuaire : fiche sans compétition depuis 3 ans → archivée et vidée ; récente ou jeune → intacte', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  db.$client.exec(`
    INSERT INTO club_directory (id, name, name_key, coach_name, coach_phone, coach_emails, notes, created_at) VALUES
      ('ancien', 'Ancien club', 'ANCIEN CLUB', 'A', '01', '["a@x.example"]', 'note', '2020-01-01T00:00:00.000Z'),
      ('actif', 'Club actif', 'CLUB ACTIF', 'B', '02', '["b@x.example"]', null, '2020-01-01T00:00:00.000Z'),
      ('jeune', 'Jeune club', 'JEUNE CLUB', 'C', '03', '["c@x.example"]', null, '2026-06-01T00:00:00.000Z');
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c2023', 'Coupe 2023', '2023-11-22', '{}'), ('c2027', 'Coupe 2027', '2027-11-22', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, pre_approval, directory_club_id) VALUES
      ('k1', 'c2023', 'Ancien club', 'ANCIEN CLUB', 0, 'ancien'), ('k2', 'c2023', 'Club actif', 'CLUB ACTIF', 0, 'actif'), ('k3', 'c2027', 'Club actif', 'CLUB ACTIF', 0, 'actif');
  `);
  expect(purgeExpiredData(db, dbPath, NOW).directoryEntries).toBe(1);
  expect(one(db, "select archived, coach_name, coach_phone, coach_emails, notes from club_directory where id = 'ancien'")).toEqual({ archived: 1, coach_name: null, coach_phone: null, coach_emails: '[]', notes: null });
  expect(one(db, "select archived, coach_emails from club_directory where id = 'actif'")).toEqual({ archived: 0, coach_emails: '["b@x.example"]' });
  expect(one(db, "select archived, coach_emails from club_directory where id = 'jeune'")).toEqual({ archived: 0, coach_emails: '["c@x.example"]' });
});

test('sauvegardes plus anciennes que 13 mois supprimées, sauf la plus récente', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  const dir = backupDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const names = ['shidokan-20260101-100000-000.sqlite', 'shidokan-20261001-100000-000.sqlite', 'shidokan-20270101-100000-000.sqlite'];
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
  expect(purgeExpiredData(db, dbPath, NOW).backups).toBe(2);
  expect(fs.readdirSync(dir).sort()).toEqual(['shidokan-20270101-100000-000.sqlite']);
  // Toutes trop vieilles : la plus récente reste.
  fs.writeFileSync(path.join(dir, names[0]!), 'x');
  fs.rmSync(path.join(dir, names[2]!));
  fs.writeFileSync(path.join(dir, names[1]!), 'x');
  purgeExpiredData(db, dbPath, NOW);
  expect(fs.readdirSync(dir)).toEqual([names[1]]);
});

test('délais réglés à 24 mois : rien d’effacé à 13 mois', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  db.$client.prepare("insert into app_settings (key, value_json) values ('retentionMonths', '24')").run();
  seedCompetition(db, 'old', '2026-11-22');
  expect(purgeExpiredData(db, dbPath, NOW).competitions).toBe(0);
});

test('archivage RGPD efface le lien Google', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  db.$client.exec(`
    INSERT INTO club_directory (id, name, name_key, coach_name, created_at, google_contact_id) VALUES
      ('ancien', 'Ancien club', 'ANCIEN CLUB', 'A', '2020-01-01T00:00:00.000Z', 'people/c1');
    INSERT INTO club_directory (id, name, name_key, archived, created_at, google_contact_id) VALUES
      ('deja', 'Déjà archivé', 'DEJA ARCHIVE', 1, '2020-01-01T00:00:00.000Z', 'people/c2');
  `);
  expect(purgeExpiredData(db, dbPath, NOW).directoryEntries).toBe(2);
  expect(one(db, "select archived, google_contact_id from club_directory where id = 'ancien'")).toEqual({ archived: 1, google_contact_id: null });
  expect(one(db, "select archived, google_contact_id from club_directory where id = 'deja'")).toEqual({ archived: 1, google_contact_id: null });
});
