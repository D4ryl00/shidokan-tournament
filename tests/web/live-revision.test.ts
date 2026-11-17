import { expect, test } from 'vitest';
import { revisionTracker } from '../../src/web/liveUpdates.js';

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
