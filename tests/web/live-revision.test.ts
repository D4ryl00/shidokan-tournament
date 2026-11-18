import { expect, test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { refreshDataLive, revisionTracker } from '../../src/web/liveUpdates.js';

test('aucune révision connue encore : des changements ont pu être manqués (le flux ne relit pas à sa toute première ouverture)', () => {
  const t = revisionTracker();
  expect(t.opened('r1')).toBe(true);
});

test('flux rouvert (onglet revenu, reconnexion) sans changement entre-temps : pas de relecture', () => {
  const t = revisionTracker();
  t.opened('r1');
  expect(t.opened('r1')).toBe(false);
});

test('flux rouvert après un changement manqué : relecture', () => {
  const t = revisionTracker();
  t.opened('r1');
  expect(t.opened('r2')).toBe(true);
  // Relue : un nouveau retour sans autre changement ne relit plus.
  expect(t.opened('r2')).toBe(false);
});

test('les changements reçus (ceux de ce poste compris) tiennent la révision à jour', () => {
  const t = revisionTracker();
  t.opened('r1');
  t.changed('r2');
  expect(t.opened('r2')).toBe(false);
});

test('serveur sans révision (ancienne version) : relecture à chaque réouverture, comme avant', () => {
  const t = revisionTracker();
  t.opened(null);
  expect(t.opened(null)).toBe(true);
});

test('relecture après un changement : les détails de déplacement sont marqués périmés, sans relecture', async () => {
  const qc = new QueryClient();
  const fetches = { zone: 0, details: 0 };
  await qc.fetchQuery({ queryKey: ['zone', 'c1'], queryFn: async () => ++fetches.zone });
  await qc.fetchQuery({ queryKey: ['move-details', 'c1', 'fp', { proposalId: 'p' }], queryFn: async () => ++fetches.details });
  // Requêtes montées (observées), comme les panneaux ouverts.
  const unsubs = [
    new (await import('@tanstack/react-query')).QueryObserver(qc, { queryKey: ['zone', 'c1'], queryFn: async () => ++fetches.zone }).subscribe(() => {}),
    new (await import('@tanstack/react-query')).QueryObserver(qc, { queryKey: ['move-details', 'c1', 'fp', { proposalId: 'p' }], queryFn: async () => ++fetches.details }).subscribe(() => {}),
  ];
  await new Promise((r) => setTimeout(r, 50)); // les relectures à l'abonnement sont terminées
  const before = { ...fetches };
  refreshDataLive(qc);
  await new Promise((r) => setTimeout(r, 50));
  expect(fetches.zone).toBeGreaterThan(before.zone);
  expect(fetches.details).toBe(before.details);
  expect(qc.getQueryState(['move-details', 'c1', 'fp', { proposalId: 'p' }])?.isInvalidated).toBe(true);
  unsubs.forEach((u) => u());
});
