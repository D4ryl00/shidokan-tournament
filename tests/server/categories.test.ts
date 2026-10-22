import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { buildFfkWorkbook } from '../helpers/ffk-fixture.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function register(over: object = {}) {
  n++;
  const res = await req('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row.id as string;
}
type Cat = { id: string; label: string; status: string; effectiveFormat: string; registrationIds: string[]; seed: number; stale: boolean; bracket: { kind: string; matches?: { id: string }[]; order?: string[]; entrants: { registrationId: string }[] } | null };
const categories = async () => (await req('GET', '/categories')).json() as Cat[];

test('3 inscrites → poule ; 4e → élimination directe', async () => {
  for (let i = 0; i < 3; i++) await register();
  let [c] = await categories();
  expect(c).toMatchObject({ label: 'Karaté · Jiyu · Cadets F · -54 kg', status: 'provisional', effectiveFormat: 'round_robin' });
  expect(c!.bracket!.matches).toHaveLength(3);
  await register();
  [c] = await categories();
  expect(c!.effectiveFormat).toBe('single_elimination');
  expect(c!.registrationIds).toHaveLength(4);
  expect(c!.bracket!.matches).toHaveLength(3);
});

test('seule dans sa catégorie : pas de match ; dernière inscription supprimée → catégorie supprimée', async () => {
  const id = await register();
  const [c] = await categories();
  expect(c!.bracket!.matches).toEqual([]);
  await req('DELETE', `/registrations/${id}`);
  expect(await categories()).toEqual([]);
});

test('kata → kata_two_rounds', async () => {
  await register({ discipline: 'kata', ruleset: null, weightClassId: null });
  await register({ discipline: 'kata', ruleset: null, weightClassId: null });
  const [c] = await categories();
  expect(c).toMatchObject({ effectiveFormat: 'kata_two_rounds', label: 'Kata · Cadets F' });
  expect(c!.bracket!.kind).toBe('kata');
});

test('changement de format ; format incompatible refusé', async () => {
  for (let i = 0; i < 4; i++) await register();
  const [c] = await categories();
  const res = await req('PATCH', `/categories/${c!.id}`, { format: 'round_robin' });
  expect(res.json()).toMatchObject({ effectiveFormat: 'round_robin' });
  expect(res.json().bracket.matches).toHaveLength(6);
  expect((await req('PATCH', `/categories/${c!.id}`, { format: 'best_of_three' })).statusCode).toBe(400);
});

test('verrouillage : catégorie lancée jamais régénérée', async () => {
  for (let i = 0; i < 3; i++) await register();
  const [c] = await categories();
  expect((await req('PATCH', `/categories/${c!.id}`, { status: 'started' })).statusCode).toBe(200);
  const before = (await categories())[0]!.bracket;
  await register();
  const [after] = await categories();
  expect(after!.bracket).toEqual(before);
  expect(after!.registrationIds).toHaveLength(4);
  expect(after!.stale).toBe(true);
  expect((await req('POST', `/categories/${c!.id}/redraw`)).statusCode).toBe(409);
  expect((await req('PATCH', `/categories/${c!.id}`, { status: 'ready' })).statusCode).toBe(409);
  const unlocked = await req('PATCH', `/categories/${c!.id}`, { status: 'ready', unlock: true });
  expect(unlocked.statusCode).toBe(200);
  expect(unlocked.json().bracket.entrants).toHaveLength(4);
  expect(unlocked.json().stale).toBe(false);
});

test('nouveau tirage et échange', async () => {
  for (let i = 0; i < 8; i++) await register();
  const [c] = await categories();
  const redrawn = (await req('POST', `/categories/${c!.id}/redraw`)).json() as Cat;
  expect(redrawn.seed).not.toBe(c!.seed);
  const [a, b] = redrawn.bracket!.entrants.map((e) => e.registrationId);
  const swapped = (await req('POST', `/categories/${c!.id}/swap`, { a, b })).json() as Cat;
  expect(swapped.bracket!.entrants.slice(0, 2).map((e) => e.registrationId)).toEqual([b, a]);
});

test('réglage de compétition (repêchage) appliqué aux catégories sans valeur propre', async () => {
  for (let i = 0; i < 8; i++) await register();
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { repechage: true } } });
  const [c] = await categories();
  expect(c!.bracket!.matches!.some((m) => m.id.startsWith('rep'))).toBe(true);
});

test('import FFK → une catégorie par clé distincte', async () => {
  const file = buildFfkWorkbook({
    Karate: [
      ['A A', null, 'L1', '1 C', 'Feminine', 'Karate', 'Cadet', -54, null],
      ['B B', null, 'L2', '1 C', 'Feminine', 'Karate', 'Cadet', -54, null],
      ['C C', null, 'L3', '1 C', 'Masculin', 'Karate', 'Senior', -75, null],
    ],
  });
  const up = (await app.inject({ method: 'POST', url: `${base}/ffk-imports`, payload: file, headers: { 'content-type': 'application/octet-stream' } })).json();
  await req('POST', `/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  expect((await categories()).map((c) => c.registrationIds.length)).toEqual([2, 1]);
});

test('changement de libellé dans la grille : pas de régénération (l’échange manuel reste)', async () => {
  for (let i = 0; i < 4; i++) await register();
  const [c] = await categories();
  const [a, b] = c!.bracket!.entrants.map((e) => e.registrationId);
  const swapped = (await req('POST', `/categories/${c!.id}/swap`, { a, b })).json() as Cat;
  const grid = (await req('GET', '/grid')).json() as { weightClasses: { id: string; label: string; maxKg: number | null }[] };
  const wc = grid.weightClasses.find((w) => w.id === 'cadet:F:-54')!;
  wc.label = '-55';
  wc.maxKg = 55;
  await app.inject({ method: 'PUT', url: `${base}/grid`, payload: grid });
  const [after] = await categories();
  expect(after!.label).toContain('-55');
  expect(after!.bracket).toEqual(swapped.bracket);
});

test('échange : combattants identiques ou étrangers au tableau refusés', async () => {
  for (let i = 0; i < 4; i++) await register();
  const [c] = await categories();
  const a = c!.bracket!.entrants[0]!.registrationId;
  expect((await req('POST', `/categories/${c!.id}/swap`, { a, b: a })).statusCode).toBe(400);
  expect((await req('POST', `/categories/${c!.id}/swap`, { a, b: 'inconnu' })).statusCode).toBe(400);
});

test('catégorie lancée : un changement de poids ne déplace pas le combattant', async () => {
  const id = await register();
  await register();
  const [c] = await categories();
  await req('PATCH', `/categories/${c!.id}`, { status: 'started' });
  await app.inject({ method: 'PUT', url: `${base}/registrations/${id}`, payload: {
    clubId: null, lastName: 'NOMX', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-61', source: 'manual',
  } });
  const cats = await categories();
  expect(cats.find((x) => x.id === c!.id)!.registrationIds).toContain(id);
  expect(cats).toHaveLength(1);
});

test('catégorie prête : régénérée quand un inscrit est ajouté', async () => {
  for (let i = 0; i < 3; i++) await register();
  const [c] = await categories();
  await req('PATCH', `/categories/${c!.id}`, { status: 'ready' });
  await register();
  const [after] = await categories();
  expect(after!.status).toBe('ready');
  expect(after!.bracket!.entrants).toHaveLength(4);
});


test('tableau non régénéré (lancé) : les noms des inscrits suivent les corrections', async () => {
  const a = await register();
  await register();
  const [c] = await categories();
  await req('PATCH', `/categories/${c!.id}`, { status: 'started' });
  const res = await app.inject({ method: 'PUT', url: `${base}/registrations/${a}`, payload: {
    clubId: null, lastName: 'CORRIGÉ', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual',
  } });
  expect(res.statusCode).toBe(200);
  const [after] = await categories();
  expect(after!.status).toBe('started');
  const entrant = (after!.bracket!.entrants as { registrationId: string; label: string }[]).find((e) => e.registrationId === a)!;
  expect(entrant.label).toBe('CORRIGÉ Léa');
});
