import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0039 : table authorization_answers, clé primaire et cascade', () => {
  const file = olderDb(38);
  closeDb(openDb(file));
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  const cols = db.prepare("select name, pk from pragma_table_info('authorization_answers')").all() as { name: string; pk: number }[];
  expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(['competition_id', 'registration_id', 'kind', 'situation_json', 'answered_at', 'version', 'updated_at']));
  expect(cols.filter((c) => c.pk > 0).map((c) => c.name).sort()).toEqual(['competition_id', 'kind', 'registration_id']);
  db.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO fighters (id, competition_id, last_name, first_name, name_key, sex, age_band_code) VALUES ('f1', 'c1', 'A', 'a', 'a a', 'M', 'cadet');
    INSERT INTO registrations (id, competition_id, fighter_id, discipline, source) VALUES ('r1', 'c1', 'f1', 'karate', 'manual');
    INSERT INTO authorization_answers (competition_id, registration_id, kind, situation_json, answered_at) VALUES ('c1', 'r1', 'age', '{}', '2026-11-20T10:00:00.000Z');
  `);
  expect(() => db.exec(`INSERT INTO authorization_answers (competition_id, registration_id, kind, situation_json, answered_at) VALUES ('c1', 'r1', 'age', '{}', 'x')`)).toThrow();
  db.exec("DELETE FROM registrations WHERE id = 'r1'");
  expect(db.prepare('select count(*) as n from authorization_answers').get()).toEqual({ n: 0 });
  db.close();
});
