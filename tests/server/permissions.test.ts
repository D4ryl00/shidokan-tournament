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
  'POST /registrations', 'PUT /registrations/:rid', 'DELETE /registrations/:rid', 'POST /clubs', 'PATCH /clubs/:clubId', 'POST /clubs/from-directory', 'POST /clubs/new',
  'PUT /weigh-in/:fighterId', 'POST /weigh-in/close',
  'POST /replacement/preview', 'POST /replacement/apply', 'POST /replacement/plan', 'POST /replacement/plan/apply', 'POST /replacement/refuse', 'POST /replacement/unrefuse', 'POST /replacement/move', 'POST /replacement/exchange', 'POST /replacement/exchange/preview', 'POST /replacement/withdraw', 'POST /replacement/set-aside', 'POST /replacement/resume', 'POST /history/undo',
  'POST /free-tableaux', 'PATCH /free-tableaux/:cid', 'DELETE /free-tableaux/:cid',
  'PUT /replacement/rules', 'POST /replacement/rules/reset', 'POST /replacement/reset',
  'PATCH /categories/:cid', 'POST /categories/:cid/redraw', 'POST /categories/:cid/swap', 'POST /categories/:cid/move', 'POST /categories/:cid/move/preview', 'POST /categories/:cid/regenerate',
  'POST /launch', 'POST /launch/reopen', 'POST /launch/number', 'POST /launch/number/preview',
  'PUT /fighters/:fighterId/public-name', 'PUT /wave-schedules',
  'POST /clubs/:clubId/lines', 'PUT /clubs/:clubId/lines/:fighterId', 'DELETE /clubs/:clubId/lines/:fighterId', 'POST /ffk-pdf',
  'PUT /categories/:cid/results/:matchId', 'DELETE /categories/:cid/results/:matchId', 'PUT /categories/:cid/kata/:rid/:round', 'PUT /categories/:cid/tie-break',
].map((r) => r.replace(' ', ' /api/competitions/:id'));
/** Écritures d'un compte Zone, sur sa zone. */
const ZONE_WRITES = [
  'PUT /categories/:cid/results/:matchId', 'DELETE /categories/:cid/results/:matchId', 'PUT /categories/:cid/kata/:rid/:round', 'PUT /categories/:cid/tie-break',
].map((r) => r.replace(' ', ' /api/competitions/:id'));
const DENIED_GETS = ['/invitations', '/invitations/preview', '/invitations/:clubId/links', '/mail-attachments', '/mail-attachments/:attachmentId', '/received-copies', '/export.json'].map((p) => `/api/competitions/:id${p}`);
const COMMON = ['GET /api/competitions', 'POST /api/auth/logout', 'PUT /api/users/me/password'];
const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/me$/, /^\/api\/auth\/login$/, /^\/api\/inscription(\/|$)/, /^\/api\/sync\/remote\//, /^\/api\/public\//];

/** Rôle serveur, organisateur ; compétition (Tatami 1 et 2) : -54 et kata sur Tatami 1, -61 sur Tatami 2, lancée ; une autre compétition. */
async function setup() {
  const dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'orga@example.org', PASSWORD);
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur' });
  const a = app;
  const orgaCookie = await loginAs(a, 'orga@example.org');
  const as = (cookie: string) => (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}) => a.inject({ method, url, headers: { cookie, ...headers }, payload: payload as object });
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

const PDF = { 'content-type': 'application/octet-stream' };
test('ffk-pdf : refusé à un compte Zone ; la lecture des fiches d’un club suit la règle de GET fighters/:fighterId/line', async () => {
  const { table, zone1, orga, base } = await setup();
  const clubId = (await orga('POST', `${base}/clubs`, { name: 'Tani Dojo' })).json().id as string;
  const denied = await zone1('POST', `${base}/ffk-pdf?discipline=karate`, 'x', PDF);
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error).toBe(FORBIDDEN);
  expect((await table('POST', `${base}/ffk-pdf?discipline=karate`, 'x', PDF)).statusCode).not.toBe(403);
  const fighterId = ((await orga('GET', `${base}/registrations`)).json() as { fighter: { id: string } }[])[0]!.fighter.id;
  const reference = (await zone1('GET', `${base}/fighters/${fighterId}/line`)).statusCode;
  expect((await zone1('GET', `${base}/clubs/${clubId}/lines`)).statusCode).toBe(reference);
});

test('PUT wave-schedules : permis à la Table centrale, refusé à un compte Zone', async () => {
  const { table, zone1, base } = await setup();
  const url = `${base}/wave-schedules`;
  expect((await table('PUT', url, { waveId: null, plannedStart: '09:30' })).statusCode).toBe(200);
  const denied = await zone1('PUT', url, { waveId: null, plannedStart: '09:30' });
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error).toBe(FORBIDDEN);
});

test('images et filtre du message aux clubs : réservés à l’organisateur (Table centrale, Zone et sans session refusées)', async () => {
  const { table, zone1, a } = await setup();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const octet = { 'content-type': 'application/octet-stream' };
  for (const [name, who] of [['table', table], ['zone', zone1]] as const) {
    for (const [method, url, payload] of [['POST', '/api/mail-images', undefined], ['GET', '/api/mail-images/11111111-1111-4111-8111-111111111111', undefined], ['POST', '/api/mail-html/check', { html: '<p>x</p>' }]] as const) {
      const res = await who(method, url, payload);
      expect(res.statusCode, `${name} ${method} ${url}`).toBe(403);
    }
  }
  for (const [method, url, payload, headers] of [['POST', '/api/mail-images', png, octet], ['GET', '/api/mail-images/11111111-1111-4111-8111-111111111111', undefined, {}], ['POST', '/api/mail-html/check', { html: '<p>x</p>' }, {}]] as const) {
    const res = await a.inject({ method, url, payload: payload as never, headers });
    expect(res.statusCode, `sans session ${method} ${url}`).toBe(401);
  }
});

test('pages et fichiers de l’application (hors /api) : toujours servis, quel que soit le rôle', () => {
  for (const role of ['table', 'zone'] as const) {
    expect(routeAccess(user(role), 'GET', '/*')).toBe('allow');
    expect(routeAccess(user(role), 'GET', '/')).toBe('allow');
    expect(routeAccess(user(role), 'GET', '')).toBe('allow');
  }
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

test('synchronisation Google de l’annuaire : réservée à l’organisateur', () => {
  for (const route of ['/api/club-directory/google/preview', '/api/club-directory/google/apply']) {
    expect(routeAccess(user('table'), 'POST', route), `table ${route}`).toBe('deny');
    expect(routeAccess(user('zone'), 'POST', route), `zone ${route}`).toBe('deny');
    expect(routeAccess(user('organisateur'), 'POST', route), `organisateur ${route}`).toBe('allow');
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

test('tableaux libres et annulation d’un déplacement manuel : Table centrale oui, Zone 403', async () => {
  const { table, zone1, base } = await setup();
  const created = await table('POST', `${base}/free-tableaux`, { name: 'Gala', discipline: 'karate', ruleset: 'jiyu' });
  expect(created.statusCode).toBe(201);
  const cid = (created.json() as { id: string }).id;
  for (const [method, url, payload] of [
    ['POST', `${base}/free-tableaux`, { name: 'Autre', discipline: 'karate', ruleset: 'jiyu' }],
    ['PATCH', `${base}/free-tableaux/${cid}`, { name: 'Gala 2' }],
    ['DELETE', `${base}/free-tableaux/${cid}`, undefined],
    ['POST', `${base}/history/undo`, { ids: ['x'], expect: ['x'] }],
  ] as const) {
    const res = await zone1(method, url, payload);
    expect(res.statusCode, `${method} ${url}`).toBe(403);
    expect(res.json().error).toBe(FORBIDDEN);
  }
  // Table centrale : permis (ici refusé par la session lancée, pas par le rôle).
  expect((await table('PATCH', `${base}/free-tableaux/${cid}`, { name: 'Gala 2' })).statusCode).toBe(409);
  expect((await table('DELETE', `${base}/free-tableaux/${cid}`)).statusCode).toBe(409);
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

test('changements de coordonnées des clubs : Table centrale et Zone refusées, l’organisateur autorisé ; une modification de la Table dans l’onglet Clubs crée la ligne', async () => {
  const { orga, table, zone1, base } = await setup();
  const entryId = (await orga('POST', '/api/club-directory', { name: 'Tani Dojo', affiliationNumber: null, coachName: 'Jean', coachPhone: '0600000000', coachEmails: [], notes: null })).json().id as string;
  const club = (await orga('POST', `${base}/clubs/from-directory`, { directoryId: entryId })).json() as { id: string };
  for (const [method, url] of [['GET', '/api/club-changes'], ['POST', `/api/club-changes/${club.id}/resolve`], ['POST', `/api/club-changes/${club.id}/ignore`], ['POST', `/api/club-directory/${entryId}/apply-to-clubs`], ['GET', `/api/club-directory/${entryId}/upcoming`], ['PATCH', `/api/club-directory/${entryId}`]] as const) {
    for (const [name, who] of [['table', table], ['zone', zone1]] as const) {
      const res = await who(method, url, method === 'GET' ? undefined : {});
      expect(res.statusCode, `${name} ${method} ${url}`).toBe(403);
    }
  }
  expect((await orga('GET', '/api/club-changes')).statusCode).toBe(200);
  expect((await table('PATCH', `${base}/clubs/${club.id}`, { coachPhone: '0611111111' })).statusCode).toBe(200);
  const changes = (await orga('GET', '/api/club-changes')).json() as { clubId: string; origin: string }[];
  expect(changes).toMatchObject([{ clubId: club.id, origin: 'competition' }]);
});

test('lignes de combattants de l’organisateur : permises à la Table centrale, refusées à un compte Zone', async () => {
  const { table, zone1, base } = await setup();
  const clubId = (await table('POST', `${base}/clubs`, { name: 'Tani Dojo' })).json().id as string;
  const line = { lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55', weightKg: null, combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null };
  const created = await table('POST', `${base}/clubs/${clubId}/lines`, { line, publicNameHidden: false });
  expect(created.statusCode, created.body).toBe(201);
  const { fighterId } = created.json() as { fighterId: string };
  const fresh = ((await table('GET', `${base}/fighters/${fighterId}/line`)).json() as { version: string }).version;
  expect((await zone1('GET', `${base}/fighters/${fighterId}/line`)).statusCode).toBe(200);
  const put = await table('PUT', `${base}/clubs/${clubId}/lines/${fighterId}`, { line, version: fresh, publicNameHidden: true });
  expect(put.statusCode, put.body).toBe(200);
  for (const [method, url, payload] of [['POST', `${base}/clubs/${clubId}/lines`, { line, publicNameHidden: false }], ['PUT', `${base}/clubs/${clubId}/lines/${fighterId}`, { line, version: 'x', publicNameHidden: false }], ['DELETE', `${base}/clubs/${clubId}/lines/${fighterId}?version=x`, undefined]] as const) {
    const res = await zone1(method, url, payload);
    expect(res.statusCode, `${method} ${url}`).toBe(403);
    expect(res.json().error).toBe(FORBIDDEN);
  }
  const now = ((await table('GET', `${base}/fighters/${fighterId}/line`)).json() as { version: string }).version;
  expect((await table('DELETE', `${base}/clubs/${clubId}/lines/${fighterId}?version=${encodeURIComponent(now)}`)).statusCode).toBe(204);
});
