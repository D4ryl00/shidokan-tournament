import { expect, test } from 'vitest';
import type { HistoryEntryView } from '../../src/domain/history/types.js';
import { toastUndoPlan } from '../../src/web/components/history/undoToast.js';

const entry = (id: string, seq: number, categoryIds: string[], status: 'active' | 'undone' = 'active'): HistoryEntryView =>
  ({ id, seq, kind: 'manual', groupId: null, status, createdAt: '', undoneAt: null, waveId: null, names: [], summary: { registrationIds: [] }, categoryIds, afterMembers: {}, blocked: null, cascade: [] });

test('seule action de sa catégorie : annulation directe', () => {
  expect(toastUndoPlan([entry('a', 1, ['c1']), entry('b', 2, ['c2'])], 'a')).toBe('direct');
});
test('une action plus récente sur la même catégorie : confirmation', () => {
  expect(toastUndoPlan([entry('a', 1, ['c1']), entry('b', 2, ['c1'])], 'a')).toBe('dialog');
});
test('absente ou déjà annulée : rien à faire', () => {
  expect(toastUndoPlan([entry('a', 1, ['c1'], 'undone')], 'a')).toBe('gone');
  expect(toastUndoPlan([], 'x')).toBe('gone');
});
