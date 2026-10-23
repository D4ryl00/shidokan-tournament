import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

/** Base de l'étape 14 avec une compétition, un club, un combattant, une inscription et un résultat. */
function step14Db(): string {
  const file = olderDb(13);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, location, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', 'Nice', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, ffk_entity, coach_name, coach_phone, coach_email, pre_approval)
      VALUES ('k1', 'c1', 'Tani Dojo', 'TANI DOJO', '0060893 TANI DOJO', 'Coach', '0600000000', 'coach@example.org', 1);
    INSERT INTO fighters (id, competition_id, club_id, last_name, first_name, name_key, sex, age_band_code)
      VALUES ('f1', 'c1', 'k1', 'Durand', 'Léa', 'DURAND LEA', 'F', 'cadet');
    INSERT INTO registrations (id, competition_id, fighter_id, discipline, source) VALUES ('r1', 'c1', 'f1', 'karate', 'ffk');
    INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b)
      VALUES ('c1', 'cat1', 'w1-0', 'a', 'ko', 'r1', 'r2');
  `);
  raw.close();
  return file;
}

const columns = (raw: Database.Database, table: string) =>
  (raw.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[]).map((c) => c.name);

test("une base de l'étape 14 migre : compétitions, clubs, inscriptions et résultats intacts", () => {
  const file = step14Db();
  closeDb(openDb(file));
  const raw = new Database(file, { readonly: true });
  expect(raw.prepare('select name, date, location from competitions').get()).toEqual({ name: 'Coupe', date: '2026-11-22', location: 'Nice' });
  expect(raw.prepare('select name, ffk_entity, coach_phone, pre_approval from clubs').get()).toEqual({
    name: 'Tani Dojo', ffk_entity: '0060893 TANI DOJO', coach_phone: '0600000000', pre_approval: 1,
  });
  expect(raw.prepare('select last_name, first_name, club_id from fighters').get()).toEqual({ last_name: 'Durand', first_name: 'Léa', club_id: 'k1' });
  expect(raw.prepare('select discipline, source from registrations').get()).toEqual({ discipline: 'karate', source: 'ffk' });
  expect(raw.prepare('select winner, method, entrant_a from match_results').get()).toEqual({ winner: 'a', method: 'ko', entrant_a: 'r1' });
  raw.close();
});

test("competitions : club_entry_status = 'closed', owner_instance_id, last_sync_at et club_entry_deadline vides", () => {
  const file = step14Db();
  closeDb(openDb(file));
  const raw = new Database(file, { readonly: true });
  expect(raw.prepare('select club_entry_status, owner_instance_id, last_sync_at, club_entry_deadline from competitions').get()).toEqual({
    club_entry_status: 'closed', owner_instance_id: null, last_sync_at: null, club_entry_deadline: null,
  });
  raw.close();
});

test('tables créées : instance, change_counter, club_directory ; clubs.directory_club_id existe', () => {
  const file = step14Db();
  closeDb(openDb(file));
  const raw = new Database(file, { readonly: true });
  const tables = (raw.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toEqual(expect.arrayContaining(['instance', 'change_counter', 'club_directory']));
  expect(columns(raw, 'clubs')).toContain('directory_club_id');
  expect(columns(raw, 'club_directory')).toEqual(expect.arrayContaining(['affiliation_number', 'ffk_entity', 'name_key', 'archived', 'version', 'updated_at']));
  expect(columns(raw, 'match_results')).toEqual(expect.arrayContaining(['version', 'updated_at']));
  expect(columns(raw, 'uploads')).not.toContain('version');
  raw.close();
});
