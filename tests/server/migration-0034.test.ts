import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0034 : compétitions privées, aucun nom masqué', () => {
  const file = olderDb(33);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO fighters (id, competition_id, last_name, first_name, name_key, sex, age_band_code) VALUES ('f1', 'c1', 'DUPONT', 'Léa', 'dupont lea', 'F', 'cadet');
  `);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  expect(check.prepare('select id, name, date, visibility from competitions').all()).toEqual([
    { id: 'c1', name: 'Coupe', date: '2026-11-22', visibility: 'private' },
  ]);
  expect(check.prepare('select id, last_name, first_name, sex, public_name_hidden from fighters').all()).toEqual([
    { id: 'f1', last_name: 'DUPONT', first_name: 'Léa', sex: 'F', public_name_hidden: 0 },
  ]);
  check.close();
});
