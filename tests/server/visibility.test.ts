import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { buildPackage, importPackage } from '../../src/server/sync/package.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

const opened: AppDb[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) closeDb(d);
});

async function appWithCompetition() {
  const dbPath = tmpDbPath();
  const app = await buildApp({ dbPath, role: 'local' });
  const created = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } });
  const { id } = created.json() as { id: string };
  return { app, dbPath, id };
}

test('a new competition is private', async () => {
  const { app, id } = await appWithCompetition();
  const c = (await app.inject({ method: 'GET', url: `/api/competitions/${id}` })).json();
  expect(c.visibility).toBe('private');
  await app.close();
});

test('PATCH visibility public then private', async () => {
  const { app, id } = await appWithCompetition();
  const url = `/api/competitions/${id}`;
  expect((await app.inject({ method: 'PATCH', url, payload: { visibility: 'public' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url })).json().visibility).toBe('public');
  expect((await app.inject({ method: 'PATCH', url, payload: { visibility: 'private' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url })).json().visibility).toBe('private');
  await app.close();
});

test('PATCH rejects an unknown visibility', async () => {
  const { app, id } = await appWithCompetition();
  const res = await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { visibility: 'brouillon' } });
  expect(res.statusCode).toBe(400);
  await app.close();
});

test('visibility travels in the sync package', async () => {
  const a = await appWithCompetition();
  await a.app.inject({ method: 'PATCH', url: `/api/competitions/${a.id}`, payload: { visibility: 'public' } });
  await a.app.close();
  const dbA = openDb(a.dbPath);
  opened.push(dbA);
  const pkg = buildPackage(dbA, a.id, { handOver: false, role: 'local' });
  const b = await appWithCompetition();
  await b.app.close();
  const dbB = openDb(b.dbPath);
  opened.push(dbB);
  await importPackage(dbB, b.dbPath, pkg, null);
  const row = dbB.$client.prepare('select visibility from competitions where id = ?').get(a.id) as { visibility: string };
  expect(row.visibility).toBe('public');
});

async function withFighter(app: Awaited<ReturnType<typeof appWithCompetition>>['app'], id: string) {
  const club = (await app.inject({ method: 'POST', url: `/api/competitions/${id}/clubs`, payload: { name: 'Tani Dojo' } })).json();
  const base = { clubId: club.id, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', source: 'onsite' };
  const karate = { ...base, discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' };
  const kata = { ...base, discipline: 'kata', ruleset: null, weightClassId: null };
  const regs = [];
  for (const payload of [karate, kata]) {
    const res = await app.inject({ method: 'POST', url: `/api/competitions/${id}/registrations`, payload });
    expect(res.statusCode).toBe(201);
    regs.push(res.json().row);
  }
  return regs as Array<{ id: string; fighterId: string }>;
}

test('hide then show a fighter name', async () => {
  const { app, id } = await appWithCompetition();
  const regs = await withFighter(app, id);
  const fighterId = regs[0]!.fighterId;
  expect(regs[1]!.fighterId).toBe(fighterId);
  const url = `/api/competitions/${id}/fighters/${fighterId}/public-name`;
  const flags = async () => ((await app.inject({ method: 'GET', url: `/api/competitions/${id}/registrations` })).json() as Array<{ publicNameHidden: boolean }>).map((r) => r.publicNameHidden);
  expect(await flags()).toEqual([false, false]);
  expect((await app.inject({ method: 'PUT', url, payload: { hidden: true } })).statusCode).toBe(204);
  expect(await flags()).toEqual([true, true]);
  expect((await app.inject({ method: 'PUT', url, payload: { hidden: false } })).statusCode).toBe(204);
  expect(await flags()).toEqual([false, false]);
  await app.close();
});

test('hiding a fighter of another competition is 404', async () => {
  const a = await appWithCompetition();
  const regs = await withFighter(a.app, a.id);
  const other = (await a.app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Autre', date: '2026-12-06' } })).json() as { id: string };
  const res = await a.app.inject({ method: 'PUT', url: `/api/competitions/${other.id}/fighters/${regs[0]!.fighterId}/public-name`, payload: { hidden: true } });
  expect(res.statusCode).toBe(404);
  const flagsOf = async (competition: string) => (await a.app.inject({ method: 'GET', url: `/api/competitions/${competition}/registrations` })).json() as Array<{ publicNameHidden: boolean }>;
  expect((await flagsOf(a.id)).map((r) => r.publicNameHidden)).toEqual([false, false]);
  const unknown = await a.app.inject({ method: 'PUT', url: `/api/competitions/${a.id}/fighters/inconnu/public-name`, payload: { hidden: true } });
  expect(unknown.statusCode).toBe(404);
  await a.app.close();
});

test('toggling the name then saving the registration: fresh rev passes, stale rev is 409', async () => {
  const { app, id } = await appWithCompetition();
  const regs = await withFighter(app, id);
  const list = async () => (await app.inject({ method: 'GET', url: `/api/competitions/${id}/registrations` })).json() as Array<{ id: string; rev: string; clubId?: string; fighter: { clubId: string }; discipline: string; ruleset: string | null; weightClassId: string | null }>;
  const before = (await list()).find((r) => r.id === regs[0]!.id)!;
  expect((await app.inject({ method: 'PUT', url: `/api/competitions/${id}/fighters/${regs[0]!.fighterId}/public-name`, payload: { hidden: true } })).statusCode).toBe(204);
  const after = (await list()).find((r) => r.id === regs[0]!.id)!;
  expect(after.rev).not.toBe(before.rev);
  const payload = { clubId: before.fighter.clubId, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: before.discipline, ruleset: before.ruleset, weightClassId: before.weightClassId, source: 'onsite' };
  const put = (rev: string) => app.inject({ method: 'PUT', url: `/api/competitions/${id}/registrations/${before.id}`, headers: { 'if-match': `"${rev}"` }, payload });
  expect((await put(before.rev)).statusCode).toBe(409);
  expect((await put(after.rev)).statusCode).toBe(200);
  await app.close();
});
