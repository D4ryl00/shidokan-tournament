import { expect, test } from 'vitest';
import { kataLineup } from '../../../src/domain/passages/index.js';

test('kataLineup : ordre gardé, absent tardif signalé (pas retiré), noté = au moins une note', () => {
  expect(kataLineup(['a', 'b', 'c', 'd'], ['b'], { a: [8, 8], c: [] })).toEqual([
    { registrationId: 'a', done: true, absent: false },
    { registrationId: 'b', done: false, absent: true },
    { registrationId: 'c', done: false, absent: false },
    { registrationId: 'd', done: false, absent: false },
  ]);
});

test('kataLineup : liste vide', () => expect(kataLineup([], [], {})).toEqual([]));
