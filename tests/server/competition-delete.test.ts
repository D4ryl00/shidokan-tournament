import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { backupDir } from '../../src/server/repositories/backups.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
});
afterEach(async () => app.close());

async function competition(name: string): Promise<string> {
  const id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name, date: '2026-11-22' } })).json().id as string;
  const res = await app.inject({
    method: 'POST', url: `/api/competitions/${id}/registrations`,
    payload: { clubId: null, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' },
  });
  expect(res.statusCode).toBe(201);
  return id;
}
const remove = (id: string, name: string) => app.inject({ method: 'DELETE', url: `/api/competitions/${id}`, payload: { name } });
const backups = () => (fs.existsSync(backupDir(dbPath)) ? fs.readdirSync(backupDir(dbPath)).length : 0);

test('supprimer une compétition : nom exact exigé, sauvegarde avant, tout disparaît, les autres restent', async () => {
  const a = await competition('Coupe à supprimer');
  const b = await competition('Coupe gardée');
  const wrong = await remove(a, 'Coupe');
  expect(wrong.statusCode).toBe(400);
  expect(wrong.body).toContain('Le nom saisi ne correspond pas à la compétition.');
  const before = backups();
  expect((await remove(a, '  Coupe à supprimer ')).statusCode).toBe(204);
  expect(backups()).toBe(before + 1);
  expect((await app.inject({ method: 'GET', url: `/api/competitions/${a}` })).statusCode).toBe(404);
  expect(((await app.inject({ method: 'GET', url: '/api/competitions' })).json() as { id: string }[]).map((c) => c.id)).toEqual([b]);
  const raw = new Database(dbPath, { readonly: true });
  for (const table of ['registrations', 'fighters', 'age_bands', 'zones', 'categories']) {
    expect((raw.prepare(`select count(*) as n from ${table} where competition_id = ?`).get(a) as { n: number }).n, table).toBe(0);
  }
  expect((raw.prepare('select count(*) as n from registrations where competition_id = ?').get(b) as { n: number }).n).toBe(1);
  raw.close();
});

test('compétition inconnue : 404', async () => {
  expect((await remove('inconnue', 'x')).statusCode).toBe(404);
});

test('gérée ailleurs : suppression refusée', async () => {
  const a = await competition('Coupe du PC');
  const raw = new Database(dbPath);
  raw.prepare("update competitions set owner_instance_id = 'pc', owner_name = 'PC de la table' where id = ?").run(a);
  raw.close();
  const res = await remove(a, 'Coupe du PC');
  expect(res.statusCode).toBe(409);
  expect(res.body).toContain('lecture seule ici');
  expect((await app.inject({ method: 'GET', url: `/api/competitions/${a}` })).statusCode).toBe(200);
});
