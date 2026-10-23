import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { routeAccess } from '../../src/server/auth/permissions.js';
import { createUser, type SessionUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { registeredRoutes } from '../helpers/routes.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const PASSWORD = 'mot-de-passe-long';
const FORBIDDEN = 'Votre compte ne permet pas cette action.';
const OTHER_COMPETITION = 'Votre compte donne accès à une autre compétition.';
const OTHER_ZONE = 'Ce combat ne se joue pas sur votre zone.';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Écritures permises à la Table centrale (motifs sous /api/competitions/:id). */
const TABLE_WRITES = [
  'POST /registrations', 'PUT /registrations/:rid', 'DELETE /registrations/:rid', 'POST /clubs', 'PATCH /clubs/:clubId',
  'PUT /weigh-in/:fighterId', 'POST /weigh-in/close',
  'POST /replacement/preview', 'POST /replacement/apply', 'POST /replacement/bulk', 'POST /replacement/refuse', 'POST /replacement/unrefuse', 'POST /replacement/undo', 'POST /replacement/move',
  'PATCH /categories/:cid', 'POST /categories/:cid/redraw', 'POST /categories/:cid/swap', 'POST /categories/:cid/move', 'POST /categories/:cid/move/preview', 'POST /categories/:cid/regenerate',
  'POST /launch', 'POST /launch/reopen', 'POST /launch/number', 'POST /launch/number/preview',
  'PUT /categories/:cid/results/:matchId', 'DELETE /categories/:cid/results/:matchId', 'PUT /categories/:cid/kata/:rid/:round', 'PUT /categories/:cid/tie-break',
].map((r) => r.replace(' ', ' /api/competitions/:id'));
/** Écritures d'un compte Zone, sur sa zone. */
const ZONE_WRITES = TABLE_WRITES.slice(-4);
const DENIED_GETS = ['/invitations', '/invitations/preview', '/received-copies', '/export.json'].map((p) => `/api/competitions/:id${p}`);
const COMMON = ['GET /api/competitions', 'POST /api/auth/logout', 'PUT /api/users/me/password'];
const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/me$/, /^\/api\/auth\/login$/, /^\/api\/inscription(\/|$)/, /^\/api\/sync\/remote\//];

/** Rôle serveur, organisateur ; compétition (Tatami 1 et 2) : -54 et kata sur Tatami 1, -61 sur Tatami 2, lancée ; une autre compétition. */
async function setup() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'orga@example.org', PASSWORD);
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur' });
  const a = app;
  const orgaCookie = await loginAs(a, 'orga@example.org');
  const as = (cookie: string) => (method: Method, url: string, payload?: unknown) => a.inject({ method, url, headers: { cookie }, payload: payload as object });
  const orga = as(orgaCookie);
  const id = (await orga('POST', '/api/competitions', { name: 'Coupe', date: '2026-11-22' })).json().id as string;
  const other = (await orga('POST', '/api/competitions', { name: 'Open', date: '2026-12-06' })).json().id as string;
  const base = `/api/competitions/${id}`;
  const [t1, t2] = ((await orga('GET', `${base}/zones`)).json() as { id: string }[]).map((z) => z.id);
  let n = 0;
  const register = (discipline: 'karate' | 'kata', weightClassId: string | null) =>
    orga('POST', `${base}/registrations`, { clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId, source: 'manual' });
  for (let i = 0; i < 4; i++) await register('karate', 'cadet:F:-54');
  for (let i = 0; i < 4; i++) await register('karate', 'cadet:F:-61');
  for (let i = 0; i < 3; i++) await register('kata', null);
  type Cat = { id: string; label: string; bracket?: { entrants?: { registrationId: string }[] } };
  const cats = async () => (await orga('GET', `${base}/categories`)).json() as Cat[];
  for (const c of await cats()) await orga('PATCH', `${base}/categories/${c.id}`, { status: 'ready', zoneId: c.label.includes('-61') ? t2 : t1 });
  expect((await orga('POST', `${base}/launch`, { waveId: null })).statusCode).toBe(204);
  const byLabel = async (s: string) => (await cats()).find((c) => c.label.includes(s))!;
  const [a54, b61, kata] = [await byLabel('-54'), await byLabel('-61'), await byLabel('Kata')];
  const account = async (email: string, role: 'table' | 'zone', zoneId: string | null = null) => {
    expect((await orga('POST', '/api/users', { email, password: PASSWORD, role, competitionId: zoneId ? id : null, zoneId })).statusCode).toBe(201);
    return as(await loginAs(a, email));
  };
  return {
    a, orga, id, other, base, t1: t1!, t2: t2!, a54, b61, kata,
    table: await account('table@example.org', 'table'),
    zone1: await account('tatami1@example.org', 'zone', t1!),
    zone2: await account('tatami2@example.org', 'zone', t2!),
  };
}
async function loginAs(a: FastifyInstance, email: string) {
  return String((await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).headers['set-cookie']).split(';')[0]!;
}
const user = (role: SessionUser['role']): SessionUser => ({ id: 'u', email: 'u@example.org', role, competitionId: role === 'zone' ? 'c' : null, zoneId: role === 'zone' ? 'z' : null });
const result = { winner: 'a', method: 'points' };

test('routeAccess : chaque route enregistrée a la décision attendue pour la Table centrale et la Zone', async () => {
  app = await buildApp({ dbPath: tmpDbPath(), role: 'serveur' });
  await app.ready();
  const routes = registeredRoutes(app).filter((r) => r.pattern.startsWith('/api'));
  expect(routes.length).toBeGreaterThan(100);
  for (const { method, pattern } of routes) {
    const key = `${method === 'HEAD' ? 'GET' : method} ${pattern}`;
    const isPublic = PUBLIC.some((p) => p.test(pattern));
    const readable = method === 'GET' || method === 'HEAD' ? (pattern === '/api/competitions/:id' || pattern.startsWith('/api/competitions/:id/')) && !DENIED_GETS.includes(pattern) : false;
    const common = isPublic || readable || COMMON.includes(key);
    expect(routeAccess(user('table'), method, pattern), `table ${key}`).toBe(common || TABLE_WRITES.includes(key) ? 'allow' : 'deny');
    expect(routeAccess(user('zone'), method, pattern), `zone ${key}`).toBe(common ? 'allow' : ZONE_WRITES.includes(key) ? 'zone-check' : 'deny');
    expect(routeAccess(user('organisateur'), method, pattern), `organisateur ${key}`).toBe('allow');
  }
  // Chaque motif listé existe vraiment (une route renommée ne passe pas inaperçue).
  const keys = new Set(routes.map((r) => `${r.method} ${r.pattern}`));
  for (const k of [...TABLE_WRITES, ...COMMON]) expect(keys.has(k), k).toBe(true);
});

test('table : saisit une inscription et un résultat ; les routes de l’organisateur → 403', async () => {
  const { table, base, a54 } = await setup();
  const rows = (await table('GET', `${base}/registrations`)).json() as { id: string; discipline: string; ruleset: string | null; weightClassId: string | null; source: string; fighter: { lastName: string; sex: string; ageBandCode: string } }[];
  const r = rows[0]!;
  const input = { clubId: null, lastName: r.fighter.lastName, firstName: 'Autre', sex: r.fighter.sex, ageBandCode: r.fighter.ageBandCode, discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId, source: r.source };
  expect((await table('PUT', `${base}/registrations/${r.id}`, input)).statusCode).toBe(200);
  expect((await table('PUT', `${base}/categories/${a54.id}/results/w1-0`, result)).statusCode).toBe(200);
  for (const [method, url] of [['PUT', `${base}/zones`], ['PATCH', base], ['GET', '/api/club-directory'], ['GET', '/api/backup.sqlite'], ['GET', `${base}/invitations`], ['GET', '/api/users'], ['POST', '/api/competitions']] as const) {
    const res = await table(method, url, method === 'GET' ? undefined : {});
    expect(res.statusCode, `${method} ${url}`).toBe(403);
    expect(res.json().error).toBe(FORBIDDEN);
  }
});

test('zone : résultats, notes de kata et départage de sa zone seulement', async () => {
  const { zone1, zone2, base, a54, b61, kata } = await setup();
  expect((await zone1('PUT', `${base}/categories/${a54.id}/results/w1-0`, result)).statusCode).toBe(200);
  const refused = await zone1('PUT', `${base}/categories/${b61.id}/results/w1-0`, result);
  expect(refused.statusCode).toBe(403);
  expect(refused.json().error).toBe(OTHER_ZONE);
  expect((await zone2('DELETE', `${base}/categories/${a54.id}/results/w1-0`)).statusCode).toBe(403);
  expect((await zone1('DELETE', `${base}/categories/${a54.id}/results/w1-0`)).statusCode).toBe(204);
  const rid = kata.bracket!.entrants![0]!.registrationId;
  expect((await zone2('PUT', `${base}/categories/${kata.id}/kata/${rid}/round1`, { notes: [8, 8, 8] })).statusCode).toBe(403);
  expect((await zone1('PUT', `${base}/categories/${kata.id}/kata/${rid}/round1`, { notes: [8, 8, 8] })).statusCode).toBe(204);
  const order = kata.bracket!.entrants!.map((e) => e.registrationId);
  expect((await zone2('PUT', `${base}/categories/${kata.id}/tie-break`, { scope: 'kata', order })).statusCode).toBe(403);
  expect((await zone1('PUT', `${base}/categories/${kata.id}/tie-break`, { scope: 'kata', order })).statusCode).toBe(204);
  // Le reste est refusé, même sur sa zone.
  const patch = await zone1('PATCH', `${base}/categories/${a54.id}`, { repechage: true });
  expect(patch.statusCode).toBe(403);
  expect(patch.json().error).toBe(FORBIDDEN);
  expect((await zone1('GET', `${base}/categories`)).statusCode).toBe(200);
});

test('zone : une autre compétition → 403 ; la liste des compétitions ne donne que la sienne', async () => {
  const { zone1, id, other } = await setup();
  for (const url of [`/api/competitions/${other}`, `/api/competitions/${other}/categories`, `/api/competitions/${other}/events`]) {
    const res = await zone1('GET', url);
    expect(res.statusCode, url).toBe(403);
    expect(res.json().error).toBe(OTHER_COMPETITION);
  }
  expect(((await zone1('GET', '/api/competitions')).json() as { id: string }[]).map((c) => c.id)).toEqual([id]);
});

test('catégorie déplacée à la suite : la nouvelle zone saisit les combats restants ; l’ancienne ne corrige que le combat joué chez elle', async () => {
  const { orga, zone1, zone2, base, a54, t2 } = await setup();
  expect((await orga('PUT', `${base}/categories/${a54.id}/results/w1-0`, result)).statusCode).toBe(200);
  expect((await orga('POST', `${base}/categories/${a54.id}/move`, { zoneId: t2, mode: 'append' })).statusCode).toBe(200);
  expect((await zone1('PUT', `${base}/categories/${a54.id}/results/w1-1`, result)).statusCode).toBe(403);
  expect((await zone2('PUT', `${base}/categories/${a54.id}/results/w1-1`, result)).statusCode).toBe(200);
  expect((await zone1('PUT', `${base}/categories/${a54.id}/results/w1-0`, { ...result, method: 'decision' })).statusCode).toBe(200);
  expect((await zone2('PUT', `${base}/categories/${a54.id}/results/w1-0`, result)).statusCode).toBe(403);
});

test('rôle local : aucun contrôle de rôle', async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  const res = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } });
  expect(res.statusCode).toBe(201);
  expect((await app.inject({ method: 'PUT', url: `/api/competitions/${res.json().id}/zones`, payload: [{ name: 'Ring' }] })).statusCode).toBe(200);
});
