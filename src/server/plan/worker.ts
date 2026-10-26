/**
 * Point d'entrée du fil de calcul du plan : reçoit l'état et la demande (`workerData`), envoie la progression
 * puis la réponse. N'importe ni la base ni Fastify (voir `compute.ts`).
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { State } from '../../domain/replacement/index.js';
import { planPayload, type PlanInput } from './compute.js';

const { state, input, progress } = workerData as { state: State; input: PlanInput; progress: boolean };
const port = parentPort!;
const result = planPayload(state, input, progress ? (p) => port.postMessage({ type: 'progress', progress: p }) : undefined);
port.postMessage({ type: 'result', result });
