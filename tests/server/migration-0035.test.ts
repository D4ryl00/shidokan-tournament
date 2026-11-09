import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0035 adds wave_schedules and categories.durations_json', () => {
  const file = olderDb(34);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO categories (id, competition_id, key_string, key_json, label, seed) VALUES ('k1', 'c1', 'ks', '{}', 'Cat', 1);
  `);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  const cols = (t: string) => (check.prepare(`select name from pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
  expect(cols('wave_schedules')).toEqual(['competition_id', 'wave_key', 'planned_start', 'actual_start', 'finals_start', 'version', 'updated_at']);
  expect(cols('categories')).toContain('durations_json');
  expect(check.prepare('select id, durations_json from categories').all()).toEqual([{ id: 'k1', durations_json: null }]);
  check.close();
});
