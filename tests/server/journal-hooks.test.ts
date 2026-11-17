import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { currentJournal } from '../../src/server/journal/context.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance | null = null;
let dbPath: string;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

type Entry = { seq: number; type: string; action: string; via: string; actor: Record<string, unknown>; data: Record<string, unknown> };
const entries = (competitionId: string): Entry[] => {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('select * from journal_entries where competition_id = ? order by seq').all(competitionId) as { seq: number; type: string; action: string; via: string; actor_json: string; data_json: string }[];
  db.close();
  return rows.map((r) => ({ seq: r.seq, type: r.type, action: r.action, via: r.via, actor: JSON.parse(r.actor_json), data: JSON.parse(r.data_json) }));
};
const allColumns = (): string => {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('select * from journal_entries').all();
  db.close();
  return JSON.stringify(rows);
};

const REG = { clubId: null, lastName: 'DUPONT', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' };

/** `routes` : routes de test ajoutées avant la première requête. */
async function local(opts: { clubServices?: boolean } = {}, routes: (a: FastifyInstance) => void = () => {}) {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath, ...opts });
  const a = app;
  routes(a);
  const id = (await a.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id as string;
  return { a, id, base: `/api/competitions/${id}`, last: () => entries(id).at(-1)!, count: () => entries(id).length };
}

test('rôle local : poste déclaré, zone nommée', async () => {
  const { a, base, last } = await local();
  const zones = (await a.inject({ method: 'GET', url: `${base}/zones` })).json() as { id: string }[];
  expect((await a.inject({ method: 'PUT', url: `${base}/zones`, payload: [{ id: zones[0]!.id, name: 'Zone 1' }, { id: zones[1]!.id, name: 'Zone 2' }] })).statusCode).toBe(200);
  const post = (headers: Record<string, string>) => a.inject({ method: 'POST', url: `${base}/registrations`, payload: REG, headers });

  expect((await post({ 'x-poste': `zone:${zones[1]!.id}` })).statusCode).toBe(201);
  expect(last().actor).toEqual({ kind: 'poste', poste: 'zone', zoneName: 'Zone 2' });
  await post({ 'x-poste': 'zone:inconnue' });
  expect(last().actor).toEqual({ kind: 'poste', poste: 'zone' });
  await post({ 'x-poste': 'table' });
  expect(last().actor).toEqual({ kind: 'poste', poste: 'table' });
  await post({ 'x-poste': 'organisation' });
  expect(last().actor).toEqual({ kind: 'poste', poste: 'organisation' });
  await post({});
  expect(last().actor).toEqual({ kind: 'poste', poste: 'inconnu' });
  await post({ 'x-poste': 'n’importe quoi' });
  expect(last().actor).toEqual({ kind: 'poste', poste: 'inconnu' });
});

test('le contexte posé à l’arrivée est visible dans un gestionnaire async, après un await', async () => {
  const { a, base } = await local({}, (a) =>
    a.post('/api/competitions/:id/test-contexte', async () => {
      await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setImmediate(r));
      const ctx = currentJournal();
      return { actor: ctx?.actor, competitionId: ctx?.competitionId };
    }),
  );
  const res = await a.inject({ method: 'POST', url: `${base}/test-contexte`, headers: { 'x-poste': 'table' } });
  expect(res.json()).toEqual({ actor: { kind: 'poste', poste: 'table' }, competitionId: base.split('/').at(-1) });
});

test('rôle serveur : le compte connecté', async () => {
  dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'orga@exemple.fr', 'mot-de-passe-long');
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur' });
  const a = app;
  const cookie = String((await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@exemple.fr', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
  const id = (await a.inject({ method: 'POST', url: '/api/competitions', headers: { cookie }, payload: { name: 'Coupe', date: '2026-11-22' } })).json().id as string;
  // Le poste déclaré ne compte pas quand un compte est connecté.
  const res = await a.inject({ method: 'POST', url: `/api/competitions/${id}/registrations`, headers: { cookie, 'x-poste': 'table' }, payload: REG });
  expect(res.statusCode).toBe(201);
  expect(entries(id).at(-1)!.actor).toEqual({ kind: 'account', email: 'orga@exemple.fr', role: 'organisateur' });
});

test('lien du club : acteur et manière posés à l’accès, jamais le jeton', async () => {
  const { a, base, last } = await local({ clubServices: true });
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await a.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Tani Dojo' } })).json().id;
  await a.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await a.inject({ method: 'GET', url: `${base}/invitations` })).json();
  const { token } = (await a.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json();
  await a.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  const line = {
    lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55', weightKg: 53.5, combats: ['karate'], kata: true, grade: '1er kyu',
    ruleset: 'jiyu', prefs: { 'shido-mix': 1 }, shobuKeep: null, licence: null,
  };
  expect((await a.inject({ method: 'POST', url: `/api/inscription/${token}/lines`, payload: { line } })).statusCode).toBe(201);
  expect(last()).toMatchObject({ actor: { kind: 'club', clubName: 'Tani Dojo' }, via: 'en-ligne' });
  expect(token.length).toBeGreaterThan(8);
  expect(allColumns()).not.toContain(token);
});

test.todo('lien du club : le club, « Inscription en ligne », jamais le jeton');

test('filet : écriture réussie sans entrée → entrée brute', async () => {
  const { a, base, last } = await local();
  const res = await a.inject({ method: 'PUT', url: `${base}/wave-schedules`, payload: { waveId: null, plannedStart: '09:30' } });
  expect(res.statusCode).toBeLessThan(400);
  expect(last()).toMatchObject({
    type: 'non-detaille', action: 'raw', actor: { kind: 'poste', poste: 'inconnu' },
    data: { method: 'PUT', route: '/api/competitions/:id/wave-schedules', params: { id: base.split('/').at(-1) } },
  });
});

test('filet : rien sur 400, 409, ni sur un aperçu', async () => {
  const { a, base, count } = await local();
  const reg = (await a.inject({ method: 'POST', url: `${base}/registrations`, payload: REG })).json() as { id: string };
  const before = count();
  expect((await a.inject({ method: 'PUT', url: `${base}/registrations/${reg.id}`, headers: { 'if-match': '"périmée"' }, payload: REG })).statusCode).toBe(409);
  expect((await a.inject({ method: 'PUT', url: `${base}/wave-schedules`, payload: { waveId: null, plannedStart: 12 } })).statusCode).toBe(400);
  expect((await a.inject({ method: 'POST', url: `${base}/replacement/plan`, payload: { choices: [] } })).statusCode).toBe(200);
  expect(count()).toBe(before);
});

test('filet : rien quand la main est partie ou la compétition supprimée pendant la requête', async () => {
  let id = '';
  const sql = (q: string) => {
    const db = new Database(dbPath);
    db.prepare(q).run(id);
    db.close();
  };
  // Routes de test : la main passe ailleurs (comme un passage de main), la compétition disparaît.
  const { base, count, ...c } = await local({}, (a) => {
    a.post('/api/competitions/:id/test-main-ailleurs', async () => {
      sql("update competitions set owner_instance_id = 'pc-1', owner_name = 'PC-SALLE' where id = ?");
      return { ok: true };
    });
    a.post('/api/competitions/:id/test-supprimee', async () => {
      sql('delete from competitions where id = ?');
      return { ok: true };
    });
  });
  id = c.id;
  const before = count();
  expect((await c.a.inject({ method: 'POST', url: `${base}/test-main-ailleurs` })).statusCode).toBe(200);
  expect(count()).toBe(before);
  sql('update competitions set owner_instance_id = null, owner_name = null where id = ?');
  expect((await c.a.inject({ method: 'POST', url: `${base}/test-supprimee` })).statusCode).toBe(200);
  expect(count()).toBe(0);
});

test.todo('filet : rien de plus quand la route a déjà noté');
