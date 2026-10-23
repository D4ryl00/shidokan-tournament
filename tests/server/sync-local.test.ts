import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let server: FastifyInstance;
let pc: FastifyInstance;
let serverUrl: string;
let cookie: string;
let id: string;

beforeEach(async () => {
  const sp = tmpDbPath();
  const d = openDb(sp);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  server = await buildApp({ dbPath: sp, role: 'serveur', publicUrl: 'https://competitions.example.org', instanceName: 'SERVEUR' });
  await server.listen({ port: 0, host: '127.0.0.1' });
  serverUrl = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
  cookie = String((await server.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
  id = (await orga('POST', '/api/competitions', { name: 'Coupe en ligne', date: '2026-11-22' })).json().id;
  await orga('POST', `/api/competitions/${id}/clubs`, { name: 'Tani Dojo' });
  const token = (await orga('POST', '/api/sync/tokens', { name: 'PC' })).json().token as string;
  pc = await buildApp({ dbPath: tmpDbPath(), instanceName: 'PC-SALLE' });
  await pc.inject({ method: 'PATCH', url: '/api/sync/settings', payload: { url: serverUrl, token } });
});
afterEach(async () => {
  await pc.close();
  await server.close();
});

function orga(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  return server.inject({ method, url, headers: { cookie }, payload: payload as object });
}
const local = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => pc.inject({ method, url, payload: payload as object });
const management = async (a: FastifyInstance, h: Record<string, string> = {}) => (await a.inject({ method: 'GET', url: `/api/competitions/${id}/management`, headers: h })).json();

test('réglages : le jeton n’est jamais renvoyé', async () => {
  const s = await local('GET', '/api/sync/settings');
  expect(s.json()).toEqual({ url: serverUrl, hasToken: true });
  expect(s.body).not.toContain('token":');
});

test('liste des compétitions du serveur ; récupérer une copie → lecture seule sur le PC', async () => {
  expect((await local('GET', '/api/sync/server-competitions')).json()).toEqual([expect.objectContaining({ id, name: 'Coupe en ligne', managedHere: true })]);
  expect((await local('POST', '/api/sync/pull', { competitionId: id, take: false })).statusCode).toBe(200);
  expect(await management(pc)).toMatchObject({ managedHere: false, copyOfServer: true, ownerName: 'le serveur en ligne' });
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Nice' })).statusCode).toBe(409);
  expect(await management(server, { cookie })).toMatchObject({ managedHere: true });
});

test('prendre la main, saisir sur le PC, envoyer une copie, rendre la main', async () => {
  expect((await local('POST', '/api/sync/pull', { competitionId: id, take: true })).statusCode).toBe(200);
  expect(await management(pc)).toMatchObject({ managedHere: true });
  expect(await management(server, { cookie })).toMatchObject({ managedHere: false, ownerName: 'PC-SALLE' });
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  // Le PC a la main : récupérer de nouveau depuis le serveur écraserait son travail.
  expect((await local('POST', '/api/sync/pull', { competitionId: id, take: false })).statusCode).toBe(409);
  expect((await local('POST', `/api/competitions/${id}/sync/copy`)).statusCode).toBe(200);
  expect((await orga('GET', `/api/competitions/${id}/received-copies`)).json()).toHaveLength(1);
  expect((await local('POST', `/api/competitions/${id}/sync/return`)).statusCode).toBe(204);
  expect(await management(server, { cookie })).toMatchObject({ managedHere: true });
  expect((await orga('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase');
  expect(await management(pc)).toMatchObject({ managedHere: false, copyOfServer: true });
});

test('après une reprise forcée du serveur : rendre la main → 409 relayé ; export en fichier toujours possible', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  await orga('POST', `/api/competitions/${id}/take-back`, { source: 'server' });
  const res = await local('POST', `/api/competitions/${id}/sync/return`);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Ce PC n’a pas la main sur cette compétition : exportez-la en fichier et demandez à un organisateur de l’importer en ligne.');
  expect((await local('GET', `/api/competitions/${id}/export.json`)).statusCode).toBe(200);
});

test('fichier : export puis import ; confirmations replace et takeOver', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  await local('PATCH', `/api/competitions/${id}`, { location: 'Salle du PC' });
  const file = (await local('GET', `/api/competitions/${id}/export.json`)).json();
  // Sur le serveur (la main est au PC) : sans confirmation → 409 ; avec takeOver → gérée ici, données du fichier.
  const imp = (q = '') => server.inject({ method: 'POST', url: `/api/competitions/import${q}`, headers: { cookie }, payload: file });
  const refused = await imp();
  expect(refused.statusCode).toBe(409);
  expect(refused.json().error).toBe('Cette compétition est gérée par PC-SALLE : confirmez la reprise de la main avec ce fichier.');
  expect((await imp('?takeOver=1')).json()).toEqual({ competitionId: id, created: false });
  expect(await management(server, { cookie })).toMatchObject({ managedHere: true });
  expect((await orga('GET', `/api/competitions/${id}`)).json().location).toBe('Salle du PC');
  // Gérée ici : sans replace → 409 ; avec replace → remplacée.
  expect((await imp()).json().error).toBe('Cette compétition existe déjà ici : confirmez son remplacement.');
  expect((await imp('?replace=1')).statusCode).toBe(200);
});

test('serveur : exporter en fichier en donnant la main ; le PC qui l’importe a la main', async () => {
  const file = (await orga('POST', `/api/competitions/${id}/export-handover`)).json();
  expect(file.handOver).toBe(true);
  expect(await management(server, { cookie })).toMatchObject({ managedHere: false, ownerName: 'un PC (par fichier)' });
  const res = await pc.inject({ method: 'POST', url: '/api/competitions/import', payload: file });
  expect(res.json()).toEqual({ competitionId: id, created: true });
  expect(await management(pc)).toMatchObject({ managedHere: true });
});

test('serveur injoignable → 502', async () => {
  await local('PATCH', '/api/sync/settings', { url: 'http://127.0.0.1:1', token: 'un-jeton' });
  const res = await local('GET', '/api/sync/server-competitions');
  expect(res.statusCode).toBe(502);
  expect(res.json().error).toMatch(/^Serveur injoignable : /);
});

test('adresse : https obligatoire (sauf cette machine) ; nouvelle adresse sans jeton → jeton effacé ; délier', async () => {
  expect((await local('PATCH', '/api/sync/settings', { url: 'http://exemple.org', token: 'x' })).statusCode).toBe(400);
  expect((await local('PATCH', '/api/sync/settings', { url: 'https://autre.example.org', token: null })).json()).toEqual({ url: 'https://autre.example.org', hasToken: false });
  expect((await pc.inject({ method: 'DELETE', url: '/api/sync/settings' })).statusCode).toBe(204);
  expect((await local('GET', '/api/sync/settings')).json()).toEqual({ url: null, hasToken: false });
});

test('rendre la main : serveur injoignable → la main reste au PC (rien de perdu)', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  await server.close();
  const res = await local('POST', `/api/competitions/${id}/sync/return`);
  expect(res.statusCode).toBe(502);
  expect(await management(pc)).toMatchObject({ managedHere: true });
  server = await buildApp({ dbPath: tmpDbPath() });
});

test('PC : une simple copie du serveur en fichier ne donne pas la main sur une copie en lecture seule', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  const plain = (await orga('GET', `/api/competitions/${id}/export.json`)).json();
  const res = await pc.inject({ method: 'POST', url: '/api/competitions/import?takeOver=1', payload: plain });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toMatch(/^Ce fichier est une simple copie du serveur/);
  expect(await management(pc)).toMatchObject({ managedHere: false });
});

test('copie récupérée alors qu’un PC a la main : le bandeau le dit', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  const other = await buildApp({ dbPath: tmpDbPath(), instanceName: 'PC-2' });
  const token = (await orga('POST', '/api/sync/tokens', { name: 'PC-2' })).json().token;
  await other.inject({ method: 'PATCH', url: '/api/sync/settings', payload: { url: serverUrl, token } });
  await other.inject({ method: 'POST', url: '/api/sync/pull', payload: { competitionId: id, take: false } });
  expect(await management(other)).toMatchObject({ copyOfServer: true, ownerName: 'le serveur en ligne — la main est à PC-SALLE' });
  await other.close();
});
