import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { registeredRoutes } from '../helpers/routes.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let id: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
});
afterEach(async () => app.close());

const setOwner = (ownerId: string | null, name: string | null, since: string | null) => {
  const r = new Database(dbPath);
  r.prepare('update competitions set owner_instance_id = ?, owner_name = ?, owner_since = ?, last_sync_at = ? where id = ?').run(ownerId, name, since, since, id);
  r.close();
};
const EXEMPT = [/\/sync\//, /\/take-back$/, /\/export\.json$/];

test('compétition gérée ailleurs : toutes les routes d’écriture → 409 avec le message exact ; lecture → 200', async () => {
  setOwner('pc-1', 'PC-SALLE', '2026-11-21T08:00:00.000Z');
  await app.ready();
  const writes = registeredRoutes(app).filter(
    (r) => !['GET', 'HEAD'].includes(r.method) && r.pattern.startsWith('/api/competitions/:id') && !EXEMPT.some((e) => e.test(r.pattern))
      // Seule exception, sur un PC : supprimer la copie (le nom est redemandé).
      && !(r.method === 'DELETE' && r.pattern === '/api/competitions/:id'),
  );
  expect(writes.length).toBeGreaterThan(30);
  for (const r of writes) {
    const url = r.pattern.replace(':id', id).replace(/:[A-Za-z]+/g, 'x');
    const res = await app.inject({ method: r.method as 'POST', url, payload: {} });
    expect(res.statusCode, `${r.method} ${r.pattern}`).toBe(409);
    expect(res.json().error, `${r.method} ${r.pattern}`).toBe('Compétition gérée par PC-SALLE depuis le 21/11/2026 : lecture seule ici.');
  }
  expect((await app.inject({ method: 'GET', url: `/api/competitions/${id}/registrations` })).statusCode).toBe(200);
  expect((await app.inject({ method: 'DELETE', url: `/api/competitions/${id}`, payload: { name: 'pas le nom' } })).statusCode).toBe(400);
});

test('gérée ici : écritures acceptées', async () => {
  expect((await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { location: 'Nice' } })).statusCode).toBe(200);
});

test('GET management : les trois états', async () => {
  const get = async () => (await app.inject({ method: 'GET', url: `/api/competitions/${id}/management` })).json();
  expect(await get()).toEqual({ managedHere: true, ownerName: null, ownerSince: null, lastSyncAt: null, copyOfServer: false, rescueSince: null, copyOfMain: false });
  setOwner('pc-1', 'PC-SALLE', '2026-11-21T08:00:00.000Z');
  expect(await get()).toEqual({ managedHere: false, ownerName: 'PC-SALLE', ownerSince: '2026-11-21T08:00:00.000Z', lastSyncAt: '2026-11-21T08:00:00.000Z', copyOfServer: false, rescueSince: null, copyOfMain: false });
  setOwner('srv', 'le serveur en ligne', '2026-11-20T08:00:00.000Z');
  const r = new Database(dbPath);
  r.prepare("insert into app_settings (key, value_json) values ('syncServer', ?)").run(JSON.stringify({ url: 'https://x', token: 't', serverInstanceId: 'srv' }));
  r.close();
  expect((await get()).copyOfServer).toBe(true);
});
