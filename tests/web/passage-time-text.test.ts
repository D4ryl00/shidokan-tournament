import { expect, test } from 'vitest';
import { categoryTimesText, passageTimeText } from '../../src/web/components/PassageTimeText.js';
import type { PassageTime } from '../../src/domain/schedule/organiser-times.js';

const at = (clock: string, planned = false): PassageTime => ({ kind: 'at', clock, planned });

test('passageTimeText : sur le tatami ou « vers H:MM »', () => {
  expect(passageTimeText({ kind: 'onTatami' })).toBe('sur le tatami');
  expect(passageTimeText(at('10:42'))).toBe('vers 10:42');
});

test('categoryTimesText : zone, prochain passage et finale', () => {
  expect(categoryTimesText('Tatami 2', { first: false, next: at('10:42'), final: at('11:35'), nextIsFinal: false }, false))
    .toBe('Tatami 2 · prochain vers 10:42 · finale vers 11:35');
  expect(categoryTimesText('Tatami 2', { first: true, next: at('10:42'), final: at('11:35'), nextIsFinal: false }, false))
    .toBe('Tatami 2 · 1er combat vers 10:42 · finale vers 11:35');
  expect(categoryTimesText('Tatami 2', { first: true, next: at('10:42'), final: null, nextIsFinal: false }, true))
    .toBe('Tatami 2 · tour 1 vers 10:42');
  expect(categoryTimesText('Tatami 2', { first: false, next: { kind: 'onTatami' }, final: at('11:35'), nextIsFinal: false }, false))
    .toBe('Tatami 2 · sur le tatami · finale vers 11:35');
  expect(categoryTimesText(null, { first: false, next: at('10:42'), final: null, nextIsFinal: false }, false)).toBe('prochain vers 10:42');
});

test('categoryTimesText : prochain passage = la finale, une seule mention', () => {
  // Kata à deux katakas (pas de tour 1) : rien n'est joué, la finale est le premier passage.
  expect(categoryTimesText('Tatami 2', { first: true, next: at('10:42'), final: at('10:42'), nextIsFinal: true }, true))
    .toBe('Tatami 2 · finale vers\u00a010:42');
  // Combat dont il ne reste que la finale.
  expect(categoryTimesText('Tatami 2', { first: false, next: at('11:35'), final: at('11:35'), nextIsFinal: true }, false))
    .toBe('Tatami 2 · finale vers\u00a011:35');
  expect(categoryTimesText('Tatami 2', { first: false, next: { kind: 'onTatami' }, final: { kind: 'onTatami' }, nextIsFinal: true }, false))
    .toBe('Tatami 2 · sur le tatami');
  expect(categoryTimesText(null, { first: true, next: at('15:30', true), final: at('15:30', true), nextIsFinal: true }, true)).toBe('finale vers\u00a015:30');
});
