import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { entryCells } from '../../src/domain/closed-categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
type View = { closed: { ageBandCode: string; sex: string; discipline: string; ruleset: string | null }[]; counts: Record<string, number>; locked: string[] };
const view = async () => (await call('GET', '/closed-categories')).json() as View;
const keys = (v: View) => v.closed.map((c) => `${c.ageBandCode}|${c.sex}|${c.discipline}|${c.ruleset ?? ''}`);
const close = (cells: object[], closed = true) => call('PUT', '/closed-categories', { cells, closed });
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

const seniorKataF = { ageBandCode: 'senior', sex: 'F', discipline: 'kata', ruleset: null };

test('fermer puis rouvrir une case', async () => {
  expect((await close([seniorKataF])).statusCode).toBe(204);
  expect(keys(await view())).toEqual(['senior|F|kata|']);
  expect((await close([seniorKataF], false)).statusCode).toBe(204);
  expect((await view()).closed).toEqual([]);
});

test('case inconnue refusée', async () => {
  const res = await close([{ ageBandCode: 'cadet', sex: 'F', discipline: 'karate', ruleset: 'shobu' }]);
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain('Catégorie inconnue dans la grille.');
});

test('au moins une case ouverte', async () => {
  const res = await close(entryCells(ffkDefaultGrid()));
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain('Au moins une catégorie doit rester ouverte.');
});

test('compte des inscrits', async () => {
  await reg();
  await reg();
  expect((await view()).counts['cadet|F|karate|jiyu']).toBe(2);
});

test("case d'une catégorie lancée : verrouillée", async () => {
  await reg();
  await reg();
  const cats = (await call('GET', '/categories')).json() as { id: string }[];
  expect((await call('PATCH', `/categories/${cats[0]!.id}`, { status: 'started' })).statusCode).toBe(200);
  expect((await view()).locked).toContain('cadet|F|karate|jiyu');
  const res = await close([{ ageBandCode: 'cadet', sex: 'F', discipline: 'karate', ruleset: 'jiyu' }]);
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain('Cadets F Karaté jiyu : catégorie déjà lancée, elle ne peut plus être fermée.');
});

test('une tranche retirée de la grille emporte ses cases fermées', async () => {
  await close([seniorKataF, { ageBandCode: 'v5', sex: 'F', discipline: 'kata', ruleset: null }]);
  const grid = ffkDefaultGrid();
  const without = { ...grid, ageBands: grid.ageBands.filter((b) => b.code !== 'v5'), weightClasses: grid.weightClasses.filter((w) => w.ageBandCode !== 'v5'), ageLinks: grid.ageLinks.filter((l) => l.from !== 'v5' && l.to !== 'v5') };
  expect((await call('PUT', '/grid', without)).statusCode).toBe(204);
  expect(keys(await view())).toEqual(['senior|F|kata|']);
});

test('un modèle de grille avec onClubForm se charge encore', async () => {
  const grid = ffkDefaultGrid();
  const old = { ...grid, ageBands: grid.ageBands.map((b) => ({ ...b, onClubForm: false })) };
  expect((await call('PUT', '/grid', old)).statusCode).toBe(204);
});

test('grille : une tranche passée « Mineurs » perd ses cases shobu fermées', async () => {
  await close([{ ageBandCode: 'senior', sex: 'F', discipline: 'karate', ruleset: 'shobu' }, seniorKataF]);
  const grid = ffkDefaultGrid();
  const minors = { ...grid, ageBands: grid.ageBands.map((b) => (b.code === 'senior' ? { ...b, isMinor: true } : b)) };
  expect((await call('PUT', '/grid', minors)).statusCode).toBe(204);
  expect(keys(await view())).toEqual(['senior|F|kata|']);
});

test('grille : retirer les seules tranches ouvertes est refusé', async () => {
  const grid = ffkDefaultGrid();
  await close(entryCells(grid).filter((c) => c.ageBandCode !== 'v5'));
  const without = { ...grid, ageBands: grid.ageBands.filter((b) => b.code !== 'v5'), weightClasses: grid.weightClasses.filter((w) => w.ageBandCode !== 'v5'), ageLinks: grid.ageLinks.filter((l) => l.from !== 'v5' && l.to !== 'v5') };
  const res = await call('PUT', '/grid', without);
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain('Au moins une catégorie doit rester ouverte.');
});
