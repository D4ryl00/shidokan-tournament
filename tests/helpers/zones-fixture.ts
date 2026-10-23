import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { matchEntrants } from '../../src/server/repositories/results.js';
import { kataRev, resultRev, tieBreakRev } from '../../src/server/revisions.js';
import type { ZoneEntry } from '../../src/server/zone/entry.js';
import { copyFromMain } from '../../src/server/zone/link.js';
import { tmpDbPath } from './tmp-db.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Cat = { id: string; label: string; zoneId: string | null; bracket?: { entrants?: { registrationId: string }[] } };

/**
 * PC principal (rôle local) : compétition à deux zones et deux sessions. Session « Matin » (cadets, lancée) : -54 et kata sur
 * Tatami 1, -61 sur Tatami 2 ; session « Après-midi » (minimes, pas lancée) : -45 sur Tatami 1.
 */
export async function mainCompetition() {
  const mainPath = tmpDbPath();
  const main = await buildApp({ dbPath: mainPath, instanceName: 'PC-PRINCIPAL' });
  const onMain = (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}) => main.inject({ method, url, payload: payload as object, headers });
  const id = (await onMain('POST', '/api/competitions', { name: 'Coupe', date: '2026-11-22' })).json().id as string;
  const base = `/api/competitions/${id}`;
  const zones = (await onMain('GET', `${base}/zones`)).json() as { id: string; name: string }[];
  const [t1, t2] = zones.map((z) => z.id) as [string, string];
  let n = 0;
  const register = (discipline: 'karate' | 'kata', ageBandCode: string, weightClassId: string | null) =>
    onMain('POST', `${base}/registrations`, { clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', ageBandCode, discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId, source: 'manual' });
  for (let i = 0; i < 4; i++) await register('karate', 'cadet', 'cadet:F:-54');
  for (let i = 0; i < 4; i++) await register('karate', 'cadet', 'cadet:F:-61');
  for (let i = 0; i < 3; i++) await register('kata', 'cadet', null);
  for (let i = 0; i < 2; i++) await register('karate', 'minime', 'minime:F:-45');
  const [matin] = (await onMain('PUT', `${base}/waves`, [
    { name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['minime'], disciplines: [] } },
  ])).json() as { id: string }[];
  const cats = async () => (await onMain('GET', `${base}/categories`)).json() as Cat[];
  for (const c of await cats()) expect((await onMain('PATCH', `${base}/categories/${c.id}`, { status: 'ready', zoneId: c.label.includes('-61') ? t2 : t1 })).statusCode).toBe(200);
  expect((await onMain('POST', `${base}/launch`, { waveId: matin!.id })).statusCode).toBe(204);
  const byLabel = async (s: string) => (await cats()).find((c) => c.label.includes(s))!;
  return { main, mainPath, onMain, id, base, t1, t2, zones, matinId: matin!.id, a54: await byLabel('-54'), b61: await byLabel('-61'), kata: await byLabel('Kata'), m45: await byLabel('-45'), cats };
}

/** Le PC principal écoute, et un portable de zone relié à lui sur Tatami 1, avec sa copie. */
export async function mainAndLaptop() {
  const m = await mainCompetition();
  await m.main.listen({ port: 0, host: '127.0.0.1' });
  const mainUrl = `http://127.0.0.1:${(m.main.server.address() as { port: number }).port}`;
  const laptopPath = tmpDbPath();
  const laptop = await buildApp({ dbPath: laptopPath, instanceName: 'PORTABLE-T1' });
  const laptopDb: AppDb = openDb(laptopPath);
  const onLaptop = (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}) => laptop.inject({ method, url, payload: payload as object, headers });
  expect((await onLaptop('PUT', '/api/zone-link', { mainUrl, competitionId: m.id, zoneId: m.t1 })).statusCode).toBe(200);
  expect(await copyFromMain(laptopDb, laptopPath)).toEqual({ ok: true });
  const close = async () => {
    closeDb(laptopDb);
    await laptop.close();
    await m.main.close();
  };
  return { ...m, mainUrl, laptop, laptopPath, laptopDb, onLaptop, close };
}

/** Les réponses sont retenues jusqu'à `release()` (la requête, elle, est déjà traitée par l'autre côté). */
export function holdResponses() {
  const real = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const res = await real(...args);
    await gate;
    return res;
  });
  return () => {
    release();
    spy.mockRestore();
  };
}
export const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));
export const RESULT = { winner: 'a', method: 'points', score: null };

type Result = { winner: 'a' | 'b'; method: string; score: string | null };
/** Journaux de zone construits à la main : combattants et révisions lus sur `db` (comme la copie du portable juste avant la coupure). */
export function journalBuilders(f: Awaited<ReturnType<typeof mainCompetition>>, db: AppDb, from = 'portable-t1') {
  let seq = 0;
  const journal = (entries: ZoneEntry[], over: Record<string, unknown> = {}) => ({
    format: 'shidokan-zone-journal', formatVersion: 1, competitionId: f.id, zoneId: f.t1, zoneName: 'Tatami 1', from: { instanceId: from, instanceName: 'PORTABLE-T1' }, entries, ...over,
  });
  const send = (entries: ZoneEntry[]) => f.onMain('POST', `${f.base}/zone-journal`, journal(entries));
  const common = (categoryId: string) => ({ id: randomUUID(), seq: ++seq, categoryId, categoryVersion: null, zoneId: f.t1, at: new Date().toISOString() });
  const resultEntry = async (categoryId: string, matchId: string, data: Result = RESULT as Result, over: Partial<ZoneEntry> = {}): Promise<ZoneEntry> => ({
    ...common(categoryId), kind: 'result', matchId, data, entrants: await matchEntrants(db, f.id, categoryId, matchId), baseRev: resultRev(db, categoryId, matchId) ?? 'none', ...over,
  });
  const deleteEntry = async (categoryId: string, matchId: string, over: Partial<ZoneEntry> = {}): Promise<ZoneEntry> => ({
    ...(await resultEntry(categoryId, matchId)), kind: 'delete', data: null, ...over,
  });
  const kataEntry = (rid: string, notes: number[], over: Partial<ZoneEntry> = {}): ZoneEntry => ({
    ...common(f.kata.id), kind: 'kata', registrationId: rid, round: 'round1', data: { notes }, entrants: null, baseRev: kataRev(db, f.kata.id, rid, 'round1') ?? 'none', ...over,
  });
  const tieBreakEntry = (order: string[], over: Partial<ZoneEntry> = {}): ZoneEntry => ({
    ...common(f.kata.id), kind: 'tie-break', scope: 'kata', data: { order }, entrants: null, baseRev: tieBreakRev(db, f.kata.id, 'kata') ?? 'none', ...over,
  });
  const putOnMain = (cid: string, matchId: string, data: Result) => f.onMain('PUT', `${f.base}/categories/${cid}/results/${matchId}`, data);
  const records = async (cid: string) =>
    ((await f.onMain('GET', `${f.base}/categories/${cid}/results`)).json() as { records: { matchId: string; winner: string; method: string }[] }).records;
  return { journal, send, resultEntry, deleteEntry, kataEntry, tieBreakEntry, putOnMain, records };
}
