import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { PublicCompetition } from '../../src/domain/public/types.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });

describe('vue des heures pour l’organisation', () => {
  test('compétition privée : la vue des heures est servie', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await call('POST', '/registrations', {
        clubId: null, lastName: `NOM${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual',
      });
      expect(res.statusCode).toBe(201);
    }
    for (const c of (await call('GET', '/categories')).json() as { id: string }[]) await call('PATCH', `/categories/${c.id}`, { status: 'ready' });
    expect((await call('POST', '/launch', { waveId: null, restart: false })).statusCode).toBe(204);
    const res = await call('GET', '/schedule/times');
    expect(res.statusCode).toBe(200);
    const view = res.json() as PublicCompetition;
    expect(view.queues.length).toBeGreaterThan(0);
    expect(view.queues.some((q) => q.items.length > 0)).toBe(true);
  });

  test('gardée en mémoire : 304 sur la même empreinte, nouvelle empreinte après un résultat', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await call('POST', '/registrations', {
        clubId: null, lastName: `NOM${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual',
      });
      expect(res.statusCode).toBe(201);
    }
    const [cat] = (await call('GET', '/categories')).json() as { id: string }[];
    await call('PATCH', `/categories/${cat!.id}`, { status: 'ready' });
    expect((await call('POST', '/launch', { waveId: null, restart: false })).statusCode).toBe(204);
    const first = await call('GET', '/schedule/times');
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-cache');
    const etag = String(first.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    const again = await app.inject({ method: 'GET', url: `${base}/schedule/times`, headers: { 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect((await call('PUT', `/categories/${cat!.id}/results/w1-0`, { winner: 'a', method: 'points' })).statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `${base}/schedule/times`, headers: { 'if-none-match': etag } });
    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(etag);
    const view = after.json() as PublicCompetition;
    expect(view.categories.find((c) => c.id === cat!.id)).toMatchObject({ results: { 'w1-0': { winner: 'a', method: 'points' } } });
    expect(view.queues.flatMap((q) => q.items).find((i) => i.categoryId === cat!.id && i.matchId === 'w1-0')?.endedAt).not.toBeNull();
  });

  test('compétition inconnue : 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/competitions/inconnue/schedule/times' })).statusCode).toBe(404);
  });

  test('la route publique reste 404 pour une compétition privée', async () => {
    const id = base.split('/').pop();
    expect((await app.inject({ method: 'GET', url: `/api/public/competitions/${id}` })).statusCode).toBe(404);
  });
});
