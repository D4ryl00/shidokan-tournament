import { expect, test } from 'vitest';
import { fetchPlanStream, ndjsonLines } from '../../src/web/planStream.js';
import { ApiError } from '../../src/web/apiError.js';

test('flux : deux lignes dans un morceau sont rendues ensemble', () => {
  const l = ndjsonLines();
  expect(l.push('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
});

test('flux : une ligne coupée en trois morceaux n’est rendue qu’une fois entière', () => {
  const l = ndjsonLines();
  expect(l.push('{"type":"pro')).toEqual([]);
  expect(l.push('gress","done"')).toEqual([]);
  expect(l.push(':1}\n')).toEqual([{ type: 'progress', done: 1 }]);
  expect(l.end()).toEqual([]);
});

test('flux : les lignes vides sont ignorées', () => {
  const l = ndjsonLines();
  expect(l.push('\n{"a":1}\n\n  \n')).toEqual([{ a: 1 }]);
});

test('flux : le reste sans saut de ligne est rendu par end()', () => {
  const l = ndjsonLines();
  expect(l.push('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }]);
  expect(l.end()).toEqual([{ b: 2 }]);
});

// --- fetchPlanStream ---

const stream = (...parts: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
const withFetch = async (res: Response, run: () => Promise<unknown>) => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => res) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = real; }
};
const call = (onProgress?: (p: unknown) => void) => fetchPlanStream('/x', {}, { onProgress });

test('fetchPlanStream : progression puis résultat, ligne coupée en deux morceaux', async () => {
  const seen: unknown[] = [];
  const out = await withFetch(stream('{"type":"progress","done":1,"total":2,"rows":[]}\n{"type":"res', 'ult","data":{"ok":1}}\n'), () => call((p) => seen.push(p)));
  expect(out).toEqual({ ok: 1 });
  expect(seen).toEqual([{ done: 1, total: 2, rows: [] }]);
});

test('fetchPlanStream : une ligne d’erreur donne une ApiError (statut et message)', async () => {
  const err = await withFetch(stream('{"type":"error","status":503,"error":"Calcul du plan annulé."}\n'), () => call()).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 503, message: 'Calcul du plan annulé.' });
});

test('fetchPlanStream : réponse non OK, ApiError comme api()', async () => {
  const res = new Response(JSON.stringify({ error: 'Interdit', issues: ['a'] }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  const err = await withFetch(res, () => call()).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 403, message: 'Interdit', issues: ['a'] });
});

test('fetchPlanStream : flux fini sans résultat, ApiError 500', async () => {
  const err = await withFetch(stream('{"type":"progress","done":1,"total":2,"rows":[]}\n'), () => call()).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 500 });
});
