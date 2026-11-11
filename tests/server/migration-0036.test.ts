import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { launchStatus } from '../../src/server/repositories/launches.js';
import { buildPackage, importPackage, PACKAGE_TABLES } from '../../src/server/sync/package.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';
import { mainCompetition } from '../helpers/zones-fixture.js';

const settings = (s: object) => JSON.stringify(s).replaceAll("'", "''");

test('migration 0036 : zone des finales par session et choix des katas repris des réglages', () => {
  const file = olderDb(35);
  const raw = new Database(file);
  raw.exec(`
    INSERT INTO competitions (id, name, date, settings_json) VALUES
      ('c1', 'Deux sessions', '2026-11-22', '${settings({ finalsZoneId: 'z2', kataFinalsOnFinalsZone: false })}'),
      ('c2', 'Sans session', '2026-11-22', '${settings({ finalsZoneId: 'y1' })}'),
      ('c3', 'Zone inconnue', '2026-11-22', '${settings({ finalsZoneId: 'disparue' })}'),
      ('c4', 'Sans zone des finales', '2026-11-22', '${settings({ finalsZoneId: null })}'),
      ('c5', 'Katas sur la zone des finales', '2026-11-22', '${settings({ finalsZoneId: 'x1', kataFinalsOnFinalsZone: true })}');
    INSERT INTO zones (id, competition_id, name, sort_order) VALUES
      ('z1', 'c1', 'Tatami 1', 0), ('z2', 'c1', 'Tatami 2', 1), ('y1', 'c2', 'Tatami 1', 0), ('x1', 'c5', 'Tatami 1', 0), ('w1', 'c4', 'Tatami 1', 0);
    INSERT INTO waves (id, competition_id, name, sort_order, rules_json) VALUES
      ('matin', 'c1', 'Matin', 0, '{}'), ('aprem', 'c1', 'Après-midi', 1, '{}'), ('c3-matin', 'c3', 'Matin', 0, '{}');
    INSERT INTO categories (id, competition_id, key_string, key_json, label, seed) VALUES
      ('c1-kata', 'c1', 'k1', '{"discipline":"kata"}', 'Kata', 1),
      ('c1-combat', 'c1', 'k2', '{"discipline":"karate"}', 'Combat', 1),
      ('c2-kata', 'c2', 'k1', '{"discipline":"kata"}', 'Kata', 1),
      ('c4-kata', 'c4', 'k1', '{"discipline":"kata"}', 'Kata', 1),
      ('c5-kata', 'c5', 'k1', '{"discipline":"kata"}', 'Kata', 1);
    INSERT INTO frozen_passages (competition_id, wave_key, zone_id, number, category_id, match_id) VALUES ('c1', 'matin', 'z1', 1, 'c1-combat', 'w1-0');
  `);
  raw.close();
  closeDb(openDb(file));
  const check = new Database(file, { readonly: true });
  expect(check.prepare('select competition_id, wave_key, finals_zone_id, where_default, when_default from wave_finals order by competition_id, wave_key').all()).toEqual([
    { competition_id: 'c1', wave_key: 'aprem', finals_zone_id: 'z2', where_default: null, when_default: null },
    { competition_id: 'c1', wave_key: 'matin', finals_zone_id: 'z2', where_default: null, when_default: null },
    { competition_id: 'c2', wave_key: '', finals_zone_id: 'y1', where_default: null, when_default: null },
    { competition_id: 'c5', wave_key: '', finals_zone_id: 'x1', where_default: null, when_default: null },
  ]);
  expect(check.prepare('select id, finals_where, finals_when from categories order by id').all()).toEqual([
    { id: 'c1-combat', finals_where: null, finals_when: null },
    { id: 'c1-kata', finals_where: 'own', finals_when: 'ready' },
    // « kataFinalsOnFinalsZone » absent : comme décoché : un kata reste un bloc unique sur sa zone.
    { id: 'c2-kata', finals_where: 'own', finals_when: 'ready' },
    // Sans zone des finales : les valeurs par défaut font déjà le bloc unique.
    { id: 'c4-kata', finals_where: null, finals_when: null },
    { id: 'c5-kata', finals_where: null, finals_when: null },
  ]);
  expect(check.prepare('select category_id, finals_choice from frozen_passages').all()).toEqual([{ category_id: 'c1-combat', finals_choice: null }]);
  check.close();
});

/**
 * Copie une compétition d'une base à jour dans une base au niveau 35 (colonnes communes des tables qui voyagent), comme si
 * elle avait été préparée et figée par la version d'avant.
 */
function asStep35(source: string, competitionId: string): string {
  const file = olderDb(35);
  const raw = new Database(file);
  raw.exec(`ATTACH DATABASE '${source.replaceAll("'", "''")}' AS src`);
  const cols = (schema: string, t: string) => (raw.prepare(`select name from pragma_table_info('${t}', '${schema}')`).all() as { name: string }[]).map((c) => c.name);
  raw.transaction(() => {
    for (const t of PACKAGE_TABLES) {
      const common = cols('main', t).filter((c) => cols('src', t).includes(c));
      if (common.length === 0) continue;
      const list = common.map((c) => `"${c}"`).join(', ');
      raw.prepare(`insert into main."${t}" (${list}) select ${list} from src."${t}" where ${t === 'competitions' ? 'id' : 'competition_id'} = ?`).run(competitionId);
    }
  })();
  raw.exec('DETACH DATABASE src');
  raw.close();
  return file;
}

test('migration 0036 : une session figée avant la migration garde ses numéros, rien à numéroter', async () => {
  // Figée comme avec les réglages d'avant : finales de combat sur Tatami 2, kata en bloc unique sur sa zone.
  const f = await mainCompetition({ finalsOnT2: true });
  const numbers = (d: Database.Database) => d.prepare('select category_id, match_id, zone_id, number from frozen_passages order by zone_id, number').all();
  const db = openDb(f.mainPath);
  const before = numbers(db.$client);
  closeDb(db);
  await f.main.close();
  expect(before.length).toBeGreaterThan(0);

  const file = asStep35(f.mainPath, f.id);
  const raw = new Database(file);
  raw.prepare('update competitions set settings_json = ? where id = ?').run(JSON.stringify({ finalsZoneId: f.t2, kataFinalsOnFinalsZone: false }), f.id);
  raw.close();
  const migrated = openDb(file);
  try {
    expect(numbers(migrated.$client)).toEqual(before);
    const status = await launchStatus(migrated, f.id, f.matinId);
    expect(status.state).toBe('launched');
    expect(status.pending).toEqual([]);
  } finally {
    closeDb(migrated);
  }
});

/** Compétitions de la même forme que celle de la migration : mêmes ids, mêmes réglages. */
const PARITY_SQL = `
  INSERT INTO competitions (id, name, date, settings_json) VALUES
    ('c1', 'Deux sessions', '2026-11-22', '${settings({ finalsZoneId: 'z2', kataFinalsOnFinalsZone: false })}'),
    ('c2', 'Sans session', '2026-11-22', '${settings({ finalsZoneId: 'y1' })}'),
    ('c3', 'Zone inconnue', '2026-11-22', '${settings({ finalsZoneId: 'disparue' })}'),
    ('c5', 'Katas sur la zone des finales', '2026-11-22', '${settings({ finalsZoneId: 'x1', kataFinalsOnFinalsZone: true })}');
  INSERT INTO zones (id, competition_id, name, sort_order) VALUES ('z1', 'c1', 'Tatami 1', 0), ('z2', 'c1', 'Tatami 2', 1), ('y1', 'c2', 'Tatami 1', 0), ('x1', 'c5', 'Tatami 1', 0);
  INSERT INTO waves (id, competition_id, name, sort_order, rules_json) VALUES ('matin', 'c1', 'Matin', 0, '{}'), ('aprem', 'c1', 'Après-midi', 1, '{}'), ('c3-matin', 'c3', 'Matin', 0, '{}');
  INSERT INTO categories (id, competition_id, key_string, key_json, label, seed) VALUES
    ('c1-kata', 'c1', 'k1', '{"discipline":"kata"}', 'Kata', 1), ('c1-combat', 'c1', 'k2', '{"discipline":"karate"}', 'Combat', 1),
    ('c2-kata', 'c2', 'k1', '{"discipline":"kata"}', 'Kata', 1), ('c5-kata', 'c5', 'k1', '{"discipline":"kata"}', 'Kata', 1);`;

const finalsState = (d: Database.Database) => ({
  waveFinals: d.prepare('select competition_id, wave_key, finals_zone_id, where_default, when_default from wave_finals order by competition_id, wave_key').all(),
  categories: d.prepare('select id, finals_where, finals_when from categories order by id').all(),
});

test('migration 0036 et paquet d’avant : même reprise des anciens réglages', async () => {
  // Par la migration.
  const old = olderDb(35);
  const raw = new Database(old);
  raw.exec(PARITY_SQL);
  raw.close();
  closeDb(openDb(old));
  const viaMigration = new Database(old, { readonly: true });
  const expected = finalsState(viaMigration);
  viaMigration.close();
  expect(expected.waveFinals).toHaveLength(4);

  // Par l'import d'un paquet sans `wave_finals`, compétition par compétition, dans une base à jour.
  const current = tmpDbPath();
  const db = openDb(current);
  try {
    for (const id of ['c1', 'c2', 'c3', 'c5']) {
      const source = openDb(tmpDbPath());
      try {
        source.$client.exec(PARITY_SQL);
        const pkg = buildPackage(source, id, { handOver: false, role: 'local' });
        delete pkg.tables.wave_finals;
        await importPackage(db, current, pkg, null, new Date(), { backup: false });
      } finally {
        closeDb(source);
      }
    }
    expect(finalsState(db.$client)).toEqual(expected);
  } finally {
    closeDb(db);
  }
});
