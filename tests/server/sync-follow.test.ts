import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { competitionFingerprint } from '../../src/server/sync/package.js';
import { followOnce } from '../../src/server/sync/follow.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let server: FastifyInstance;
let pc: FastifyInstance;
let serverPath: string;
let pcPath: string;
let pcDb: AppDb;
let cookie: string;
let id: string;

beforeEach(async () => {
  serverPath = tmpDbPath();
  const d = openDb(serverPath);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  server = await buildApp({ dbPath: serverPath, role: 'serveur', publicUrl: 'https://competitions.example.org', instanceName: 'SERVEUR' });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const serverUrl = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
  cookie = String((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
  id = (await orga('POST', '/api/competitions', { name: 'Coupe en ligne', date: '2026-11-22' })).json().id;
  const token = (await orga('POST', '/api/sync/tokens', { name: 'PC' })).json().token as string;
  pcPath = tmpDbPath();
  pc = await buildApp({ dbPath: pcPath, instanceName: 'PC-SALLE' });
  await pc.inject({ method: 'PATCH', url: '/api/sync/settings', payload: { url: serverUrl, token } });
  pcDb = openDb(pcPath);
});
afterEach(async () => {
  closeDb(pcDb);
  await pc.close();
  await server.close();
});

function orga(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) {
  return server.inject({ method, url, headers: { cookie }, payload: payload as object });
}
const local = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) => pc.inject({ method, url, payload: payload as object });
const serverFingerprint = () => {
  const db = openDb(serverPath);
  try {
    return competitionFingerprint(db, id);
  } finally {
    closeDb(db);
  }
};
const storedFingerprint = () => (pcDb.$client.prepare('select server_fingerprint as f from competitions where id = ?').get(id) as { f: string | null }).f;
const register = (lastName: string) =>
  orga('POST', `/api/competitions/${id}/registrations`, { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' });
const pcNames = async () => ((await local('GET', `/api/competitions/${id}/registrations`)).json() as { fighter: { lastName: string } }[]).map((r) => r.fighter.lastName).sort();

test('empreinte : stable à la relecture ; change après une écriture ; ne change pas quand la main change', async () => {
  const first = serverFingerprint();
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(serverFingerprint()).toBe(first);
  await register('DURAND');
  const afterWrite = serverFingerprint();
  expect(afterWrite).not.toBe(first);
  expect((await local('POST', '/api/sync/pull', { competitionId: id, take: true })).statusCode).toBe(200);
  expect(serverFingerprint()).toBe(afterWrite);
});

test('récupérer une copie : le PC retient l’empreinte de la version du serveur', async () => {
  await register('DURAND');
  expect((await local('POST', '/api/sync/pull', { competitionId: id, take: false })).statusCode).toBe(200);
  expect(storedFingerprint()).toBe(serverFingerprint());
});

test('copie à jour : une écriture faite en ligne arrive dans la copie du PC', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  expect((await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 })).statusCode).toBe(200);
  await register('MARTIN');
  expect(await followOnce(pcDb, pcPath)).toEqual({ ok: true });
  expect(await pcNames()).toEqual(['MARTIN']);
  expect(storedFingerprint()).toBe(serverFingerprint());
  const status = (await local('GET', '/api/sync/follow')).json();
  expect(status).toMatchObject({ competitionId: id, intervalMin: 5, lastError: null });
  expect(status.lastSuccessAt).not.toBeNull();
  expect((await local('GET', `/api/competitions/${id}/management`)).json()).toMatchObject({ managedHere: false, copyOfServer: true });
});

test('copie à jour quand le PC a la main : rien n’est récupéré, son travail reste', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 });
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  const res = await followOnce(pcDb, pcPath);
  expect(res).toEqual({ error: 'Ce PC a la main : la copie n’est plus mise à jour.' });
  expect((await local('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase');
  expect((await local('GET', '/api/sync/follow')).json().lastError).toBe('Ce PC a la main : la copie n’est plus mise à jour.');
});

test('serveur injoignable : erreur notée, la copie reste lisible', async () => {
  await register('DURAND');
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 });
  await server.close();
  const res = await followOnce(pcDb, pcPath);
  expect('error' in res && res.error).toMatch(/^Serveur injoignable : /);
  expect(await pcNames()).toEqual(['DURAND']);
  server = await buildApp({ dbPath: tmpDbPath() });
});

test('réglage : intervalle de 1 à 60 minutes ; null arrête', async () => {
  expect((await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 0 })).statusCode).toBe(400);
  expect((await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 61 })).statusCode).toBe(400);
  expect((await local('PUT', '/api/sync/follow', null)).statusCode).toBe(200);
  expect((await local('GET', '/api/sync/follow')).json()).toMatchObject({ competitionId: null });
  expect(await followOnce(pcDb, pcPath)).toEqual({ error: 'Aucune copie à tenir à jour.' });
});
