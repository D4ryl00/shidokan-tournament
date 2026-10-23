import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { matchEntrants } from '../../src/server/repositories/results.js';
import { kataRev, resultRev, tieBreakRev } from '../../src/server/revisions.js';
import type { ZoneEntry } from '../../src/server/zone/entry.js';
import { mainCompetition, RESULT } from '../helpers/zones-fixture.js';

let f: Awaited<ReturnType<typeof mainCompetition>>;
let db: AppDb;
let seq = 0;
beforeEach(async () => {
  f = await mainCompetition();
  db = openDb(f.mainPath);
  seq = 0;
});
afterEach(async () => {
  closeDb(db);
  await f.main.close();
});

type Result = { winner: 'a' | 'b'; method: string; score: string | null };
const journal = (entries: ZoneEntry[], over: Record<string, unknown> = {}) => ({
  format: 'shidokan-zone-journal', formatVersion: 1, competitionId: f.id, zoneId: f.t1, zoneName: 'Tatami 1', from: { instanceId: 'portable-t1', instanceName: 'PORTABLE-T1' }, entries, ...over,
});
const send = (entries: ZoneEntry[]) => f.onMain('POST', `${f.base}/zone-journal`, journal(entries));
const common = (categoryId: string) => ({ id: randomUUID(), seq: ++seq, categoryId, categoryVersion: null, zoneId: f.t1, at: new Date().toISOString() });
/** Saisie de combat, avec les combattants et la révision lus sur le PC principal (comme la copie du portable juste avant la coupure). */
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
const records = async (cid: string) =>
  ((await f.onMain('GET', `${f.base}/categories/${cid}/results`)).json() as { records: { matchId: string; winner: string; method: string }[] }).records;
const statuses = () => (db.$client.prepare('select status, reason from zone_entries order by seq').all() as { status: string; reason: string | null }[]);
const counts = (over: Partial<Record<'received' | 'applied' | 'present' | 'conflicts' | 'waiting' | 'alreadyReceived', number>>) => ({
  received: 0, applied: 0, present: 0, conflicts: 0, waiting: 0, alreadyReceived: 0, ...over,
});
const putOnMain = (cid: string, matchId: string, data: Result) => f.onMain('PUT', `${f.base}/categories/${cid}/results/${matchId}`, data);

test('combat vide, mêmes combattants → applied, le résultat est là', async () => {
  const res = await send([await resultEntry(f.a54.id, 'w1-0')]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual(counts({ received: 1, applied: 1 }));
  expect(await records(f.a54.id)).toMatchObject([{ matchId: 'w1-0', winner: 'a', method: 'points' }]);
  expect(statuses()).toEqual([{ status: 'applied', reason: null }]);
});

test('résultat identique déjà présent → present', async () => {
  const e = await resultEntry(f.a54.id, 'w1-0');
  await putOnMain(f.a54.id, 'w1-0', RESULT as Result);
  expect((await send([e])).json()).toEqual(counts({ received: 1, present: 1 }));
});

test('autre résultat saisi entre-temps → conflict « Une autre saisie a été faite sur le PC principal. », rien n’a changé', async () => {
  const e = await resultEntry(f.a54.id, 'w1-0');
  await putOnMain(f.a54.id, 'w1-0', { winner: 'b', method: 'decision', score: null });
  expect((await send([e])).json()).toEqual(counts({ received: 1, conflicts: 1 }));
  expect(statuses()).toEqual([{ status: 'conflict', reason: 'Une autre saisie a été faite sur le PC principal.' }]);
  expect(await records(f.a54.id)).toMatchObject([{ matchId: 'w1-0', winner: 'b', method: 'decision' }]);
});

test('combattants changés (un résultat précédent corrigé à la table centrale) → conflict « Les combattants de ce combat ont changé. »', async () => {
  await putOnMain(f.a54.id, 'w1-0', RESULT as Result);
  await putOnMain(f.a54.id, 'w1-1', RESULT as Result);
  const final = await resultEntry(f.a54.id, 'w2-0');
  await putOnMain(f.a54.id, 'w1-0', { winner: 'b', method: 'points', score: null });
  expect((await send([final])).json()).toEqual(counts({ received: 1, conflicts: 1 }));
  expect(statuses()).toEqual([{ status: 'conflict', reason: 'Les combattants de ce combat ont changé.' }]);
  expect((await records(f.a54.id)).map((r) => r.matchId).sort()).toEqual(['w1-0', 'w1-1']);
});

test('après un conflit, l’entrée suivante de la même catégorie → waiting ; celle d’une autre catégorie → applied', async () => {
  const first = await resultEntry(f.a54.id, 'w1-0');
  const second = await resultEntry(f.a54.id, 'w1-1');
  const rid = f.kata.bracket!.entrants![0]!.registrationId;
  const kata = kataEntry(rid, [8, 8, 7]);
  await putOnMain(f.a54.id, 'w1-0', { winner: 'b', method: 'points', score: null });
  expect((await send([first, second, kata])).json()).toEqual(counts({ received: 3, conflicts: 1, waiting: 1, applied: 1 }));
  expect(statuses().map((s) => s.status)).toEqual(['conflict', 'waiting', 'applied']);
  expect((await records(f.a54.id)).map((r) => r.matchId)).toEqual(['w1-0']);
});

test('correction par la zone de sa propre saisie (seq 1 puis seq 2 sur le même combat) → les deux applied, le résultat final est celui de seq 2', async () => {
  const first = await resultEntry(f.a54.id, 'w1-0');
  // Sur le portable, la seconde saisie a lu la version locale de la première : une version propre au portable.
  const second = await resultEntry(f.a54.id, 'w1-0', { winner: 'b', method: 'decision', score: null }, { baseRev: '987654' });
  expect((await send([first, second])).json()).toEqual(counts({ received: 2, applied: 2 }));
  expect(await records(f.a54.id)).toMatchObject([{ matchId: 'w1-0', winner: 'b', method: 'decision' }]);
});

test('effacement : applied, puis present ; effacement d’un résultat changé entre-temps → conflict', async () => {
  await putOnMain(f.a54.id, 'w1-0', RESULT as Result);
  expect((await send([await deleteEntry(f.a54.id, 'w1-0')])).json()).toEqual(counts({ received: 1, applied: 1 }));
  expect(await records(f.a54.id)).toEqual([]);
  expect((await send([await deleteEntry(f.a54.id, 'w1-0', { baseRev: '42' })])).json()).toEqual(counts({ received: 1, present: 1 }));
  await putOnMain(f.a54.id, 'w1-1', RESULT as Result);
  const stale = await deleteEntry(f.a54.id, 'w1-1');
  await putOnMain(f.a54.id, 'w1-1', { winner: 'b', method: 'points', score: null });
  expect((await send([stale])).json()).toEqual(counts({ received: 1, conflicts: 1 }));
  expect((await records(f.a54.id)).map((r) => r.matchId)).toEqual(['w1-1']);
});

test('notes de kata : applied / present / conflict', async () => {
  const [r0, r1] = f.kata.bracket!.entrants!.map((e) => e.registrationId);
  expect((await send([kataEntry(r0!, [8, 8, 7])])).json()).toEqual(counts({ received: 1, applied: 1 }));
  expect((await send([kataEntry(r0!, [8, 8, 7], { baseRev: 'none' })])).json()).toEqual(counts({ received: 1, present: 1 }));
  const stale = kataEntry(r1!, [7, 7, 7]);
  expect((await f.onMain('PUT', `${f.base}/categories/${f.kata.id}/kata/${r1}/round1`, { notes: [9, 9, 9] })).statusCode).toBe(204);
  expect((await send([stale])).json()).toEqual(counts({ received: 1, conflicts: 1 }));
  const kata = (await f.onMain('GET', `${f.base}/categories/${f.kata.id}/results`)).json() as { kataScores: { round1: Record<string, number[]> } };
  expect(kata.kataScores.round1[r1!]).toEqual([9, 9, 9]);
});

test('départage : applied / present / conflict', async () => {
  const order = f.kata.bracket!.entrants!.map((e) => e.registrationId);
  expect((await send([tieBreakEntry(order)])).json()).toEqual(counts({ received: 1, applied: 1 }));
  expect((await send([tieBreakEntry(order, { baseRev: 'none' })])).json()).toEqual(counts({ received: 1, present: 1 }));
  const stale = tieBreakEntry([...order].reverse());
  expect((await f.onMain('PUT', `${f.base}/categories/${f.kata.id}/tie-break`, { scope: 'kata', order: [order[0]!, order[2]!] })).statusCode).toBe(204);
  expect((await send([stale])).json()).toEqual(counts({ received: 1, conflicts: 1 }));
});

test('une saisie que les règles refusent (combat introuvable) → conflict avec son message', async () => {
  const e = await resultEntry(f.a54.id, 'w9-9', RESULT as Result, { entrants: null });
  expect((await send([e])).json()).toEqual(counts({ received: 1, conflicts: 1 }));
  expect(statuses()[0]!.reason).toBe('Combat introuvable');
});

test('journal reçu deux fois → alreadyReceived = n, rien de plus', async () => {
  const entries = [await resultEntry(f.a54.id, 'w1-0'), await resultEntry(f.a54.id, 'w1-1')];
  expect((await send(entries)).json()).toEqual(counts({ received: 2, applied: 2 }));
  expect((await send(entries)).json()).toEqual(counts({ received: 2, alreadyReceived: 2 }));
  expect(statuses()).toHaveLength(2);
});

test('autre compétition → 400 ; format inconnu → 400 ; entrée mal formée → 400, rien d’appliqué', async () => {
  const e = await resultEntry(f.a54.id, 'w1-0');
  let res = await f.onMain('POST', `${f.base}/zone-journal`, journal([e], { competitionId: 'autre' }));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Ce journal est celui d’une autre compétition.');
  res = await f.onMain('POST', `${f.base}/zone-journal`, { format: 'shidokan-competition' });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Ce fichier n’est pas un journal de zone.');
  res = await f.onMain('POST', `${f.base}/zone-journal`, journal([e, { ...e, id: randomUUID(), seq: 'deux' } as unknown as ZoneEntry]));
  expect(res.statusCode).toBe(400);
  expect(await records(f.a54.id)).toEqual([]);
  expect(statuses()).toEqual([]);
});
