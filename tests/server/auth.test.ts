import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { hashPassword, verifyPassword } from '../../src/server/auth/passwords.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { RateLimiter } from '../../src/server/auth/guard.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const PASSWORD = 'mot-de-passe-long';

/** Application en rôle serveur, avec un compte organisateur. */
async function serverApp() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'Orga@Example.org', PASSWORD);
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur' });
  return { app, dbPath };
}
const login = async (a: FastifyInstance, password = PASSWORD) =>
  a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password } });
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0]!;

/** Toutes les routes enregistrées (« méthode adresse »), depuis l'arbre de printRoutes. */
function routes(a: FastifyInstance): { method: string; url: string }[] {
  const stack: string[] = [];
  const out: { method: string; url: string }[] = [];
  for (const line of a.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = line.match(/^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?/);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack.push(m[2]!);
    for (const method of (m[3] ?? '').split(', ').filter(Boolean)) out.push({ method, url: stack.join('').replace(/:[A-Za-z]+/g, 'x') });
  }
  return out;
}

test('hashPassword / verifyPassword : bon et mauvais mot de passe ; deux empreintes du même mot de passe diffèrent', () => {
  const a = hashPassword(PASSWORD);
  expect(a).toMatch(/^scrypt\$[^$]+\$[^$]+$/);
  expect(verifyPassword(PASSWORD, a)).toBe(true);
  expect(verifyPassword('autre-mot-de-passe', a)).toBe(false);
  expect(hashPassword(PASSWORD)).not.toBe(a);
});

test('serveur : toutes les routes /api non publiques répondent 401 sans session', async () => {
  const { app: a } = await serverApp();
  await a.ready();
  const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/me$/, /^\/api\/auth\/login$/, /^\/api\/inscription(\/|$)/];
  const list = routes(a).filter((r) => r.url.startsWith('/api/') && r.method !== 'HEAD' && !PUBLIC.some((p) => p.test(r.url)));
  expect(list.length).toBeGreaterThan(40);
  for (const r of list) {
    const res = await a.inject({ method: r.method as 'GET', url: r.url, payload: r.method === 'GET' ? undefined : {} });
    expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    expect(res.json().error, `${r.method} ${r.url}`).toBe('Connexion requise.');
  }
});

test('serveur : routes publiques accessibles sans session', async () => {
  const { app: a } = await serverApp();
  expect((await a.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  const me = await a.inject({ method: 'GET', url: '/api/auth/me' });
  expect(me.statusCode).toBe(401);
  expect(me.json().error).not.toBe('Connexion requise.');
  expect((await a.inject({ method: 'GET', url: '/api/inscription/inconnu' })).statusCode).toBe(404);
});

test('connexion : cookie HttpOnly, SameSite=Lax, Secure ; avec le cookie → 200 ; mauvais mot de passe → 401 ; déconnexion', async () => {
  const { app: a } = await serverApp();
  const bad = await login(a, 'mauvais-mot-de-passe');
  expect(bad.statusCode).toBe(401);
  expect(bad.json().error).toBe('E-mail ou mot de passe incorrect.');
  const ok = await login(a);
  expect(ok.statusCode).toBe(204);
  const header = String(ok.headers['set-cookie']);
  expect(header).toMatch(/^shidokan_session=[A-Za-z0-9_-]{43};/);
  expect(header).toContain('HttpOnly');
  expect(header).toContain('SameSite=Lax');
  expect(header).toContain('Secure');
  const cookie = cookieOf(ok);
  expect((await a.inject({ method: 'GET', url: '/api/competitions', headers: { cookie } })).statusCode).toBe(200);
  expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json()).toEqual({ role: 'serveur', user: { email: 'orga@example.org' } });
  expect((await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(204);
  expect((await a.inject({ method: 'GET', url: '/api/competitions', headers: { cookie } })).statusCode).toBe(401);
});

test('session expirée → 401 et supprimée', async () => {
  const { app: a, dbPath } = await serverApp();
  const cookie = cookieOf(await login(a));
  const raw = new Database(dbPath);
  raw.prepare("update sessions set expires_at = '2000-01-01T00:00:00.000Z'").run();
  raw.close();
  expect((await a.inject({ method: 'GET', url: '/api/competitions', headers: { cookie } })).statusCode).toBe(401);
  const check = new Database(dbPath, { readonly: true });
  expect(check.prepare('select count(*) as n from sessions').get()).toEqual({ n: 0 });
  check.close();
});

test('écriture avec Origin d’un autre site → 403 ; même hôte → acceptée', async () => {
  const { app: a } = await serverApp();
  const cookie = cookieOf(await login(a));
  const post = (origin: string) =>
    a.inject({ method: 'POST', url: '/api/competitions', headers: { cookie, origin, host: 'competitions.example.org' }, payload: { name: 'Coupe', date: '2026-11-22' } });
  const foreign = await post('https://attaquant.example.com');
  expect(foreign.statusCode).toBe(403);
  expect(foreign.json().error).toBe('Origine refusée.');
  expect((await post('https://competitions.example.org')).statusCode).toBe(201);
});

test('11e essai de connexion en 15 minutes → 429 ; RateLimiter : fenêtre glissante', async () => {
  const { app: a } = await serverApp();
  for (let i = 0; i < 10; i++) expect((await login(a, 'mauvais-mot-de-passe')).statusCode).toBe(401);
  const blocked = await login(a);
  expect(blocked.statusCode).toBe(429);
  expect(blocked.json().error).toBe('Trop de requêtes : réessayez dans quelques minutes.');
  const limiter = new RateLimiter(2, 1000);
  expect([limiter.hit('ip', 0), limiter.hit('ip', 100), limiter.hit('ip', 200)]).toEqual([true, true, false]);
  expect(limiter.hit('ip', 1150)).toBe(true);
});

test('comptes : création, liste sans empreinte, suppression, changement de mot de passe', async () => {
  const { app: a } = await serverApp();
  const cookie = cookieOf(await login(a));
  const h = { cookie };
  expect((await a.inject({ method: 'POST', url: '/api/users', headers: h, payload: { email: 'b@example.org', password: 'court' } })).statusCode).toBe(400);
  const created = await a.inject({ method: 'POST', url: '/api/users', headers: h, payload: { email: 'B@example.org', password: PASSWORD } });
  expect(created.statusCode).toBe(201);
  expect((await a.inject({ method: 'POST', url: '/api/users', headers: h, payload: { email: 'b@example.org', password: PASSWORD } })).statusCode).toBe(409);
  const list = await a.inject({ method: 'GET', url: '/api/users', headers: h });
  expect(list.json().map((u: { email: string }) => u.email)).toEqual(['b@example.org', 'orga@example.org']);
  expect(list.body).not.toContain('scrypt');
  const me = list.json().find((u: { email: string }) => u.email === 'orga@example.org');
  expect((await a.inject({ method: 'DELETE', url: `/api/users/${me.id}`, headers: h })).statusCode).toBe(400);
  expect((await a.inject({ method: 'DELETE', url: `/api/users/${created.json().id}`, headers: h })).statusCode).toBe(204);
  expect((await a.inject({ method: 'PUT', url: '/api/users/me/password', headers: h, payload: { current: 'faux-mot-de-passe', next: 'nouveau-mot-de-passe' } })).statusCode).toBe(400);
  expect((await a.inject({ method: 'PUT', url: '/api/users/me/password', headers: h, payload: { current: PASSWORD, next: 'nouveau-mot-de-passe' } })).statusCode).toBe(204);
  expect((await login(a, 'nouveau-mot-de-passe')).statusCode).toBe(204);
});

test('local : aucune connexion demandée ; /api/auth/me → { role: local, user: null }', async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  expect((await app.inject({ method: 'GET', url: '/api/competitions' })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).json()).toEqual({ role: 'local', user: null });
});
