import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

const NAME = "Coupe Shidokan – Côte d'Azur";
let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
});
afterEach(async () => {
  await app.close();
});

async function create(body: object = { name: NAME, date: '2026-11-22' }) {
  return app.inject({ method: 'POST', url: '/api/competitions', payload: body });
}

test('santé', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.json()).toEqual({ ok: true });
});

test('créer, lister, lire : les accents restent intacts', async () => {
  const res = await create();
  expect(res.statusCode).toBe(201);
  const id = res.json().id;
  const list = await app.inject({ method: 'GET', url: '/api/competitions' });
  expect(list.json().map((c: { name: string }) => c.name)).toEqual([NAME]);
  const one = await app.inject({ method: 'GET', url: `/api/competitions/${id}` });
  expect(one.json().name).toBe(NAME);
  expect(one.json().settings.weightGapMaxKg).toEqual({ children: 5, adults: 5 });
});

test('création invalide : date mal formée → 400 en français', async () => {
  const res = await create({ name: 'X', date: '22/11/2026' });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Données invalides');
  expect(res.json().issues.join(' ')).toMatch(/date/i);
});

test('404 sur une compétition inconnue', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/competitions/inconnu' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'Compétition introuvable' });
});

test('réglage invalide → 400, rien n’est enregistré', async () => {
  const id = (await create()).json().id;
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/competitions/${id}`,
    payload: { settings: { weightGapMaxKg: { children: -1, adults: 5 } } },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.length).toBeGreaterThan(0);
  expect(res.json().issues.join(' ')).toMatch(/supérieur ou égal à 0/);
  const again = await app.inject({ method: 'GET', url: `/api/competitions/${id}` });
  expect(again.json().settings.weightGapMaxKg.children).toBe(5);
});

test('nombre de tatamis à 0 → 400', async () => {
  const id = (await create()).json().id;
  const res = await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { tatamiCount: 0 } });
  expect(res.statusCode).toBe(400);
});

test('PATCH valide', async () => {
  const id = (await create()).json().id;
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/competitions/${id}`,
    payload: { location: 'Nice', settings: { repechage: true } },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().location).toBe('Nice');
  expect(res.json().settings.repechage).toBe(true);
});

test('grille : GET par défaut, PUT invalide → 400, PUT valide → 204', async () => {
  const id = (await create()).json().id;
  const get = await app.inject({ method: 'GET', url: `/api/competitions/${id}/grid` });
  expect(get.json()).toEqual(ffkDefaultGrid());

  const bad = ffkDefaultGrid();
  bad.ageBands.push({ ...bad.ageBands[0]! });
  const res = await app.inject({ method: 'PUT', url: `/api/competitions/${id}/grid`, payload: bad });
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.some((i: string) => i.includes('en double'))).toBe(true);

  const good = ffkDefaultGrid();
  good.weightClasses[0]!.label = '-20';
  good.weightClasses[0]!.maxKg = 20;
  const put = await app.inject({ method: 'PUT', url: `/api/competitions/${id}/grid`, payload: good });
  expect(put.statusCode).toBe(204);
  const after = await app.inject({ method: 'GET', url: `/api/competitions/${id}/grid` });
  expect(after.json()).toEqual(good);
});

test('grille d’une compétition inconnue → 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/competitions/inconnu/grid' });
  expect(res.statusCode).toBe(404);
});

test('date impossible refusée', async () => {
  for (const date of ['2026-13-45', '2026-02-30']) {
    const res = await create({ name: 'X', date });
    expect(res.statusCode).toBe(400);
  }
});

test('tolérance de pesée de 50 kg refusée', async () => {
  const id = (await create()).json().id;
  const res = await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { settings: { weighInToleranceKg: { M: 50, F: 0.5 } } } });
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.join(' ')).toMatch(/réglages › tolérance de pesée › M : doit être inférieur ou égal à 5/);
});

test('tranche de mixité inconnue de la grille refusée', async () => {
  const id = (await create()).json().id;
  const res = await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { settings: { mixSexes: { enabled: true, ageBandCodes: ['inconnue'] } } } });
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.join(' ')).toContain('inconnue');
});

test('erreurs du serveur en français', async () => {
  const badJson = await app.inject({ method: 'POST', url: '/api/competitions', payload: '{pas du json', headers: { 'content-type': 'application/json' } });
  expect(badJson.statusCode).toBe(400);
  expect(badJson.json().error).toBe('Requête mal formée (JSON invalide)');
  const media = await app.inject({ method: 'POST', url: '/api/competitions', payload: 'x', headers: { 'content-type': 'application/xml' } });
  expect(media.statusCode).toBe(415);
  expect(media.json().error).toBe('Type de contenu non pris en charge');
  const unknown = await app.inject({ method: 'GET', url: '/api/inconnue' });
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json().error).toBe('Route inconnue');
  const empty = await app.inject({ method: 'POST', url: '/api/competitions', headers: { 'content-type': 'application/json' }, payload: '' });
  expect(empty.statusCode).toBe(400);
  expect(empty.json().error).toMatch(/manquant|invalide/);
});

test('une SyntaxError interne reste une erreur serveur (500), pas une requête mal formée', async () => {
  app.get('/api/test-syntaxe', async () => JSON.parse('{cassé'));
  const res = await app.inject({ method: 'GET', url: '/api/test-syntaxe' });
  expect(res.statusCode).toBe(500);
  expect(res.json().error).toBe('Erreur interne du serveur');
});

test('tranche de mixité retirée de la grille : les autres réglages restent modifiables', async () => {
  const id = (await create()).json().id;
  const mix = await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { settings: { mixSexes: { enabled: true, ageBandCodes: ['v4', 'v5'] } } } });
  expect(mix.statusCode).toBe(200);
  const g = ffkDefaultGrid();
  const grid = {
    ageBands: g.ageBands.filter((b) => b.code !== 'v5'),
    weightClasses: g.weightClasses.filter((w) => w.ageBandCode !== 'v5'),
    ageLinks: g.ageLinks.filter((l) => l.from !== 'v5' && l.to !== 'v5'),
  };
  const put = await app.inject({ method: 'PUT', url: `/api/competitions/${id}/grid`, payload: grid });
  expect(put.statusCode).toBe(204);
  const res = await app.inject({ method: 'PATCH', url: `/api/competitions/${id}`, payload: { settings: { weighInToleranceKg: { M: 1, F: 1 } } } });
  expect(res.statusCode).toBe(200);
  expect(res.json().settings.mixSexes.ageBandCodes).toEqual(['v4']);
});

test('grille : une tranche peut ne pas être proposée sur la fiche club', async () => {
  const id = (await create()).json().id;
  const g = ffkDefaultGrid();
  const off = new Set(['mini-poussin', 'espoir']);
  const put = await app.inject({ method: 'PUT', url: `/api/competitions/${id}/grid`, payload: { ...g, ageBands: g.ageBands.map((b) => ({ ...b, onClubForm: !off.has(b.code) })) } });
  expect(put.statusCode).toBe(204);
  const bands = (await app.inject({ method: 'GET', url: `/api/competitions/${id}/grid` })).json().ageBands as { code: string; onClubForm: boolean }[];
  expect(bands.filter((b) => !b.onClubForm).map((b) => b.code).sort()).toEqual(['espoir', 'mini-poussin']);
  // Ancien client ou modèle enregistré sans le champ : toutes proposées
  const legacy = { ...g, ageBands: g.ageBands.map(({ onClubForm: _o, ...b }) => b) };
  expect((await app.inject({ method: 'PUT', url: `/api/competitions/${id}/grid`, payload: legacy })).statusCode).toBe(204);
  const again = (await app.inject({ method: 'GET', url: `/api/competitions/${id}/grid` })).json().ageBands as { onClubForm: boolean }[];
  expect(again.every((b) => b.onClubForm)).toBe(true);
});
