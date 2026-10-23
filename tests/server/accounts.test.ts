import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { olderDb } from '../helpers/older-db.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const PASSWORD = 'mot-de-passe-long';

/** Rôle serveur, un organisateur connecté, deux compétitions avec chacune ses zones. */
async function setup() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'orga@example.org', PASSWORD);
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur' });
  const a = app;
  const cookie = await loginAs(a, 'orga@example.org');
  const orga = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => a.inject({ method, url, headers: { cookie }, payload: payload as object });
  const competition = async (name: string) => {
    const id = (await orga('POST', '/api/competitions', { name, date: '2026-11-22' })).json().id as string;
    const zones = (await orga('PUT', `/api/competitions/${id}/zones`, [{ name: 'Tatami 1' }, { name: 'Tatami 2' }])).json() as { id: string; name: string }[];
    return { id, zones };
  };
  return { a, orga, coupe: await competition('Coupe 2026'), autre: await competition('Open 2026') };
}
async function loginAs(a: FastifyInstance, email: string) {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  return String(res.headers['set-cookie']).split(';')[0]!;
}

test('créer un compte Table centrale et un compte Zone ; la liste donne rôle, compétition et zone (noms compris)', async () => {
  const { orga, coupe } = await setup();
  expect((await orga('POST', '/api/users', { email: 'table@example.org', password: PASSWORD, role: 'table' })).statusCode).toBe(201);
  const zone = coupe.zones[1]!;
  expect((await orga('POST', '/api/users', { email: 'tatami2@example.org', password: PASSWORD, role: 'zone', competitionId: coupe.id, zoneId: zone.id })).statusCode).toBe(201);
  const list = (await orga('GET', '/api/users')).json() as Record<string, unknown>[];
  expect(list.find((u) => u.email === 'orga@example.org')).toMatchObject({ role: 'organisateur', competitionId: null, zoneId: null });
  expect(list.find((u) => u.email === 'table@example.org')).toMatchObject({ role: 'table', competitionId: null, zoneId: null, competitionName: null, zoneName: null });
  expect(list.find((u) => u.email === 'tatami2@example.org')).toMatchObject({ role: 'zone', competitionId: coupe.id, zoneId: zone.id, competitionName: 'Coupe 2026', zoneName: 'Tatami 2' });
});

test('compte Zone sans zone, ou avec une zone d’une autre compétition → 400', async () => {
  const { orga, coupe, autre } = await setup();
  const message = 'Choisissez une zone de cette compétition.';
  const noZone = await orga('POST', '/api/users', { email: 'z@example.org', password: PASSWORD, role: 'zone', competitionId: coupe.id });
  expect(noZone.statusCode).toBe(400);
  expect(noZone.json().error).toBe(message);
  const wrong = await orga('POST', '/api/users', { email: 'z@example.org', password: PASSWORD, role: 'zone', competitionId: coupe.id, zoneId: autre.zones[0]!.id });
  expect(wrong.statusCode).toBe(400);
  expect(wrong.json().error).toBe(message);
  // Une zone donnée à un autre rôle n'a pas de sens : elle est refusée aussi.
  const table = await orga('POST', '/api/users', { email: 't@example.org', password: PASSWORD, role: 'table', competitionId: coupe.id, zoneId: coupe.zones[0]!.id });
  expect(table.statusCode).toBe(400);
});

test('PATCH change le rôle ; la session déjà ouverte du compte voit le nouveau rôle sans se reconnecter', async () => {
  const { a, orga, coupe } = await setup();
  const id = (await orga('POST', '/api/users', { email: 'benevole@example.org', password: PASSWORD, role: 'table' })).json().id as string;
  const cookie = await loginAs(a, 'benevole@example.org');
  const me = async () => (await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
  expect(await me()).toEqual({ role: 'serveur', user: { email: 'benevole@example.org', role: 'table', competitionId: null, zoneId: null } });
  const zoneId = coupe.zones[0]!.id;
  expect((await orga('PATCH', `/api/users/${id}`, { role: 'zone', competitionId: coupe.id, zoneId })).statusCode).toBe(204);
  expect(await me()).toEqual({ role: 'serveur', user: { email: 'benevole@example.org', role: 'zone', competitionId: coupe.id, zoneId } });
  expect((await orga('PATCH', `/api/users/${id}`, { role: 'organisateur', competitionId: null, zoneId: null })).statusCode).toBe(204);
  expect((await me()).user.role).toBe('organisateur');
});

test('changer son propre rôle → 400', async () => {
  const { orga } = await setup();
  const self = ((await orga('GET', '/api/users')).json() as { id: string }[])[0]!;
  const res = await orga('PATCH', `/api/users/${self.id}`, { role: 'table', competitionId: null, zoneId: null });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Vous ne pouvez pas changer le rôle de votre propre compte.');
  expect((await orga('PATCH', '/api/users/inconnu', { role: 'table', competitionId: null, zoneId: null })).statusCode).toBe(404);
});

test('zone supprimée de la compétition, ou compétition disparue : la liste montre des noms vides, sans erreur', async () => {
  const { a, orga, coupe } = await setup();
  await orga('POST', '/api/users', { email: 'tatami2@example.org', password: PASSWORD, role: 'zone', competitionId: coupe.id, zoneId: coupe.zones[1]!.id });
  await orga('PUT', `/api/competitions/${coupe.id}/zones`, [{ id: coupe.zones[0]!.id, name: 'Tatami 1' }]);
  const row = ((await orga('GET', '/api/users')).json() as Record<string, unknown>[]).find((u) => u.email === 'tatami2@example.org');
  expect(row).toMatchObject({ role: 'zone', competitionName: 'Coupe 2026', zoneName: null });
  void a;
});

test('migration : une base 0018 avec un compte garde ce compte en organisateur, sans compétition ni zone', () => {
  const file = olderDb(18);
  const raw = new Database(file);
  raw.prepare("insert into users (id, email, password_hash) values ('u1', 'orga@example.org', 'x')").run();
  raw.close();
  closeDb(openDb(file));
  const after = new Database(file, { readonly: true });
  expect(after.prepare('select role, competition_id, zone_id from users').get()).toEqual({ role: 'organisateur', competition_id: null, zone_id: null });
  const cols = (after.prepare("select name from pragma_table_info('competitions')").all() as { name: string }[]).map((c) => c.name);
  expect(cols).toEqual(expect.arrayContaining(['server_fingerprint', 'rescue_since']));
  after.close();
});
