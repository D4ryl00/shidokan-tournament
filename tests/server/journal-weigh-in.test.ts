import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let id: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${id}`;
});
afterEach(async () => app.close());

type Entry = { id: string; parent_id: string | null; type: string; action: string; via: string; data: Record<string, any> };
const entries = (): Entry[] => {
  const ro = new Database(dbPath, { readonly: true });
  const rows = ro.prepare('select * from journal_entries where competition_id = ? order by seq').all(id) as (Entry & { data_json: string })[];
  ro.close();
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) }));
};
const weighEntries = () => entries().filter((e) => ['weigh-in', 'presence', 'weigh-in-closed', 'raw'].includes(e.action) || e.parent_id);
const call = (method: 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(sex = 'F') {
  n++;
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'Zoe', sex, ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: sex === 'M' ? 'cadet:M:-57' : 'cadet:F:-54', source: 'manual',
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}

test('poids saisi puis corrigé', async () => {
  const a = await reg();
  const before = entries().length;
  expect((await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 52.4 })).statusCode).toBe(204);
  expect((await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 53.1 })).statusCode).toBe(204);
  const w = entries().slice(before).filter((e) => e.action === 'weigh-in');
  expect(w).toHaveLength(2);
  expect(w[0]).toMatchObject({ type: 'pesee', via: 'pesee', data: { subject: 'NOM1 Zoe', changes: [{ label: 'Poids', before: null, after: '52,4 kg' }] } });
  expect(w[1]!.data.changes).toEqual([{ label: 'Poids', before: '52,4 kg', after: '53,1 kg' }]);
});

test('poids entier sans décimales, effacé : null', async () => {
  const a = await reg();
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 53 });
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: null });
  const w = entries().filter((e) => e.action === 'weigh-in');
  expect(w[0]!.data.changes[0].after).toBe('53 kg');
  expect(w[1]!.data.changes).toEqual([{ label: 'Poids', before: '53 kg', after: null }]);
});

test('présence : absente', async () => {
  const a = await reg();
  await call('PUT', `/weigh-in/${a.fighterId}`, { presence: 'absent' });
  const p = entries().filter((e) => e.action === 'presence');
  expect(p).toHaveLength(1);
  expect(p[0]).toMatchObject({ type: 'pesee', via: 'pesee', data: { changes: [{ label: 'Présence', before: 'inconnue', after: 'absente' }] } });
  expect(entries().filter((e) => e.action === 'weigh-in')).toHaveLength(0);
});

test('présence : présent pour un homme ; poids et présence : deux entrées', async () => {
  const a = await reg('M');
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 50 });
  const list = entries().filter((e) => ['weigh-in', 'presence'].includes(e.action));
  expect(list.map((e) => e.action)).toEqual(['weigh-in', 'presence']);
  expect(list[1]!.data.changes).toEqual([{ label: 'Présence', before: 'inconnue', after: 'présent' }]);
});

test('même valeur renvoyée : rien, pas même une entrée brute', async () => {
  const a = await reg();
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 52.4 });
  const count = entries().length;
  expect((await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 52.4 })).statusCode).toBe(204);
  expect(entries()).toHaveLength(count);
});

test('clôture : un groupe, une ligne par absent marqué', async () => {
  await reg();
  await reg('M');
  const c = await reg();
  await call('PUT', `/weigh-in/${c.fighterId}`, { weighInKg: 50 });
  const count = entries().length;
  const res = await call('POST', '/weigh-in/close');
  expect(res.json()).toEqual({ markedAbsent: 2 });
  const added = entries().slice(count);
  expect(added).toHaveLength(3);
  const [parent, ...kids] = added;
  expect(parent).toMatchObject({ type: 'pesee', action: 'weigh-in-closed', parent_id: null, data: { detail: '2 marqués absents' } });
  expect(parent!.data.subject).toBeUndefined();
  expect(kids.map((k) => [k.action, k.parent_id])).toEqual([['presence', parent!.id], ['presence', parent!.id]]);
  expect(kids.map((k) => k.data.changes[0].after).sort()).toEqual(['absent', 'absente']);
});

test('clôture sans absent : le groupe est écrit quand même', async () => {
  const count = entries().length;
  await call('POST', '/weigh-in/close');
  const added = entries().slice(count);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ action: 'weigh-in-closed', data: { detail: '0 marqué absent' } });
});

test('clôture d’une session : son nom dans le sujet', async () => {
  await reg();
  const [w] = (await call('PUT', '/waves', [{ name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } }] as unknown as object)).json() as { id: string }[];
  const count = entries().length;
  expect((await call('POST', '/weigh-in/close', { waveId: w!.id })).statusCode).toBe(200);
  const parent = entries().slice(count).find((e) => e.action === 'weigh-in-closed')!;
  expect(parent.data.subject).toBe('Matin');
});
