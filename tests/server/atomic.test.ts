import { expect, test } from 'vitest';
import { atomically, dryRun } from '../../src/server/db/atomic.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDir } from '../helpers/tmp-db.js';
import path from 'node:path';

function setup() {
  const db = openDb(path.join(tmpDir('atomic-'), 'a.sqlite'));
  db.$client.exec('CREATE TABLE t (n integer)');
  const count = () => (db.$client.prepare('select count(*) c from t').get() as { c: number }).c;
  const add = () => db.$client.exec('INSERT INTO t VALUES (1)');
  return { db, count, add };
}

test('une erreur annule les écritures', async () => {
  const { db, count, add } = setup();
  await expect(atomically(db, async () => { add(); throw new Error('boum'); })).rejects.toThrow('boum');
  expect(count()).toBe(0);
  expect(db.$client.inTransaction).toBe(false);
  closeDb(db);
});

test('succès : commit et valeur rendue', async () => {
  const { db, count, add } = setup();
  expect(await atomically(db, async () => { add(); return 7; })).toBe(7);
  expect(count()).toBe(1);
  closeDb(db);
});

test('imbriqué : ne commite pas l’extérieur', async () => {
  const { db, count, add } = setup();
  await expect(atomically(db, async () => { await atomically(db, async () => add()); expect(db.$client.inTransaction).toBe(true); throw new Error('x'); })).rejects.toThrow('x');
  expect(count()).toBe(0);
  closeDb(db);
});

test('dryRun rend la valeur et n’écrit rien, seul ou dans atomically', async () => {
  const { db, count, add } = setup();
  expect(await dryRun(db, async () => { add(); return 'v'; })).toBe('v');
  expect(count()).toBe(0);
  await atomically(db, async () => {
    add();
    expect(await dryRun(db, async () => { add(); return count(); })).toBe(2);
    expect(count()).toBe(1);
  });
  expect(count()).toBe(1);
  closeDb(db);
});

test('dryRun relance l’erreur de fn et laisse la base intacte', async () => {
  const { db, count, add } = setup();
  await expect(dryRun(db, async () => { add(); throw new Error('e'); })).rejects.toThrow('e');
  expect(count()).toBe(0);
  expect(db.$client.inTransaction).toBe(false);
  closeDb(db);
});
