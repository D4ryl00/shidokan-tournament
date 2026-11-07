import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0033 : le journal des réaffectations est repris dans history_entries', () => {
  const file = olderDb(32);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO recasements (id, competition_id, registration_id, proposal_id, type, from_label, to_label, reason, manual, pre_approved, bulk, status, snapshot_json, wave_id, created_at) VALUES
      ('r1', 'c1', 'g1', 'p1', 'M', 'A', 'B', 'à la main', 1, 0, 0, 'validated', '{}', 'w1', '2026-11-01T10:00:00.000Z'),
      ('r2', 'c1', 'g2', 'p2', 'B', 'C', 'D', 'poids', 0, 0, 1, 'undone', '{}', NULL, '2026-11-01T11:00:00.000Z'),
      ('r3', 'c1', 'g3', 'p3', 'W', 'E', 'F', '', 0, 0, 0, 'validated', '{}', NULL, '2026-11-01T12:00:00.000Z'),
      ('r4', 'c1', 'g4', 'p4', 'B', 'G', 'H', '', 0, 0, 0, 'validated', '{}', NULL, '2026-11-01T13:00:00.000Z');
  `);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  const rows = check.prepare('select * from history_entries order by rowid').all() as Record<string, unknown>[];
  expect(rows.map((r) => [r.kind, r.status])).toEqual([['manual', 'active'], ['plan', 'undone'], ['withdraw', 'active'], ['reaffectation', 'active']]);
  expect(rows[0]).toMatchObject({ competition_id: 'c1', recasement_ids: '["r1"]', wave_id: 'w1', created_at: '2026-11-01T10:00:00.000Z', group_id: null });
  expect(JSON.parse(rows[0]!.summary_json as string)).toEqual({ registrationIds: ['g1'], fromLabel: 'A', toLabel: 'B', reason: 'à la main' });
  expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  check.close();
});
