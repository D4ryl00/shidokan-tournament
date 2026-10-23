import fs from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { seedDev } from '../../scripts/seed-dev.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { backupDir } from '../../src/server/repositories/backups.js';
import { buildPackage, importPackage, PACKAGE_TABLES } from '../../src/server/sync/package.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

const opened: AppDb[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) closeDb(d);
});

/** Base avec une compétition de démonstration complétée (résultats, kata, sessions, lancement, réaffectation…). */
async function seeded(): Promise<{ db: AppDb; dbPath: string; id: string }> {
  const dbPath = tmpDbPath();
  const app = await buildApp({ dbPath });
  const { competitionId: id } = await seedDev(app, { seed: 3 });
  await app.close();
  const db = openDb(dbPath);
  opened.push(db);
  const reg = db.$client.prepare('select id, category_id from registrations where competition_id = ? and category_id is not null limit 1').get(id) as { id: string; category_id: string };
  db.$client.exec(`
    INSERT INTO waves (id, competition_id, name, sort_order, rules_json) VALUES ('wave-${id}', '${id}', 'Matin', 0, '{}');
    INSERT INTO wave_launches (competition_id, wave_key, launched, launched_at) VALUES ('${id}', 'wave-${id}', 1, '2026-11-22T09:00:00.000Z');
    INSERT INTO frozen_passages (competition_id, wave_key, zone_id, number, category_id, match_id) VALUES ('${id}', 'wave-${id}', 'z', 1, '${reg.category_id}', 'w1-0');
    INSERT INTO match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b) VALUES ('${id}', '${reg.category_id}', 'w1-0', 'a', 'ko', '${reg.id}', 'x');
    INSERT INTO kata_scores (competition_id, category_id, registration_id, round, notes_json) VALUES ('${id}', '${reg.category_id}', '${reg.id}', 'round1', '[8,8,8]');
    INSERT INTO tie_breaks (competition_id, category_id, scope, order_json) VALUES ('${id}', '${reg.category_id}', 'kata', '[]');
    INSERT INTO recasements (id, competition_id, registration_id, proposal_id, type, from_label, to_label, manual, pre_approved, bulk, snapshot_json) VALUES ('rec-${id}', '${id}', '${reg.id}', 'p1', 'A', 'x', 'y', 0, 0, 0, '{}');
    INSERT INTO refusals (competition_id, proposal_id) VALUES ('${id}', 'p2');
  `);
  return { db, dbPath, id };
}

const IGNORED = new Set(['version', 'updated_at', 'directory_club_id', 'owner_instance_id', 'owner_name', 'owner_since', 'last_sync_at']);
/** Lignes de la compétition, table par table, sans les colonnes propres à l'installation. */
function snapshot(db: AppDb, id: string) {
  const out: Record<string, unknown[]> = {};
  for (const t of PACKAGE_TABLES) {
    const col = t === 'competitions' ? 'id' : 'competition_id';
    const rows = (db.$client.prepare(`select * from "${t}" where ${col} = ?`).all(id) as Record<string, unknown>[]).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => !IGNORED.has(k) && !(t === 'age_links' && k === 'id'))),
    );
    out[t] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

test('aller-retour : une compétition complète construite en A, reçue en B → mêmes données', async () => {
  const a = await seeded();
  const b = await seeded();
  const pkg = buildPackage(a.db, a.id, { handOver: false, role: 'local' });
  expect(pkg.format).toBe('shidokan-competition');
  expect(Object.keys(pkg.tables)).toEqual(expect.arrayContaining(['registrations', 'match_results', 'age_links', 'frozen_passages']));
  expect(pkg.tables.club_invitations).toBeUndefined();
  const res = await importPackage(b.db, b.dbPath, pkg, null);
  expect(res).toEqual({ competitionId: a.id, created: true });
  expect(snapshot(b.db, a.id)).toEqual(snapshot(a.db, a.id));
});

test('recevoir de nouveau après des changements en A → B identique ; une autre compétition de B intacte', async () => {
  const a = await seeded();
  const b = await seeded();
  const otherBefore = snapshot(b.db, b.id);
  const otherLinks = b.db.$client.prepare('select id from age_links where competition_id = ? order by id').all(b.id);
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: false, role: 'local' }), null);
  const victim = a.db.$client.prepare("select id from registrations where competition_id = ? and discipline = 'kata' limit 1").get(a.id) as { id: string };
  a.db.$client.prepare('delete from kata_scores where registration_id = ?').run(victim.id);
  a.db.$client.prepare('delete from registrations where id = ?').run(victim.id);
  a.db.$client.prepare("insert into match_results (competition_id, category_id, match_id, winner, method, entrant_a, entrant_b) values (?, 'c2', 'w1-1', 'b', 'points', 'x', 'y')").run(a.id);
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: false, role: 'local' }), null);
  expect(snapshot(b.db, a.id)).toEqual(snapshot(a.db, a.id));
  expect(snapshot(b.db, b.id)).toEqual(otherBefore);
  expect(b.db.$client.prepare('select id from age_links where competition_id = ? order by id').all(b.id)).toEqual(otherLinks);
});

test('retour sur une installation qui a des liens et des mails : ils restent ; un club absent mais avec un lien reste', async () => {
  const a = await seeded();
  const b = await seeded();
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: false, role: 'local' }), null);
  const club = b.db.$client.prepare('select id from clubs where competition_id = ? limit 1').get(a.id) as { id: string };
  b.db.$client.prepare("insert into club_invitations (id, competition_id, club_id, token_hash) values ('inv', ?, ?, 'h')").run(a.id, club.id);
  b.db.$client.prepare("insert into mail_log (id, competition_id, club_id, email, status) values ('m', ?, ?, 'x@example.org', 'sent')").run(a.id, club.id);
  b.db.$client.prepare("insert into clubs (id, competition_id, name, name_key, pre_approval) values ('club-serveur', ?, 'Club invité', 'CLUB INVITE', 0)").run(a.id);
  b.db.$client.prepare("insert into club_invitations (id, competition_id, club_id, token_hash) values ('inv2', ?, 'club-serveur', 'h2')").run(a.id);
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: true, role: 'local' }), null);
  expect(b.db.$client.prepare('select id from club_invitations where competition_id = ? order by id').all(a.id)).toEqual([{ id: 'inv' }, { id: 'inv2' }]);
  expect(b.db.$client.prepare('select count(*) as n from mail_log where competition_id = ?').get(a.id)).toEqual({ n: 1 });
  expect(b.db.$client.prepare("select count(*) as n from clubs where id = 'club-serveur'").get()).toEqual({ n: 1 });
});

test('paquet piégé (une ligne d’une autre compétition) → 400, rien n’est écrit', async () => {
  const a = await seeded();
  const b = await seeded();
  const pkg = buildPackage(a.db, a.id, { handOver: false, role: 'local' });
  const foreign = b.db.$client.prepare('select * from registrations where competition_id = ? limit 1').get(b.id) as Record<string, unknown>;
  pkg.tables.registrations!.push({ ...foreign, competition_id: a.id, presence: 'absent' });
  const before = snapshot(b.db, b.id);
  await expect(importPackage(b.db, b.dbPath, pkg, null)).rejects.toThrow('Paquet invalide : des données appartiennent à une autre compétition.');
  expect(snapshot(b.db, b.id)).toEqual(before);
  expect(b.db.$client.prepare('select count(*) as n from competitions where id = ?').get(a.id)).toEqual({ n: 0 });
});

test('format inconnu → 400 ; migrations supérieures → 400', async () => {
  const a = await seeded();
  const b = await seeded();
  await expect(importPackage(b.db, b.dbPath, { hello: 1 }, null)).rejects.toThrow('Ce fichier n’est pas une compétition exportée par l’application.');
  const pkg = buildPackage(a.db, a.id, { handOver: false, role: 'local' });
  await expect(importPackage(b.db, b.dbPath, { ...pkg, migrations: pkg.migrations + 1 }, null)).rejects.toThrow(
    'Ce paquet vient d’une version plus récente de l’application : mettez cette installation à jour.',
  );
});

test('annuaire : fiche reçue de même numéro qu’une fiche locale → club relié à la fiche locale, non écrasée', async () => {
  const a = await seeded();
  const b = await seeded();
  const club = a.db.$client.prepare('select id, directory_club_id as d from clubs where competition_id = ? limit 1').get(a.id) as { id: string; d: string };
  a.db.$client.prepare("update club_directory set affiliation_number = '0060893', coach_phone = '01' where id = ?").run(club.d);
  b.db.$client.prepare("insert into club_directory (id, name, name_key, affiliation_number, coach_phone) values ('local-entry', 'Tani', 'TANI', '0060893', '02')").run();
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: false, role: 'local' }), null);
  expect(b.db.$client.prepare('select directory_club_id as d from clubs where id = ?').get(club.id)).toEqual({ d: 'local-entry' });
  expect(b.db.$client.prepare("select coach_phone from club_directory where id = 'local-entry'").get()).toEqual({ coach_phone: '02' });
  // Les autres clubs : fiches inconnues de B → ajoutées.
  expect((b.db.$client.prepare('select count(*) as n from clubs where competition_id = ? and directory_club_id is null').get(a.id) as { n: number }).n).toBe(0);
});

test('sauvegarde avant la réception ; owner → owner_name, owner_since, last_sync_at', async () => {
  const a = await seeded();
  const b = await seeded();
  const files = () => (fs.existsSync(backupDir(b.dbPath)) ? fs.readdirSync(backupDir(b.dbPath)).length : 0);
  const before = files();
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: false, role: 'serveur' }), { id: 'srv', name: 'le serveur en ligne' }, new Date('2026-11-21T10:00:00Z'));
  expect(files()).toBe(before + 1);
  expect(b.db.$client.prepare('select owner_instance_id, owner_name, owner_since, last_sync_at from competitions where id = ?').get(a.id)).toEqual({
    owner_instance_id: 'srv', owner_name: 'le serveur en ligne', owner_since: '2026-11-21T10:00:00.000Z', last_sync_at: '2026-11-21T10:00:00.000Z',
  });
  await importPackage(b.db, b.dbPath, buildPackage(a.db, a.id, { handOver: true, role: 'serveur' }), null, new Date('2026-11-21T11:00:00Z'));
  expect(b.db.$client.prepare('select owner_instance_id, owner_name from competitions where id = ?').get(a.id)).toEqual({ owner_instance_id: null, owner_name: null });
});

test('règle de garde : chaque table de compétition voyage ou reste explicitement', async () => {
  const { unclassifiedTables } = await import('../../src/server/sync/package.js');
  const a = await seeded();
  expect(unclassifiedTables(a.db)).toEqual([]);
});
