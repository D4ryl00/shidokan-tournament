import { expect, test } from 'vitest';
import { entryHeadline, undoEffect } from '../../src/domain/history/text.js';
import { filterOfKind, HISTORY_KIND_LABELS, RESET_KINDS, type HistoryEntryView } from '../../src/domain/history/types.js';

const view = (p: Partial<HistoryEntryView>): HistoryEntryView => ({
  id: 'h', seq: 1, kind: 'manual', groupId: null, status: 'active', createdAt: '', undoneAt: null, waveId: null,
  names: [], summary: { registrationIds: [] }, categoryIds: [], afterMembers: {}, blocked: null, cascade: [], ...p,
});

test('titres', () => {
  expect(entryHeadline(view({ kind: 'places', names: ['PETIT Inès', 'MOREAU Jade'], summary: { registrationIds: ['a', 'b'], detail: 'Karaté · Jiyu · Benjamins F · -35 kg' } })))
    .toEqual({ what: 'PETIT Inès ↔ MOREAU Jade', detail: 'Karaté · Jiyu · Benjamins F · -35 kg : places échangées dans le tableau' });
  expect(entryHeadline(view({ kind: 'redraw', summary: { registrationIds: [], detail: 'Karaté · Jiyu · Benjamins F · -35 kg' } })).what).toBe('Nouveau tirage');
  expect(entryHeadline(view({ kind: 'format', summary: { registrationIds: [], detail: 'Kata · Benjamins F : Automatique ➜ Tour 1 puis finale à deux' } })).what).toBe('Format changé');
  expect(entryHeadline(view({ kind: 'manual', names: ['GUERIN Emma'], summary: { registrationIds: ['g'], fromLabel: 'Minimes F · -38 kg', toLabel: 'Minimes F · -42 kg' } })))
    .toEqual({ what: 'GUERIN Emma', detail: 'Minimes F · -38 kg ➜ Minimes F · -42 kg' });
  expect(entryHeadline(view({ kind: 'exchange', names: ['A', 'B'], summary: { registrationIds: ['a', 'b'], fromLabel: 'Minimes F · -38 kg', toLabel: 'Minimes F · -42 kg' } })))
    .toEqual({ what: 'A ↔ B', detail: 'Minimes F · -38 kg ↔ Minimes F · -42 kg' });
});

test('effet de l’annulation', () => {
  expect(undoEffect(view({ kind: 'plan', names: ['GUERIN Emma'], summary: { registrationIds: ['g'], fromLabel: 'Karaté · Jiyu · Minimes F · -38 kg', toLabel: 'x' } })))
    .toBe('GUERIN Emma retourne en Karaté · Jiyu · Minimes F · -38 kg.');
  expect(undoEffect(view({ kind: 'exchange', names: ['A', 'B'] }))).toBe('A et B retournent chacun dans leur catégorie d’avant.');
  expect(undoEffect(view({ kind: 'places', names: ['A', 'B'] }))).toBe('A et B reprennent leur place d’avant.');
  expect(undoEffect(view({ kind: 'redraw', summary: { registrationIds: [], detail: 'Benjamins F · -35 kg' } }))).toBe('Benjamins F · -35 kg retrouve son tirage d’avant.');
  expect(undoEffect(view({ kind: 'format', summary: { registrationIds: [], detail: 'Kata · Benjamins F : Automatique ➜ Tour 1 puis finale à deux' } })))
    .toBe('Kata · Benjamins F repasse en « Automatique ».');
  expect(undoEffect(view({ kind: 'free', summary: { registrationIds: [], detail: 'Kata · Benjamins F : Tableau libre ➜ Automatique' } })))
    .toBe('Kata · Benjamins F repasse en « Tableau libre ».');
  expect(undoEffect(view({ kind: 'withdraw', names: ['GUERIN Emma'], summary: { registrationIds: ['g'], fromLabel: 'Minimes F · -38 kg' } })))
    .toBe('GUERIN Emma combat de nouveau en Minimes F · -38 kg.');
});

test('types', () => {
  expect(filterOfKind('reaffectation')).toBe('plan');
  expect(filterOfKind('withdraw')).toBe('manual');
  expect(filterOfKind('format')).toBe('tab');
  expect(RESET_KINDS).toEqual(['plan', 'reaffectation', 'manual', 'exchange', 'withdraw']);
  expect(HISTORY_KIND_LABELS.withdraw).toBe('Ne combat pas');
});
