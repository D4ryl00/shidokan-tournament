import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { backupDir } from '../../src/server/repositories/backups.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let server: FastifyInstance;
let pc: FastifyInstance;
let serverPath: string;
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
  id = (await orga('POST', '/api/competitions', { name: 'Coupe en ligne', date: '2026-11-22', location: 'Nice' })).json().id;
  const token = (await orga('POST', '/api/sync/tokens', { name: 'PC' })).json().token as string;
  pc = await buildApp({ dbPath: tmpDbPath(), instanceName: 'PC-SALLE' });
  await pc.inject({ method: 'PATCH', url: '/api/sync/settings', payload: { url: serverUrl, token } });
});
afterEach(async () => {
  await pc.close();
  await server.close();
});

function orga(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return server.inject({ method, url, headers: { cookie }, payload: payload as object });
}
const local = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => pc.inject({ method, url, payload: payload as object });
const management = async (a: FastifyInstance, h: Record<string, string> = {}) => (await a.inject({ method: 'GET', url: `/api/competitions/${id}/management`, headers: h })).json();
const rescue = () => local('POST', `/api/competitions/${id}/sync/rescue`);
const notify = (replace = false) => local('POST', `/api/competitions/${id}/sync/rescue/notify`, { replace });
const register = (lastName: string) =>
  orga('POST', `/api/competitions/${id}/registrations`, { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' });
const DIVERGED = 'Des modifications ont été faites en ligne après la dernière copie de ce PC. Confirmez pour remplacer la version en ligne par celle de ce PC (la version en ligne est gardée dans une sauvegarde du serveur).';

test('secours sur une copie du serveur : modifiable tout de suite, sans réseau', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await server.close();
  const before = Date.now();
  expect((await rescue()).statusCode).toBe(204);
  const m = await management(pc);
  expect(m).toMatchObject({ managedHere: true, copyOfServer: false });
  expect(new Date(m.rescueSince).getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect((await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  server = await buildApp({ dbPath: tmpDbPath() });
});

test('secours sur une compétition gérée ici → 409', async () => {
  const own = (await local('POST', '/api/competitions', { name: 'Coupe du PC', date: '2026-11-22' })).json().id;
  const res = await pc.inject({ method: 'POST', url: `/api/competitions/${own}/sync/rescue` });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Seule une copie du serveur peut être prise en secours.');
  await local('POST', '/api/sync/pull', { competitionId: id, take: true });
  expect((await rescue()).statusCode).toBe(409);
});

test('prévenir, serveur inchangé : la version du PC est en ligne, la main est au PC ; ensuite « Rendre la main » marche', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await rescue();
  await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' });
  expect((await notify()).statusCode).toBe(204);
  expect(await management(server, { cookie })).toMatchObject({ managedHere: false, ownerName: 'PC-SALLE' });
  const online = (await orga('GET', `/api/competitions/${id}`)).json();
  expect(online.location).toBe('Gymnase');
  expect((await orga('GET', `/api/competitions/${id}/club-entry`)).json().status).toBe('frozen');
  expect((await orga('PATCH', `/api/competitions/${id}`, { location: 'Ailleurs' })).statusCode).toBe(409);
  expect(await management(pc)).toMatchObject({ managedHere: true, rescueSince: null });
  expect((await orga('GET', `/api/competitions/${id}/received-copies`)).json()).toHaveLength(1);
  expect((await local('POST', `/api/competitions/${id}/sync/return`)).statusCode).toBe(204);
  expect(await management(server, { cookie })).toMatchObject({ managedHere: true });
});

test('prévenir, inscription modifiée en ligne entre-temps : 409 sans rien écrire ; « remplacer » → version du PC, l’ancienne dans une sauvegarde', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await rescue();
  expect((await register('EN-LIGNE')).statusCode).toBe(201);
  await local('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' });
  const refused = await notify();
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toEqual({ error: DIVERGED, code: 'RESCUE_DIVERGED' });
  expect((await orga('GET', `/api/competitions/${id}`)).json().location).toBe('Nice');
  expect(await management(server, { cookie })).toMatchObject({ managedHere: true });
  expect((await management(pc)).rescueSince).not.toBeNull();

  expect((await notify(true)).statusCode).toBe(204);
  expect((await orga('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase');
  expect((await orga('GET', `/api/competitions/${id}/registrations`)).json()).toEqual([]);
  expect(await management(server, { cookie })).toMatchObject({ managedHere: false, ownerName: 'PC-SALLE' });
  // La sauvegarde faite juste avant la réception contient l'inscription saisie en ligne.
  const dir = backupDir(serverPath);
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().at(-1)!;
  const raw = new Database(path.join(dir, latest), { readonly: true });
  expect(raw.prepare("select count(*) as n from fighters where last_name = 'EN-LIGNE'").get()).toEqual({ n: 1 });
  raw.close();
});

test('un autre PC (par fichier) a la main entre-temps → 409', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await rescue();
  expect((await orga('POST', `/api/competitions/${id}/export-handover`)).statusCode).toBe(200);
  const res = await notify(true);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Cette compétition est gérée par un PC (par fichier) : demandez à un organisateur de reprendre la main en ligne.');
  expect((await management(pc)).rescueSince).not.toBeNull();
});

test('jeton révoqué → 401 relayé ; le PC garde la main en secours', async () => {
  await local('POST', '/api/sync/pull', { competitionId: id, take: false });
  await rescue();
  const [token] = (await orga('GET', '/api/sync/tokens')).json() as { id: string }[];
  await orga('DELETE', `/api/sync/tokens/${token!.id}`);
  const res = await notify();
  expect(res.statusCode).toBe(401);
  expect(res.json().error).toBe('Jeton de synchronisation invalide.');
  expect(await management(pc)).toMatchObject({ managedHere: true });
  expect((await management(pc)).rescueSince).not.toBeNull();
});
