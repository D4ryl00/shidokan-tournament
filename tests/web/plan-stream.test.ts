import { expect, test } from 'vitest';
import { ndjsonLines } from '../../src/web/planStream.js';

test('flux : deux lignes dans un morceau sont rendues ensemble', () => {
  const l = ndjsonLines();
  expect(l.push('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
});

test('flux : une ligne coupée en trois morceaux n’est rendue qu’une fois entière', () => {
  const l = ndjsonLines();
  expect(l.push('{"type":"pro')).toEqual([]);
  expect(l.push('gress","done"')).toEqual([]);
  expect(l.push(':1}\n')).toEqual([{ type: 'progress', done: 1 }]);
  expect(l.end()).toEqual([]);
});

test('flux : les lignes vides sont ignorées', () => {
  const l = ndjsonLines();
  expect(l.push('\n{"a":1}\n\n  \n')).toEqual([{ a: 1 }]);
});

test('flux : le reste sans saut de ligne est rendu par end()', () => {
  const l = ndjsonLines();
  expect(l.push('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }]);
  expect(l.end()).toEqual([{ b: 2 }]);
});
