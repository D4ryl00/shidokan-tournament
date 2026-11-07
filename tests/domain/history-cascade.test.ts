import { expect, test } from 'vitest';
import { type CascadeEntry, compositionChanged, undoSet } from '../../src/domain/history/cascade.js';
import type { HistoryKind } from '../../src/domain/history/types.js';

const e = (id: string, seq: number, categoryIds: string[], kind: HistoryKind = 'manual', active = true, afterMembers: Record<string, string[]> = {}): CascadeEntry => ({
  id, seq, active, kind, categoryIds, afterMembers,
});

test('cascade : les plus récentes qui touchent une même catégorie, de proche en proche, plus récente d’abord', () => {
  const all = [e('h1', 1, ['A', 'B']), e('h2', 2, ['C']), e('h3', 3, ['B', 'D'], 'places'), e('h4', 4, ['D']), e('h5', 5, ['C'])];
  expect(undoSet(all, ['h1']).map((x) => x.id)).toEqual(['h4', 'h3', 'h1']);
});
test('cascade : ignore les annulées et les plus anciennes', () => {
  const all = [e('h1', 1, ['A']), e('h2', 2, ['A'], 'manual', false), e('h3', 3, ['A'])];
  expect(undoSet(all, ['h3']).map((x) => x.id)).toEqual(['h3']);
  expect(undoSet(all, ['h1']).map((x) => x.id)).toEqual(['h3', 'h1']);
});
test('plusieurs cibles (plan) : union sans doublon', () => {
  const all = [e('p1', 1, ['A']), e('p2', 2, ['B']), e('s', 3, ['A', 'B'], 'places')];
  expect(undoSet(all, ['p1', 'p2']).map((x) => x.id)).toEqual(['s', 'p2', 'p1']);
});
test('composition : un échange de places dont le tableau a changé hors historique', () => {
  const s = e('s', 3, ['A'], 'places', true, { A: ['r1', 'r2'] });
  expect(compositionChanged([s], new Map([['A', ['r2', 'r1']]]))).toBe(false);
  expect(compositionChanged([s], new Map([['A', ['r1']]]))).toBe(true);
  // Un déplacement ne se bloque jamais pour ça.
  expect(compositionChanged([e('m', 3, ['A'], 'manual', true, { A: ['r1', 'r2'] })], new Map([['A', ['r1']]]))).toBe(false);
  // C'est la plus récente du lot touchant A qui compte.
  const later = e('m2', 4, ['A'], 'manual', true, { A: ['r1'] });
  expect(compositionChanged([later, s], new Map([['A', ['r1']]]))).toBe(false);
});
