import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { SERVER_ONLY } from '../../src/domain/app-settings.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import type { MailTransport } from '../../src/server/mail.js';
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
  for (const payload of [{ smtp }, { mailMode: 'smtp' }, { googleFromName: 'Shidokan' }, { invitationMail: { subject: 'S', body: 'B' } }, { privacyContact: 'a@example.org', mailMode: 'smtp' }]) {
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

test('PC : le message d’une compétition ne change pas ; les autres réglages et une valeur identique passent', async () => {
  const patch = (settings: unknown) => app.inject({ method: 'PATCH', url: comp(''), payload: { settings } });
  for (const invitationMail of [{ subject: 'S', body: 'B' }, { subject: 'S', body: '<p>B</p>', format: 'html' }]) {
    const res = await patch({ invitationMail });
    expect([res.statusCode, res.json()]).toEqual([403, { error: SERVER_ONLY }]);
  }
  expect((await patch({ repechage: true })).statusCode).toBe(200);
  expect((await patch({ invitationMail: null })).statusCode).toBe(200);
  // Un message arrivé avec la compétition : le renvoyer tel quel passe, le retirer ou le changer non.
  const mail = { subject: 'S', body: '<p>Arrivé</p>', format: 'html' };
  const raw = new Database(dbPath);
  const row = raw.prepare('select settings_json as s from competitions where id = ?').get(id) as { s: string };
  raw.prepare('update competitions set settings_json = ? where id = ?').run(JSON.stringify({ ...(JSON.parse(row.s) as object), invitationMail: mail }), id);
  raw.close();
  expect((await patch({ invitationMail: { format: 'html', body: mail.body, subject: mail.subject } })).statusCode).toBe(200);
  expect((await patch({ invitationMail: null })).statusCode).toBe(403);
  expect((await patch({ invitationMail: { ...mail, body: '<p>Autre</p>' } })).statusCode).toBe(403);
});

test('main ailleurs : l’envoi aux clubs est refusé, le message et son image restent ; au retour du paquet, l’envoi part avec l’image', async () => {
  const p = tmpDbPath();
  const d = openDb(p);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  const sent: { to: string; html?: string; attachments?: { cid?: string; content: Buffer }[] }[] = [];
  const transport: MailTransport = () => ({
    verify: async () => true,
    sendMail: async (m: { to: { address: string }[]; html?: string; attachments?: { cid?: string; content: Buffer }[] }) => {
      sent.push({ to: m.to.map((a) => a.address).join(', '), html: m.html, attachments: m.attachments });
      return {};
    },
  });
  const srv = await buildApp({ dbPath: p, role: 'serveur', publicUrl: 'https://competitions.example.org', mailTransport: transport });
  try {
    const cookie = String((await srv.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
    const orga = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => srv.inject({ method, url, headers: { cookie }, payload: payload as object });
    const cid = (await orga('POST', '/api/competitions', { name: 'Coupe', date: '2026-11-22' })).json().id as string;
    const base = `/api/competitions/${cid}`;
    await orga('PATCH', '/api/app-settings', { smtp: { host: 'smtp.example.org', port: 465, security: 'tls', user: 'orga@example.org', password: 'x', fromName: 'Shidokan France', fromEmail: 'orga@example.org' } });
    await orga('PATCH', `${base}/club-entry`, { status: 'open', deadline: '2026-11-15' });

    // Un message avec une image, un club invité.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const image = (await srv.inject({ method: 'POST', url: '/api/mail-images', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: png })).json() as { id: string; url: string };
    const body = `<p>Bonjour {coach}</p><img src="${image.url}"><p>{lien}</p>`;
    expect((await orga('PATCH', base, { settings: { invitationMail: { subject: 'Inscriptions', body, format: 'html' } } })).statusCode).toBe(200);
    const directory = (await orga('POST', '/api/club-directory', { name: 'Tani Dojo', affiliationNumber: null, coachName: 'Jean', coachPhone: null, coachEmails: ['tani@example.org'], notes: null })).json().id as string;
    const [link] = (await orga('POST', `${base}/invitations`, { directoryIds: [directory] })).json() as { clubId: string }[];
    const linksOf = async () => ((await orga('GET', `${base}/invitations/${link!.clubId}/links`)).json() as unknown[]).length;
    expect(await linksOf()).toBe(1);

    // La compétition part sur un PC (paquet exporté, main ailleurs).
    const jeton = (await orga('POST', '/api/sync/tokens', { name: 'PC de la salle' })).json().token as string;
    const remote = (path: string, payload: unknown) => srv.inject({ method: 'POST', url: `/api/sync/remote${path}`, headers: { authorization: `Bearer ${jeton}` }, payload: payload as object });
    const pkg = (await remote(`/competitions/${cid}/take`, { instanceId: 'pc-1', instanceName: 'PC-SALLE' })).json();

    // Pendant ce temps : envoi refusé, aucun mail, aucun lien de plus ; le message et son image sont intacts.
    const refused = await orga('POST', `${base}/invitations/send`, { clubs: [{ clubId: link!.clubId }] });
    expect(refused.statusCode).toBe(409);
    expect(sent).toEqual([]);
    expect(await linksOf()).toBe(1);
    const mine = (await orga('GET', base)).json() as { settings: { invitationMail: { body: string } } };
    expect(mine.settings.invitationMail.body).toContain(image.url);
    expect((await srv.inject({ method: 'GET', url: image.url, headers: { cookie } })).statusCode).toBe(200);

    // Le paquet revient : la main aussi, et l'envoi part avec l'image dans le mail.
    // Il revient avec du HTML sale dans le message : le mail et l'aperçu sont filtrés quand même.
    const row = pkg.tables.competitions[0];
    const settings = JSON.parse(row.settings_json);
    settings.invitationMail.body += '<script>alert(1)</script><a href="javascript:x()" onclick="x()">j</a><img src="https://e.fr/a.png">';
    row.settings_json = JSON.stringify(settings);
    const back = await remote(`/competitions/${cid}/return`, { ...pkg, from: { instanceId: 'pc-1', instanceName: 'PC-SALLE', role: 'local' }, handOver: true });
    expect(back.statusCode).toBe(200);
    const dirty = /<script|alert|javascript:|onclick|e\.fr/;
    expect((await orga('GET', `${base}/invitations/preview?clubId=${link!.clubId}`)).json().html).not.toMatch(dirty);
    const res = await orga('POST', `${base}/invitations/send`, { clubs: [{ clubId: link!.clubId }] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ status: 'sent' })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).not.toMatch(dirty);
    expect(sent[0]!.html).toContain(`cid:image-${image.id}@shidokan`);
    expect(sent[0]!.attachments!.find((a) => a.cid === `image-${image.id}@shidokan`)!.content.equals(png)).toBe(true);
    expect(await linksOf()).toBe(2);
  } finally {
    await srv.close();
  }
});
