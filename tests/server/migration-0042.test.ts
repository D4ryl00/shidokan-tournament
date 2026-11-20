import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0042 : mail_log.kind vaut invitation par défaut', () => {
  const file = olderDb(41);
  const old = new Database(file);
  old.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key) VALUES ('k1', 'c1', 'Club', 'club');
    INSERT INTO mail_log (id, competition_id, club_id, email, status) VALUES ('m0', 'c1', 'k1', 'a@b.fr', 'sent');
  `);
  old.close();
  closeDb(openDb(file));
  const db = new Database(file);
  expect((db.prepare("select name from pragma_table_info('mail_log')").all() as { name: string }[]).map((c) => c.name)).toContain('kind');
  db.exec("INSERT INTO mail_log (id, competition_id, club_id, email, status) VALUES ('m1', 'c1', 'k1', 'a@b.fr', 'sent')");
  expect(db.prepare('select id, kind from mail_log order by id').all()).toEqual([
    { id: 'm0', kind: 'invitation' },
    { id: 'm1', kind: 'invitation' },
  ]);
  db.close();
});
