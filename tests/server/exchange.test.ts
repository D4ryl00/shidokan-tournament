import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
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
type Src = { kind: string; registrationId?: string };
type Cat = {
  id: string; rev?: string; label: string; registrationIds: string[]; arranged: boolean;
  bracket: { entrants: { registrationId: string; clubId: string | null; label: string }[]; matches: { id: string; round: number; a: Src; b: Src }[] } | null;
};
type Reg = { id: string; placementLocked: boolean; recasementType: string | null };
const categories = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (id: string) => (await categories()).find((c) => c.registrationIds.includes(id))!;
const contents = async () => (await categories()).map(({ rev: _rev, ...c }) => c).sort((a, b) => (a.id < b.id ? -1 : 1));
const regOf = async (id: string) => ((await call('GET', '/registrations')).json() as Reg[]).find((r) => r.id === id)!;
type Entry = { id: string; kind: string; summary: { registrationIds: string[] } };
const history = async () => ((await call('GET', '/history')).json() as { entries: Entry[] }).entries;
/** Premier tour : pour chaque combat, les deux inscriptions. */
const firstRound = (c: Cat) => c.bracket!.matches.filter((m) => m.round === 1).map((m) => [m.a.registrationId, m.b.registrationId]);

/** Deux catégories de quatre (-54 et -61) ; renvoie leurs inscrits dans l'ordre de création. */
async function two() {
  const a: { id: string; fighterId: string }[] = [];
  const b: { id: string; fighterId: string }[] = [];
  for (let i = 0; i < 4; i++) a.push(await reg({ lastName: `ALPHA${i}` }));
  for (let i = 0; i < 4; i++) b.push(await reg({ lastName: `BETA${i}`, weightClassId: 'cadet:F:-61' }));
  return { a, b };
}

test('échange : chacun à la place exacte de l’autre, une entrée, annulation complète', async () => {
  const { a, b } = await two();
  const [x, y] = [a[0]!, b[0]!];
  const before = await contents();
  const [catA0, catB0] = [await catOf(x.id), await catOf(y.id)];
  const res = await call('POST', '/replacement/exchange', { a: x.id, b: y.id });
  expect(res.statusCode).toBe(200);
  const { warnings, historyId } = res.json() as { warnings: string[]; historyId: string };
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings.every((w) => w.startsWith('ALPHA0 x : ') || w.startsWith('BETA0 x : '))).toBe(true);
  const [catA1, catB1] = [await catOf(y.id), await catOf(x.id)];
  expect([catA1.id, catB1.id]).toEqual([catA0.id, catB0.id]);
  const swap = (rows: (string | undefined)[][], from: string, to: string) => rows.map((r) => r.map((id) => (id === from ? to : id)));
  expect(firstRound(catA1)).toEqual(swap(firstRound(catA0), x.id, y.id));
  expect(firstRound(catB1)).toEqual(swap(firstRound(catB0), y.id, x.id));
  expect(catA1.bracket!.entrants.find((e) => e.registrationId === y.id)!.label).toBe('BETA0 x');
  for (const id of [x.id, y.id]) expect(await regOf(id)).toMatchObject({ placementLocked: true, recasementType: 'M' });
  const entries = await history();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ kind: 'exchange', summary: { registrationIds: [x.id, y.id] } });
  const undone = await call('POST', '/history/undo', { ids: [historyId], expect: [historyId] });
  expect(undone.statusCode).toBe(200);
  expect(await contents()).toEqual(before);
});

test('aperçu : l’arrivant rencontre son club au 1er tour', async () => {
  const club = (await call('POST', '/clubs', { name: 'Tani Dojo' })).json() as { id: string };
  // Catégorie A : ALPHA0 (club) et ALPHA1 (club) ; B0 du club en B. Échanger ALPHA2 contre B0 met B0 dans le tableau d'A avec ALPHA0 et ALPHA1.
  const a = [await reg({ lastName: 'ALPHA0', clubId: club.id }), await reg({ lastName: 'ALPHA1' }), await reg({ lastName: 'ALPHA2' }), await reg({ lastName: 'ALPHA3' })];
  const b = [await reg({ lastName: 'BETA0', weightClassId: 'cadet:F:-61', clubId: club.id }), ...(await Promise.all([1, 2, 3].map(() => reg({ weightClassId: 'cadet:F:-61' }))))];
  const catA = await catOf(a[0]!.id);
  const mate = firstRound(catA).find((r) => r.includes(a[0]!.id))!.find((id) => id !== a[0]!.id)!;
  const before = await contents();
  const preview = await call('POST', '/replacement/exchange/preview', { a: mate, b: b[0]!.id });
  expect(preview.statusCode).toBe(200);
  expect((preview.json() as { sameClub: string[] }).sameClub).toEqual([expect.stringMatching(/^(ALPHA0 x|BETA0 x) et (ALPHA0 x|BETA0 x) \(Tani Dojo\) se rencontrent au 1er tour\.$/)]);
  expect(await contents()).toEqual(before);
  // Le même aperçu pour un déplacement simple : un champ sameClub (vide ici).
  const move = await call('POST', '/replacement/preview', { move: { registrationId: b[1]!.id, categoryId: catA.id } });
  expect((move.json() as { sameClub: string[] }).sameClub).toEqual([]);
  expect(await contents()).toEqual(before);
  const real = await call('POST', '/replacement/exchange', { a: mate, b: b[0]!.id });
  expect((real.json() as { sameClub: string[] }).sameClub).toHaveLength(1);
});

test('refus : même catégorie, absent, catégorie lancée', async () => {
  const { a, b } = await two();
  const same = await call('POST', '/replacement/exchange', { a: a[0]!.id, b: a[1]!.id });
  expect(same.statusCode).toBe(400);
  expect(same.json().issues).toEqual(['Échange impossible : ces deux combattants sont dans la même catégorie.']);
  expect((await call('PUT', `/weigh-in/${b[0]!.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
  expect((await call('POST', '/replacement/exchange', { a: a[0]!.id, b: b[0]!.id })).statusCode).toBe(400);
  const catB = await catOf(b[1]!.id);
  await call('PATCH', `/categories/${catB.id}`, { status: 'started' });
  expect((await call('POST', '/replacement/exchange', { a: a[0]!.id, b: b[1]!.id })).statusCode).toBe(409);
  expect(await history()).toHaveLength(0);
});
