import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { versionedTables } from '../../src/server/db/row-versions.js';
import { listBackups } from '../../src/server/repositories/backups.js';
import { unclassifiedTables } from '../../src/server/sync/package.js';
import { copyFromMain, zoneLinkStatus } from '../../src/server/zone/link.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let main: FastifyInstance;
let laptop: FastifyInstance;
let laptopPath: string;
let laptopDb: AppDb;
let mainUrl: string;
let id: string;
let zoneId: string;

beforeEach(async () => {
  main = await buildApp({ dbPath: tmpDbPath(), instanceName: 'PC-PRINCIPAL' });
  await main.listen({ port: 0, host: '127.0.0.1' });
  mainUrl = `http://127.0.0.1:${(main.server.address() as { port: number }).port}`;
  id = (await onMain('POST', '/api/competitions', { name: 'Coupe', date: '2026-11-22' })).json().id;
  zoneId = ((await onMain('GET', `/api/competitions/${id}/zones`)).json() as { id: string }[])[0]!.id;
  laptopPath = tmpDbPath();
  laptop = await buildApp({ dbPath: laptopPath, instanceName: 'PORTABLE-T1' });
  laptopDb = openDb(laptopPath);
});
afterEach(async () => {
  closeDb(laptopDb);
  await laptop.close();
  await main.close();
});

function onMain(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) {
  return main.inject({ method, url, payload: payload as object });
}
const onLaptop = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) => laptop.inject({ method, url, payload: payload as object });
const register = (lastName: string) =>
  onMain('POST', `/api/competitions/${id}/registrations`, { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' });
const laptopNames = async () => {
  const res = await onLaptop('GET', `/api/competitions/${id}/registrations`);
  return res.statusCode === 200 ? (res.json() as { fighter: { lastName: string } }[]).map((r) => r.fighter.lastName).sort() : [];
};
const link = () => onLaptop('PUT', '/api/zone-link', { mainUrl: `${mainUrl}/`, competitionId: id, zoneId });

test('probe : compétitions et zones du PC principal', async () => {
  const res = await onLaptop('POST', '/api/zone-link/probe', { mainUrl });
  expect(res.statusCode).toBe(200);
  const zones = ((await onMain('GET', `/api/competitions/${id}/zones`)).json() as { id: string; name: string }[]).map((z) => ({ id: z.id, name: z.name }));
  expect(res.json()).toEqual({ competitions: [{ id, name: 'Coupe', zones }] });
  expect((await onLaptop('POST', '/api/zone-link/probe', { mainUrl: 'ftp://exemple' })).statusCode).toBe(400);
});

test('copyFromMain : copie en lecture seule, main au PC principal ; Management.copyOfMain ; une seconde copie inchangée n’importe rien', async () => {
  await register('DURAND');
  expect((await link()).statusCode).toBe(200);
  expect((await onLaptop('GET', '/api/zone-link')).json()).toMatchObject({ link: { mainUrl, competitionId: id, zoneId, autonomous: null }, pending: 0 });
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  expect(await laptopNames()).toEqual(['DURAND']);
  expect((await onLaptop('GET', `/api/competitions/${id}/management`)).json()).toMatchObject({ managedHere: false, copyOfMain: true, ownerName: 'le PC principal' });
  expect((await onLaptop('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(409);
  const backups = (await listBackups(laptopPath)).length;
  const syncedAt = (laptopDb.$client.prepare('select last_sync_at as s from competitions where id = ?').get(id) as { s: string }).s;
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  expect((await listBackups(laptopPath)).length).toBe(backups);
  expect((laptopDb.$client.prepare('select last_sync_at as s from competitions where id = ?').get(id) as { s: string }).s >= syncedAt).toBe(true);
  expect(zoneLinkStatus(laptopPath)).toMatchObject({ lastError: null });
  expect(zoneLinkStatus(laptopPath).lastCopyAt).not.toBeNull();
  // Une copie changée remplace l'ancienne, toujours sans sauvegarde.
  await register('MARTIN');
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  expect(await laptopNames()).toEqual(['DURAND', 'MARTIN']);
  expect((await listBackups(laptopPath)).length).toBe(backups);
});

test('suivi : une inscription sur le PC principal arrive sur le portable en moins de 3 s', async () => {
  await register('DURAND');
  expect((await link()).statusCode).toBe(200);
  const waitFor = async (name: string) => {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if ((await laptopNames()).includes(name)) return Date.now() - start;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${name} n’est pas arrivé sur le portable`);
  };
  await waitFor('DURAND');
  await register('MARTIN');
  expect(await waitFor('MARTIN')).toBeLessThan(3000);
});

test('PC principal arrêté : lastError rempli, la copie reste lisible', async () => {
  await register('DURAND');
  await link();
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  await main.close();
  const res = await copyFromMain(laptopDb, laptopPath);
  expect(res).toMatchObject({ error: expect.stringMatching(/^PC principal injoignable/) });
  expect(zoneLinkStatus(laptopPath).lastError).toMatch(/^PC principal injoignable/);
  expect(await laptopNames()).toEqual(['DURAND']);
  expect((await onLaptop('GET', '/api/zone-link')).json()).toMatchObject({ status: { lastError: expect.stringMatching(/^PC principal injoignable/) } });
  main = await buildApp({ dbPath: tmpDbPath() }); // refermé par afterEach
});

test('pas de copie si la compétition n’est plus une copie du PC principal (prise par fichier, par exemple)', async () => {
  await register('DURAND');
  await link();
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  const pkg = (await onMain('GET', `/api/competitions/${id}/export.json`)).json();
  expect((await laptop.inject({ method: 'POST', url: '/api/competitions/import?takeOver=1', payload: pkg })).statusCode).toBe(200);
  expect((await onLaptop('PATCH', `/api/competitions/${id}`, { location: 'Gymnase' })).statusCode).toBe(200);
  await register('MARTIN');
  expect(await copyFromMain(laptopDb, laptopPath)).toMatchObject({ error: expect.any(String) });
  expect((await onLaptop('GET', `/api/competitions/${id}`)).json().location).toBe('Gymnase');
  expect(await laptopNames()).toEqual(['DURAND']);
});

test('export.json porte l’empreinte de la compétition', async () => {
  expect((await onMain('GET', `/api/competitions/${id}/export.json`)).json().fingerprint).toMatch(/^[0-9a-f]{64}$/);
});

test('règle de garde : zone_journal et zone_entries classées (unclassifiedTables vide), versionnées', () => {
  expect(unclassifiedTables(laptopDb)).toEqual([]);
  expect(versionedTables(laptopDb)).toEqual(expect.arrayContaining(['zone_journal', 'zone_entries']));
});

// --- Suppression d'une compétition ---

const MAIN_DELETED = 'La compétition a été supprimée sur le PC principal : cette copie n’est plus mise à jour ; vous pouvez la supprimer.';
const removeOn = (app: FastifyInstance) => app.inject({ method: 'DELETE', url: `/api/competitions/${id}`, payload: { name: 'Coupe' } });

test('supprimée sur le PC principal : message clair sur le portable, qui peut supprimer sa copie (il est alors délié)', async () => {
  await link();
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  expect((await removeOn(main)).statusCode).toBe(204);
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ error: MAIN_DELETED });
  expect((await removeOn(laptop)).statusCode).toBe(204);
  expect((await onLaptop('GET', `/api/competitions/${id}`)).statusCode).toBe(404);
  expect((await onLaptop('GET', '/api/zone-link')).json().link).toBeNull();
});

test('zone autonome : le portable refuse de supprimer sa copie', async () => {
  await link();
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  expect((await onLaptop('POST', '/api/zone-link/autonomous')).statusCode).toBeLessThan(300);
  const res = await removeOn(laptop);
  expect(res.statusCode).toBe(409);
  expect(res.body).toContain('Zone autonome : repassez en ligne (ou exportez le journal) avant de supprimer cette copie.');
});
