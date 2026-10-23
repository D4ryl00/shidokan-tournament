import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { backupDir } from '../../src/server/repositories/backups.js';
import { mirrorOnce } from '../../src/server/mirror.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let main: FastifyInstance;
let mainUrl: string;
let second: FastifyInstance;
let secondPath: string;
beforeEach(async () => {
  main = await buildApp({ dbPath: tmpDbPath(), instanceName: 'PC-PRINCIPAL' });
  await main.listen({ port: 0, host: '127.0.0.1' });
  mainUrl = `http://127.0.0.1:${(main.server.address() as { port: number }).port}`;
  await main.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe du principal', date: '2026-11-22' } });
  secondPath = tmpDbPath();
  second = await buildApp({ dbPath: secondPath, instanceName: 'PC-SECOURS' });
});
afterEach(async () => {
  await second.close();
  await main.close();
});

const copiesDir = () => path.join(backupDir(secondPath), 'copies');
const setMirror = (url: string | null) => second.inject({ method: 'PUT', url: '/api/mirror', payload: { url, intervalMin: 5 } });
const withDb = async <T>(fn: (db: ReturnType<typeof openDb>) => Promise<T>) => {
  const db = openDb(secondPath);
  try {
    return await fn(db);
  } finally {
    closeDb(db);
  }
};

test('copie écrite sous sauvegardes/copies, lisible ; état renvoyé par GET /api/mirror', async () => {
  expect((await setMirror(mainUrl)).statusCode).toBe(200);
  const res = await withDb((db) => mirrorOnce(db, secondPath));
  expect(res).toEqual({ file: expect.stringMatching(/^copie-\d{8}-\d{6}\.sqlite$/) });
  const file = path.join(copiesDir(), (res as { file: string }).file);
  expect(fs.readFileSync(file).subarray(0, 15).toString()).toBe('SQLite format 3');
  const list = (await second.inject({ method: 'GET', url: '/api/mirror/copies' })).json();
  expect(list).toEqual([expect.objectContaining({ name: (res as { file: string }).file })]);
});

test('PC principal éteint → erreur notée, aucun fichier ; pas de fichier provisoire laissé', async () => {
  await setMirror(mainUrl);
  await main.close();
  const res = await withDb((db) => mirrorOnce(db, secondPath));
  expect(res).toEqual({ error: expect.stringMatching(/injoignable/) });
  expect(fs.existsSync(copiesDir()) ? fs.readdirSync(copiesDir()) : []).toEqual([]);
  main = await buildApp({ dbPath: tmpDbPath() });
});

test('100 copies au plus', async () => {
  await setMirror(mainUrl);
  fs.mkdirSync(copiesDir(), { recursive: true });
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(copiesDir(), `copie-20260101-${String(100000 + i)}.sqlite`), 'x');
  await withDb((db) => mirrorOnce(db, secondPath));
  const files = fs.readdirSync(copiesDir());
  expect(files).toHaveLength(100);
  expect(files).not.toContain('copie-20260101-100000.sqlite');
});

test('restaurer une copie : les compétitions du PC principal arrivent, gérées ici', async () => {
  await setMirror(mainUrl);
  const { file } = (await withDb((db) => mirrorOnce(db, secondPath))) as { file: string };
  expect((await second.inject({ method: 'POST', url: `/api/mirror/copies/${file}/restore` })).statusCode).toBe(204);
  const list = (await second.inject({ method: 'GET', url: '/api/competitions' })).json() as { id: string; name: string }[];
  expect(list.map((c) => c.name)).toContain('Coupe du principal');
  const id = list.find((c) => c.name === 'Coupe du principal')!.id;
  expect((await second.inject({ method: 'GET', url: `/api/competitions/${id}/management` })).json()).toMatchObject({ managedHere: true });
});

test('nom de copie inconnu ou avec ../ → 404', async () => {
  expect((await second.inject({ method: 'POST', url: '/api/mirror/copies/inconnue.sqlite/restore' })).statusCode).toBe(404);
  expect((await second.inject({ method: 'POST', url: '/api/mirror/copies/..%2F..%2Fx/restore' })).statusCode).toBe(404);
});

test('réglage absent en rôle serveur', async () => {
  const p = tmpDbPath();
  const d = openDb(p);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  const srv = await buildApp({ dbPath: p, role: 'serveur' });
  const cookie = String((await srv.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
  expect((await srv.inject({ method: 'PUT', url: '/api/mirror', headers: { cookie }, payload: { url: mainUrl, intervalMin: 5 } })).statusCode).toBe(404);
  await srv.close();
});
