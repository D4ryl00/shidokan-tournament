import { afterEach, beforeEach, expect, test } from 'vitest';
import { pendingEntries } from '../../src/server/zone/autonomous.js';
import { copyFromMain } from '../../src/server/zone/link.js';
import { holdResponses, loseResponses, mainAndLaptop, mainCompetition, RESULT, tick } from '../helpers/zones-fixture.js';

let f: Awaited<ReturnType<typeof mainAndLaptop>>;
beforeEach(async () => {
  f = await mainAndLaptop();
  expect((await f.onLaptop('POST', '/api/zone-link/autonomous')).statusCode).toBe(204);
  for (const m of ['w1-0', 'w1-1']) expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/${m}`, RESULT)).statusCode).toBe(200);
});
afterEach(async () => {
  await f.close();
});

const mainRecords = async () =>
  ((await f.onMain('GET', `${f.base}/categories/${f.a54.id}/results`)).json() as { records: { matchId: string }[] }).records.map((r) => r.matchId).sort();
const view = async () => (await f.onLaptop('GET', '/api/zone-link')).json() as { link: { autonomous: unknown }; pending: number; status: { lastCopyAt: string | null } };

test('repasser en ligne : saisies appliquées sur le PC principal, compte rendu, zone autonome arrêtée, copie reprise', async () => {
  // Pendant la coupure, la table centrale a saisi un combat d'une autre catégorie sur le PC principal.
  expect((await f.onMain('PUT', `${f.base}/categories/${f.b61.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
  const res = await f.onLaptop('POST', '/api/zone-link/online');
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ zoneName: 'Tatami 1', mainUrl: f.mainUrl, report: { received: 2, applied: 2, present: 0, conflicts: 0, waiting: 0, alreadyReceived: 0 } });
  expect(await mainRecords()).toEqual(['w1-0', 'w1-1']);
  expect(await view()).toMatchObject({ link: { autonomous: null }, pending: 0 });
  // Copie reprise : le combat saisi à la table centrale est sur le portable, qui est de nouveau en lecture seule.
  const b61 = (await f.onLaptop('GET', `${f.base}/categories/${f.b61.id}/results`)).json() as { records: { matchId: string }[] };
  expect(b61.records.map((r) => r.matchId)).toEqual(['w1-0']);
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(409);
});

test('PC principal arrêté → 502, la zone reste autonome, pending inchangé', async () => {
  await f.main.close();
  const res = await f.onLaptop('POST', '/api/zone-link/online');
  expect(res.statusCode).toBe(502);
  expect(res.json().error).toMatch(/^PC principal injoignable/);
  expect(await view()).toMatchObject({ link: { autonomous: { finals: false } }, pending: 2 });
  expect((await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w2-0`, RESULT)).statusCode).toBe(200);
});

test('réponse perdue après réception : un second envoi → alreadyReceived, rien en double', async () => {
  const restore = loseResponses();
  const lost = await f.onLaptop('POST', '/api/zone-link/online');
  restore();
  expect(lost.statusCode).toBe(502);
  expect(await view()).toMatchObject({ pending: 2, link: { autonomous: { finals: false } } });
  expect(await mainRecords()).toEqual(['w1-0', 'w1-1']);
  const again = await f.onLaptop('POST', '/api/zone-link/online');
  expect(again.statusCode).toBe(200);
  expect(again.json().report).toMatchObject({ received: 2, applied: 0, alreadyReceived: 2 });
  expect(await mainRecords()).toEqual(['w1-0', 'w1-1']);
});

test('journal.json puis stop exported → plus autonome ; le fichier importé sur le PC principal applique les saisies', async () => {
  const file = await f.onLaptop('GET', '/api/zone-link/journal.json');
  expect(file.statusCode).toBe(200);
  expect(file.headers['content-disposition']).toMatch(/^attachment; filename="journal-Tatami-1-\d{8}-\d{6}\.json"$/);
  const journal = file.json();
  expect(journal).toMatchObject({ format: 'shidokan-zone-journal', formatVersion: 1, competitionId: f.id, zoneId: f.t1, zoneName: 'Tatami 1', from: { instanceName: 'PORTABLE-T1' } });
  expect(journal.entries).toHaveLength(2);
  expect((await view()).pending).toBe(2);
  const refused = await f.onLaptop('POST', '/api/zone-link/stop', {});
  expect(refused.statusCode).toBe(400);
  expect(refused.json().error).toBe('Exportez d’abord le journal (fichier).');
  expect((await f.onLaptop('POST', '/api/zone-link/stop', { exported: true })).statusCode).toBe(204);
  expect(await view()).toMatchObject({ link: { autonomous: null }, pending: 0 });
  expect(pendingEntries(f.laptopDb, f.id)).toEqual([]);
  expect((await f.onMain('POST', `${f.base}/zone-journal`, journal)).json()).toMatchObject({ received: 2, applied: 2 });
  expect(await mainRecords()).toEqual(['w1-0', 'w1-1']);
});

test('pendant l’envoi, les saisies sont refusées (elles ne seraient pas dans le journal envoyé)', async () => {
  const release = holdResponses();
  const sending = f.onLaptop('POST', '/api/zone-link/online');
  await tick();
  const during = await f.onLaptop('PUT', `${f.base}/categories/${f.a54.id}/results/w2-0`, RESULT);
  expect(during.statusCode).toBe(409);
  expect(during.json().error).toBe('Envoi du journal en cours : réessayez dans un instant.');
  release();
  expect((await sending).statusCode).toBe(200);
});

test('schedule : waitingOtherZones compte les combats de la zone qui attendent les résultats d’une autre zone', async () => {
  const m = await mainCompetition({ finalsOnT2: true });
  try {
    const waiting = async () =>
      Object.fromEntries(((await m.onMain('GET', `${m.base}/schedule`)).json() as { zones: { zone: { id: string }; waitingOtherZones: number }[] }).zones.map((z) => [z.zone.id, z.waitingOtherZones]));
    // Finale de -54 (Tatami 1) sur la zone des finales : elle attend les demi-finales.
    expect(await waiting()).toMatchObject({ [m.t1]: 0, [m.t2]: 1 });
    for (const match of ['w1-0', 'w1-1']) await m.onMain('PUT', `${m.base}/categories/${m.a54.id}/results/${match}`, RESULT);
    expect(await waiting()).toMatchObject({ [m.t2]: 0 });
  } finally {
    await m.main.close();
  }
});

test('repasser en ligne quand le PC principal n’a rien appliqué (tout en conflit) : la copie reprend quand même celle du PC principal', async () => {
  // Saisies de la zone sur w1-0 et w1-1 ; avant la coupure, la table centrale avait déjà saisi autre chose (le portable ne l'a pas vu).
  const fresh = await mainAndLaptop();
  try {
    await fresh.onMain('PUT', `${fresh.base}/categories/${fresh.b61.id}/results/w1-0`, RESULT); // rien sur -54 : empreinte inchangée ensuite
    expect((await fresh.onLaptop('POST', '/api/zone-link/autonomous')).statusCode).toBe(204);
    expect((await fresh.onLaptop('PUT', `${fresh.base}/categories/${fresh.a54.id}/results/w1-0`, RESULT)).statusCode).toBe(200);
    expect((await fresh.onMain('PUT', `${fresh.base}/categories/${fresh.a54.id}/results/w1-0`, { winner: 'b', method: 'points', score: null })).statusCode).toBe(200);
    // Le portable reçoit cette version (copie juste avant la coupure, par exemple) : son empreinte est celle du PC principal.
    const res = await fresh.onLaptop('POST', '/api/zone-link/refresh');
    expect(res.json()).toMatchObject({ conflicts: 1 });
    expect((await fresh.onLaptop('POST', '/api/zone-link/online')).json().report).toMatchObject({ conflicts: 1 });
    const laptop = (await fresh.onLaptop('GET', `${fresh.base}/categories/${fresh.a54.id}/results`)).json() as { records: { matchId: string; winner: string }[] };
    expect(laptop.records).toMatchObject([{ matchId: 'w1-0', winner: 'b' }]);
  } finally {
    await fresh.close();
  }
});

test('repasser en ligne, tout en conflit, sans copie entre-temps : le portable ne garde pas sa saisie locale', async () => {
  const fresh = await mainAndLaptop();
  try {
    // Avant la coupure : w1-0 gagné par A, vu par le portable.
    await fresh.onMain('PUT', `${fresh.base}/categories/${fresh.a54.id}/results/w1-0`, RESULT);
    await copyFromMain(fresh.laptopDb, fresh.laptopPath);
    expect((await fresh.onLaptop('POST', '/api/zone-link/autonomous')).statusCode).toBe(204);
    expect((await fresh.onLaptop('PUT', `${fresh.base}/categories/${fresh.a54.id}/results/w1-0`, { winner: 'b', method: 'decision', score: null })).statusCode).toBe(200);
    // La table centrale change ce résultat, puis revient au premier : même contenu (même empreinte), autre version.
    await fresh.onMain('PUT', `${fresh.base}/categories/${fresh.a54.id}/results/w1-0`, { winner: 'b', method: 'points', score: null });
    await fresh.onMain('PUT', `${fresh.base}/categories/${fresh.a54.id}/results/w1-0`, RESULT);
    expect((await fresh.onLaptop('POST', '/api/zone-link/online')).json().report).toMatchObject({ conflicts: 1 });
    const laptop = (await fresh.onLaptop('GET', `${fresh.base}/categories/${fresh.a54.id}/results`)).json() as { records: { matchId: string; winner: string; method: string }[] };
    expect(laptop.records).toMatchObject([{ matchId: 'w1-0', winner: 'a', method: 'points' }]);
  } finally {
    await fresh.close();
  }
});
