import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let url: string;
let id: string;
let other: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Autre', date: '2026-11-22' } })).json().id;
});
afterEach(async () => app.close());

/** Ouvre le flux d'une compétition et compte les « change » reçus pendant `ms`, après l'action. */
async function changesDuring(competitionId: string, action: () => Promise<unknown>, ms = 400): Promise<number> {
  const controller = new AbortController();
  const res = await fetch(`${url}/api/competitions/${competitionId}/events`, { signal: controller.signal });
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
  await action();
  await new Promise((r) => setTimeout(r, ms));
  controller.abort();
  await reading;
  return (text.match(/event: change/g) ?? []).length;
}

test('une écriture réussie sur la compétition → change ; refusée (400) → rien ; autre compétition → rien', async () => {
  expect(await changesDuring(id, () => app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { location: 'Nice' } }))).toBeGreaterThanOrEqual(1);
  expect(await changesDuring(id, () => app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { date: 'pas une date' } }))).toBe(0);
  expect(await changesDuring(id, () => app.inject({ method: 'PATCH', url: `/api/competitions/${other}`, payload: { location: 'Lyon' } }))).toBe(0);
});

test('écriture depuis la page du club → change', async () => {
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };
  const entry = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Tani Dojo' } })).json().id;
  const [link] = (await app.inject({ method: 'POST', url: `/api/competitions/${id}/invitations`, payload: { directoryIds: [entry] } })).json();
  await app.inject({ method: 'PATCH', url: `/api/competitions/${id}/club-entry`, payload: { status: 'open' } });
  const header = { coachName: 'Jean', coachPhone: null, coachEmail: null, preApproval: false, affiliationNumber: null };
  expect(await changesDuring(id, () => app.inject({ method: 'PATCH', url: `/api/inscription/${link.token}/club`, payload: header }))).toBeGreaterThanOrEqual(1);
});

test('réception d’un paquet (fichier) → change', async () => {
  const pkg = (await app.inject({ method: 'GET', url: `/api/competitions/${id}/export.json` })).json();
  expect(await changesDuring(id, () => app.inject({ method: 'POST', url: '/api/competitions/import?replace=1', payload: pkg }))).toBeGreaterThanOrEqual(1);
});

test('rôle serveur sans session → 401', async () => {
  const dbPath = tmpDbPath();
  const d = openDb(dbPath);
  createUser(d, 'orga@example.org', 'mot-de-passe-long');
  closeDb(d);
  const srv = await buildApp({ dbPath, role: 'serveur' });
  expect((await srv.inject({ method: 'GET', url: `/api/competitions/${id}/events` })).statusCode).toBe(401);
  await srv.close();
});
