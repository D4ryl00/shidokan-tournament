import { expect, test } from 'vitest';
import { accessTimes } from '../../src/web/access-labels.js';

test('heure d’un lien : à la minute ; avec les secondes quand un autre lien du club a été créé la même minute', () => {
  const t = accessTimes([
    { id: 'a', createdAt: '2026-11-03T08:08:05.000Z' },
    { id: 'b', createdAt: '2026-11-03T08:08:41.000Z' },
    { id: 'c', createdAt: '2026-11-03T08:11:00.000Z' },
  ]);
  expect(t.get('a')).toMatch(/^\d{2}:\d{2}:05$/);
  expect(t.get('b')).toMatch(/^\d{2}:\d{2}:41$/);
  expect(t.get('c')).toMatch(/^\d{2}:\d{2}$/);
});

test('même minute à des jours différents : pas de secondes', () => {
  const t = accessTimes([
    { id: 'a', createdAt: '2026-11-02T08:08:05.000Z' },
    { id: 'b', createdAt: '2026-11-03T08:08:41.000Z' },
  ]);
  expect(t.get('a')).toMatch(/^\d{2}:\d{2}$/);
  expect(t.get('b')).toMatch(/^\d{2}:\d{2}$/);
});
