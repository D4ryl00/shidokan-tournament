import { afterEach, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { ensureInstance, getInstance } from '../../src/server/repositories/instance.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  if (db) closeDb(db);
  if (app) await app.close();
  db = null;
  app = null;
});

test('ensureInstance crée une ligne puis la renvoie identique au second appel, même avec un autre nom', () => {
  db = openDb(tmpDbPath());
  expect(getInstance(db)).toBeNull();
  const first = ensureInstance(db, 'PC-TABLE');
  expect(first.name).toBe('PC-TABLE');
  expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(ensureInstance(db, 'AUTRE')).toEqual(first);
  expect(getInstance(db)).toEqual(first);
});

test("buildApp crée l'identité avec instanceName ; un redémarrage sur la même base garde le même id", async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath, instanceName: 'PC-SALLE' });
  await app.close();
  app = null;
  db = openDb(dbPath);
  const first = getInstance(db)!;
  closeDb(db);
  db = null;
  expect(first.name).toBe('PC-SALLE');
  app = await buildApp({ dbPath, instanceName: 'AUTRE' });
  await app.close();
  app = null;
  db = openDb(dbPath);
  expect(getInstance(db)).toEqual(first);
});
