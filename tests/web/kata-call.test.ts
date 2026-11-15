import { expect, test } from 'vitest';
import { kataCall } from '../../src/web/kataCall.js';

const s = (name: string, done = false, absent = false) => ({ name, club: 'C', done, absent });

test('se présente / se prépare', () =>
  expect(kataCall([s('A', true), s('B'), s('C')])).toEqual({ position: 2, total: 3, current: s('B'), next: s('C') }));

test('dernier : pas de suivant', () => expect(kataCall([s('A', true), s('B')]).next).toBeNull());

test('tous notés : personne', () => expect(kataCall([s('A', true)])).toEqual({ position: 1, total: 1, current: null, next: null }));

test('un kataka noté hors ordre : le premier non noté se présente, le suivant non noté se prépare', () =>
  expect(kataCall([s('A'), s('B', true), s('C')])).toMatchObject({ position: 1, current: s('A'), next: s('C') }));

test('absent tardif : jamais appelé, ni compté', () => {
  expect(kataCall([s('A', true), s('B', false, true), s('C'), s('D')])).toEqual({ position: 2, total: 3, current: s('C'), next: s('D') });
  expect(kataCall([s('A'), s('B', false, true)])).toMatchObject({ current: s('A'), next: null, total: 1 });
  expect(kataCall([s('A', true), s('B', false, true)])).toMatchObject({ current: null, next: null });
});
