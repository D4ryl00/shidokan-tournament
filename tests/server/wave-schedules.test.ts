import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { onCompetitionChange } from '../../src/server/events.js';
import { listCategories } from '../../src/server/repositories/categories.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let id: string;
let base: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${id}`;
});
afterEach(async () => app.close());

type Wave = { id: string };
const MATIN = { name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } };
const APREM = { name: 'Après-midi', rules: { ageBandCodes: ['senior'], disciplines: [] } };
const putWaves = async (payload: object) => (await app.inject({ method: 'PUT', url: `${base}/waves`, payload })).json() as Wave[];
const put = (payload: object) => app.inject({ method: 'PUT', url: `${base}/wave-schedules`, payload });
const get = async () => (await app.inject({ method: 'GET', url: `${base}/wave-schedules` })).json() as object[];

test('sets and reads the three times of a wave', async () => {
  const [m] = await putWaves([MATIN]);
  const res = await put({ waveId: m!.id, plannedStart: '09:30', actualStart: '09:41', finalsStart: '14:00' });
  expect(res.statusCode).toBe(200);
  const expected = { waveId: m!.id, plannedStart: '09:30', actualStart: '09:41', finalsStart: '14:00' };
  expect(res.json()).toEqual(expected);
  expect(await get()).toEqual([expected]);
});

test('a partial patch keeps the other times', async () => {
  const [m] = await putWaves([MATIN]);
  await put({ waveId: m!.id, plannedStart: '09:30' });
  const res = await put({ waveId: m!.id, actualStart: '09:41' });
  expect(res.json()).toEqual({ waveId: m!.id, plannedStart: '09:30', actualStart: '09:41', finalsStart: null });
});

test('null clears a time', async () => {
  const [m] = await putWaves([MATIN]);
  await put({ waveId: m!.id, plannedStart: '09:30', actualStart: '09:41' });
  const res = await put({ waveId: m!.id, actualStart: null });
  expect(res.json()).toEqual({ waveId: m!.id, plannedStart: '09:30', actualStart: null, finalsStart: null });
});

test('rejects a bad clock', async () => {
  const [m] = await putWaves([MATIN]);
  for (const bad of ['9h30', '24:00', '9:30', '12:60']) expect((await put({ waveId: m!.id, plannedStart: bad })).statusCode, bad).toBe(400);
  expect(await get()).toEqual([]);
});

test('rejects an unknown wave, and waveId null when the competition has waves', async () => {
  const [m] = await putWaves([MATIN]);
  expect((await put({ waveId: 'nope', plannedStart: '09:30' })).statusCode).toBe(400);
  expect((await put({ waveId: null, plannedStart: '09:30' })).statusCode).toBe(400);
  expect((await put({ waveId: m!.id, plannedStart: '09:30', extra: 1 })).statusCode).toBe(400);
});

test('waveId null without waves is the single session', async () => {
  const res = await put({ waveId: null, plannedStart: '09:30' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ waveId: null, plannedStart: '09:30', actualStart: null, finalsStart: null });
  const db = openDb(dbPath);
  expect(db.$client.prepare('select wave_key from wave_schedules where competition_id = ?').all(id)).toEqual([{ wave_key: '' }]);
  closeDb(db);
});

test('removing a wave deletes its times', async () => {
  const [m, a] = await putWaves([MATIN, APREM]);
  await put({ waveId: m!.id, plannedStart: '09:30' });
  await put({ waveId: a!.id, plannedStart: '14:00' });
  await putWaves({ waves: [{ id: m!.id, ...MATIN }], knownIds: [m!.id, a!.id] });
  expect(await get()).toEqual([{ waveId: m!.id, plannedStart: '09:30', actualStart: null, finalsStart: null }]);
});

test('a schedule change fires the competition event', async () => {
  const [m] = await putWaves([MATIN]);
  const listener = vi.fn();
  const off = onCompetitionChange(id, listener);
  await put({ waveId: m!.id, plannedStart: '09:30' });
  off();
  expect(listener).toHaveBeenCalledTimes(1);
});

test('category durations are saved even when the wave is launched', async () => {
  const reg = await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId: null, lastName: 'A', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' } });
  expect(reg.statusCode).toBe(201);
  const zone = ((await app.inject({ method: 'GET', url: `${base}/zones` })).json() as { id: string }[])[0]!.id;
  const [cat] = (await app.inject({ method: 'GET', url: `${base}/categories` })).json() as { id: string }[];
  await app.inject({ method: 'PATCH', url: `${base}/categories/${cat!.id}`, payload: { status: 'ready', zoneId: zone } });
  expect((await app.inject({ method: 'POST', url: `${base}/launch`, payload: { waveId: null } })).statusCode).toBe(204);
  const durations = { bracket: { rounds: 3, roundSec: 100, restSec: 30, overtimeSec: 60 }, matches: {} };
  const res = await app.inject({ method: 'PATCH', url: `${base}/categories/${cat!.id}`, payload: { durations } });
  expect(res.statusCode).toBe(200);
  const db = openDb(dbPath);
  expect((await listCategories(db, id)).find((c) => c.id === cat!.id)!.durations).toEqual(durations);
  expect(db.$client.prepare('select count(*) as n from history_entries where competition_id = ?').get(id)).toEqual({ n: 0 });
  closeDb(db);
  const cleared = await app.inject({ method: 'PATCH', url: `${base}/categories/${cat!.id}`, payload: { durations: null } });
  expect(cleared.json().durations).toBeNull();
});

test('rejects durations out of bounds', async () => {
  await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId: null, lastName: 'A', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' } });
  const [cat] = (await app.inject({ method: 'GET', url: `${base}/categories` })).json() as { id: string }[];
  const res = await app.inject({ method: 'PATCH', url: `${base}/categories/${cat!.id}`, payload: { durations: { bracket: { rounds: 0, roundSec: 100, restSec: 30, overtimeSec: 60 }, matches: {} } } });
  expect(res.statusCode).toBe(400);
});
