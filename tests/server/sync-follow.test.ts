import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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

test('empreinte : stable à la relecture ; change après une écriture, et quand les inscriptions en ligne s’ouvrent', async () => {
  const first = serverFingerprint();
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(serverFingerprint()).toBe(first);
  await register('DURAND');
  const afterWrite = serverFingerprint();
  expect(afterWrite).not.toBe(first);
  expect((await orga('PATCH', `/api/competitions/${id}/club-entry`, { status: 'open' })).statusCode).toBe(200);
  expect(serverFingerprint()).not.toBe(afterWrite);
});

test('prise de main puis retour : le PC retient chaque fois l’empreinte du serveur', async () => {
  await register('DURAND');
  expect((await local('POST', '/api/sync/pull', { competitionId: id, take: true })).statusCode).toBe(200);
  expect(storedFingerprint()).toBe(serverFingerprint());
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  expect((await local('POST', `/api/competitions/${id}/sync/return`)).statusCode).toBe(204);
  expect(storedFingerprint()).toBe(serverFingerprint());
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

/** Les réponses du serveur sont retenues jusqu'à `release()` (la requête, elle, est déjà traitée par le serveur). */
function holdResponses() {
  const real = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const res = await real(...args);
    await gate;
    return res;
  });
  return () => {
    release();
    spy.mockRestore();
  };
}
const tick = () => new Promise((r) => setTimeout(r, 100));

test('copie à jour en cours quand le PC prend la main en secours : la réponse arrivée après n’écrase rien', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 });
  await register('MARTIN');
  const release = holdResponses();
  const running = followOnce(pcDb, pcPath);
  await tick();
  expect((await local('POST', `/api/competitions/${id}/sync/rescue`)).statusCode).toBe(204);
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  release();
  expect(await running).toEqual({ error: 'Ce PC a la main : la copie n’est plus mise à jour.' });
  expect((await local('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase');
  expect((await local('GET', `/api/competitions/${id}/management`)).json()).toMatchObject({ managedHere: true });
});

test('« Rendre la main » en cours puis refusé : la copie à jour ne passe pas entre les deux, le travail du PC reste', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 });
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  // Un organisateur a repris la main en ligne : le retour du PC sera refusé.
  expect((await orga('POST', `/api/competitions/${id}/take-back`, { source: 'server' })).statusCode).toBe(204);
  const release = holdResponses();
  const returning = local('POST', `/api/competitions/${id}/sync/return`);
  await tick();
  const follow = followOnce(pcDb, pcPath);
  await tick();
  release();
  expect((await returning).statusCode).toBe(409);
  expect('error' in (await follow)).toBe(true);
  expect((await local('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase');
  expect((await local('GET', `/api/competitions/${id}/management`)).json()).toMatchObject({ managedHere: true });
});

test('nouveau réglage pendant une mise à jour : pas de seconde mise à jour en même temps', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 });
  const release = holdResponses();
  const first = followOnce(pcDb, pcPath);
  await tick();
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 10 });
  expect(await followOnce(pcDb, pcPath)).toEqual({ error: 'Une mise à jour est déjà en cours.' });
  release();
  expect(await first).toEqual({ ok: true });
});

test('compétition absente de ce PC : message clair', async () => {
  await local('PUT', '/api/sync/follow', { competitionId: id, intervalMin: 5 });
  expect(await followOnce(pcDb, pcPath)).toEqual({ error: 'Cette compétition n’est pas sur ce PC : récupérez-en d’abord une copie.' });
});
