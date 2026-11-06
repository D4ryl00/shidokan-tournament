import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0032 : catégories intactes, aucun tableau arrangé', () => {
  const file = olderDb(31);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO categories (id, competition_id, key_string, key_json, label, status, seed, bracket_json) VALUES
      ('k1', 'c1', 'karate|jiyu|F|cadet|cadet:F:-54', '{}', 'Cadettes', 'ready', 7, '{"kind":"combat"}'),
      ('k2', 'c1', 'kata||F|cadet|', '{}', 'Kata', 'provisional', 8, NULL);
  `);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  expect(check.prepare('select id, label, status, seed, bracket_json, arranged from categories order by id').all()).toEqual([
    { id: 'k1', label: 'Cadettes', status: 'ready', seed: 7, bracket_json: '{"kind":"combat"}', arranged: 0 },
    { id: 'k2', label: 'Kata', status: 'provisional', seed: 8, bracket_json: null, arranged: 0 },
  ]);
  check.close();
});
