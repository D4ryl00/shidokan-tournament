import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/auth/sessions.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let cookie: string;
let id: string;
let token: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  const db = openDb(dbPath);
  createUser(db, 'orga@example.org', 'mot-de-passe-long');
  closeDb(db);
  app = await buildApp({ dbPath, role: 'serveur', publicUrl: 'https://competitions.example.org' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'orga@example.org', password: 'mot-de-passe-long' } })).headers['set-cookie']).split(';')[0]!;
  id = (await orga('POST', '/api/competitions', { name: 'Coupe', date: '2026-11-22' })).json().id;
  await orga('POST', `/api/competitions/${id}/clubs`, { name: 'Tani Dojo' });
  token = (await orga('POST', '/api/sync/tokens', { name: 'PC de la salle' })).json().token;
});
afterEach(async () => app.close());

function orga(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { cookie }, payload: payload as object });
}
function remote(method: 'GET' | 'POST', path: string, payload?: unknown, bearer = token) {
  return app.inject({ method, url: `/api/sync/remote${path}`, headers: { authorization: `Bearer ${bearer}` }, payload: payload as object });
}
const PC = { instanceId: 'pc-1', instanceName: 'PC-SALLE' };
const owner = () => {
  const r = new Database(dbPath, { readonly: true });
  const row = r.prepare('select owner_instance_id as id, owner_name as name, club_entry_status as status from competitions where id = ?').get(id);
  r.close();
  return row;
};
/** Paquet tel que le PC l'enverrait (depuis le paquet reçu, en changeant l'expéditeur). */
const fromPc = (pkg: Record<string, unknown>, instanceId = 'pc-1') => ({ ...pkg, from: { instanceId, instanceName: 'PC-SALLE', role: 'local' }, handOver: true });

test('jeton : montré une fois, liste sans jeton, révoqué → 401 ; sans en-tête → 401', async () => {
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const list = await orga('GET', '/api/sync/tokens');
  expect(list.json()).toEqual([expect.objectContaining({ name: 'PC de la salle', revoked: false })]);
  expect(list.body).not.toContain(token);
  expect((await remote('GET', '/competitions')).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: '/api/sync/remote/competitions' })).json().error).toBe('Jeton de synchronisation invalide.');
  await orga('DELETE', `/api/sync/tokens/${list.json()[0].id}`);
  expect((await remote('GET', '/competitions')).statusCode).toBe(401);
});

test('copie : paquet sans changer la main ; liste des compétitions', async () => {
  expect((await remote('GET', '/competitions')).json()).toEqual([expect.objectContaining({ id, name: 'Coupe', managedHere: true, ownerName: null })]);
  const pkg = (await remote('GET', `/competitions/${id}/package`)).json();
  expect(pkg).toMatchObject({ format: 'shidokan-competition', competitionId: id, handOver: false });
  expect(owner()).toMatchObject({ id: null });
});

test('prise de main : owner = le PC, inscriptions figées, écritures de l’organisateur → 409', async () => {
  const res = await remote('POST', `/competitions/${id}/take`, PC);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ handOver: true, competitionId: id });
  expect(owner()).toEqual({ id: 'pc-1', name: 'PC-SALLE', status: 'frozen' });
  expect((await orga('PATCH', `/api/competitions/${id}`, { location: 'Nice' })).statusCode).toBe(409);
  expect((await remote('POST', `/competitions/${id}/take`, { instanceId: 'pc-2', instanceName: 'AUTRE' })).statusCode).toBe(409);
});

test('copie envoyée : gardée (5 au plus), sans rien remplacer ; PC sans la main → 409', async () => {
  const pkg = (await remote('POST', `/competitions/${id}/take`, PC)).json();
  for (let i = 0; i < 6; i++) expect((await remote('POST', `/competitions/${id}/copy`, fromPc(pkg))).statusCode).toBe(204);
  expect((await orga('GET', `/api/competitions/${id}/received-copies`)).json()).toHaveLength(5);
  expect((await remote('POST', `/competitions/${id}/copy`, fromPc(pkg, 'pc-2'))).statusCode).toBe(409);
});

test('retour : compétition remplacée, main revenue au serveur ; autre PC → 409 avec le message exact', async () => {
  const pkg = (await remote('POST', `/competitions/${id}/take`, PC)).json();
  const competition = pkg.tables.competitions[0];
  const changed = { ...fromPc(pkg), tables: { ...pkg.tables, competitions: [{ ...competition, location: 'Gymnase du PC' }] } };
  const other = await remote('POST', `/competitions/${id}/return`, { ...changed, from: { instanceId: 'pc-2', instanceName: 'AUTRE', role: 'local' } });
  expect(other.statusCode).toBe(409);
  expect(other.json().error).toBe('Ce PC n’a pas la main sur cette compétition : exportez-la en fichier et demandez à un organisateur de l’importer en ligne.');
  const back = await remote('POST', `/competitions/${id}/return`, changed);
  expect(back.statusCode).toBe(200);
  expect(back.json()).toEqual({ instanceId: expect.any(String), fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(owner()).toMatchObject({ id: null });
  expect((await orga('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase du PC');
});

test('reprise forcée : source server → main ici ; source lastCopy → données de la dernière copie', async () => {
  const pkg = (await remote('POST', `/competitions/${id}/take`, PC)).json();
  const competition = pkg.tables.competitions[0];
  await remote('POST', `/competitions/${id}/copy`, { ...fromPc(pkg), tables: { ...pkg.tables, competitions: [{ ...competition, location: 'Copie de midi' }] } });
  expect((await orga('POST', `/api/competitions/${id}/take-back`, { source: 'lastCopy' })).statusCode).toBe(204);
  expect(owner()).toMatchObject({ id: null });
  expect((await orga('GET', `/api/competitions/${id}`)).json().location).toBe('Copie de midi');
  await remote('POST', `/competitions/${id}/take`, PC);
  expect((await orga('POST', `/api/competitions/${id}/take-back`, { source: 'server' })).statusCode).toBe(204);
  expect(owner()).toMatchObject({ id: null });
  // Le PC ne peut plus rendre la main.
  expect((await remote('POST', `/competitions/${id}/return`, fromPc(pkg))).statusCode).toBe(409);
});

test('routes distantes : la limite de 120 requêtes par 10 minutes s’applique', async () => {
  let last = 0;
  for (let i = 0; i < 121; i++) last = (await remote('GET', '/competitions')).statusCode;
  expect(last).toBe(429);
});

test('la main est liée au jeton : un autre jeton ne peut ni copier, ni rendre, ni reprendre en se faisant passer pour le PC', async () => {
  const pkg = (await remote('POST', `/competitions/${id}/take`, PC)).json();
  const other = (await orga('POST', '/api/sync/tokens', { name: 'Autre PC' })).json().token as string;
  expect((await remote('POST', `/competitions/${id}/copy`, fromPc(pkg), other)).statusCode).toBe(409);
  expect((await remote('POST', `/competitions/${id}/return`, fromPc(pkg), other)).statusCode).toBe(409);
  expect((await remote('POST', `/competitions/${id}/take`, PC, other)).statusCode).toBe(409);
  // Le paquet servi ne révèle pas l'identité du PC qui a la main.
  expect(JSON.stringify((await remote('GET', `/competitions/${id}/package`)).json())).not.toContain('pc-1');
});

test('compétition donnée par fichier : aucun jeton ne peut la prendre en se disant « file »', async () => {
  await orga('POST', `/api/competitions/${id}/export-handover`);
  expect((await remote('POST', `/competitions/${id}/take`, { instanceId: 'file', instanceName: 'X' })).statusCode).toBe(409);
});

test('copie reçue : vérifiée (même compétition, paquet valide) ; reprise depuis la dernière copie revérifiée', async () => {
  const pkg = (await remote('POST', `/competitions/${id}/take`, PC)).json();
  const other = (await orga('POST', '/api/competitions', { name: 'Autre', date: '2026-12-01' })).json().id as string;
  expect((await remote('POST', `/competitions/${id}/copy`, { ...fromPc(pkg), competitionId: other })).statusCode).toBe(400);
  expect((await remote('POST', `/competitions/${id}/copy`, { ...fromPc(pkg), format: 'autre' })).statusCode).toBe(400);
  expect((await orga('GET', `/api/competitions/${id}/received-copies`)).json()).toHaveLength(0);
});

test('PC dont la version est plus ancienne que le serveur → prise de main refusée avant tout changement', async () => {
  const res = await remote('POST', `/competitions/${id}/take`, { ...PC, migrations: 1 });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Mettez d’abord ce PC à jour : il a une version plus ancienne de l’application que le serveur.');
  expect(owner()).toMatchObject({ id: null });
});

test('retour ou reprise : les copies reçues sont effacées ; et effacées par la conservation des données', async () => {
  const pkg = (await remote('POST', `/competitions/${id}/take`, PC)).json();
  await remote('POST', `/competitions/${id}/copy`, fromPc(pkg));
  expect((await remote('POST', `/competitions/${id}/return`, fromPc(pkg))).statusCode).toBe(200);
  expect((await orga('GET', `/api/competitions/${id}/received-copies`)).json()).toHaveLength(0);
});
