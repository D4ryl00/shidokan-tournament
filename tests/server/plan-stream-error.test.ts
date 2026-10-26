import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/** Calcul qui échoue après une première progression (erreur du fil, ou serveur qui s'arrête). */
const hooks = vi.hoisted(() => ({ fail: null as null | 'crash' | 'stopped' }));
vi.mock('../../src/server/plan/runner.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/server/plan/runner.js')>();
  return {
    ...mod,
    runPlanJob: async (...[state, input, opts]: Parameters<typeof mod.runPlanJob>) => {
      if (!hooks.fail) return mod.runPlanJob(state, input, opts);
      opts?.onProgress?.({ done: 1, total: 3, rows: [] });
      await new Promise((r) => setTimeout(r, 20));
      throw hooks.fail === 'crash' ? new Error('panne dans le fil') : new mod.PlanAbortedError();
    },
  };
});

let app: FastifyInstance;
let base: string;
beforeAll(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterAll(async () => app.close());

const stream = async () => {
  const res = await app.inject({ method: 'POST', url: `${base}/replacement/plan`, headers: { accept: 'application/x-ndjson' }, payload: { choices: [] } });
  expect(res.statusCode).toBe(200);
  return res.body.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
};

test('flux NDJSON : erreur du calcul après l’envoi des en-têtes → dernière ligne « error » (500, message générique)', async () => {
  hooks.fail = 'crash';
  expect(await stream()).toEqual([
    { type: 'progress', done: 1, total: 3, rows: [] },
    { type: 'error', status: 500, error: 'Erreur interne du serveur' },
  ]);
});

test('flux NDJSON : calcul arrêté par le serveur → ligne « error » 503 avec son message', async () => {
  hooks.fail = 'stopped';
  expect((await stream()).at(-1)).toEqual({ type: 'error', status: 503, error: 'Calcul du plan annulé.' });
});
