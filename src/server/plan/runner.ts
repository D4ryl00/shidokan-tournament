/**
 * Calcul du plan dans un fil à part (un par demande) : le serveur reste disponible pendant un calcul lourd,
 * et une demande abandonnée arrête son fil au lieu de le laisser finir pour rien.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { LadderProgress, State } from '../../domain/replacement/index.js';
import type { PlanInput, PlanResponse } from './compute.js';

/** Même extension que ce module : `.ts` sous vitest et `tsx watch`, `.js` une fois compilé (`dist/`). */
const ext = path.extname(fileURLToPath(import.meta.url));
const workerUrl = new URL(`./worker${ext}`, import.meta.url);
/** En TypeScript, le fil a besoin du chargeur tsx ; `tsx watch` le donne déjà dans `execArgv` (hérité par le fil). */
const execArgv = ext === '.ts' && !process.execArgv.some((a) => a.includes('tsx')) ? [...process.execArgv, '--import', 'tsx'] : undefined;

/** Calcul arrêté avant sa fin : demande abandonnée, ou serveur qui s'arrête. */
export class PlanAbortedError extends Error {
  /** Arrêt du serveur pendant le calcul : réponse 503, message affichable. */
  readonly statusCode = 503;
  readonly expose = true;
  constructor(message = 'Calcul du plan annulé.') {
    super(message);
    this.name = 'PlanAbortedError';
  }
}

/** Fils en cours, jusqu'à leur sortie effective. */
const workers = new Set<Worker>();
/** Arrêt de chaque calcul en cours (rejet `PlanAbortedError`, fil arrêté). */
const stops = new Set<() => void>();

export function activePlanJobs(): number {
  return workers.size;
}

/** Arrête tous les calculs en cours et attend la sortie de leurs fils (fermeture du serveur). */
export async function stopAllPlanJobs(): Promise<void> {
  const exited = [...workers].map((w) => new Promise((resolve) => w.once('exit', resolve)));
  for (const stop of [...stops]) stop();
  await Promise.all(exited);
}

/**
 * Calcule `planPayload(state, input)` dans un nouveau fil. `signal` annulé : le fil est arrêté, rejet `PlanAbortedError`.
 * `onProgress` reçoit la progression du fil, dans l'ordre ; rien n'arrive après le résultat ou l'annulation.
 */
export function runPlanJob(
  state: State,
  input: PlanInput,
  opts: { signal?: AbortSignal; onProgress?: (p: LadderProgress) => void } = {},
): Promise<PlanResponse> {
  const { signal, onProgress } = opts;
  if (signal?.aborted) return Promise.reject(new PlanAbortedError());
  return new Promise<PlanResponse>((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { state, input, progress: onProgress !== undefined }, execArgv });
    workers.add(worker);
    let settled = false;
    const settle = (outcome: { result: PlanResponse } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      stops.delete(stop);
      signal?.removeEventListener('abort', stop);
      if ('result' in outcome) resolve(outcome.result);
      else reject(outcome.error);
    };
    const stop = () => {
      settle({ error: new PlanAbortedError() });
      void worker.terminate();
    };
    stops.add(stop);
    signal?.addEventListener('abort', stop, { once: true });
    worker.on('message', (m: { type: 'progress'; progress: LadderProgress } | { type: 'result'; result: PlanResponse }) => {
      if (settled) return;
      if (m.type === 'result') {
        settle({ result: m.result });
        return;
      }
      try {
        onProgress?.(m.progress);
      } catch (error) {
        settle({ error });
        void worker.terminate();
      }
    });
    worker.on('error', (error) => settle({ error }));
    worker.on('exit', (code) => {
      workers.delete(worker);
      settle({ error: new Error(`Le calcul du plan s’est arrêté sans résultat (code ${code}).`) });
    });
  });
}
