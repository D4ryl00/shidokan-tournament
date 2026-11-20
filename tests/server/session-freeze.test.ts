import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { buildPackage, importPackage } from '../../src/server/sync/package.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let id: string;
let dbPath: string;
const opened: AppDb[] = [];
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${id}`;
});
afterEach(async () => {
  for (const d of opened.splice(0)) closeDb(d);
  await app.close();
});

/** Seconde connexion à la base de test : lecture brute, sans synchronisation. */
const raw = () => {
  const db = openDb(dbPath);
  opened.push(db);
  return db;
};

type Cat = { id: string; label: string; waveId: string | null; waveOverride: string | null; frozenWave: string | null; registrationIds: string[] };
type Wave = { id: string; name: string };
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(ageBandCode: string, over: object = {}) {
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', ageBandCode, discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
const cats = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (registrationId: string) => (await cats()).find((c) => c.registrationIds.includes(registrationId))!;
const freeze = () => call('POST', '/waves/freeze');
const unfreeze = () => call('POST', '/waves/unfreeze');
const competition = async () => (await app.inject({ method: 'GET', url: base })).json() as { sessionsFrozenAt: string | null };

/** Sessions J (juniors) et S (seniors) ; une catégorie kata regroupée : 1 senior et 1 junior recasée → J (égalité, plus jeunes). */
async function setup() {
  const [J, S] = (await call('PUT', '/waves', [
    { name: 'Juniors', rules: { ageBandCodes: ['junior'], disciplines: [] } },
    { name: 'Seniors', rules: { ageBandCodes: ['senior'], disciplines: [] } },
  ])).json() as Wave[];
  const senior = await reg('senior');
  const junior = await reg('junior');
  expect((await call('POST', '/replacement/move', { registrationId: junior.id, categoryId: (await catOf(senior.id)).id })).statusCode).toBe(200);
  const grouped = await catOf(senior.id);
  expect(grouped.registrationIds).toContain(junior.id);
  expect(grouped.waveId).toBe(J!.id);
  return { J: J!, S: S!, senior, junior, groupedId: grouped.id };
}

describe('figer les sessions', () => {
  test('figer : chaque catégorie garde sa session ; une inscription tardive ne la fait plus basculer', async () => {
    const { J, groupedId } = await setup();
    const res = await freeze();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { frozenAt: string; count: number };
    expect(body.count).toBe(1);
    expect(Date.parse(body.frozenAt)).not.toBeNaN();
    expect((await competition()).sessionsFrozenAt).toBe(body.frozenAt);
    expect((await cats()).find((c) => c.id === groupedId)).toMatchObject({ frozenWave: J.id, waveId: J.id, waveOverride: null });
    // Deux seniors de plus arrivent dans la catégorie : trois contre une, la session reste J.
    await reg('senior');
    await reg('senior');
    const after = (await cats()).find((c) => c.id === groupedId)!;
    expect(after.registrationIds).toHaveLength(4);
    expect(after.waveId).toBe(J.id);
  });

  test('ne plus figer : la majorité reprend ; les choix manuels restent', async () => {
    const { S, groupedId } = await setup();
    // Une catégorie choisie à la main (cadettes → S).
    const cadet = await reg('cadet');
    const cadetCat = await catOf(cadet.id);
    expect((await call('PATCH', `/categories/${cadetCat.id}`, { waveOverride: S.id })).statusCode).toBe(200);
    expect((await freeze()).statusCode).toBe(200);
    await reg('senior');
    await reg('senior');
    expect((await unfreeze()).statusCode).toBe(204);
    expect((await competition()).sessionsFrozenAt).toBeNull();
    const all = await cats();
    expect(all.every((c) => c.frozenWave === null)).toBe(true);
    expect(all.find((c) => c.id === groupedId)!.waveId).toBe(S.id);
    expect(all.find((c) => c.id === cadetCat.id)).toMatchObject({ waveOverride: S.id, waveId: S.id });
  });

  test('catégorie créée après le gel : figée à sa création, absents exclus', async () => {
    const { J, S } = await setup();
    expect((await freeze()).statusCode).toBe(200);
    // Inscription dans une catégorie nouvelle : figée dès sa création.
    const late = await reg('junior', { sex: 'M' });
    expect(await catOf(late.id)).toMatchObject({ frozenWave: J.id, waveId: J.id });
    // Catégorie regroupée créée après le gel (comme par une réaffectation) : deux juniors absentes et une senior.
    const [j1, j2, s1] = [await reg('junior', { sex: 'M', discipline: 'shido-boxing', ruleset: 'jiyu', weightClassId: 'junior:M:-61' }), await reg('junior', { sex: 'M', discipline: 'shido-boxing', ruleset: 'jiyu', weightClassId: 'junior:M:-61' }), await reg('senior', { sex: 'M', discipline: 'shido-boxing', ruleset: 'jiyu', weightClassId: 'senior:M:-67' })];
    for (const r of [j1, j2]) {
      // Pesée de leur session actuelle (leur catégorie junior, figée en J à sa création).
      const res = await call('PUT', `/weigh-in/${r.fighterId}`, { presence: 'absent', waveId: J.id });
      expect(res.statusCode, res.body).toBe(204);
    }
    const db = raw();
    const key = { discipline: 'shido-boxing', ruleset: 'jiyu', sex: 'M', ageBandCodes: ['junior', 'senior'], weightClassIds: ['junior:M:-61', 'senior:M:-67'] };
    db.$client.prepare("insert into categories (id, competition_id, key_string, key_json, label, seed) values ('regroupee', ?, 'regroupee', ?, 'Regroupée', 1)").run(id, JSON.stringify(key));
    db.$client.prepare("update registrations set category_id = 'regroupee', placement_locked = 1 where id in (?, ?, ?)").run(j1.id, j2.id, s1.id);
    db.$client.prepare("delete from categories where competition_id = ? and id <> 'regroupee' and id not in (select category_id from registrations where category_id is not null)").run(id);
    // Avec les absentes, J l'emporterait (2 contre 1) ; sans elles, S.
    const created = (await cats()).find((c) => c.id === 'regroupee')!;
    expect(created).toMatchObject({ frozenWave: S.id, waveId: S.id });
    // Les absentes reviennent : la session figée ne bouge plus.
    for (const r of [j1, j2]) expect((await call('PUT', `/weigh-in/${r.fighterId}`, { presence: 'present', waveId: S.id })).statusCode).toBe(204);
    expect((await cats()).find((c) => c.id === 'regroupee')!.waveId).toBe(S.id);
  });

  test('session supprimée : frozenWave effacé, puis refigé au calcul suivant', async () => {
    const { J, S } = await setup();
    const senior = await reg('senior', { sex: 'M' });
    const seniorCat = await catOf(senior.id);
    expect(seniorCat.waveId).toBe(S.id);
    expect((await freeze()).statusCode).toBe(200);
    // La session S disparaît ; J prend aussi les seniors.
    const put = await call('PUT', '/waves', { waves: [{ id: J.id, name: 'Juniors', rules: { ageBandCodes: ['junior', 'senior'], disciplines: [] } }], knownIds: [J.id, S.id] });
    expect(put.statusCode).toBe(200);
    const frozenWave = () => (raw().$client.prepare('select frozen_wave as f from categories where id = ?').get(seniorCat.id) as { f: string | null }).f;
    expect(frozenWave()).toBeNull();
    expect((await cats()).find((c) => c.id === seniorCat.id)).toMatchObject({ frozenWave: J.id, waveId: J.id });
    expect(frozenWave()).toBe(J.id);
  });

  /** Sessions J et S, une junior seule et un senior seul (kata F) ; figées ; la junior rejoint le senior (sa catégorie, figée J, disparaît). */
  async function frozenThenMoved() {
    const [J, S] = (await call('PUT', '/waves', [
      { name: 'Juniors', rules: { ageBandCodes: ['junior'], disciplines: [] } },
      { name: 'Seniors', rules: { ageBandCodes: ['senior'], disciplines: [] } },
    ])).json() as Wave[];
    const senior = await reg('senior');
    const junior = await reg('junior');
    const juniorCat = await catOf(junior.id);
    expect((await freeze()).statusCode).toBe(200);
    expect((await cats()).find((c) => c.id === juniorCat.id)!.frozenWave).toBe(J!.id);
    const moved = await call('POST', '/replacement/move', { registrationId: junior.id, categoryId: (await catOf(senior.id)).id });
    expect(moved.statusCode).toBe(200);
    const historyId = (moved.json() as { historyId: string }).historyId;
    expect((await cats()).some((c) => c.id === juniorCat.id)).toBe(false);
    return { J: J!, S: S!, juniorCatId: juniorCat.id, historyId };
  }
  const undo = (historyId: string) => call('POST', '/history/undo', { ids: [historyId], expect: [historyId] });

  test('annulation après « Ne plus figer » : la catégorie revenue n’a pas de session figée', async () => {
    const { J, juniorCatId, historyId } = await frozenThenMoved();
    expect((await unfreeze()).statusCode).toBe(204);
    const res = await undo(historyId);
    expect(res.statusCode, res.body).toBe(200);
    const back = (await cats()).find((c) => c.id === juniorCatId)!;
    expect(back).toMatchObject({ frozenWave: null, waveId: J.id });
    expect((raw().$client.prepare('select count(*) as n from categories where competition_id = ? and frozen_wave is not null').get(id) as { n: number }).n).toBe(0);
  });

  test('annulation pendant le gel : une session figée supprimée entre-temps est refigée', async () => {
    const { J, S, juniorCatId, historyId } = await frozenThenMoved();
    // La session J disparaît ; S prend juniors et seniors.
    const put = await call('PUT', '/waves', { waves: [{ id: S.id, name: 'Seniors', rules: { ageBandCodes: ['junior', 'senior'], disciplines: [] } }], knownIds: [J.id, S.id] });
    expect(put.statusCode).toBe(200);
    const res = await undo(historyId);
    expect(res.statusCode, res.body).toBe(200);
    expect((await cats()).find((c) => c.id === juniorCatId)).toMatchObject({ frozenWave: S.id, waveId: S.id });
  });

  test('journal : Sessions figées / défigées', async () => {
    await setup();
    await reg('cadet');
    expect((await freeze()).statusCode).toBe(200);
    expect((await unfreeze()).statusCode).toBe(204);
    const { entries } = (await call('GET', '/journal')).json() as { entries: { type: string; action: string; via: string; data: { count?: number; route?: string } }[] };
    const frozen = entries.find((e) => e.action === 'sessions-frozen');
    expect(frozen).toMatchObject({ type: 'session', via: 'sessions', data: { count: 2 } });
    expect(entries.find((e) => e.action === 'sessions-unfrozen')).toMatchObject({ type: 'session', via: 'sessions' });
    // Notées en détail : pas d'entrée brute pour ces routes.
    expect(entries.filter((e) => e.action === 'raw' && e.data.route?.includes('freeze'))).toEqual([]);
  });

  test('refus : figer sans session ; figer deux fois ; défiger sans gel', async () => {
    await reg('senior');
    expect((await freeze()).statusCode).toBe(409);
    expect((await unfreeze()).statusCode).toBe(409);
    await call('PUT', '/waves', [{ name: 'Seniors', rules: { ageBandCodes: ['senior'], disciplines: [] } }]);
    expect((await freeze()).statusCode).toBe(200);
    expect((await freeze()).statusCode).toBe(409);
    expect((await unfreeze()).statusCode).toBe(204);
    expect((await unfreeze()).statusCode).toBe(409);
  });

  test('paquet de synchronisation : frozen_wave et sessions_frozen_at voyagent ; une session d’une autre compétition est refusée', async () => {
    const { J, groupedId } = await setup();
    expect((await freeze()).statusCode).toBe(200);
    const a = raw();
    const pkg = buildPackage(a, id, { handOver: false, role: 'local' });
    // Base B, avec une autre compétition qui a ses sessions.
    const bPath = tmpDbPath();
    const bApp = await buildApp({ dbPath: bPath });
    const other = (await bApp.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Autre', date: '2026-11-22' } })).json().id as string;
    const [foreign] = (await bApp.inject({ method: 'PUT', url: `/api/competitions/${other}/waves`, payload: [{ name: 'X', rules: { ageBandCodes: ['senior'], disciplines: [] } }] })).json() as Wave[];
    await bApp.close();
    const b = openDb(bPath);
    opened.push(b);
    const trapped = { ...pkg, tables: { ...pkg.tables, categories: pkg.tables.categories!.map((r) => (r.id === groupedId ? { ...r, frozen_wave: foreign!.id } : r)) } };
    await expect(importPackage(b, bPath, trapped, null)).rejects.toThrow('Paquet invalide : des données appartiennent à une autre compétition.');
    await importPackage(b, bPath, pkg, null);
    expect(b.$client.prepare('select frozen_wave as f from categories where id = ?').get(groupedId)).toEqual({ f: J.id });
    const at = (a.$client.prepare('select sessions_frozen_at as t from competitions where id = ?').get(id) as { t: string }).t;
    expect(at).not.toBeNull();
    expect(b.$client.prepare('select sessions_frozen_at as t from competitions where id = ?').get(id)).toEqual({ t: at });
  });
});
