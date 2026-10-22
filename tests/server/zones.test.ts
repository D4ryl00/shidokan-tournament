import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let base: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

type Zone = { id: string; name: string; order: number };
const zones = async (b = base) => (await app.inject({ method: 'GET', url: `${b}/zones` })).json() as Zone[];
const putZones = (body: object[]) => app.inject({ method: 'PUT', url: `${base}/zones`, payload: body });
async function category() {
  for (let i = 0; i < 2; i++) {
    await app.inject({ method: 'POST', url: `${base}/registrations`, payload: {
      clubId: null, lastName: `NOM${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual',
    } });
  }
  return ((await app.inject({ method: 'GET', url: `${base}/categories` })).json() as { id: string; zoneId: string | null; bracket: { matches: { id: string }[] } }[])[0]!;
}
const cat = async (id: string) => ((await app.inject({ method: 'GET', url: `${base}/categories` })).json() as { id: string; zoneId: string | null; status: string }[]).find((c) => c.id === id)!;

test('création : zoneCount crée Tatami 1…N (défaut 2)', async () => {
  expect((await zones()).map((z) => z.name)).toEqual(['Tatami 1', 'Tatami 2']);
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Autre', date: '2026-11-22', zoneCount: 3 } })).json().id;
  expect((await zones(`/api/competitions/${other}`)).map((z) => z.name)).toEqual(['Tatami 1', 'Tatami 2', 'Tatami 3']);
});

test('renommer et réordonner : identifiants et affectations gardés', async () => {
  const [t1, t2] = await zones();
  const c = await category();
  expect((await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { zoneId: t2!.id } })).statusCode).toBe(200);
  const res = await putZones([{ id: t2!.id, name: 'Ring' }, { id: t1!.id, name: 'Tatami 1' }]);
  expect(res.statusCode).toBe(200);
  expect((await zones()).map((z) => [z.id, z.name])).toEqual([[t2!.id, 'Ring'], [t1!.id, 'Tatami 1']]);
  expect((await cat(c.id)).zoneId).toBe(t2!.id);
});

test('noms en double refusés (400)', async () => {
  const res = await putZones([{ name: 'Ring' }, { name: 'ring' }]);
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.join(' ')).toContain('Deux zones portent le même nom');
});

test('supprimer une zone : catégories sans zone ; refus (409) si une catégorie lancée y est', async () => {
  const [t1, t2] = await zones();
  const c = await category();
  await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { zoneId: t2!.id } });
  await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { status: 'started' } });
  expect((await putZones([{ id: t1!.id, name: 'Tatami 1' }])).statusCode).toBe(409);
  await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { status: 'ready', unlock: true } });
  expect((await putZones([{ id: t1!.id, name: 'Tatami 1' }])).statusCode).toBe(200);
  expect((await cat(c.id)).zoneId).toBeNull();
});

test('PATCH zoneId d’une autre compétition → 400', async () => {
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Autre', date: '2026-11-22' } })).json().id;
  const foreign = (await zones(`/api/competitions/${other}`))[0]!;
  const c = await category();
  expect((await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { zoneId: foreign.id } })).statusCode).toBe(400);
});

test('programme groupé par zone, dans l’ordre des zones', async () => {
  const [t1, t2] = await zones();
  const c = await category();
  await putZones([{ id: t2!.id, name: 'Ring' }, { id: t1!.id, name: 'Tatami 1' }]);
  await app.inject({ method: 'PATCH', url: `${base}/categories/${c.id}`, payload: { zoneId: t2!.id } });
  const s = (await app.inject({ method: 'GET', url: `${base}/schedule` })).json() as { zones: { zone: Zone; categories: { id: string }[] }[]; unassigned: unknown[] };
  expect(s.zones.map((z) => z.zone.name)).toEqual(['Ring']);
  expect(s.zones[0]!.categories.map((x) => x.id)).toEqual([c.id]);
});

test('sauvegarde puis restauration : zones conservées', async () => {
  await putZones([{ name: 'Ring' }]);
  await app.inject({ method: 'POST', url: '/api/backups' });
  const list = (await app.inject({ method: 'GET', url: '/api/backups' })).json() as { name: string }[];
  const file = (await app.inject({ method: 'GET', url: `/api/backups/${list[0]!.name}` })).rawPayload;
  await putZones([{ name: 'Autre' }]);
  const restored = await app.inject({ method: 'POST', url: '/api/restore', payload: file, headers: { 'content-type': 'application/octet-stream' } });
  expect(restored.statusCode).toBe(204);
  expect((await zones()).map((z) => z.name)).toEqual(['Ring']);
});

test('migration d’une base antérieure : tatamis repris en zones, affectations gardées', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-'));
  const src = path.resolve('drizzle');
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  const before = journal.entries.filter((e) => e.idx <= 7);
  for (const e of before) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: before }));
  const file = path.join(dir, 'old.sqlite');
  process.env.MIGRATIONS_DIR = dir;
  try {
    closeDb(openDb(file));
  } finally {
    delete process.env.MIGRATIONS_DIR;
  }
  const raw = new Database(file);
  raw.prepare("INSERT INTO competitions (id, name, date, tatami_count, settings_json) VALUES ('c1', 'Ancienne', '2026-11-22', 3, '{}')").run();
  raw.prepare("INSERT INTO categories (id, competition_id, key_string, key_json, label, status, seed, tatami) VALUES ('k1', 'c1', 'k', '{}', 'Cat', 'ready', 1, 2)").run();
  raw.prepare("INSERT INTO clubs (id, competition_id, name, name_key) VALUES ('club1', 'c1', 'Club', 'CLUB')").run();
  // Ancienne app : catégorie restée sur le tatami 3 après passage à 2 tatamis
  raw.prepare("INSERT INTO competitions (id, name, date, tatami_count, settings_json) VALUES ('c2', 'Réduite', '2026-11-22', 2, '{}')").run();
  raw.prepare("INSERT INTO categories (id, competition_id, key_string, key_json, label, status, seed, tatami) VALUES ('k2', 'c2', 'k', '{}', 'Cat', 'started', 1, 3)").run();
  raw.close();
  const db = openDb(file);
  const z = db.$client.prepare('SELECT id, name, sort_order FROM zones WHERE competition_id = ? ORDER BY sort_order').all('c1') as { id: string; name: string }[];
  expect(z.map((x) => x.name)).toEqual(['Tatami 1', 'Tatami 2', 'Tatami 3']);
  const k = db.$client.prepare("SELECT zone_id FROM categories WHERE id = 'k1'").get() as { zone_id: string };
  expect(k.zone_id).toBe(z[1]!.id);
  const z2 = db.$client.prepare('SELECT id, name FROM zones WHERE competition_id = ? ORDER BY sort_order').all('c2') as { id: string; name: string }[];
  expect(z2.map((x) => x.name)).toEqual(['Tatami 1', 'Tatami 2', 'Tatami 3']);
  expect(db.$client.prepare("SELECT zone_id FROM categories WHERE id = 'k2'").get()).toEqual({ zone_id: z2[2]!.id });
  // Rien n'est perdu ailleurs (pas de suppression en cascade pendant la migration)
  expect(db.$client.prepare("SELECT count(*) AS n FROM clubs WHERE competition_id = 'c1'").get()).toEqual({ n: 1 });
  closeDb(db);
});
