import { expect, test, vi } from 'vitest';
import type { OrganiserTimes } from '../../src/domain/schedule/organiser-times.js';
import { guarded } from '../../src/web/useOrganiserTimes.js';

test('heures présumées : une erreur de lecture rend « pas d’heure » au lieu de faire tomber l’écran', () => {
  const boom = () => {
    throw new Error('boom');
  };
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const t = guarded({ passage: boom, onCall: boom, category: boom, drift: boom, waveLaunched: boom } as unknown as OrganiserTimes);
  expect(t.passage('A', 'w1-0')).toBeNull();
  expect(t.onCall('A', 'w1-0')).toBeNull();
  expect(t.category({ id: 'A', bracket: null })).toBeNull();
  expect(t.drift('z1')).toBeNull();
  expect(t.waveLaunched(null)).toBe(false);
  expect(spy).toHaveBeenCalledTimes(5);
  spy.mockRestore();
  const ok = guarded({ passage: () => ({ kind: 'onTatami' }), onCall: () => '10:30', category: () => null, drift: () => 3, waveLaunched: () => true });
  expect([ok.passage('A', 'x'), ok.onCall('A', 'x'), ok.drift('z'), ok.waveLaunched('w')]).toEqual([{ kind: 'onTatami' }, '10:30', 3, true]);
});
