import type { LadderProgress } from '../domain/replacement/plan.js';
import { ApiError, TAB_ID } from './apiError.js';
import type { PlanResponse } from './api.js';

/**
 * Découpe un flux NDJSON en lignes JSON : une ligne à cheval sur deux morceaux n'est rendue qu'une fois entière,
 * les lignes vides sont ignorées, `end()` rend le reste sans saut de ligne.
 */
export function ndjsonLines(): { push(chunk: string): unknown[]; end(): unknown[] } {
  let rest = '';
  const parse = (line: string): unknown[] => (line.trim() === '' ? [] : [JSON.parse(line)]);
  return {
    push(chunk) {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      return lines.flatMap(parse);
    },
    end() {
      const last = rest;
      rest = '';
      return parse(last);
    },
  };
}

type PlanEvent =
  | ({ type: 'progress' } & LadderProgress)
  | { type: 'result'; data: PlanResponse }
  | { type: 'error'; status: number; error: string };

/**
 * `POST /replacement/plan` en flux : la progression du calcul (`onProgress`) puis le plan. Mêmes en-têtes que `api()` ;
 * annuler le `signal` arrête le calcul côté serveur.
 */
export async function fetchPlanStream(
  url: string,
  body: unknown,
  opts: { signal?: AbortSignal; onProgress?: (p: LadderProgress) => void } = {},
): Promise<PlanResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Poste-Id': TAB_ID, Accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[]; code?: string };
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.issues ?? [], data.code);
  }
  let result: PlanResponse | undefined;
  const handle = (events: unknown[]) => {
    for (const e of events as PlanEvent[]) {
      if (e.type === 'progress') opts.onProgress?.({ done: e.done, total: e.total, rows: e.rows });
      else if (e.type === 'result') result = e.data;
      else if (e.type === 'error') throw new ApiError(e.status, e.error);
    }
  };
  const lines = ndjsonLines();
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        handle(lines.push(decoder.decode(value, { stream: true })));
      }
      handle(lines.push(decoder.decode()));
    } finally {
      // Ligne d'erreur ou annulation : le flux est libéré (sans effet s'il est déjà fini).
      void reader.cancel().catch(() => {});
    }
  } else {
    handle(lines.push(await res.text()));
  }
  handle(lines.end());
  if (!result) throw new ApiError(500, 'Le calcul du plan s’est interrompu.');
  return result;
}
