import { expect, test } from 'vitest';
import { kataLineup } from '../../../src/domain/passages/index.js';

test('kataLineup : ordre gardé, absents retirés, noté = au moins une note', () => {
  expect(kataLineup(['a', 'b', 'c', 'd'], ['b'], { a: [8, 8], c: [] })).toEqual([
    { registrationId: 'a', done: true }, { registrationId: 'c', done: false }, { registrationId: 'd', done: false },
  ]);
});

test('kataLineup : liste vide', () => expect(kataLineup([], [], {})).toEqual([]));
