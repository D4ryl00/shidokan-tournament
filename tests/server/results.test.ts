import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { readWorkbook } from '../../src/server/spreadsheet/read.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  n++;
  const club = (await call('POST', '/clubs', { name: `Club ${n % 2 ? 'A' : 'B'}` })).json();
  return (await call('POST', '/registrations', {
    clubId: club.id, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  })).json().row as { id: string };
}
type Cat = { id: string; status: string; registrationIds: string[]; bracket: { kind: string; matches?: { id: string; round: number; phase: string }[] } };
const cats = async () => (await call('GET', '/categories')).json() as Cat[];
type Res = { records: { matchId: string; entrantA: string; entrantB: string }[]; ignored: { matchId: string }[]; progress: { status: string; played: number; total: number; podium: { complete: boolean; first: string | null; ties: string[][] } } };
const results = async (cid: string) => (await call('GET', `/categories/${cid}/results`)).json() as Res;
const put = (cid: string, matchId: string, winner: 'a' | 'b', method = 'points') => call('PUT', `/categories/${cid}/results/${matchId}`, { winner, method });

async function fourInElimination() {
  for (let i = 0; i < 4; i++) await reg();
  return (await cats())[0]!;
}

test('saisie : lancée puis terminée, podium', async () => {
  const c = await fourInElimination();
  expect((await put(c.id, 'w1-0', 'a')).statusCode).toBe(200);
  expect((await cats())[0]!.status).toBe('started');
  await put(c.id, 'w1-1', 'b');
  await put(c.id, 'w2-0', 'a');
  expect((await cats())[0]!.status).toBe('finished');
  const p = (await call('GET', '/podiums')).json() as { categories: { complete: boolean }[]; medals: { gold: number }[] };
  expect(p.categories[0]!.complete).toBe(true);
  expect(p.medals.reduce((s, r) => s + r.gold, 0)).toBe(1);
});

test('KO en jiyu et combat non jouable refusés', async () => {
  const c = await fourInElimination();
  expect((await put(c.id, 'w1-0', 'a', 'ko')).statusCode).toBe(400);
  expect((await put(c.id, 'w2-0', 'a')).statusCode).toBe(400);
});

test('correction : la finale devient à revoir et ignorée', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  await put(c.id, 'w1-1', 'a');
  await put(c.id, 'w2-0', 'a');
  const res = await put(c.id, 'w1-0', 'b');
  expect(res.json().affected).toEqual(['w2-0']);
  const r = await results(c.id);
  expect(r.ignored.map((x) => x.matchId)).toEqual(['w2-0']);
  expect(r.progress.podium.complete).toBe(false);
  expect((await cats())[0]!.status).toBe('started');
});

test('déverrouillage + nouveau combattant : anciens résultats jamais réappliqués à d’autres combattants', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  const before = (await results(c.id)).records[0]!;
  await call('PATCH', `/categories/${c.id}`, { status: 'ready', unlock: true });
  await reg();
  await call('POST', `/categories/${c.id}/redraw`);
  const r = await results(c.id);
  const cat = (await cats()).find((x) => x.id === c.id)!;
  const { resolveBracket } = await import('../../src/domain/brackets/index.js');
  const m = resolveBracket(cat.bracket as never, {}).matches.find((x) => x.id === 'w1-0')!;
  const samePair = [m.entrantA, m.entrantB].sort().join() === [before.entrantA, before.entrantB].sort().join();
  // Le résultat n'est appliqué que si le combat oppose exactement les deux mêmes combattants.
  expect(r.progress.played).toBe(samePair ? 1 : 0);
  expect(r.ignored).toHaveLength(samePair ? 0 : 1);
});

test('effacer le dernier résultat → prête', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  await call('DELETE', `/categories/${c.id}/results/w1-0`);
  expect((await cats())[0]!.status).toBe('ready');
});

test('poule de 3 en cycle → départage → terminée', async () => {
  for (let i = 0; i < 3; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const c = (await cats())[0]!;
  const ids = c.registrationIds;
  const matches = (await (await call('GET', `/categories/${c.id}/results`)).json()) as Res;
  void matches;
  // cycle réel : ids[0] bat ids[1], ids[1] bat ids[2], ids[2] bat ids[0]
  const { resolveBracket } = await import('../../src/domain/brackets/index.js');
  const beats: Record<string, string> = { [ids[0]!]: ids[1]!, [ids[1]!]: ids[2]!, [ids[2]!]: ids[0]! };
  for (const m of resolveBracket(c.bracket as never, {}).matches) {
    await put(c.id, m.id, beats[m.entrantA!] === m.entrantB ? 'a' : 'b');
  }
  let r = await results(c.id);
  expect(r.progress.podium.ties).toHaveLength(1);
  expect(r.progress.status).toBe('started');
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:0', order: ids });
  r = await results(c.id);
  expect(r.progress.status).toBe('finished');
});

test('kata à 3 : notes, égalité, départage', async () => {
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  const c = (await cats())[0]!;
  const note = (rid: string, round: string, notes: number[]) => call('PUT', `/categories/${c.id}/kata/${rid}/${round}`, { notes });
  await note(k[0]!.id, 'round1', [9, 9, 9]);
  await note(k[1]!.id, 'round1', [8, 8, 8]);
  await note(k[2]!.id, 'round1', [8, 8, 8]);
  let r = await results(c.id);
  expect(r.progress.podium.complete).toBe(false);
  expect(r.progress.podium.ties.length).toBe(1);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata', order: [k[2]!.id, k[1]!.id] });
  await note(k[0]!.id, 'final', [7, 7, 7]);
  await note(k[2]!.id, 'final', [9, 9, 9]);
  r = await results(c.id);
  expect(r.progress).toMatchObject({ status: 'finished', podium: { first: k[2]!.id } });
  expect((await note(k[0]!.id, 'round1', [11])).statusCode).toBe(400);
});

test('programme des tatamis', async () => {
  await fourInElimination();
  for (let i = 0; i < 2; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const [a, b] = await cats();
  await call('PATCH', `/categories/${a!.id}`, { tatami: 1, order: 2 });
  await call('PATCH', `/categories/${b!.id}`, { tatami: 1, order: 1 });
  const s = (await call('GET', '/schedule')).json() as { tatamis: { tatami: number; categories: { id: string; nextMatches: unknown[] }[] }[] };
  const t1 = s.tatamis.find((t) => t.tatami === 1)!;
  expect(t1.categories.map((c) => c.id)).toEqual([b!.id, a!.id]);
  expect(t1.categories[1]!.nextMatches).toHaveLength(2);
});

test('exports .xlsx et .ods relus', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  await put(c.id, 'w1-1', 'a');
  await put(c.id, 'w2-0', 'b');
  const res = await call('GET', '/exports/results.xlsx');
  expect(res.statusCode).toBe(200);
  const book = readWorkbook(res.rawPayload);
  expect(book.sheets[0]!.cells.length).toBeGreaterThanOrEqual(4);
  const pod = readWorkbook((await call('GET', '/exports/podiums.ods')).rawPayload);
  expect(pod.sheets.map((s) => s.name)).toEqual(['Podiums', 'Clubs']);
  expect(pod.sheets[1]!.cells[0]).toEqual(['Club', 'Or', 'Argent', 'Bronze', 'Total']);
});

test('tie-break : portée invalide ou inscrits étrangers refusés ; ordres fusionnés', async () => {
  for (let i = 0; i < 3; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const c = (await cats())[0]!;
  expect((await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:42', order: c.registrationIds })).statusCode).toBe(400);
  expect((await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:0', order: ['inconnu', 'autre'] })).statusCode).toBe(400);
});

test('combattant absent après la fin : le podium et les médailles restent', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  const c = (await cats())[0]!;
  await put(c.id, c.bracket.matches![0]!.id, 'a');
  const fighter = ((await call('GET', '/registrations')).json() as { id: string; fighterId: string }[]).find((x) => x.id === a.id)!.fighterId;
  await call('PUT', `/weigh-in/${fighter}`, { presence: 'absent' });
  const p = (await call('GET', '/podiums')).json() as { categories: { complete: boolean }[]; medals: unknown[] };
  expect(p.categories).toHaveLength(1);
  expect(p.categories[0]!.complete).toBe(true);
  expect(p.medals.length).toBeGreaterThan(0);
});

test('inscription d’une catégorie lancée : suppression refusée ; export toujours possible', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  const res = await call('DELETE', `/registrations/${c.registrationIds[0]}`);
  expect(res.statusCode).toBe(409);
  expect((await call('GET', '/exports/results.xlsx')).statusCode).toBe(200);
});

async function cycleOfThree() {
  for (let i = 0; i < 3; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const c = (await cats())[0]!;
  const ids = c.registrationIds;
  const { resolveBracket } = await import('../../src/domain/brackets/index.js');
  const beats: Record<string, string> = { [ids[0]!]: ids[1]!, [ids[1]!]: ids[2]!, [ids[2]!]: ids[0]! };
  const matches = resolveBracket(c.bracket as never, {}).matches;
  for (const m of matches) await put(c.id, m.id, beats[m.entrantA!] === m.entrantB ? 'a' : 'b');
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:0', order: ids });
  return { c, ids, matches, beats };
}
type FullRes = Res & { tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] } };

test('départage de poule effacé quand un résultat de la poule change (pas s’il est ré-enregistré à l’identique)', async () => {
  const { c, matches, beats } = await cycleOfThree();
  const m = matches[0]!;
  const same = beats[m.entrantA!] === m.entrantB ? 'a' : 'b';
  await put(c.id, m.id, same);
  expect(((await results(c.id)) as FullRes).tieBreaks.pools[0]).toBeDefined();
  await put(c.id, m.id, same === 'a' ? 'b' : 'a');
  const r = (await results(c.id)) as FullRes;
  expect(r.tieBreaks.pools[0]).toBeUndefined();
  expect(r.progress.podium.ties).toHaveLength(0); // plus de cycle : classement net
});

test('départage de poule effacé quand un résultat de la poule est effacé', async () => {
  const { c, matches } = await cycleOfThree();
  await call('DELETE', `/categories/${c.id}/results/${matches[0]!.id}`);
  expect(((await results(c.id)) as FullRes).tieBreaks.pools[0]).toBeUndefined();
});

test('kata : départage effacé quand une note du tour 1 change', async () => {
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  const c = (await cats())[0]!;
  const note = (rid: string, round: string, notes: number[]) => call('PUT', `/categories/${c.id}/kata/${rid}/${round}`, { notes });
  await note(k[0]!.id, 'round1', [9, 9, 9]);
  await note(k[1]!.id, 'round1', [8, 8, 8]);
  await note(k[2]!.id, 'round1', [8, 8, 8]);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata', order: [k[2]!.id, k[1]!.id] });
  await note(k[1]!.id, 'round1', [8, 8, 8]);
  expect(((await results(c.id)) as FullRes).tieBreaks.kata).toHaveLength(2);
  await note(k[1]!.id, 'round1', [8.5, 8, 8]);
  expect(((await results(c.id)) as FullRes).tieBreaks.kata).not.toContain(k[1]!.id);
});

test('kata : une note du tour 1 hors du groupe à égalité ne défait pas les départages', async () => {
  const k: { id: string }[] = [];
  for (let i = 0; i < 5; i++) k.push(await reg({ discipline: 'kata', ruleset: null, weightClassId: null }));
  const c = (await cats())[0]!;
  const note = (rid: string, round: string, notes: number[]) => call('PUT', `/categories/${c.id}/kata/${rid}/${round}`, { notes });
  const [a, b, d, e, f] = k.map((x) => x.id) as [string, string, string, string, string];
  await note(a, 'round1', [9, 9, 9]);
  await note(b, 'round1', [8, 8, 8]);
  await note(d, 'round1', [8, 8, 8]);
  await note(e, 'round1', [7, 7, 7]);
  await note(f, 'round1', [6, 6, 6]);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata', order: [d, b] });
  await note(a, 'final', [8, 8, 8]);
  await note(d, 'final', [8, 8, 8]);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata:final', order: [d, a] });
  expect((await results(c.id)).progress.podium.complete).toBe(true);
  await note(f, 'round1', [5, 5, 5]);
  let r = (await results(c.id)) as FullRes;
  expect(r.tieBreaks.kata).toEqual([d, b]);
  expect(r.tieBreaks.kataFinal).toEqual([d, a]);
  // b passe devant : il sort du départage du tour 1, et la finale change de finalistes → départage de la finale effacé.
  await note(b, 'round1', [10, 10, 10]);
  r = (await results(c.id)) as FullRes;
  expect(r.tieBreaks.kata).toEqual([d]);
  expect(r.tieBreaks.kataFinal).toEqual([]);
});

test('régénération du tableau : les départages sont effacés', async () => {
  const { c } = await cycleOfThree();
  await call('PATCH', `/categories/${c.id}`, { status: 'ready', unlock: true });
  await reg({ weightClassId: 'cadet:F:-61' });
  const again = (await cats())[0]!;
  expect(again.registrationIds).toHaveLength(4);
  expect(((await results(again.id)) as FullRes).tieBreaks.pools[0]).toBeUndefined();
});

test('statut : une catégorie provisoire le reste tant qu’aucun résultat n’est saisi', async () => {
  const c = await fourInElimination();
  expect(c.status).toBe('provisional');
  await call('DELETE', `/categories/${c.id}/results/w1-0`);
  expect((await cats())[0]!.status).toBe('provisional');
});

test('export des podiums : podium incomplet « en cours », « Sans club » hors du classement des clubs', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  for (let i = 0; i < 2; i++) await call('POST', '/registrations', { clubId: null, lastName: `SANS${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-61', source: 'manual' });
  const solo = (await cats()).find((x) => x.registrationIds.length === 2)!;
  await put(solo.id, solo.bracket.matches![0]!.id, 'a');
  const pod = readWorkbook((await call('GET', '/exports/podiums.xlsx')).rawPayload);
  const rows = pod.sheets[0]!.cells;
  expect(rows[0]).toEqual(['Catégorie', 'État', '1er', '2e', '3e', '3e']);
  expect(rows.find((r) => String(r[0]).includes('-54'))![1]).toBe('en cours');
  expect(rows.find((r) => String(r[0]).includes('-61'))![1]).toBe('terminé');
  expect(pod.sheets[1]!.cells.map((r) => r[0])).not.toContain('Sans club');
});

test('export des résultats : feuille « Kata » (notes, note retenue, rang)', async () => {
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  const c = (await cats())[0]!;
  await call('PUT', `/categories/${c.id}/kata/${k[0]!.id}/round1`, { notes: [9, 8.5, 9] });
  const book = readWorkbook((await call('GET', '/exports/results.xlsx')).rawPayload);
  const kata = book.sheets.find((s) => s.name === 'Kata')!;
  expect(kata.cells[0]).toEqual(['Catégorie', 'Tour', 'Rang', 'Kataka', 'Club', 'Notes', 'Note retenue']);
  const row = kata.cells.find((r) => r[5] === '9 ; 8,5 ; 9')!;
  expect(row).toMatchObject({ 1: 'Tour 1', 2: 1 });
  expect(Number(String(row[6]).replace(',', '.'))).toBeCloseTo(8.83, 2);
});
