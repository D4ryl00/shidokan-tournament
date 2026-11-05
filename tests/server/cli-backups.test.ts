import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let dbPath: string;
let db: AppDb;
beforeEach(() => {
  dbPath = tmpDbPath();
  db = openDb(dbPath);
  db.$client.prepare("insert into competitions (id, name, date, settings_json) values ('c1', 'Avant', '2026-11-22', '{}')").run();
  closeDb(db);
});
afterEach(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const cli = (...args: string[]) =>
  spawnSync('npx', ['tsx', 'src/server/cli.ts', ...args], { encoding: 'utf8', env: { ...process.env, DATABASE_PATH: dbPath }, input: '' });
const competitions = () => {
  const r = new Database(dbPath, { readonly: true });
  const names = (r.prepare('select name from competitions order by name').all() as { name: string }[]).map((c) => c.name);
  r.close();
  return names;
};

test('sauvegarder, lister, restaurer par son nom ; sans confirmation, rien ne change ; une copie est faite avant', { timeout: 120_000 }, () => {
  const made = cli('backup');
  expect(made.status).toBe(0);
  const name = path.basename(made.stdout.match(/Sauvegarde faite : (.+)/)![1]!.trim());
  expect(cli('list-backups').stdout).toContain(name);

  const raw = new Database(dbPath);
  raw.prepare("insert into competitions (id, name, date, settings_json) values ('c2', 'Après', '2026-11-22', '{}')").run();
  raw.close();

  const refused = cli('restore', name);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('Restauration annulée');
  expect(competitions()).toEqual(['Après', 'Avant']);

  const done = cli('restore', name, '--oui');
  expect(done.status).toBe(0);
  expect(done.stdout).toContain('docker compose restart app');
  expect(competitions()).toEqual(['Avant']);
  expect(cli('list-backups').stdout.trim().split('\n')).toHaveLength(2);
});

test('restaurer par un chemin ; fichier absent ou qui n’est pas une sauvegarde : refus, rien ne change', { timeout: 120_000 }, () => {
  expect(cli('restore', '/chemin/absent.sqlite', '--oui').status).toBe(1);
  const notBackup = path.join(path.dirname(dbPath), 'faux.sqlite');
  fs.writeFileSync(notBackup, 'pas une base');
  const refused = cli('restore', notBackup, '--oui');
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('n\'est pas une sauvegarde');
  expect(competitions()).toEqual(['Avant']);

  const copy = path.join(path.dirname(dbPath), 'copie.sqlite');
  fs.copyFileSync(dbPath, copy);
  const raw = new Database(dbPath);
  raw.prepare("update competitions set name = 'Modifiée'").run();
  raw.close();
  expect(cli('restore', copy, '--oui').status).toBe(0);
  expect(competitions()).toEqual(['Avant']);
});
