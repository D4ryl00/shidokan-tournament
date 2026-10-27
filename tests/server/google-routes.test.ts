import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CONTACTS_SCOPE } from '../../src/domain/app-settings.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';
import { connectGoogle, fakeGoogle, type FakeGoogle } from '../helpers/fake-google.js';

let app: FastifyInstance;
let fake: FakeGoogle;
let dbPath: string;
const PUBLIC_URL = 'https://competitions.example.org';
const build = (o: { google?: boolean; publicUrl?: string } = {}) =>
  buildApp({ dbPath, publicUrl: o.publicUrl, google: o.google === false ? undefined : { clientId: 'id', clientSecret: 'SECRET-CLIENT', fetch: fake.fetch } });

beforeEach(async () => {
  fake = fakeGoogle();
  dbPath = tmpDbPath();
  app = await build({ publicUrl: PUBLIC_URL });
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

const settings = async () => (await app.inject({ method: 'GET', url: '/api/app-settings' })).json();
const startState = async () => new URL((await app.inject({ method: 'POST', url: '/api/app-settings/google/start' })).json().url).searchParams.get('state')!;
const callback = (query: string) => app.inject({ method: 'GET', url: `/api/app-settings/google/callback?${query}` });

test('connexion réussie : retour sur les Réglages, compte et mode Google, ni jeton ni secret renvoyés', async () => {
  const res = await connectGoogle(app);
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/parametres?google=connecte#mails');
  const s = await settings();
  expect(s).toMatchObject({ googleAvailable: true, mailMode: 'google', google: { email: 'orga@gmail.com', fromName: 'Shidokan France', status: 'ok' } });
  expect(s.google.lastRefreshAt).toEqual(expect.any(String));
  const text = JSON.stringify(s);
  expect(text).not.toContain('refreshToken');
  expect(text).not.toContain('rt-');
  expect(text).not.toContain('SECRET-CLIENT');
});

test('sans configuration Google ou sans adresse publique : indisponible, pas de route', async () => {
  for (const o of [{ google: false, publicUrl: PUBLIC_URL }, { publicUrl: undefined }]) {
    await app.close();
    app = await build(o);
    expect((await settings()).googleAvailable).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/app-settings/google/start' })).statusCode).toBe(404);
  }
});

test('state inconnu, rejoué ou de plus de 10 minutes → expire, rien n’est enregistré', async () => {
  expect((await callback('code=c&state=inconnu')).headers.location).toBe('/parametres?google=expire#mails');
  expect((await callback('code=c')).headers.location).toBe('/parametres?google=expire#mails');
  const state = await startState();
  expect((await callback(`code=c&state=${state}`)).headers.location).toBe('/parametres?google=connecte#mails');
  await app.inject({ method: 'POST', url: '/api/app-settings/google/disconnect' });
  expect((await callback(`code=c&state=${state}`)).headers.location).toBe('/parametres?google=expire#mails');
  vi.useFakeTimers({ toFake: ['Date'] });
  const old = await startState();
  vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
  expect((await callback(`code=c&state=${old}`)).headers.location).toBe('/parametres?google=expire#mails');
  expect((await settings()).google).toBeNull();
});

test('refus chez Google → annule, rien n’est enregistré', async () => {
  const state = await startState();
  expect((await callback(`error=access_denied&state=${state}`)).headers.location).toBe('/parametres?google=annule#mails');
  expect(await settings()).toMatchObject({ google: null, mailMode: 'smtp' });
});

test('autorisation d’envoyer décochée chez Google → envoi-refuse, rien n’est enregistré, le jeton reçu est révoqué', async () => {
  fake.grantedScopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];
  expect((await connectGoogle(app)).headers.location).toBe('/parametres?google=envoi-refuse#mails');
  expect(await settings()).toMatchObject({ google: null, mailMode: 'smtp' });
  await vi.waitFor(() => expect(fake.revoked).toEqual(['rt-1']));
});

test('erreur de Google à l’échange du code → erreur', async () => {
  const state = await startState();
  fake.noRefreshToken = true;
  expect((await callback(`code=c&state=${state}`)).headers.location).toBe('/parametres?google=erreur#mails');
  expect((await settings()).google).toBeNull();
});

test('reconnexion avec un autre compte : adresse remplacée, nom de l’expéditeur gardé, ancien jeton révoqué', async () => {
  await connectGoogle(app);
  expect((await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { googleFromName: 'Club X' } })).statusCode).toBe(200);
  fake.email = 'autre@gmail.com';
  await connectGoogle(app);
  expect((await settings()).google).toMatchObject({ email: 'autre@gmail.com', fromName: 'Club X', status: 'ok' });
  await vi.waitFor(() => expect(fake.revoked).toEqual(['rt-1']));
});

test('premier compte : nom de l’expéditeur repris du réglage SMTP', async () => {
  await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { smtp: { host: 'smtp.x.org', port: 465, security: 'tls', user: 'u', password: 'p', fromName: 'Ligue', fromEmail: 'l@x.org' } } });
  await connectGoogle(app);
  expect((await settings()).google.fromName).toBe('Ligue');
});

test('déconnexion : révoquée chez Google, compte effacé, retour au SMTP ; échec de révocation → effacé quand même', async () => {
  await connectGoogle(app);
  expect((await app.inject({ method: 'POST', url: '/api/app-settings/google/disconnect' })).json()).toEqual({ revoked: true });
  expect(fake.revoked).toEqual(['rt-1']);
  expect(await settings()).toMatchObject({ google: null, mailMode: 'smtp' });
  await connectGoogle(app);
  fake.revokeFails = true;
  expect((await app.inject({ method: 'POST', url: '/api/app-settings/google/disconnect' })).json()).toEqual({ revoked: false });
  expect((await settings()).google).toBeNull();
});

async function serveurApp() {
  const { createUser } = await import('../../src/server/auth/sessions.js');
  const { openDb, closeDb } = await import('../../src/server/db/client.js');
  await app.close();
  const d = openDb(dbPath);
  createUser(d, 'a@example.org', 'mot-de-passe-long');
  closeDb(d);
  app = await buildApp({ dbPath, role: 'serveur', publicUrl: PUBLIC_URL, google: { clientId: 'id', clientSecret: 's', fetch: fake.fetch } });
  return async () => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
}

test('rôle serveur : le state est lié à la session (même compte, autre session → refusé)', async () => {
  const login = await serveurApp();
  const first = await login();
  const second = await login();
  const state = new URL((await app.inject({ method: 'POST', url: '/api/app-settings/google/start', headers: { cookie: first } })).json().url).searchParams.get('state')!;
  const res = await app.inject({ method: 'GET', url: `/api/app-settings/google/callback?code=c&state=${state}`, headers: { cookie: second } });
  expect(res.headers.location).toBe('/parametres?google=expire#mails');
});

test('rôle serveur : session expirée au retour de Google → retour sur les Réglages avec un message, pas une page brute', async () => {
  const login = await serveurApp();
  const cookie = await login();
  const state = new URL((await app.inject({ method: 'POST', url: '/api/app-settings/google/start', headers: { cookie } })).json().url).searchParams.get('state')!;
  const res = await app.inject({ method: 'GET', url: `/api/app-settings/google/callback?code=c&state=${state}` });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/parametres?google=session#mails');
  expect((await app.inject({ method: 'GET', url: '/api/app-settings' })).statusCode).toBe(401);
});

test('rôle serveur : le state d’un organisateur ne sert pas à un autre', async () => {
  const { createUser } = await import('../../src/server/auth/sessions.js');
  const { openDb, closeDb } = await import('../../src/server/db/client.js');
  await app.close();
  const d = openDb(dbPath);
  createUser(d, 'a@example.org', 'mot-de-passe-long');
  createUser(d, 'b@example.org', 'mot-de-passe-long');
  closeDb(d);
  app = await buildApp({ dbPath, role: 'serveur', publicUrl: PUBLIC_URL, google: { clientId: 'id', clientSecret: 's', fetch: fake.fetch } });
  const cookieOf = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
  const a = await cookieOf('a@example.org');
  const b = await cookieOf('b@example.org');
  const state = new URL((await app.inject({ method: 'POST', url: '/api/app-settings/google/start', headers: { cookie: a } })).json().url).searchParams.get('state')!;
  const res = await app.inject({ method: 'GET', url: `/api/app-settings/google/callback?code=c&state=${state}`, headers: { cookie: b } });
  expect(res.headers.location).toBe('/parametres?google=expire#mails');
  expect((await connectGoogle(app, { cookie: a })).headers.location).toBe('/parametres?google=connecte#mails');
});

const testMail = () => app.inject({ method: 'POST', url: '/api/app-settings/test-mail', payload: { to: 'moi@example.org' } });

test('se reconnecter avec le même compte : la nouvelle connexion fonctionne (pas de révocation du compte)', async () => {
  await connectGoogle(app);
  expect((await connectGoogle(app)).headers.location).toBe('/parametres?google=connecte#mails');
  expect(fake.revoked).toEqual([]);
  expect((await testMail()).statusCode).toBe(204);
});

test('autorisation d’envoyer décochée en se reconnectant avec le même compte : la connexion déjà là continue de fonctionner', async () => {
  await connectGoogle(app);
  fake.grantedScopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];
  expect((await connectGoogle(app)).headers.location).toBe('/parametres?google=envoi-refuse#mails');
  expect(fake.revoked).toEqual([]);
  expect((await settings()).google).toMatchObject({ email: 'orga@gmail.com', status: 'ok' });
  expect((await testMail()).statusCode).toBe(204);
});

const rawDb = () => new Database(dbPath);

test('connexion : droits accordés retenus ; contacts décochés → connecté quand même', async () => {
  await connectGoogle(app);
  expect((await settings()).google.scopes).toContain(CONTACTS_SCOPE);
  fake.grantedScopes = fake.grantedScopes.filter((s) => s !== CONTACTS_SCOPE);
  const res = await connectGoogle(app);
  expect(res.headers.location).toBe('/parametres?google=connecte#mails');
  expect((await settings()).google.scopes).not.toContain(CONTACTS_SCOPE);
});

test('reconnexion : mode d’envoi gardé ; première connexion après « Déconnecter » → google', async () => {
  await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { smtp: { host: 'smtp.x.org', port: 465, security: 'tls', user: 'u', password: 'p', fromName: 'Ligue', fromEmail: 'l@x.org' } } });
  await connectGoogle(app);
  expect((await settings()).mailMode).toBe('google');
  expect((await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { mailMode: 'smtp' } })).statusCode).toBe(200);
  await connectGoogle(app);
  expect((await settings()).mailMode).toBe('smtp');
  await app.inject({ method: 'POST', url: '/api/app-settings/google/disconnect' });
  await connectGoogle(app);
  expect((await settings()).mailMode).toBe('google');
});

test('reconnexion avec un autre compte : liens et attente effacés ; même compte : rien ne change', async () => {
  await connectGoogle(app);
  const add = async (name: string) => (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { name, affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null } })).json().id as string;
  const club = await add('Tani Dojo');
  // Un club sans lien n'est pas touché (sa version ne bouge pas) quand les liens sont effacés.
  const free = await add('Dojo Libre');
  const db = rawDb();
  try {
    db.prepare('update club_directory set google_contact_id = ? where id = ?').run('people/c1', club);
    const state = JSON.parse((db.prepare("select value_json v from app_settings where key = 'googleContacts'").get() as { v: string }).v);
    db.prepare("update app_settings set value_json = ? where key = 'googleContacts'").run(JSON.stringify({ ...state, pending: ['people/c9'] }));
    const read = () => ({
      link: (db.prepare('select google_contact_id l from club_directory where id = ?').get(club) as { l: string | null }).l,
      state: JSON.parse((db.prepare("select value_json v from app_settings where key = 'googleContacts'").get() as { v: string }).v),
    });
    const freeVersion = () => (db.prepare('select version v from club_directory where id = ?').get(free) as { v: number }).v;
    const before = freeVersion();
    await connectGoogle(app);
    expect(read()).toMatchObject({ link: 'people/c1', state: { account: 'orga@gmail.com', pending: ['people/c9'] } });
    fake.email = 'autre@gmail.com';
    await connectGoogle(app);
    expect(read()).toMatchObject({ link: null, state: { account: 'autre@gmail.com', pending: [] } });
    expect(freeVersion()).toBe(before);
  } finally {
    db.close();
  }
});
