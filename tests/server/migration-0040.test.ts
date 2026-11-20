import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0040 : table ignored_cases, clé primaire et cascade', () => {
  const file = olderDb(39);
  closeDb(openDb(file));
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  const cols = db.prepare("select name, pk from pragma_table_info('ignored_cases')").all() as { name: string; pk: number }[];
  expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(['competition_id', 'case_id', 'fingerprint', 'note', 'created_at', 'wave_id', 'history_entry_id', 'version', 'updated_at']));
  expect(cols.filter((c) => c.pk > 0).map((c) => c.name).sort()).toEqual(['case_id', 'competition_id']);
  db.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO ignored_cases (competition_id, case_id, fingerprint, history_entry_id) VALUES ('c1', 'alone:r1', '[]', 'h1');
  `);
  expect(db.prepare('select note, wave_id from ignored_cases').get()).toEqual({ note: '', wave_id: null });
  expect(() => db.exec(`INSERT INTO ignored_cases (competition_id, case_id, fingerprint, history_entry_id) VALUES ('c1', 'alone:r1', '[]', 'h2')`)).toThrow();
  db.exec("DELETE FROM competitions WHERE id = 'c1'");
  expect(db.prepare('select count(*) as n from ignored_cases').get()).toEqual({ n: 0 });
  db.close();
});
