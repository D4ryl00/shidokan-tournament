import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { CHANGED_REASON, lockedReason } from '../../src/domain/history/cascade.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { historyEntries, registrations as registrationsTable } from '../../src/server/db/schema.js';
import { recorded } from '../../src/server/repositories/history.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let competitionId: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  competitionId = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${competitionId}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  n++;
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
type Slot = { kind: 'entrant'; registrationId: string } | { kind: 'bye' } | { kind: string };
type Match = { id: string; round: number; phase: string; a: Slot; b: Slot };
type Cat = {
  id: string; rev?: string; label: string; registrationIds: string[]; status: string; arranged: boolean; format: string | null; seed: number;
  bracket: { kind: 'combat' | 'kata'; entrants: { registrationId: string }[]; matches?: Match[] } | null;
};
type Entry = {
  id: string; seq: number; kind: string; status: 'active' | 'undone'; undoneAt: string | null; waveId: string | null; names: string[];
  summary: { registrationIds: string[]; fromLabel?: string; toLabel?: string; reason?: string }; categoryIds: string[]; blocked: string | null; cascade: string[];
};
const categories = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (registrationId: string) => (await categories()).find((c) => c.registrationIds.includes(registrationId));
/** Catégories sans leur version (`rev` change à chaque écriture, même quand le contenu revient). */
const contents = async () => (await categories()).map(({ rev: _rev, ...c }) => c).sort((a, b) => (a.id < b.id ? -1 : 1));
const move = async (registrationId: string, categoryId: string) => {
  const res = await call('POST', '/replacement/move', { registrationId, categoryId });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { warnings: string[]; historyId: string | null };
  expect(body.historyId).toEqual(expect.any(String));
  return body.historyId!;
};
const history = async (waveId?: string) => {
  const res = await call('GET', `/history${waveId ? `?waveId=${waveId}` : ''}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as { entries: Entry[] }).entries;
};
const entry = async (id: string) => (await history()).find((e) => e.id === id)!;
const undo = (ids: string[], expectIds: string[]) => call('POST', '/history/undo', { ids, expect: expectIds });
/** Paires du 1er tour (combats complets) d'un tableau à élimination. */
const firstRoundPairs = (c: Cat) =>
  (c.bracket!.matches ?? [])
    .filter((m) => m.phase === 'main' && m.round === 1 && m.a.kind === 'entrant' && m.b.kind === 'entrant')
    .map((m) => [(m.a as { registrationId: string }).registrationId, (m.b as { registrationId: string }).registrationId].sort().join('+'))
    .sort();

/** A (-54) et B (-47) chacun dans une catégorie de trois ; X (-61) : trois combattants. */
async function threeGroups() {
  const a = await reg({ lastName: 'ALPHA' });
  await reg();
  await reg();
  const b = await reg({ lastName: 'BETA', weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  const x = await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  return { a, b, fromA: (await catOf(a.id))!, fromB: (await catOf(b.id))!, x: (await catOf(x.id))! };
}

test('déplacement manuel journalisé', async () => {
  const { a, fromA, x } = await threeGroups();
  const h = await move(a.id, x.id);
  const [e] = await history();
  // Libellés au moment de l'action : l'arrivée porte sa clé élargie (« -54 / -61 kg »).
  const toLabel = (await categories()).find((c) => c.id === x.id)!.label;
  expect(toLabel).not.toBe(x.label);
  expect(e).toMatchObject({
    id: h, kind: 'manual', status: 'active', undoneAt: null, names: ['ALPHA x'], blocked: null, cascade: [],
    summary: { registrationIds: [a.id], fromLabel: fromA.label, toLabel, reason: 'Placé à la main' },
  });
  expect(e!.categoryIds).toEqual(expect.arrayContaining([fromA.id, x.id]));
});

test('places gardées : les combats d’avant ne bougent pas, les deux tableaux sont arrangés', async () => {
  const a = await reg({ lastName: 'ALPHA' });
  for (let i = 0; i < 3; i++) await reg();
  // X : élimination de six (deux combats complets, deux exemptions).
  const first = await reg({ weightClassId: 'cadet:F:-61' });
  for (let i = 0; i < 5; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const x = (await catOf(first.id))!;
  const fromA = (await catOf(a.id))!;
  expect(x.bracket!.kind).toBe('combat');
  const before = firstRoundPairs(x);
  expect(before).toHaveLength(2);
  await move(a.id, x.id);
  const after = (await categories()).find((c) => c.id === x.id)!;
  expect(after.registrationIds).toContain(a.id);
  // Les deux combats d'avant gardent leurs deux combattants ; l'arrivant prend une exemption.
  expect(firstRoundPairs(after)).toEqual(expect.arrayContaining(before));
  expect(firstRoundPairs(after)).toHaveLength(3);
  expect(after.arranged).toBe(true);
  expect((await categories()).find((c) => c.id === fromA.id)!.arranged).toBe(true);
});

test('annuler remet exactement les catégories d’avant', async () => {
  const { a, x } = await threeGroups();
  const before = await contents();
  const h = await move(a.id, x.id);
  expect(await contents()).not.toEqual(before);
  const res = await undo([h], [h]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ undone: [h] });
  expect(await contents()).toEqual(before);
  const e = await entry(h);
  expect(e.status).toBe('undone');
  expect(e.undoneAt).toEqual(expect.any(String));
  expect(e.blocked).toBeNull();
});

test('cascade : annuler un déplacement emporte le plus récent qui touche la même catégorie', async () => {
  const { a, b, fromA, fromB, x } = await threeGroups();
  const h1 = await move(a.id, x.id);
  const h2 = await move(b.id, x.id);
  const list = await history();
  expect(list.map((e) => e.id)).toEqual([h2, h1]);
  expect(list.find((e) => e.id === h1)!.cascade).toEqual([h2]);
  expect(list.find((e) => e.id === h2)!.cascade).toEqual([]);
  const res = await undo([h1], [h2, h1]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ undone: [h2, h1] });
  for (const id of [h1, h2]) expect((await entry(id)).status).toBe('undone');
  expect((await catOf(a.id))!.id).toBe(fromA.id);
  expect((await catOf(b.id))!.id).toBe(fromB.id);
});

test('expect périmé : un autre poste a ajouté une action liée, rien n’est annulé', async () => {
  const { a, b, x } = await threeGroups();
  const h1 = await move(a.id, x.id);
  await move(b.id, x.id);
  const res = await undo([h1], [h1]);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Un autre poste a modifié ces tableaux : la liste est mise à jour.');
  expect((await history()).every((e) => e.status === 'active')).toBe(true);
  expect((await catOf(a.id))!.id).toBe(x.id);
  expect((await catOf(b.id))!.id).toBe(x.id);
});

test('catégorie supprimée puis restaurée : même id, même tableau', async () => {
  const { x } = await threeGroups();
  const lone = await reg({ lastName: 'SEULE', weightClassId: 'cadet:F:+61' });
  const loneCat = (await catOf(lone.id))!;
  const before = await contents();
  const h = await move(lone.id, x.id);
  expect((await categories()).some((c) => c.id === loneCat.id)).toBe(false);
  expect((await undo([h], [h])).statusCode).toBe(200);
  expect((await catOf(lone.id))!.id).toBe(loneCat.id);
  expect(await contents()).toEqual(before);
});

test('catégorie lancée : l’annulation est bloquée, avec la raison', async () => {
  const { a, x } = await threeGroups();
  const h = await move(a.id, x.id);
  const arrival = (await categories()).find((c) => c.id === x.id)!;
  const match = arrival.bracket!.matches!.find((m) => m.a.kind === 'entrant' && m.b.kind === 'entrant')!;
  expect((await call('PUT', `/categories/${x.id}/results/${match.id}`, { winner: 'a', method: 'points' })).statusCode).toBe(200);
  expect(arrival.label).toMatch(/^Karaté · Jiyu · /);
  expect((await entry(h)).blocked).toBe(lockedReason(arrival.label));
  expect(lockedReason(arrival.label)).toBe(`${arrival.label} est lancée : déverrouillez-la pour annuler.`);
  const res = await undo([h], [h]);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe(lockedReason(arrival.label));
  expect((await entry(h)).status).toBe('active');
  expect(CHANGED_REASON).not.toBe(lockedReason(arrival.label));
});

test('session : la liste ne rend que les actions de la session demandée', async () => {
  const [matin, aprem] = (
    await call('PUT', '/waves', [
      { name: 'Matin', rules: { ageBandCodes: [], disciplines: ['kata'] } },
      { name: 'Après-midi', rules: { ageBandCodes: [], disciplines: ['karate'] } },
    ])
  ).json() as { id: string }[];
  const kataF = await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  const kataM = await reg({ discipline: 'kata', ruleset: null, weightClassId: null, sex: 'M' });
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null, sex: 'M' });
  const { a, x } = await threeGroups();
  const hKata = await move(kataF.id, (await catOf(kataM.id))!.id);
  const hKarate = await move(a.id, x.id);
  expect((await history(matin!.id)).map((e) => e.id)).toEqual([hKata]);
  expect((await history(aprem!.id)).map((e) => e.id)).toEqual([hKarate]);
  expect((await history()).map((e) => e.id)).toEqual([hKarate, hKata]);
  expect((await call('GET', '/history?waveId=inconnue')).statusCode).toBe(404);
});

test('recorded sans synchronisation : un changement de membres seul touche les deux catégories', async () => {
  const { a, fromA, x } = await threeGroups();
  const db = openDb(dbPath);
  try {
    const { historyId } = await recorded(
      db,
      competitionId,
      { kind: 'manual', waveId: null, summary: { registrationIds: [a.id] } },
      async () => {
        db.update(registrationsTable).set({ categoryId: x.id, placementLocked: true }).where(eq(registrationsTable.id, a.id)).run();
      },
      { sync: false },
    );
    expect(historyId).toEqual(expect.any(String));
    const row = db.select().from(historyEntries).where(eq(historyEntries.id, historyId!)).get()!;
    expect(JSON.parse(row.categoryIds).sort()).toEqual([fromA.id, x.id].sort());
    // Aucune ligne de catégorie n'a changé (pas de synchronisation) : rien à réécrire.
    expect(JSON.parse(row.beforeJson)).toEqual({ categories: [], created: [], registrations: [] });
    const after = JSON.parse(row.afterMembersJson) as Record<string, string[]>;
    expect(after[x.id]).toContain(a.id);
    expect(after[fromA.id]).not.toContain(a.id);
    // Rien de changé, aucun recasement : rien n'est écrit.
    const none = await recorded(db, competitionId, { kind: 'manual', waveId: null, summary: { registrationIds: [] } }, async () => 1, { sync: false });
    expect(none).toEqual({ result: 1, historyId: null });
  } finally {
    closeDb(db);
  }
});
