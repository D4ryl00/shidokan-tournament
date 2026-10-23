import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copyFromMain } from '../../src/server/zone/link.js';
import { pendingEntries } from '../../src/server/zone/autonomous.js';
import { holdResponses, mainAndLaptop, RESULT, tick } from '../helpers/zones-fixture.js';

let f: Awaited<ReturnType<typeof mainAndLaptop>>;
beforeEach(async () => {
  f = await mainAndLaptop();
});
afterEach(async () => {
  await f.close();
});

const OTHER_WRITE = 'Zone autonome : seules les saisies de la zone Tatami 1 sont possibles sur ce PC.';
const OTHER_ZONE = 'Ce combat ne se joue pas sur la zone Tatami 1.';
const NOT_LAUNCHED = 'Session suivante pas encore lancée sur cette copie.';
const autonomous = () => f.onLaptop('POST', '/api/zone-link/autonomous');

test('avant : toute écriture sur le portable → 409 (lecture seule)', async () => {
  const res = await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w1-0`, RESULT);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toMatch(/lecture seule/);
  expect(pendingEntries(f.laptopDb, f.id)).toEqual([]);
});

test('zone autonome Tatami 1 : résultat d’un combat de -54 → 200 et une entrée de journal ; correction du même combat → seq 2, baseRev = la version locale', async () => {
  expect((await autonomous()).statusCode).toBe(204);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
  const [first] = pendingEntries(f.laptopDb, f.id);
  const results = (await f.onLaptop('GET', `${f.base}/categories/${f.a54.id}/results`)).json() as { records: { matchId: string; entrantA: string; entrantB: string; rev: string }[] };
  const record = results.records.find((r) => r.matchId === 'w1-0')!;
  expect(first).toMatchObject({
    seq: 1, kind: 'result', categoryId: f.a54.id, matchId: 'w1-0', data: { winner: 'a', method: 'points', score: null },
    entrants: [record.entrantA, record.entrantB], baseRev: 'none', zoneId: f.t1,
  });
  expect(first!.id).toMatch(/^[0-9a-f-]{36}$/);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w1-0`, { winner: 'b', method: 'decision', score: null })).statusCode).toBe(200);
  const second = pendingEntries(f.laptopDb, f.id)[1]!;
  expect(second).toMatchObject({ seq: 2, baseRev: record.rev, data: { winner: 'b', method: 'decision' } });
  expect((await f.onLaptop('DELETE', `${f.base}/categories/${f.a54.id}/results/w1-0`)).statusCode).toBe(204);
  expect(pendingEntries(f.laptopDb, f.id)[2]).toMatchObject({ seq: 3, kind: 'delete', data: null, entrants: [record.entrantA, record.entrantB] });
});

test('résultat d’un combat de -61 → 409 « Ce combat ne se joue pas sur la zone Tatami 1. » ; PATCH d’une catégorie → 409 ; rien dans le journal', async () => {
  await autonomous();
  const other = await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, RESULT);
  expect(other.statusCode).toBe(409);
  expect(other.json().error).toBe(OTHER_ZONE);
  const patch = await f.onLaptop('PATCH', `${f.base}/categories/${f.a54.id}`, { status: 'ready' });
  expect(patch.statusCode).toBe(409);
  expect(patch.json().error).toBe(OTHER_WRITE);
  expect((await f.onLaptop('POST', `${f.base}/registrations`, {})).json().error).toBe(OTHER_WRITE);
  expect(pendingEntries(f.laptopDb, f.id)).toEqual([]);
});

test('catégorie d’une session non lancée → 409 « Session suivante pas encore lancée sur cette copie. »', async () => {
  await autonomous();
  const res = await f.onLaptop('PUT', `${f.base}/categories/${f.m45.id}/results/w1-0`, RESULT);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe(NOT_LAUNCHED);
});

test('notes de kata et départage de sa zone → journal (kind kata, tie-break) ; une saisie refusée par les règles n’est pas notée', async () => {
  await autonomous();
  const rid = f.kata.bracket!.entrants![0]!.registrationId;
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.kata.id}/kata/${rid}/round1`, { notes: [8, 8, 7] })).statusCode).toBe(204);
  const order = f.kata.bracket!.entrants!.map((e) => e.registrationId);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.kata.id}/tie-break`, { scope: 'kata', order })).statusCode).toBe(204);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.kata.id}/tie-break`, { scope: 'pool:0', order })).statusCode).toBe(400);
  expect(pendingEntries(f.laptopDb, f.id)).toMatchObject([
    { seq: 1, kind: 'kata', registrationId: rid, round: 'round1', data: { notes: [8, 8, 7] }, entrants: null, baseRev: 'none' },
    { seq: 2, kind: 'tie-break', scope: 'kata', data: { order }, entrants: null, baseRev: 'none' },
  ]);
});

test('une copie du PC principal en cours quand la zone devient autonome : la réponse arrivée après n’écrase rien', async () => {
  expect((await f.onMain('PUT', `${f.base}/categories/${f.a54.id}/results/w1-1`, RESULT)).statusCode).toBe(200);
  const release = holdResponses();
  const running = copyFromMain(f.laptopDb, f.laptopPath);
  await tick();
  expect((await autonomous()).statusCode).toBe(204);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
  release();
  expect(await running).toEqual({ error: 'Zone autonome : la copie n’est plus mise à jour.' });
  const records = ((await f.onLaptop('GET', `${f.base}/categories/${f.a54.id}/results`)).json() as { records: { matchId: string }[] }).records.map((r) => r.matchId);
  expect(records).toEqual(['w1-0']);
  expect(pendingEntries(f.laptopDb, f.id)).toHaveLength(1);
});

test('zone autonome : seulement sur une copie du PC principal', async () => {
  const pkg = (await f.onMain('GET', `${f.base}/export.json`)).json();
  expect((await f.laptop.inject({ method: 'POST', url: '/api/competitions/import?takeOver=1', payload: pkg })).statusCode).toBe(200);
  const res = await autonomous();
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Seule une copie du PC principal peut passer en zone autonome.');
});

test('zone autonome : importer la compétition par fichier (même en reprenant la main) est refusé, rien ne change', async () => {
  await autonomous();
  const pkg = (await f.onMain('GET', `${f.base}/export.json`)).json();
  for (const q of ['', '?takeOver=1', '?replace=1']) {
    const res = await f.laptop.inject({ method: 'POST', url: `/api/competitions/import${q}`, payload: pkg });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Zone autonome en cours sur cette compétition : pour une copie plus récente, utilisez « Recevoir une copie plus récente ».');
  }
  expect((await f.onLaptop('GET', `${f.base}/management`)).json()).toMatchObject({ copyOfMain: true });
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, RESULT)).statusCode).toBe(409);
});

test('bandeau : GET /api/zone-link donne autonomous.since et pending = 3', async () => {
  await autonomous();
  for (const m of ['w1-0', 'w1-1']) await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/${m}`, RESULT);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(200);
  const view = (await f.onLaptop('GET', '/api/zone-link')).json();
  expect(view).toMatchObject({ zoneName: 'Tatami 1', pending: 3, link: { autonomous: { since: expect.any(String), finals: false } } });
});

describe('finales de ses catégories (zone des finales sur Tatami 2)', () => {
  let g: Awaited<ReturnType<typeof mainAndLaptop>>;
  beforeEach(async () => {
    g = await mainAndLaptop({ finalsOnT2: true });
    expect((await g.onLaptop('POST', '/api/zone-link/autonomous')).statusCode).toBe(204);
    for (const m of ['w1-0', 'w1-1']) expect((await g.onLaptop('PUT', `${g.base}/categories/${g.a54.id}/results/${m}`, RESULT)).statusCode).toBe(200);
  });
  afterEach(async () => {
    await g.close();
  });

  test('la finale de -54 refusée au portable Tatami 1 ; après « finals », permise et journalisée ; une finale d’une catégorie de Tatami 2 reste refusée', async () => {
    const refused = await g.onLaptop('PUT', `${g.base}/categories/${g.a54.id}/results/w2-0`, RESULT);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe(OTHER_ZONE);
    expect((await g.onLaptop('POST', '/api/zone-link/finals')).statusCode).toBe(204);
    expect((await g.onLaptop('GET', '/api/zone-link')).json()).toMatchObject({ link: { autonomous: { finals: true } } });
    expect((await g.onLaptop('PUT', `${g.base}/categories/${g.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(200);
    expect(pendingEntries(g.laptopDb, g.id).at(-1)).toMatchObject({ seq: 3, kind: 'result', matchId: 'w2-0' });
    const other = await g.onLaptop('PUT', `${g.base}/categories/${g.b61.id}/results/w2-0`, RESULT);
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe(OTHER_ZONE);
  });

  test('« finals » : seulement en zone autonome', async () => {
    await g.onLaptop('POST', '/api/zone-link/online');
    const res = await g.onLaptop('POST', '/api/zone-link/finals');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Ce PC n’est pas en zone autonome.');
  });

  test('au rejeu, une finale déjà jouée sur la zone des finales → carte', async () => {
    await g.onLaptop('POST', '/api/zone-link/finals');
    expect((await g.onLaptop('PUT', `${g.base}/categories/${g.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(200);
    // Sur le PC principal, la zone des finales a reçu les demi-finales (par fichier) et joué la finale avec l'autre vainqueur.
    for (const m of ['w1-0', 'w1-1']) await g.onMain('PUT', `${g.base}/categories/${g.a54.id}/results/${m}`, RESULT);
    await g.onMain('PUT', `${g.base}/categories/${g.a54.id}/results/w2-0`, { winner: 'b', method: 'points', score: null });
    const res = await g.onLaptop('POST', '/api/zone-link/online');
    expect(res.json().report).toMatchObject({ received: 3, present: 2, conflicts: 1 });
    const cards = (await g.onMain('GET', `${g.base}/zone-cards`)).json() as { target: string; reason: string }[];
    expect(cards).toMatchObject([{ reason: 'Une autre saisie a été faite sur le PC principal.' }]);
  });
});
