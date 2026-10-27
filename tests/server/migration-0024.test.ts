import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';

test('migration 0024 : l’adresse unique devient le premier élément de la liste ; sans adresse, liste vide', () => {
  const file = olderDb(23);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}');
    INSERT INTO club_directory (id, name, name_key, coach_email) VALUES ('d1', 'Tani Dojo', 'TANI DOJO', ' coach@tani.fr '), ('d2', 'Budo', 'BUDO', NULL), ('d3', 'Vide', 'VIDE', '  ');
    INSERT INTO clubs (id, competition_id, name, name_key, coach_email, pre_approval, directory_club_id) VALUES
      ('k1', 'c1', 'Tani Dojo', 'TANI DOJO', 'coach@tani.fr', 0, 'd1'), ('k2', 'c1', 'Budo', 'BUDO', NULL, 0, 'd2');
  `);
  raw.close();
  closeDb(openDb(file));
  const db = new Database(file, { readonly: true });
  expect(db.prepare('select id, coach_emails from club_directory order by id').all()).toEqual([
    { id: 'd1', coach_emails: '["coach@tani.fr"]' }, { id: 'd2', coach_emails: '[]' }, { id: 'd3', coach_emails: '[]' },
  ]);
  expect(db.prepare('select id, coach_emails from clubs order by id').all()).toEqual([{ id: 'k1', coach_emails: '["coach@tani.fr"]' }, { id: 'k2', coach_emails: '[]' }]);
  const columns = (t: string) => (db.prepare(`select name from pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name);
  expect(columns('clubs')).not.toContain('coach_email');
  expect(columns('club_directory')).not.toContain('coach_email');
  db.close();
});
