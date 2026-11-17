import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { journalSearchText } from '../../src/domain/journal/text.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0038 : « Journal ouvert » dans les compétitions tenues ici seulement', () => {
  const file = olderDb(37);
  const raw = new Database(file);
  raw.exec(`INSERT INTO competitions (id, name, date, settings_json, owner_instance_id) VALUES
    ('c1', 'Ici', '2026-11-22', '{}', NULL), ('c2', 'Ailleurs', '2026-11-22', '{}', 'x')`);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  const rows = check.prepare('select competition_id, seq, parent_id, type, action, via, actor_json, data_json, search_text from journal_entries').all();
  expect(rows).toEqual([
    {
      competition_id: 'c1', seq: 1, parent_id: null, type: 'competition', action: 'journal-opened', via: 'autre',
      actor_json: '{"kind":"app"}', data_json: '{}',
      search_text: journalSearchText({ action: 'journal-opened', data: {}, actor: { kind: 'app' }, via: 'autre' }),
    },
  ]);
  check.close();
});
