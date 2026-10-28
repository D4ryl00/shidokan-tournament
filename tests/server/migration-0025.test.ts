import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0025 : la session de chaque action (nulle pour les lignes d’avant)', () => {
  const file = olderDb(24);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO refusals (competition_id, proposal_id) VALUES ('c1', 'A:r1>c2');
    INSERT INTO set_aside_cases (competition_id, case_id) VALUES ('c1', 'alone:r1');
  `);
  raw.close();
  closeDb(openDb(file));
  const db = new Database(file, { readonly: true });
  const columns = (t: string) => (db.prepare(`select name from pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
  for (const t of ['recasements', 'refusals', 'set_aside_cases']) expect(columns(t)).toContain('wave_id');
  expect(db.prepare('select proposal_id, wave_id from refusals').all()).toEqual([{ proposal_id: 'A:r1>c2', wave_id: null }]);
  expect(db.prepare('select case_id, wave_id from set_aside_cases').all()).toEqual([{ case_id: 'alone:r1', wave_id: null }]);
  db.close();
});
