import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { afterEach, expect, test } from 'vitest';
import { PLAN_KEY, refreshPlansLive, trackPlanFetch } from '../../src/web/api.js';

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((qc) => qc.clear()));

/** Un plan observé (requête active) dont chaque calcul attend `release()` ; `starts` compte les calculs lancés, `aborts` les arrêtés. */
function planQuery(meta: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const queryKey: QueryKey = [PLAN_KEY, 'c1', null, []];
  const pending: (() => void)[] = [];
  const counts = { starts: 0, aborts: 0 };
  const observer = new QueryObserver(qc, {
    queryKey,
    meta,
    queryFn: ({ signal }) => {
      counts.starts++;
      signal.addEventListener('abort', () => counts.aborts++);
      return trackPlanFetch(qc, queryKey, signal, () => new Promise<number>((resolve) => pending.push(() => resolve(counts.starts))));
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const release = async () => {
    pending.shift()?.();
    // Le résultat est rangé, puis le recalcul éventuel part (setTimeout 0).
    await new Promise((r) => setTimeout(r, 5));
  };
  return { qc, queryKey, counts, release, unsubscribe, query: () => qc.getQueryCache().find({ queryKey, exact: true })! };
}

test('mise à jour en direct pendant un calcul : il continue, un seul nouveau calcul part à la fin', async () => {
  const p = planQuery();
  expect(p.counts.starts).toBe(1);
  refreshPlansLive(p.qc);
  refreshPlansLive(p.qc);
  expect(p.counts).toEqual({ starts: 1, aborts: 0 });
  await p.release();
  expect(p.query().state.data).toBe(1);
  expect(p.counts).toEqual({ starts: 2, aborts: 0 });
  // Ce nouveau calcul fini, rien de plus.
  await p.release();
  expect(p.counts.starts).toBe(2);
  p.unsubscribe();
});

test('mise à jour en direct sans calcul en cours : le plan est relu', async () => {
  const p = planQuery();
  await p.release();
  refreshPlansLive(p.qc);
  expect(p.counts.starts).toBe(2);
  p.unsubscribe();
});

test('calcul arrêté (annulation, geste qui relance) : pas de calcul de plus à la fin', async () => {
  const p = planQuery();
  refreshPlansLive(p.qc);
  await p.qc.cancelQueries({ queryKey: p.queryKey });
  await new Promise((r) => setTimeout(r, 5));
  expect(p.counts).toEqual({ starts: 1, aborts: 1 });
  p.unsubscribe();
});

test('plan annulé : une mise à jour en direct le marque périmé sans le relancer', async () => {
  const p = planQuery();
  await p.release();
  // `usePlan` met l'heure du plan affiché au moment de l'annulation dans `meta.cancelledAt`.
  p.query().options.meta = { cancelledAt: p.query().state.dataUpdatedAt };
  refreshPlansLive(p.qc);
  expect(p.counts.starts).toBe(1);
  expect(p.query().state.isInvalidated).toBe(true);
  p.unsubscribe();
});
