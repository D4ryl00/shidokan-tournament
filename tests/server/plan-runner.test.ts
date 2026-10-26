import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { planPayload } from '../../src/server/plan/compute.js';
import { PlanAbortedError, activePlanJobs, runPlanJob } from '../../src/server/plan/runner.js';
import type { PlanResponse } from '../../src/server/plan/compute.js';
import type { LadderProgress, State } from '../../src/domain/replacement/index.js';
import { randomState } from '../domain/replacement/random-state.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

/**
 * Crochets de test sur le calcul du plan (inactifs par défaut) : `hold` retient chaque calcul jusqu'à ce que le test le libère,
 * `tamper` modifie la réponse (le `hash` reste celui du vrai plan).
 */
const gate = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  entered: null as (() => void) | null,
  tamper: null as ((r: PlanResponse) => PlanResponse) | null,
}));
vi.mock('../../src/server/plan/runner.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/server/plan/runner.js')>();
  return {
    ...mod,
    runPlanJob: async (...args: Parameters<typeof mod.runPlanJob>) => {
      if (gate.hold) {
        gate.entered?.();
        await gate.hold;
      }
      const r = await mod.runPlanJob(...args);
      return gate.tamper ? gate.tamper(r) : r;
    },
  };
});

/** Toutes les règles actives, mélanges rares compris, ligne en bas (comme dans les tests du diagramme). */
function allRules(seed: number, size: number) {
  const s = randomState(seed, size);
  s.settings.mixMinorsAdults = true;
  s.settings.shobuToJiyu = true;
  s.settings.mixSexes = { enabled: true, ageBandCodes: s.grid.ageBands.map((b) => b.code) };
  s.settings.replacementRules.cutAfter = 'minorsAdults';
  return s;
}

const NDJSON = 'application/x-ndjson';
/** Aucun fil en cours (ceux des tests précédents sont sortis) : le prochain fil compté est bien celui qu'on lance. */
const idle = () => vi.waitFor(() => expect(activePlanJobs()).toBe(0), { timeout: 1000, interval: 5 });
const lines = (body: string) => body.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });

describe('dans le fil', () => {
  test('même résultat dans le fil que hors du fil', async () => {
    const s = randomState(3, 60);
    for (const forApply of [false, true]) {
      const input = { waveId: null, choices: [], forApply };
      const inThread = await runPlanJob(s, input);
      const here = planPayload(s, input);
      expect(inThread).toEqual(here);
      expect(inThread.plan.hash).toBe(here.plan.hash);
      expect(inThread.fingerprint).toBe(here.fingerprint);
    }
  });

  test('la progression arrive dans l’ordre', async () => {
    const s = randomState(5, 80);
    const events: LadderProgress[] = [];
    const result = await runPlanJob(s, { waveId: null, choices: [], forApply: false }, { onProgress: (p) => events.push(p) });
    expect(events.length).toBeGreaterThan(1);
    const total = events[0]!.total;
    expect(events.every((e) => e.total === total)).toBe(true);
    expect(events.map((e) => e.done)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(events[events.length - 1]!.rows).toEqual(result.rows);
    // Plan à appliquer : un seul calcul.
    const forApply: LadderProgress[] = [];
    await runPlanJob(s, { waveId: null, choices: [], forApply: true }, { onProgress: (p) => forApply.push(p) });
    expect(forApply).toEqual([{ done: 1, total: 1, rows: [] }]);
  });

  test('annuler arrête le fil', async () => {
    const s = allRules(42, 500);
    const controller = new AbortController();
    const job = runPlanJob(s, { waveId: null, choices: [], forApply: false }, { signal: controller.signal, onProgress: () => controller.abort() });
    await expect(job).rejects.toBeInstanceOf(PlanAbortedError);
    await vi.waitFor(() => expect(activePlanJobs()).toBe(0), { timeout: 1000, interval: 10 });
  });

  test('erreur dans le fil : rejet avec son message', async () => {
    const broken = { ...randomState(3, 5), settings: undefined } as unknown as State;
    const input = { waveId: null, choices: [], forApply: false };
    const here = (() => {
      try {
        planPayload(broken, input);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(here).not.toBe('');
    await expect(runPlanJob(broken, input)).rejects.toThrow(here);
    await vi.waitFor(() => expect(activePlanJobs()).toBe(0), { timeout: 1000, interval: 10 });
  });

  test('annulé avant de partir : aucun fil', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runPlanJob(randomState(3, 20), { waveId: null, choices: [], forApply: false }, { signal: controller.signal })).rejects.toBeInstanceOf(PlanAbortedError);
    expect(activePlanJobs()).toBe(0);
  });
});

describe('par la route', () => {
  let app: FastifyInstance;
  let url: string;
  let base: string;
  /** Compétition à peu de combattants (réponses rapides). */
  let small: string;
  let dbPath: string;
  beforeAll(async () => {
    dbPath = tmpDbPath();
    app = await buildApp({ dbPath });
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const create = async (name: string) => (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name, date: '2026-11-22' } })).json().id as string;
    // Calcul lourd : 500 inscriptions tirées comme dans les tests du diagramme (réglages par défaut : environ 2 s).
    base = `/api/competitions/${await create('Lourde')}`;
    const s = randomState(42, 500);
    for (const [i, m] of s.members.entries()) {
      const res = await app.inject({
        method: 'POST', url: `${base}/registrations`,
        payload: {
          clubId: null, lastName: `NOM${i}`, firstName: 'x', sex: m.sex, ageBandCode: m.ageBandCode, discipline: m.discipline, ruleset: m.ruleset,
          weightClassId: m.weightClassId, approxWeightKg: m.approxWeightKg, otherDisciplines: m.otherDisciplines, acceptsJiyuFirst: m.acceptsJiyuFirst, source: 'manual',
        },
      });
      expect(res.statusCode).toBe(201);
    }
    small = `/api/competitions/${await create('Petite')}`;
    for (const weightClassId of ['cadet:F:-47', 'cadet:F:-54', 'cadet:F:-61']) {
      await app.inject({
        method: 'POST', url: `${small}/registrations`,
        payload: { clubId: null, lastName: weightClassId, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
      });
    }
  }, 120_000);
  afterAll(async () => app.close());

  test('le serveur répond pendant un calcul lourd', async () => {
    await idle();
    let finished = false;
    const job = app.inject({ method: 'POST', url: `${base}/replacement/plan`, payload: { choices: [] } }).then((r) => {
      finished = true;
      return r;
    });
    // Le calcul est parti dans son fil (le chargement de l'état, lui, se fait avant).
    await vi.waitFor(() => expect(activePlanJobs()).toBe(1), { timeout: 10_000, interval: 5 });
    // Une minuterie, puis la demande : un calcul dans le fil principal retiendrait les deux jusqu'à sa fin.
    const t = performance.now();
    await new Promise((r) => setTimeout(r, 50));
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    const elapsed = performance.now() - t;
    expect(health.json()).toEqual({ ok: true });
    expect(elapsed).toBeLessThan(250);
    expect(finished).toBe(false);
    expect((await job).statusCode).toBe(200);
  });

  test('flux NDJSON : une ligne par événement, puis le résultat', async () => {
    const res = await app.inject({ method: 'POST', url: `${small}/replacement/plan`, headers: { accept: NDJSON }, payload: { choices: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(NDJSON);
    const events = lines(res.body);
    expect(events.length).toBeGreaterThan(1);
    const last = events[events.length - 1]!;
    expect(last.type).toBe('result');
    const progress = events.slice(0, -1);
    expect(progress.every((e) => e.type === 'progress')).toBe(true);
    expect(progress.map((e) => e.done)).toEqual(progress.map((_, i) => i + 1));
    expect(progress[progress.length - 1]!.total).toBe(progress.length);
    const json = await app.inject({ method: 'POST', url: `${small}/replacement/plan`, payload: { choices: [] } });
    expect(last.data).toEqual(json.json());
    // Plan à appliquer : même forme.
    const forApply = lines((await app.inject({ method: 'POST', url: `${small}/replacement/plan`, headers: { accept: NDJSON }, payload: { choices: [], forApply: true } })).body);
    expect(forApply.map((e) => e.type)).toEqual(['progress', 'result']);
    expect(forApply[1]!.data).toEqual((await app.inject({ method: 'POST', url: `${small}/replacement/plan`, payload: { choices: [], forApply: true } })).json());
  });

  test('erreur avant le calcul : réponse JSON ordinaire, même en flux', async () => {
    const res = await app.inject({ method: 'POST', url: `${small}/replacement/plan`, headers: { accept: NDJSON }, payload: { waveId: 'inconnue', choices: [] } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ error: 'Session introuvable' });
    const bad = await app.inject({ method: 'POST', url: `${small}/replacement/plan`, headers: { accept: NDJSON }, payload: { choices: 'non' } });
    expect(bad.statusCode).toBe(400);
  });

  test('client parti avant la fin (flux ou JSON) : le fil est arrêté', async () => {
    await idle();
    for (const accept of [NDJSON, 'application/json']) {
      await idle();
      const controller = new AbortController();
      const res = fetch(`${url}${base}/replacement/plan`, {
        method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', accept }, body: JSON.stringify({ choices: [] }),
      });
      await vi.waitFor(() => expect(activePlanJobs()).toBe(1), { timeout: 10_000, interval: 5 });
      controller.abort();
      await expect(res.then((r) => r.text())).rejects.toThrow();
      await vi.waitFor(() => expect(activePlanJobs()).toBe(0), { timeout: 1000, interval: 10 });
    }
    // Le serveur reste disponible.
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });

  test('arrêt du serveur pendant un calcul : le fil est arrêté, l’arrêt n’attend pas la fin', async () => {
    await idle();
    // Un serveur à lui sur la même base : celui des autres tests reste ouvert jusqu'à la fin.
    const own = await buildApp({ dbPath });
    await own.listen({ port: 0, host: '127.0.0.1' });
    const ownUrl = `http://127.0.0.1:${(own.server.address() as { port: number }).port}`;
    const res = fetch(`${ownUrl}${base}/replacement/plan`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: NDJSON }, body: JSON.stringify({ choices: [] }),
    }).then((r) => r.text()).catch(() => '');
    await vi.waitFor(() => expect(activePlanJobs()).toBe(1), { timeout: 10_000, interval: 5 });
    const t = performance.now();
    await own.close();
    expect(performance.now() - t).toBeLessThan(500);
    expect(activePlanJobs()).toBe(0);
    // Le client reçoit une erreur en fin de flux, ou une connexion coupée, jamais un résultat.
    expect(await res).not.toContain('"type":"result"');
  });
});

describe('appliquer pendant que d’autres écrivent', () => {
  let app: FastifyInstance;
  let base: string;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) => app.inject({ method, url: `${base}${path}`, payload });
  const reg = async (weightClassId: string, approxWeightKg: number) => {
    const res = await call('POST', '/registrations', {
      clubId: null, lastName: weightClassId, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, approxWeightKg, source: 'manual',
    });
    return res.json().row as { id: string; fighterId: string };
  };
  /** Deux seules voisines de poids : le plan à appliquer les réunit (un déplacement). */
  const setup = async () => {
    base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
    const a = await reg('cadet:F:-47', 46);
    await reg('cadet:F:-54', 49);
    const p = (await call('POST', '/replacement/plan', { choices: [], forApply: true })).json() as { fingerprint: string; plan: { hash: string; moves: unknown[] } };
    expect(p.plan.moves).toHaveLength(1);
    await idle();
    return { a, apply: () => call('POST', '/replacement/plan/apply', { choices: [], fingerprint: p.fingerprint, hash: p.plan.hash }) };
  };
  const journal = async () => ((await call('GET', '/replacement')).json() as { recasements: unknown[] }).recasements;
  let applyDbPath: string;
  beforeAll(async () => {
    applyDbPath = tmpDbPath();
    app = await buildApp({ dbPath: applyDbPath });
  });
  afterAll(async () => app.close());

  test('le début de la transaction échoue (base verrouillée par un autre écrivain) : erreur, rien d’écrit, rien de resté ouvert', async () => {
    const { apply } = await setup();
    const other = new Database(applyDbPath);
    // Verrou d'écriture pris juste avant l'écriture du plan : le BEGIN IMMEDIATE du serveur attend puis échoue (base occupée).
    gate.tamper = (r) => {
      other.exec('BEGIN IMMEDIATE');
      return r;
    };
    try {
      const res = await apply();
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      gate.tamper = null;
      if (other.inTransaction) other.exec('ROLLBACK');
      other.close();
    }
    expect(await journal()).toEqual([]);
    // Aucune transaction n'est restée ouverte : la même application passe maintenant.
    const again = await apply();
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ applied: 1 });
  }, 20_000);

  test('deux applications du même plan en même temps : une seule écrit, l’autre 409', async () => {
    const { apply } = await setup();
    const [r1, r2] = await Promise.all([apply(), apply()]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.statusCode === 200)!.json()).toEqual({ applied: 1 });
    expect(await journal()).toHaveLength(1);
  });

  test('une pesée pendant le calcul de l’application : 409, rien d’écrit', async () => {
    const { a, apply } = await setup();
    // Le calcul est retenu jusqu'à la fin de la pesée : aucune hypothèse sur la vitesse de démarrage du fil.
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      gate.entered = resolve;
    });
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const applying = apply();
      await entered;
      expect((await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 46 })).statusCode).toBeLessThan(300);
      release();
      const res = await applying;
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("La situation a changé depuis l'affichage : rechargez les propositions.");
      expect(await journal()).toEqual([]);
    } finally {
      release();
      gate.hold = null;
      gate.entered = null;
    }
  });

  test('un déplacement qui échoue en cours de boucle : tout est annulé, rien d’écrit (409)', async () => {
    const { a, apply } = await setup();
    const before = (await call('GET', '/registrations')).json() as { id: string; categoryId: string | null }[];
    // Deuxième déplacement dont le combattant n'est plus là d'où le plan le prend : le premier est déjà écrit.
    gate.tamper = (r) => ({ ...r, plan: { ...r.plan, moves: [...r.plan.moves, { ...r.plan.moves[0]!, fromCategoryId: 'ailleurs' }] } });
    try {
      const res = await apply();
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("La situation a changé depuis l'affichage : rechargez les propositions.");
    } finally {
      gate.tamper = null;
    }
    expect(await journal()).toEqual([]);
    const after = (await call('GET', '/registrations')).json() as { id: string; categoryId: string | null }[];
    expect(after.find((r) => r.id === a.id)!.categoryId).toBe(before.find((r) => r.id === a.id)!.categoryId);
  });
});
