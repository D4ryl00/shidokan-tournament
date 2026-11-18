import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { afterEach, expect, test } from 'vitest';
import { cancelPlan, PLAN_CACHE, PLAN_KEY, refreshPlansLive, trackPlanFetch } from '../../src/web/api.js';
import { forgetPlansOfLeftCompetition } from '../../src/web/liveUpdates.js';

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((qc) => qc.clear()));

/** Un plan observé (requête active) dont chaque calcul attend `release()` ; `starts` compte les calculs lancés, `aborts` les arrêtés. */
function planQuery(meta: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const queryKey: QueryKey = [PLAN_KEY, 'c1', null, []];
  const pending: (() => void)[] = [];
  const counts = { starts: 0, aborts: 0 };
  const options = {
    ...PLAN_CACHE,
    queryKey,
    meta,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      counts.starts++;
      signal.addEventListener('abort', () => counts.aborts++);
      return trackPlanFetch(qc, queryKey, signal, () => new Promise<number>((resolve) => pending.push(() => resolve(counts.starts))));
    },
  };
  const unsubscribe = new QueryObserver(qc, options).subscribe(() => {});
  const release = async () => {
    pending.shift()?.();
    // Le résultat est rangé, puis le recalcul éventuel part (setTimeout 0).
    await new Promise((r) => setTimeout(r, 5));
  };
  // Retour sur la page : un nouvel observateur de la même clé.
  const observe = () => new QueryObserver(qc, options).subscribe(() => {});
  return { qc, queryKey, counts, release, unsubscribe, observe, query: () => qc.getQueryCache().find({ queryKey, exact: true })! };
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

test('calcul arrêté qui finit après celui qui le remplace : la mise à jour en direct reçue entre-temps est gardée', async () => {
  const p = planQuery();
  await p.release();
  // Un geste relance le plan : le calcul 2 démarre, puis il est remplacé par le calcul 3 (le 2 finira plus tard).
  void p.qc.invalidateQueries({ queryKey: p.queryKey });
  void p.qc.invalidateQueries({ queryKey: p.queryKey });
  expect(p.counts).toEqual({ starts: 3, aborts: 1 });
  refreshPlansLive(p.qc);
  // Le calcul 2, arrêté, ne finit qu'ici : il ne doit pas effacer la marque posée pour le calcul 3.
  await p.release();
  await p.release();
  expect(p.counts.starts).toBe(4);
  p.unsubscribe();
});

test('plan quitté puis revenu sans changement : pas de nouveau calcul', async () => {
  const p = planQuery();
  await p.release();
  p.unsubscribe();
  const back = p.observe();
  await new Promise((r) => setTimeout(r, 5));
  expect(p.counts.starts).toBe(1);
  expect(p.query().state.data).toBe(1);
  back();
});

test('plan quitté, mise à jour en direct pendant l’absence : recalculé au retour', async () => {
  const p = planQuery();
  await p.release();
  p.unsubscribe();
  refreshPlansLive(p.qc);
  const back = p.observe();
  expect(p.counts.starts).toBe(2);
  back();
});

test('plan annulé puis quitté : recalculé au retour', async () => {
  const p = planQuery();
  await p.release();
  void p.qc.invalidateQueries({ queryKey: p.queryKey });
  expect(p.counts.starts).toBe(2);
  await cancelPlan(p.qc, p.queryKey);
  expect(p.query().state.data).toBe(1);
  expect(p.counts.starts).toBe(2);
  p.unsubscribe();
  const back = p.observe();
  expect(p.counts.starts).toBe(3);
  back();
});

test('plan relancé (« Relancer le calcul ») puis annulé et quitté : recalculé au retour', async () => {
  const p = planQuery();
  await p.release();
  // « Relancer le calcul » : un nouveau calcul sur un plan à jour (rien ne l'a marqué périmé).
  void p.query().fetch();
  expect(p.counts.starts).toBe(2);
  await cancelPlan(p.qc, p.queryKey);
  expect(p.query().state.data).toBe(1);
  p.unsubscribe();
  const back = p.observe();
  expect(p.counts.starts).toBe(3);
  back();
});

test('compétition quittée : ses plans sans observateur sont oubliés, au tour suivant', async () => {
  const p = planQuery();
  await p.release();
  p.unsubscribe();
  forgetPlansOfLeftCompetition(p.qc, 'c1');
  await new Promise((r) => setTimeout(r, 5));
  expect(p.qc.getQueryCache().find({ queryKey: p.queryKey, exact: true })).toBeUndefined();
});

test('démontage simulé (StrictMode) : le plan encore observé n’est ni oublié ni arrêté', async () => {
  const p = planQuery();
  expect(p.counts.starts).toBe(1);
  forgetPlansOfLeftCompetition(p.qc, 'c1');
  await new Promise((r) => setTimeout(r, 5));
  expect(p.counts).toEqual({ starts: 1, aborts: 0 });
  await p.release();
  expect(p.query().state.data).toBe(1);
  p.unsubscribe();
});
