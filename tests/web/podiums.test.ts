import { expect, test } from 'vitest';
import { podiumState } from '../../src/web/podiums.js';

test('podiumState : jamais commencée → À disputer ; commencée → En cours ; podium complet → Terminée', () => {
  expect(podiumState({ complete: false, status: 'not_started' })).toBe('À disputer');
  expect(podiumState({ complete: false, status: 'started' })).toBe('En cours');
  expect(podiumState({ complete: true, status: 'finished' })).toBe('Terminée');
  // Podium complet : terminée, même si l'état n'a pas encore suivi.
  expect(podiumState({ complete: true, status: 'started' })).toBe('Terminée');
});
