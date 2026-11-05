import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0030 : un club qui a un lien actif reste invité, à la date de son plus ancien lien actif ; les autres non', () => {
  const file = olderDb(29);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO clubs (id, competition_id, name, name_key, pre_approval) VALUES
      ('k1', 'c1', 'Avec liens', 'AVEC LIENS', 0), ('k2', 'c1', 'Liens retirés', 'LIENS RETIRES', 0), ('k3', 'c1', 'Jamais invité', 'JAMAIS INVITE', 0);
    INSERT INTO club_invitations (id, competition_id, club_id, token_hash, created_at, revoked_at) VALUES
      ('l0', 'c1', 'k1', 'h0', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('l1', 'c1', 'k1', 'h1', '2026-02-01T00:00:00.000Z', NULL),
      ('l2', 'c1', 'k1', 'h2', '2026-03-01T00:00:00.000Z', NULL),
      ('l3', 'c1', 'k2', 'h3', '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
  `);
  raw.close();
  closeDb(openDb(file));
  const db = new Database(file, { readonly: true });
  expect(db.prepare('select id, invited_at from clubs order by id').all()).toEqual([
    { id: 'k1', invited_at: '2026-02-01T00:00:00.000Z' }, { id: 'k2', invited_at: null }, { id: 'k3', invited_at: null },
  ]);
  expect((db.prepare('select count(*) as n from club_invitations').get() as { n: number }).n).toBe(4);
  db.close();
});
