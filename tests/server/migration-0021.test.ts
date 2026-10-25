import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

/** Base de l'étape 21 : une tranche mineure et une adulte non proposées sur la fiche club, une proposée. */
function step21Db(): string {
  const file = olderDb(20);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, location, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', 'Nice', '{}');
    INSERT INTO age_bands (competition_id, code, label, min_age, max_age, is_minor, sort_order, on_club_form) VALUES
      ('c1', 'cadet', 'Cadets', 14, 15, 1, 0, 0),
      ('c1', 'junior', 'Juniors', 16, 17, 1, 1, 1),
      ('c1', 'senior', 'Seniors', 18, NULL, 0, 2, 0);
  `);
  raw.close();
  return file;
}

test('migration 0021 : une tranche non proposée sur la fiche club devient une ligne fermée', () => {
  const file = step21Db();
  closeDb(openDb(file));
  const raw = new Database(file, { readonly: true });
  const count = (where: string) => (raw.prepare(`select count(*) as n from closed_categories where ${where}`).get() as { n: number }).n;
  expect(count("age_band_code = 'cadet'")).toBe(10);
  expect(count("age_band_code = 'cadet' and ruleset = 'shobu'")).toBe(0);
  expect(count("age_band_code = 'senior'")).toBe(18);
  expect(count("age_band_code = 'junior'")).toBe(0);
  expect(count("age_band_code = 'senior' and discipline = 'kata' and ruleset = ''")).toBe(2);
  raw.close();
});
