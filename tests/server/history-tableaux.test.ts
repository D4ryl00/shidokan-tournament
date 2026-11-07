import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { CHANGED_REASON } from '../../src/domain/history/cascade.js';
import { buildApp } from '../../src/server/app.js';
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
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
type Cat = {
  id: string; rev?: string; label: string; registrationIds: string[]; status: string; arranged: boolean; format: string | null; repechage: boolean | null; seed: number;
  key: { discipline: string; ruleset: string | null };
  bracket: { kind: string; entrants: { registrationId: string }[] } | null;
};
type Entry = { id: string; kind: string; status: string; summary: { registrationIds: string[]; detail?: string }; blocked: string | null; cascade: string[] };
const categories = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (registrationId: string) => (await categories()).find((c) => c.registrationIds.includes(registrationId))!;
/** Contenu des catégories sans leur version (`rev` change à chaque écriture). */
const contents = async () => (await categories()).map(({ rev: _rev, ...c }) => c as Cat).sort((a, b) => (a.id < b.id ? -1 : 1));
const history = async () => ((await call('GET', '/history')).json() as { entries: Entry[] }).entries;
const entry = async (id: string) => (await history()).find((e) => e.id === id)!;
const undo = (ids: string[], expectIds: string[]) => call('POST', '/history/undo', { ids, expect: expectIds });
/** Trois combattants -54 (une catégorie), plus A, B, C. */
async function group(over: object = {}) {
  return [await reg({ lastName: 'ALPHA', ...over }), await reg(over), await reg(over)];
}

test('échange de places journalisé, puis annulé : tableau d’avant', async () => {
  const [a, b] = await group();
  const before = await contents();
  const cat = await catOf(a!.id);
  const res = await call('POST', `/categories/${cat.id}/swap`, { a: a!.id, b: b!.id });
  expect(res.statusCode).toBe(200);
  const { historyId } = res.json() as { historyId: string | null };
  expect(historyId).toEqual(expect.any(String));
  expect(await contents()).not.toEqual(before);
  const e = await entry(historyId!);
  expect(e).toMatchObject({ kind: 'places', blocked: null, summary: { registrationIds: [a!.id, b!.id], detail: cat.label } });
  expect((await undo([historyId!], [historyId!])).statusCode).toBe(200);
  expect(await contents()).toEqual(before);
});

test('nouveau tirage annulé : même graine, même tableau', async () => {
  const [a] = await group();
  const before = await contents();
  const cat = await catOf(a!.id);
  const res = await call('POST', `/categories/${cat.id}/redraw`);
  const { historyId, seed } = res.json() as { historyId: string; seed: number };
  expect(seed).not.toBe(cat.seed);
  expect((await entry(historyId)).kind).toBe('redraw');
  expect((await undo([historyId], [historyId])).statusCode).toBe(200);
  expect(await contents()).toEqual(before);
});

test('format : journalisé seulement si format, repêchage ou 3e place changent', async () => {
  const [a] = await group();
  const cat = await catOf(a!.id);
  const before = await contents();
  const noop = await call('PATCH', `/categories/${cat.id}`, { status: 'ready' });
  expect((noop.json() as { historyId: string | null }).historyId).toBeNull();
  expect(await history()).toHaveLength(0);
  await call('PATCH', `/categories/${cat.id}`, { status: 'provisional' });
  const res = await call('PATCH', `/categories/${cat.id}`, { format: 'round_robin' });
  const { historyId } = res.json() as { historyId: string };
  expect((await entry(historyId)).summary.detail).toBe(`${cat.label} : Automatique ➜ Poule (tous contre tous)`);
  const rep = (await call('PATCH', `/categories/${cat.id}`, { repechage: true })).json() as { historyId: string };
  expect((await entry(rep.historyId)).summary.detail).toBe(`${cat.label} : Repêchage : Comme la compétition ➜ Oui`);
  // Le changement de repêchage, plus récent sur la même catégorie, part en cascade.
  expect((await undo([historyId], [historyId, rep.historyId])).statusCode).toBe(200);
  expect(await entry(rep.historyId)).toMatchObject({ status: 'undone' });
  expect(await contents()).toEqual(before);
});

test('changement hors historique : un absent au tableau bloque l’échange, pas un déplacement ailleurs', async () => {
  const [a, b, c] = await group();
  // Un déplacement fait avant, dans d'autres catégories.
  const x = await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  const y = await reg({ weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  const moved = await call('POST', '/replacement/move', { registrationId: x.id, categoryId: (await catOf(y.id)).id });
  expect(moved.statusCode).toBe(200);
  const manualId = (moved.json() as { historyId: string }).historyId;
  const cat = await catOf(a!.id);
  const { historyId } = (await call('POST', `/categories/${cat.id}/swap`, { a: a!.id, b: b!.id })).json() as { historyId: string };
  expect((await entry(historyId)).blocked).toBeNull();
  expect((await call('PUT', `/weigh-in/${c!.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
  expect((await entry(historyId)).blocked).toBe(CHANGED_REASON);
  expect((await entry(manualId)).blocked).toBeNull();
  expect((await undo([historyId], [historyId])).statusCode).toBe(409);
  expect((await undo([manualId], [manualId])).statusCode).toBe(200);
});

test('tableau libre : discipline changée puis annulée, membres et clé d’avant ; renommage seul non journalisé', async () => {
  const [a, b] = await group();
  const free = (await call('POST', '/free-tableaux', { name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' })).json() as Cat;
  await call('POST', '/replacement/move', { registrationId: a!.id, categoryId: free.id });
  await call('POST', '/replacement/move', { registrationId: b!.id, categoryId: free.id });
  const before = await contents();
  const regs = async () => ((await call('GET', '/registrations')).json() as { id: string; discipline: string; ruleset: string | null; weightClassId: string | null }[])
    .filter((r) => [a!.id, b!.id].includes(r.id)).map((r) => ({ id: r.id, discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId }));
  const regsBefore = await regs();
  const rename = (await call('PATCH', `/free-tableaux/${free.id}`, { name: 'Gala 2' })).json() as { historyId: string | null };
  expect(rename.historyId).toBeNull();
  await call('PATCH', `/free-tableaux/${free.id}`, { name: 'Gala 1' });
  const before2 = await contents();
  const res = (await call('PATCH', `/free-tableaux/${free.id}`, { discipline: 'kata', ruleset: null })).json() as { historyId: string };
  const e = await entry(res.historyId);
  expect(e).toMatchObject({ kind: 'free', summary: { detail: 'Gala 1 : Karaté · Jiyu ➜ Kata' } });
  expect((await regs()).every((r) => r.discipline === 'kata')).toBe(true);
  expect((await undo([res.historyId], [res.historyId])).statusCode).toBe(200);
  expect(await regs()).toEqual(regsBefore);
  expect(await contents()).toEqual(before2);
  expect(before2.length).toBe(before.length);
});

test('supprimer un tableau libre : delete-preview, annulation en cascade ; expect périmé : 409', async () => {
  const [a, b] = await group();
  const fromA = await catOf(a!.id);
  const free = (await call('POST', '/free-tableaux', { name: 'Démo', discipline: 'karate', ruleset: 'jiyu' })).json() as Cat;
  const m1 = ((await call('POST', '/replacement/move', { registrationId: a!.id, categoryId: free.id })).json() as { historyId: string }).historyId;
  const m2 = ((await call('POST', '/replacement/move', { registrationId: b!.id, categoryId: free.id })).json() as { historyId: string }).historyId;
  const preview = await call('GET', `/free-tableaux/${free.id}/delete-preview`);
  expect(preview.statusCode).toBe(200);
  expect(((preview.json() as { targets: string[] }).targets).sort()).toEqual([m1, m2].sort());
  const stale = await call('DELETE', `/free-tableaux/${free.id}?expect=${m1}`);
  expect(stale.statusCode).toBe(409);
  expect((await categories()).some((c) => c.id === free.id)).toBe(true);
  const ok = await call('DELETE', `/free-tableaux/${free.id}?expect=${[m1, m2].join(',')}`);
  expect(ok.statusCode).toBe(200);
  expect((await categories()).some((c) => c.id === free.id)).toBe(false);
  expect((await catOf(a!.id)).id).toBe(fromA.id);
  expect(await entry(m1)).toMatchObject({ status: 'undone' });
  expect(await entry(m2)).toMatchObject({ status: 'undone' });
});
