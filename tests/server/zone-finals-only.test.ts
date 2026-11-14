import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { finalMatchIds } from '../../src/domain/passages/index.js';
import type { CombatBracket } from '../../src/domain/brackets/types.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { passagePlan } from '../../src/server/repositories/passages.js';
import { listZones } from '../../src/server/repositories/zones.js';
import { setCategoryFinals, setFinalsZone } from '../../src/server/repositories/wave-finals.js';
import { buildPackage, importPackage } from '../../src/server/sync/package.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let db: AppDb;
let id: string;
let base: string;
beforeEach(async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${id}`;
  db = openDb(dbPath);
});
afterEach(async () => {
  closeDb(db);
  await app.close();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
const register = async (count: number, over: object) => {
  for (let i = 0; i < count; i++) {
    await call('POST', '/registrations', { clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...over });
  }
};
type Zone = { id: string; name: string; finalsOnly: boolean };

describe('zone réservée aux finales', () => {
  test('la case se lit, s’enregistre, et reste telle quelle quand elle est omise', async () => {
    const put = await call('PUT', '/zones', [{ name: 'Tatami 1' }, { name: 'Ring', finalsOnly: true }]);
    expect(put.statusCode).toBe(200);
    expect((put.json() as Zone[]).map((z) => z.finalsOnly)).toEqual([false, true]);
    const [t1, ring] = put.json() as Zone[];
    await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }, { id: ring!.id, name: 'Ring' }]);
    expect(((await call('GET', '/zones')).json() as Zone[]).map((z) => z.finalsOnly)).toEqual([false, true]);
    await call('PUT', '/zones', [{ id: t1!.id, name: 'Tatami 1' }, { id: ring!.id, name: 'Ring', finalsOnly: false }]);
    expect(((await call('GET', '/zones')).json() as Zone[]).map((z) => z.finalsOnly)).toEqual([false, false]);
  });

  test('aucune catégorie sur la zone réservée ; ses finales y passent dès que la catégorie est finie', async () => {
    await call('PUT', '/zones', [{ name: 'Ring', finalsOnly: true }, { name: 'Tatami 1' }, { name: 'Tatami 2' }]);
    const ringId = ((await call('GET', '/zones')).json() as Zone[]).find((z) => z.name === 'Ring')!.id;
    await register(4, { ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
    await register(4, { ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
    const plan = await passagePlan(db, id);
    expect(Object.values(plan.categories).map((c) => c.zoneId)).not.toContain(ringId);
    expect(Object.keys(plan.categories)).toHaveLength(2);

    await setFinalsZone(db, id, null, ringId);
    await setCategoryFinals(db, id, null, { where: 'finals', when: 'ready' });
    const after = await passagePlan(db, id);
    const finals = new Set<string>();
    for (const c of (await call('GET', '/categories')).json() as { id: string; bracket: CombatBracket }[]) {
      for (const m of finalMatchIds(c.bracket)) finals.add(`${c.id}/${m}`);
    }
    const queue = after.zones.find((z) => z.zoneId === ringId)!.passages;
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((p) => p.matchId !== null && finals.has(`${p.categoryId}/${p.matchId}`))).toBe(true);
    expect(new Set(queue.map((p) => p.categoryId)).size).toBe(2);
    expect(after.impossible).toEqual([]);
  });

  test('paquet d’avant sans finals_only : zones à faux', async () => {
    await call('PUT', '/zones', [{ name: 'Tatami 1' }, { name: 'Ring', finalsOnly: true }]);
    const pkg = buildPackage(db, id, { handOver: false, role: 'local' });
    expect(pkg.tables.zones!.map((z) => z.finals_only)).toEqual([0, 1]);
    for (const z of pkg.tables.zones!) delete z.finals_only;
    const otherPath = tmpDbPath();
    const other = openDb(otherPath);
    try {
      await importPackage(other, otherPath, pkg, null, new Date(), { backup: false });
      expect((await listZones(other, id)).map((z) => z.finalsOnly)).toEqual([false, false]);
    } finally {
      closeDb(other);
    }
  });
});
