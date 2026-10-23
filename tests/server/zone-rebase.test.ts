import { afterEach, beforeEach, expect, test } from 'vitest';
import { pendingEntries } from '../../src/server/zone/autonomous.js';
import { mainAndLaptop, RESULT } from '../helpers/zones-fixture.js';

/** Portable de la zone des finales (Tatami 2), en zone autonome. */
let f: Awaited<ReturnType<typeof mainAndLaptop>>;
beforeEach(async () => {
  f = await mainAndLaptop({ finalsOnT2: true, zone: 't2' });
  expect((await f.onLaptop('POST', '/api/zone-link/autonomous')).statusCode).toBe(204);
});
afterEach(async () => {
  await f.close();
});

const refresh = (pkg?: unknown) => f.onLaptop('POST', '/api/zone-link/refresh', pkg as object);
const laptopRecords = async (cid: string) =>
  ((await f.onLaptop('GET', `${f.base}/categories/${cid}/results`)).json() as { records: { matchId: string; winner: string }[] }).records;
const B = { winner: 'b', method: 'points', score: null };

test('copie plus récente avec les demi-finales d’une autre zone : la finale devient jouable sur le portable', async () => {
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(400);
  for (const m of ['w1-0', 'w1-1']) await f.onMain('PUT', `${f.base}/categories/${f.a54.id}/results/${m}`, RESULT);
  const res = await refresh();
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ reapplied: 0, present: 0, conflicts: 0 });
  expect((await f.onLaptop('GET', '/api/zone-link')).json()).toMatchObject({ link: { autonomous: { finals: false } } });
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(200);
  expect(pendingEntries(f.laptopDb, f.id)).toHaveLength(1);
});

test('par fichier : la copie exportée du PC principal, puis les saisies de la zone réappliquées', async () => {
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
  for (const m of ['w1-0', 'w1-1']) await f.onMain('PUT', `${f.base}/categories/${f.a54.id}/results/${m}`, RESULT);
  const pkg = (await f.onMain('GET', `${f.base}/export.json`)).json();
  expect((await refresh(pkg)).json()).toEqual({ reapplied: 1, present: 0, conflicts: 0 });
  expect((await laptopRecords(f.b61.id)).map((r) => r.matchId)).toEqual(['w1-0']);
  expect((await laptopRecords(f.a54.id)).map((r) => r.matchId).sort()).toEqual(['w1-0', 'w1-1']);
});

test('saisie de la zone déjà présente sur la nouvelle copie → present, pas de doublon', async () => {
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
  // Le journal est parti par clé USB et le PC principal l'a appliqué ; la zone autonome continue.
  const journal = (await f.onLaptop('GET', '/api/zone-link/journal.json')).json();
  expect((await f.onMain('POST', `${f.base}/zone-journal`, journal)).json()).toMatchObject({ applied: 1 });
  expect((await refresh()).json()).toEqual({ reapplied: 0, present: 1, conflicts: 0 });
  expect(await laptopRecords(f.b61.id)).toHaveLength(1);
  expect(pendingEntries(f.laptopDb, f.id)).toHaveLength(1);
});

test('saisie en conflit → la nouvelle copie garde sa valeur ; l’entrée reste à renvoyer', async () => {
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-1`, RESULT)).statusCode).toBe(200);
  await f.onMain('PUT', `${f.base}/categories/${f.b61.id}/results/w1-1`, B);
  expect((await refresh()).json()).toEqual({ reapplied: 0, present: 0, conflicts: 1 });
  expect(await laptopRecords(f.b61.id)).toMatchObject([{ matchId: 'w1-1', winner: 'b' }]);
  expect(pendingEntries(f.laptopDb, f.id)).toHaveLength(1);
});

test('toutes les entrées restent non envoyées ; « Repasser en ligne » ensuite → compte rendu cohérent', async () => {
  // w1-0, puis sa correction par la zone (elle se réapplique aussi), puis w1-1, saisi autrement sur le PC principal.
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, B)).statusCode).toBe(200);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.b61.id}/results/w1-1`, RESULT)).statusCode).toBe(200);
  await f.onMain('PUT', `${f.base}/categories/${f.b61.id}/results/w1-1`, B);
  expect((await refresh()).json()).toEqual({ reapplied: 2, present: 0, conflicts: 1 });
  expect(await laptopRecords(f.b61.id)).toMatchObject([{ matchId: 'w1-0', winner: 'b' }, { matchId: 'w1-1', winner: 'b' }]);
  expect((await f.onLaptop('GET', '/api/zone-link')).json()).toMatchObject({ pending: 3 });
  // Le second rebase ne double rien.
  expect((await refresh()).json()).toEqual({ reapplied: 2, present: 0, conflicts: 1 });
  const online = await f.onLaptop('POST', '/api/zone-link/online');
  expect(online.json().report).toEqual({ received: 3, applied: 2, present: 0, conflicts: 1, waiting: 0, alreadyReceived: 0 });
});

test('fichier d’une autre compétition → 400 ; hors zone autonome → 409', async () => {
  const other = (await f.onMain('POST', '/api/competitions', { name: 'Open', date: '2026-12-06' })).json().id as string;
  const pkg = (await f.onMain('GET', `/api/competitions/${other}/export.json`)).json();
  const res = await refresh(pkg);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Ce fichier est celui d’une autre compétition.');
  await f.onLaptop('POST', '/api/zone-link/online');
  expect((await refresh()).statusCode).toBe(409);
});
