import { afterEach, beforeEach, expect, test } from 'vitest';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import type { ZoneEntry } from '../../src/server/zone/entry.js';
import { journalBuilders, mainCompetition, RESULT } from '../helpers/zones-fixture.js';

let f: Awaited<ReturnType<typeof mainCompetition>>;
let db: AppDb;
let b: ReturnType<typeof journalBuilders>;
beforeEach(async () => {
  f = await mainCompetition();
  db = openDb(f.mainPath);
  b = journalBuilders(f, db);
});
afterEach(async () => {
  closeDb(db);
  await f.main.close();
});

type Card = { id: string; zoneName: string; categoryId: string; categoryLabel: string; kind: string; target: string; zone: string; pc: string; status: 'conflict' | 'waiting'; reason: string | null };
const cards = async () => (await f.onMain('GET', `${f.base}/zone-cards`)).json() as Card[];
const decide = (entryId: string, keep: 'zone' | 'pc') => f.onMain('POST', `${f.base}/zone-cards/${entryId}`, { keep });
const fighter = async (rid: string) => {
  const regs = (await f.onMain('GET', `${f.base}/registrations`)).json() as { id: string; fighter: { lastName: string; firstName: string } }[];
  const r = regs.find((x) => x.id === rid)!;
  return `${r.fighter.lastName} ${r.fighter.firstName}`;
};
const queueOf = async (zoneId: string) =>
  ((await f.onMain('GET', `/api/competitions/${f.id}/schedule`)).json() as { zones: { zone: { id: string }; queue: { categoryId: string; matchId: string | null; held: boolean }[] }[] }).zones.find(
    (z) => z.zone.id === zoneId,
  )!.queue;

/**
 * Avant la coupure : 1er tour de -54, combat w1-1 joué (A). La zone saisit w1-0 (A) puis la finale ; la table centrale a saisi
 * w1-0 (B) entre-temps : conflit sur w1-0, finale en attente.
 */
async function conflictThenWaiting(): Promise<[ZoneEntry, ZoneEntry]> {
  await b.putOnMain(f.a54.id, 'w1-1', RESULT as never);
  const first = await b.resultEntry(f.a54.id, 'w1-0');
  await b.putOnMain(f.a54.id, 'w1-0', RESULT as never); // lecture des combattants de la finale, vus par la zone
  const final = await b.resultEntry(f.a54.id, 'w2-0', { winner: 'a', method: 'decision', score: null }, { baseRev: 'none' });
  await b.putOnMain(f.a54.id, 'w1-0', { winner: 'b', method: 'points', score: '2-1' });
  expect((await b.send([first, final])).json()).toMatchObject({ conflicts: 1, waiting: 1 });
  return [first, final];
}

test('cartes : conflit et entrée en attente, avec les deux états lisibles', async () => {
  const [first, final] = await conflictThenWaiting();
  const [a, bb] = first.entrants!;
  const list = await cards();
  expect(list.map((c) => [c.id, c.status])).toEqual([[first.id, 'conflict'], [final.id, 'waiting']]);
  expect(list[0]).toMatchObject({
    zoneName: 'Tatami 1', categoryId: f.a54.id, categoryLabel: f.a54.label, kind: 'result',
    zone: `${await fighter(a)} gagne aux points`, pc: `${await fighter(bb)} gagne aux points (2-1)`, reason: 'Une autre saisie a été faite sur le PC principal.', canKeepZone: true,
  });
  expect(list[0]!.target).toMatch(/^Combat .+ : .+ contre .+$/);
  expect(list[1]).toMatchObject({ pc: 'aucun résultat', zone: expect.stringMatching(/gagne par décision$/), canKeepZone: false });
});

test('garder celui de la zone → appliqué ; l’entrée en attente de la catégorie s’applique toute seule', async () => {
  const [first, final] = await conflictThenWaiting();
  expect((await decide(first.id, 'zone')).statusCode).toBe(204);
  const records = await b.records(f.a54.id);
  expect(records.find((r) => r.matchId === 'w1-0')).toMatchObject({ winner: 'a' });
  expect(records.find((r) => r.matchId === 'w2-0')).toMatchObject({ winner: 'a', method: 'decision' });
  expect(await cards()).toEqual([]);
  expect(db.$client.prepare('select id, status from zone_entries order by seq').all()).toEqual([{ id: first.id, status: 'kept-zone' }, { id: final.id, status: 'applied' }]);
});

test('garder celui du PC → rien ne change ; l’entrée en attente devient un conflit (combattants changés)', async () => {
  const [first, final] = await conflictThenWaiting();
  expect((await decide(first.id, 'pc')).statusCode).toBe(204);
  const records = await b.records(f.a54.id);
  expect(records.find((r) => r.matchId === 'w1-0')).toMatchObject({ winner: 'b' });
  expect(records.some((r) => r.matchId === 'w2-0')).toBe(false);
  expect(await cards()).toMatchObject([{ id: final.id, status: 'conflict', reason: 'Les combattants de ce combat ont changé.' }]);
});

test('garder celui de la zone quand les combattants ont changé → 409 avec le message exact ; garder celui du PC la ferme', async () => {
  const [first, final] = await conflictThenWaiting();
  await decide(first.id, 'pc');
  expect((await cards())[0]).toMatchObject({ id: final.id, canKeepZone: false });
  const res = await decide(final.id, 'zone');
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Les combattants de ce combat ont changé : impossible de garder la saisie de la zone.');
  expect((await decide(final.id, 'pc')).statusCode).toBe(204);
  expect(await cards()).toEqual([]);
  expect((await decide(final.id, 'pc')).statusCode).toBe(409);
});

test('carte en attente : « Garder celui de la zone » refusé (la carte précédente de la catégorie d’abord) ; « Garder celui du PC » la ferme', async () => {
  const [first, final] = await conflictThenWaiting();
  const res = await decide(final.id, 'zone');
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Tranchez d’abord la carte précédente de cette catégorie : celle-ci s’appliquera ensuite toute seule si elle le peut.');
  expect((await b.records(f.a54.id)).some((r) => r.matchId === 'w2-0')).toBe(false);
  expect((await decide(final.id, 'pc')).statusCode).toBe(204);
  expect((await cards()).map((c) => c.id)).toEqual([first.id]);
});

test('schedule : held sur les passages d’une catégorie qui a une carte ouverte ; plus après la décision', async () => {
  const [first] = await conflictThenWaiting();
  const held = (await queueOf(f.t1)).filter((q) => q.categoryId === f.a54.id);
  expect(held.length).toBeGreaterThan(0);
  expect(held.every((q) => q.held)).toBe(true);
  expect((await queueOf(f.t1)).filter((q) => q.categoryId !== f.a54.id).every((q) => !q.held)).toBe(true);
  await decide(first.id, 'pc');
  await decide((await cards())[0]!.id, 'pc');
  expect((await queueOf(f.t1)).every((q) => !q.held)).toBe(true);
});

test('même journal reçu deux fois : pas de carte en double', async () => {
  const [first, final] = await conflictThenWaiting();
  expect((await b.send([first, final])).json()).toMatchObject({ alreadyReceived: 2 });
  expect(await cards()).toHaveLength(2);
});
