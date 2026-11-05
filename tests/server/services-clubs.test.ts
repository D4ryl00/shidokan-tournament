import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { SERVER_ONLY } from '../../src/domain/app-settings.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let id: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath, google: { clientId: 'id', clientSecret: 'secret' }, publicUrl: 'https://competitions.example.org' });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
});
afterEach(async () => app.close());

const comp = (p: string) => `/api/competitions/${id}${p}`;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

test('PC : chaque route de mail et d’inscription en ligne répond 403 SERVER_ONLY, quelle que soit la méthode', async () => {
  const routes: [Method, string][] = [
    ['GET', comp('/invitations')], ['POST', comp('/invitations')], ['POST', comp('/invitations/send')], ['POST', comp('/invitations/c1/mailto')],
    ['GET', comp('/invitations/preview')], ['GET', comp('/invitations/c1/links')], ['POST', comp('/invitations/c1/links')],
    ['DELETE', comp('/invitations/c1/links/l1')], ['DELETE', comp('/invitations/c1')],
    ['GET', comp('/mail-attachments')], ['POST', comp('/mail-attachments')], ['GET', comp('/mail-attachments/a1')], ['PATCH', comp('/mail-attachments/a1')], ['DELETE', comp('/mail-attachments/a1')],
    ['GET', comp('/club-entry')], ['PATCH', comp('/club-entry')],
    ['GET', '/api/inscription/abc'], ['PATCH', '/api/inscription/abc/club'], ['POST', '/api/inscription/abc/lines'], ['PUT', '/api/inscription/abc/lines/f1'], ['DELETE', '/api/inscription/abc/lines/f1'],
    ['POST', '/api/mail-images'], ['GET', '/api/mail-images/i1'], ['POST', '/api/mail-html/check'],
    ['POST', '/api/app-settings/test-mail'],
    ['POST', '/api/app-settings/google/start'], ['GET', '/api/app-settings/google/callback'], ['POST', '/api/app-settings/google/disconnect'],
    ['POST', '/api/club-directory/google/preview'], ['POST', '/api/club-directory/google/apply'],
    ['PUT', '/api/inscription/abc'], ['POST', '/api/mail-images/i1'], ['GET', '/api/app-settings/google/inconnue'],
  ];
  for (const [method, url] of routes) {
    const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
    expect([method, url, res.statusCode, res.json()]).toEqual([method, url, 403, { error: SERVER_ONLY }]);
  }
  for (const method of ['HEAD', 'OPTIONS'] as const) {
    for (const url of [comp('/invitations'), '/api/inscription/abc', '/api/mail-images/i1']) expect((await app.inject({ method, url })).statusCode).toBe(403);
  }
});

test('PC : adresse encodée ou barre finale ne contourne pas le refus', async () => {
  for (const url of ['/api/%69nscription/abc', '/api//mail-images', `/api/competitions/${id}/invitations/`, '/api/mail-html/check/']) {
    expect([url, (await app.inject({ method: 'POST', url, payload: {} })).statusCode]).toEqual([url, 403]);
  }
});

test('PC : SERVER_ONLY l’emporte sur la compétition inconnue et sur la main ailleurs', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/competitions/inconnue/invitations' })).json()).toEqual({ error: SERVER_ONLY });
  const r = new Database(dbPath);
  r.prepare("update competitions set owner_instance_id = 'autre', owner_name = 'Autre PC', owner_since = '2026-11-01', last_sync_at = '2026-11-01' where id = ?").run(id);
  r.close();
  for (const [method, url] of [['POST', comp('/invitations/send')], ['PATCH', comp('/club-entry')], ['DELETE', comp('/mail-attachments/a1')]] as [Method, string][]) {
    const res = await app.inject({ method, url, payload: {} });
    expect([url, res.statusCode, res.json()]).toEqual([url, 403, { error: SERVER_ONLY }]);
  }
});

test('PC : réglages — mail refusé, confidentialité acceptée, lecture possible', async () => {
  const smtp = { host: 'smtp.example.org', port: 587, security: 'starttls', user: '', password: 'x', fromName: 'A', fromEmail: 'a@example.org' };
  for (const payload of [{ smtp }, { mailMode: 'smtp' }, { invitationMail: { subject: 'S', body: 'B' } }, { privacyContact: 'a@example.org', mailMode: 'smtp' }]) {
    const res = await app.inject({ method: 'PATCH', url: '/api/app-settings', payload });
    expect([JSON.stringify(payload), res.statusCode, res.json()]).toEqual([JSON.stringify(payload), 403, { error: SERVER_ONLY }]);
  }
  const ok = await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { privacyContact: 'contact@example.org', retentionMonths: 12 } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toMatchObject({ privacyContact: 'contact@example.org', retentionMonths: 12 });
  const read = await app.inject({ method: 'GET', url: '/api/app-settings' });
  expect(read.statusCode).toBe(200);
  expect(read.json()).toMatchObject({ googleAvailable: false, smtp: null });
});

test('PC : les fiches club restent téléchargeables', async () => {
  expect((await app.inject({ method: 'GET', url: comp('/club-form.pdf') })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: comp('/club-form.ods') })).statusCode).toBe(200);
});

test('clubServices forcé à true : les routes répondent', async () => {
  const a = await buildApp({ dbPath: tmpDbPath(), clubServices: true });
  try {
    const cid = (await a.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
    expect((await a.inject({ method: 'GET', url: `/api/competitions/${cid}/invitations` })).statusCode).toBe(200);
  } finally {
    await a.close();
  }
});

test('serveur en ligne connecté : les invitations répondent 200', async () => {
  const p = tmpDbPath();
  const db = openDb(p);
  createUser(db, 'orga@example.org', 'mot-de-passe-long');
  closeDb(db);
  const a = await buildApp({ dbPath: p, role: 'serveur' });
  try {
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const cid = (await a.inject({ method: 'POST', url: '/api/competitions', headers: { cookie }, payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
    expect((await a.inject({ method: 'GET', url: `/api/competitions/${cid}/invitations`, headers: { cookie } })).statusCode).toBe(200);
  } finally {
    await a.close();
  }
});
