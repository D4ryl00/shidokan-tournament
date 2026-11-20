import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import { entryKey } from '../../src/domain/closed-categories.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
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

test('export FFK : cinq feuilles, catégorie finale en texte, absente et retirée écartées', async () => {
  const a = await reg({ lastName: 'DEPLACE' });
  const absent = await reg({ lastName: 'ABSENTE', sex: 'M', weightClassId: 'cadet:M:-52' });
  const w = await reg({ lastName: 'RETIREE', sex: 'M', weightClassId: 'cadet:M:-52' });
  await reg({ lastName: 'RESTE', sex: 'M', weightClassId: 'cadet:M:-57' });
  const cs = (await call('GET', '/categories')).json() as { id: string; registrationIds: string[] }[];
  const target = cs.find((c) => !c.registrationIds.includes(a.id))!;
  expect((await call('POST', '/replacement/move', { registrationId: a.id, categoryId: target.id })).statusCode).toBe(200);
  expect((await call('PUT', `/weigh-in/${absent.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
  const raw = new Database(dbPath);
  raw.prepare("UPDATE registrations SET withdrawn_reason = 'closed_category', withdrawn_entry = ?, category_id = NULL WHERE id = ?").run(
    entryKey({ ageBandCode: 'cadet', sex: 'M', discipline: 'karate', ruleset: 'jiyu' }), w.id,
  );
  raw.close();

  const res = await call('GET', '/exports/ffk.xlsx');
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-disposition']).toBe('attachment; filename="export-ffk.xlsx"');
  const wb = XLSX.read(res.rawPayload, { type: 'buffer', cellStyles: true });
  expect(wb.SheetNames).toEqual(['Karate', 'Boxe', 'Mix Martial', 'Triathlon', 'Kata']);
  const sheet = wb.Sheets['Karate']!;
  expect(sheet['!cols']![0]!.width).toBeCloseTo(25.71, 1);
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const names = rows.map((r) => r[1]);
  expect(names).toContain('DEPLACE');
  expect(names).toContain('RESTE');
  expect(names).not.toContain('ABSENTE');
  expect(names).not.toContain('RETIREE');
  const i = rows.findIndex((r) => r[1] === 'DEPLACE');
  const cell = sheet[`H${i + 1}`]!;
  expect(cell.z).toBe('@');
  expect(String(cell.v)).toMatch(/^-?\+?\d+$/);
});
