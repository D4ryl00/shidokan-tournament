import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { todayInParis } from '../../src/domain/public/view.js';
import { competitionChanged, everythingChanged } from '../../src/server/events.js';
import { forgetPublicCache, publicCompetition, publicList } from '../../src/server/public/cache.js';
import { createRegistration } from '../../src/server/repositories/registrations.js';
import { competitionFingerprint } from '../../src/server/sync/package.js';
import type { PublicCompetition, PublicCompetitionSummary } from '../../src/domain/public/types.js';
import { tmpDbPath, tmpDir } from '../helpers/tmp-db.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const PASSWORD = 'mot-de-passe-long';
const NOT_FOUND = { error: 'Compétition introuvable.' };
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Cat = { id: string; label: string; waveId: string | null };

/**
 * Rôle serveur, organisateur connecté ; compétition publique du jour (Tatami 1 et 2) : -54 sur Tatami 1, -61 sur Tatami 2,
 * kata sur Tatami 1, non lancée. Un club avec coordonnées, un grade et une pesée : données d'organisation à ne jamais montrer.
 * Le visiteur passe par `visit` (sans cookie).
 */
async function setup() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'orga@example.org', PASSWORD);
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur' });
  const a = app;
  const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: PASSWORD } });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const orga = (method: Method, url: string, payload?: unknown) => a.inject({ method, url, headers: { cookie }, payload: payload as object });
  const visit = (url: string, headers: Record<string, string> = {}) => a.inject({ method: 'GET', url, headers });
  const today = todayInParis(new Date());
  const id = (await orga('POST', '/api/competitions', { name: 'Coupe du jour', date: today, location: 'Lyon' })).json().id as string;
  const base = `/api/competitions/${id}`;
  expect((await orga('PATCH', base, { visibility: 'public' })).statusCode).toBe(200);
  const [t1, t2] = ((await orga('GET', `${base}/zones`)).json() as { id: string }[]).map((z) => z.id);
  const club = (await orga('POST', `${base}/clubs`, { name: 'Dojo Lyon', coachName: 'Jean Coach', coachPhone: '0611223344', coachEmails: ['coach@example.org'] })).json().id as string;
  let n = 0;
  const register = (discipline: 'karate' | 'kata', weightClassId: string | null) =>
    orga('POST', `${base}/registrations`, {
      clubId: club,
      lastName: `NOM${++n}`,
      firstName: 'Léa',
      sex: 'F',
      ageBandCode: 'cadet',
      licence: 'LIC777',
      grade: '3e kyu',
      discipline,
      ruleset: discipline === 'kata' ? null : 'jiyu',
      weightClassId,
      source: 'manual',
    });
  for (let i = 0; i < 4; i++) await register('karate', 'cadet:F:-54');
  for (let i = 0; i < 4; i++) await register('karate', 'cadet:F:-61');
  for (let i = 0; i < 3; i++) await register('kata', null);
  const rows = (await orga('GET', `${base}/registrations`)).json() as { fighterId: string; weightClassId: string | null }[];
  const weighed = rows.find((r) => r.weightClassId === 'cadet:F:-54')!;
  expect((await orga('PUT', `${base}/weigh-in/${weighed.fighterId}`, { presence: 'present', weighInKg: 52.7 })).statusCode).toBe(204);
  const cats = async () => (await orga('GET', `${base}/categories`)).json() as Cat[];
  for (const c of await cats()) await orga('PATCH', `${base}/categories/${c.id}`, { status: 'ready', zoneId: c.label.includes('-61') ? t2 : t1 });
  const launch = async () => expect((await orga('POST', `${base}/launch`, { waveId: null })).statusCode).toBe(204);
  const byLabel = async (s: string) => (await cats()).find((c) => c.label.includes(s))!;
  return { a, orga, visit, cookie, dbPath, id, base, today, launch, byLabel, pub: `/api/public/competitions/${id}` };
}

test('private competition is 404 like an unknown one', async () => {
  const { orga, visit, base, pub, launch, id } = await setup();
  await launch();
  expect((await orga('PATCH', base, { visibility: 'private' })).statusCode).toBe(200);
  const unknown = await visit('/api/public/competitions/inconnu');
  const priv = await visit(pub);
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json()).toEqual(NOT_FOUND);
  expect([priv.statusCode, priv.body]).toEqual([unknown.statusCode, unknown.body]);
  const unknownEvents = await visit('/api/public/competitions/inconnu/events');
  const privEvents = await visit(`/api/public/competitions/${id}/events`);
  expect(unknownEvents.statusCode).toBe(404);
  expect([privEvents.statusCode, privEvents.body]).toEqual([unknownEvents.statusCode, unknownEvents.body]);
  expect(privEvents.body).toBe(unknown.body);
});

test('public list shows public competitions only', async () => {
  const { orga, visit, id, today } = await setup();
  const create = async (name: string, date: string, visibility: 'public' | 'private') => {
    const cid = (await orga('POST', '/api/competitions', { name, date })).json().id as string;
    if (visibility === 'public') await orga('PATCH', `/api/competitions/${cid}`, { visibility });
    return cid;
  };
  const later = await create('Open de printemps', '2099-04-02', 'public');
  const soon = await create('Open d’hiver', '2099-01-10', 'public');
  const old = await create('Coupe 2000', '2000-05-01', 'public');
  const older = await create('Coupe 1999', '1999-05-01', 'public');
  await create('Interne', today, 'private');
  await create('Interne futur', '2099-02-01', 'private');
  const res = await visit('/api/public/competitions');
  expect(res.statusCode).toBe(200);
  const body = res.json() as { today: PublicCompetitionSummary[]; upcoming: PublicCompetitionSummary[]; past: PublicCompetitionSummary[] };
  expect(body.today).toEqual([{ id, name: 'Coupe du jour', date: today, location: 'Lyon', phase: 'today', launched: false }]);
  expect(body.upcoming.map((c) => c.id)).toEqual([soon, later]);
  expect(body.past.map((c) => c.id)).toEqual([old, older]);
  expect(body.upcoming[0]).toEqual({ id: soon, name: 'Open d’hiver', date: '2099-01-10', location: null, phase: 'upcoming', launched: false });
  expect(res.body).not.toContain('Interne');
});

test('nothing before launch', async () => {
  const { visit, pub, launch } = await setup();
  const before = (await visit(pub)).json() as PublicCompetition;
  expect(before.categories).toEqual([]);
  expect(before.queues).toEqual([]);
  expect(before.zones).toEqual([]);
  expect(before.entrants).toEqual({});
  await launch();
  const after = (await visit(pub)).json() as PublicCompetition;
  expect(after.categories.map((c) => c.label).sort()).toEqual(expect.arrayContaining([expect.stringContaining('-54'), expect.stringContaining('-61')]));
  expect(after.categories.length).toBe(3);
  for (const c of after.categories) expect(Object.keys(c.numbers).length).toBeGreaterThan(0);
  expect(after.queues.length).toBe(2);
  expect(after.waves).toEqual([{ id: null, name: 'Session unique', launched: true }]);
  const list = (await visit('/api/public/competitions')).json() as { today: PublicCompetitionSummary[] };
  expect(list.today[0]).toMatchObject({ phase: 'today', launched: true });
});

test('reopened wave disappears', async () => {
  const { orga, visit, base, pub, launch } = await setup();
  await launch();
  expect(((await visit(pub)).json() as PublicCompetition).categories.length).toBe(3);
  expect((await orga('POST', `${base}/launch/reopen`, { waveId: null })).statusCode).toBe(204);
  const view = (await visit(pub)).json() as PublicCompetition;
  expect(view.categories).toEqual([]);
  expect(view.queues).toEqual([]);
  expect(view.waves).toEqual([{ id: null, name: 'Session unique', launched: false }]);
});

test('turning private again returns 404', async () => {
  const { orga, visit, base, pub, launch } = await setup();
  await launch();
  expect((await visit(pub)).statusCode).toBe(200);
  expect(((await visit('/api/public/competitions')).json() as { today: unknown[] }).today.length).toBe(1);
  expect((await orga('PATCH', base, { visibility: 'private' })).statusCode).toBe(200);
  const res = await visit(pub);
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual(NOT_FOUND);
  expect(((await visit('/api/public/competitions')).json() as { today: unknown[] }).today).toEqual([]);
});

test('etag answers 304', async () => {
  const { visit, pub, launch } = await setup();
  await launch();
  for (const url of [pub, '/api/public/competitions']) {
    const first = await visit(url);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-cache');
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    const again = await visit(url, { 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect(again.headers.etag).toBe(etag);
    expect((await visit(url, { 'if-none-match': '"autre"' })).statusCode).toBe(200);
  }
});

test('a result changes the etag', async () => {
  const { orga, visit, base, pub, launch, byLabel } = await setup();
  await launch();
  const first = await visit(pub);
  const etag = String(first.headers.etag);
  expect((await visit(pub)).headers.etag).toBe(etag);
  const a54 = await byLabel('-54');
  expect((await orga('PUT', `${base}/categories/${a54.id}/results/w1-0`, { winner: 'a', method: 'points' })).statusCode).toBe(200);
  const after = await visit(pub, { 'if-none-match': etag });
  expect(after.statusCode).toBe(200);
  expect(after.headers.etag).not.toBe(etag);
  const view = after.json() as PublicCompetition;
  expect(view.categories.find((c) => c.id === a54.id)).toMatchObject({ status: 'started', results: { 'w1-0': { winner: 'a', method: 'points' } } });
});

test('no organisation data in public json', async () => {
  const { visit, pub, launch } = await setup();
  await launch();
  const body = (await visit(pub)).body;
  expect(body).toContain('Dojo Lyon');
  expect(body).toContain('NOM1 Léa');
  for (const secret of ['52.7', 'coach@example.org', '0611223344', 'Jean Coach', '3e kyu', 'LIC777', 'weighInKg', 'presence', 'grade', 'licence', 'coachEmails']) {
    expect(body, secret).not.toContain(secret);
  }
});

test('public routes need no session', async () => {
  const { visit, pub, id } = await setup();
  for (const url of ['/api/public/competitions', pub, `/api/public/competitions/${id}/events`, '/api/public/competitions/inconnu']) {
    const res = url.endsWith('/events') ? await openEvents(url) : await visit(url);
    expect(res.statusCode, url).not.toBe(401);
  }
});

test('public pages and responses are not indexed (X-Robots-Tag)', async () => {
  const { a, visit, pub, id, launch } = await setup();
  await launch();
  const first = await visit(pub);
  const notModified = await visit(pub, { 'if-none-match': String(first.headers.etag) });
  expect(notModified.statusCode).toBe(304);
  for (const res of [first, notModified, await visit('/api/public/competitions'), await visit('/api/public/competitions/inconnu')]) {
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  }
  expect((await openEvents(`/api/public/competitions/${id}/events`)).robots).toBe('noindex, nofollow');
  // Les routes des organisateurs ne sont pas concernées.
  expect((await a.inject({ method: 'GET', url: '/api/competitions' })).headers['x-robots-tag']).toBeUndefined();
});

test('the SPA page is not indexed on /public… and, on the server, on / (public home)', async () => {
  const dist = tmpDir('sk-dist-');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Shidokan</title>');
  const html = async (role: 'serveur' | 'local', url: string) => {
    const one = await buildApp({ dbPath: tmpDbPath(), role, webDistDir: dist });
    try {
      const res = await one.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('Shidokan');
      return res.headers['x-robots-tag'];
    } finally {
      await one.close();
    }
  };
  for (const url of ['/', '/public', '/public/abc', '/public/abc?onglet=zones']) expect(await html('serveur', url), url).toBe('noindex, nofollow');
  expect(await html('local', '/public/abc')).toBe('noindex, nofollow');
  expect(await html('serveur', '/connexion')).toBeUndefined();
  expect(await html('serveur', '/competitions/abc/reglages')).toBeUndefined();
  expect(await html('local', '/')).toBeUndefined();
});

/** Ouvre le flux public sur un vrai port et lit le statut (le flux reste ouvert : il est coupé aussitôt). */
async function openEvents(path: string): Promise<{ statusCode: number; contentType: string | null; robots: string | null }> {
  const a = app!;
  if (!a.server.listening) await a.listen({ port: 0, host: '127.0.0.1' });
  const port = (a.server.address() as { port: number }).port;
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
  controller.abort();
  return { statusCode: res.status, contentType: res.headers.get('content-type'), robots: res.headers.get('x-robots-tag') };
}

test('public event stream: change without origin', async () => {
  const { a, base, cookie, id, launch } = await setup();
  await a.listen({ port: 0, host: '127.0.0.1' });
  const port = (a.server.address() as { port: number }).port;
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/public/competitions/${id}/events`, { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  let text = '';
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    } catch {
      /* flux fermé */
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  // Écriture d'un poste identifié : son identifiant ne sort pas dans le flux public.
  await a.inject({ method: 'PATCH', url: base, headers: { cookie, 'x-poste-id': 'poste-secret' }, payload: { location: 'Nice' } });
  await launch();
  await new Promise((r) => setTimeout(r, 300));
  controller.abort();
  await reading;
  expect(text).toContain('event: change\ndata: {}\n\n');
  expect(text).not.toContain('origin');
  expect(text).not.toContain('poste-secret');
});

test('cached until a change on the bus, whatever its source (package import, restore)', async () => {
  const { visit, pub, launch, dbPath, id } = await setup();
  await launch();
  const etag = String((await visit(pub)).headers.etag);
  expect((await visit('/api/public/competitions')).body).toContain('Lyon');
  // Écriture hors des routes (comme une restauration) : la réponse gardée ne bouge pas tant que rien ne prévient.
  const db = openDb(dbPath);
  try {
    db.$client.prepare('update competitions set location = ? where id = ?').run('Grenoble', id);
    expect((await visit(pub)).headers.etag).toBe(etag);
    expect((await visit('/api/public/competitions')).body).not.toContain('Grenoble');
    everythingChanged();
    const after = await visit(pub);
    expect(after.headers.etag).not.toBe(etag);
    expect(after.json()).toMatchObject({ location: 'Grenoble' });
    expect((await visit('/api/public/competitions')).body).toContain('Grenoble');
    db.$client.prepare('update competitions set location = ? where id = ?').run('Annecy', id);
    competitionChanged(id);
    expect((await visit(pub)).json()).toMatchObject({ location: 'Annecy' });
    expect((await visit('/api/public/competitions')).body).toContain('Annecy');
  } finally {
    closeDb(db);
  }
});

test('a public read writes nothing: categories left unsynced stay as they are (rescue fingerprint unchanged)', async () => {
  const { visit, orga, pub, base, launch, dbPath, id } = await setup();
  await launch();
  const db = openDb(dbPath);
  try {
    // Inscription écrite hors des routes : les catégories ne sont pas resynchronisées (comme après une pesée juste avant une coupure).
    const club = ((await orga('GET', `${base}/clubs`)).json() as { id: string }[])[0]!.id;
    await createRegistration(db, id, {
      clubId: club, lastName: 'TARDIF', firstName: 'Zoé', sex: 'M', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual',
    });
    const categoryCount = () => (db.$client.prepare('select count(*) as n from categories where competition_id = ?').get(id) as { n: number }).n;
    const before = { fingerprint: competitionFingerprint(db, id), categories: categoryCount() };
    competitionChanged(id);
    expect((await visit(pub)).statusCode).toBe(200);
    expect((await visit('/api/public/competitions')).statusCode).toBe(200);
    expect({ fingerprint: competitionFingerprint(db, id), categories: categoryCount() }).toEqual(before);
  } finally {
    closeDb(db);
  }
});

test('the day is part of the cache key: the phase changes at midnight', async () => {
  const { id, today, dbPath } = await setup();
  const db = openDb(dbPath);
  try {
    const noon = new Date(`${today}T12:00:00+01:00`);
    const nextDay = new Date(noon.getTime() + 24 * 3600 * 1000);
    const first = await publicCompetition(db, id, noon);
    expect(JSON.parse(first!.body).phase).toBe('today');
    expect((await publicCompetition(db, id, noon))!.etag).toBe(first!.etag);
    expect(JSON.parse((await publicCompetition(db, id, nextDay))!.body).phase).toBe('past');
    expect(JSON.parse((await publicList(db, noon)).body).today.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(JSON.parse((await publicList(db, nextDay)).body).past.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(await publicCompetition(db, 'inconnu', noon)).toBeNull();
  } finally {
    forgetPublicCache(db);
    closeDb(db);
  }
});

test('public event stream closes when the competition turns private', async () => {
  const { a, orga, base, id } = await setup();
  await a.listen({ port: 0, host: '127.0.0.1' });
  const port = (a.server.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/public/competitions/${id}/events`);
  const reader = res.body!.getReader();
  let text = '';
  const reading = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return 'fermé';
      text += new TextDecoder().decode(value);
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  expect((await orga('PATCH', base, { visibility: 'private' })).statusCode).toBe(200);
  // Le flux prévient (le téléphone relit et reçoit 404) puis se ferme de lui-même.
  expect(await Promise.race([reading, new Promise((r) => setTimeout(() => r('ouvert'), 2000))])).toBe('fermé');
  expect(text).toContain('event: change');
});
