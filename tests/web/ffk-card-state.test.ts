import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { ALREADY_RETAINED, type FfkCard, type FfkCardState } from '../../src/domain/ffk-plan/plan.js';
import type { FfkCardValue } from '../../src/domain/ffk-plan/values.js';
import { nextToSettle, pageState, type CardDraft, type PageCardState } from '../../src/web/components/ffk-import/cardState.js';

const line: ClubFormLine = {
  lastName: 'NAVARO', firstName: 'Tess', sex: 'F', ageBandCode: 'B', weightClassId: 'B:F:-35', weightKg: null, combats: ['karate'], kata: false,
  grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null,
};
const value: FfkCardValue = { line, clubId: 'club-1', publicNameHidden: false };

const card = (key: string, state: FfkCardState, reason: string | null = state === 'todo' ? 'combattant pas choisi' : null): FfkCard => ({
  key, rows: [], exportLine: line, clubEntity: '0060690 ETOILE', clubId: 'club-1', weightIssue: null, notes: [], candidates: [], sure: null,
  state, fighterId: state === 'auto' || state === 'done' ? 'f-1' : null, value: state === 'auto' || state === 'done' ? value : null,
  diffs: [], missing: [], changes: [], reason, version: null,
});

const draft = (patch: Partial<CardDraft> = {}): CardDraft => ({ fighterId: 'f-1', value, dirty: true, ...patch });

describe('pageState', () => {
  test('carte non touchée : l’état de l’aperçu', () => {
    expect(pageState(card('a', 'todo'), undefined, undefined)).toBe('todo');
    expect(pageState(card('a', 'auto'), undefined, undefined)).toBe('auto');
  });

  test('brouillon modifié non validé → « À valider », même sur une carte sans problème', () => {
    expect(pageState(card('a', 'todo'), draft(), undefined)).toBe('pending');
    expect(pageState(card('a', 'auto'), draft(), { kind: 'none' })).toBe('pending');
  });

  test('brouillon modifié où il reste un champ à remplir → « À trancher »', () => {
    expect(pageState(card('a', 'todo'), draft({ value: { ...value, line: { ...line, ageBandCode: null } } }), { kind: 'none' })).toBe('todo');
  });

  test('carte seulement ouverte (brouillon non modifié) : l’état de l’aperçu', () => {
    expect(pageState(card('a', 'auto'), draft({ dirty: false }), undefined)).toBe('auto');
  });

  test('choix validé → « Validée », sans attendre l’aperçu', () => {
    expect(pageState(card('a', 'todo'), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('done');
    expect(pageState(card('a', 'done'), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('done');
  });

  test('choix validé que l’aperçu a refusé (combattant déjà retenu, club disparu…) → « À trancher »', () => {
    expect(pageState(card('a', 'todo', ALREADY_RETAINED), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('todo');
    expect(pageState(card('a', 'todo', 'club introuvable'), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('todo');
  });

  test('écartée, ou « Ne pas lier pour l’instant »', () => {
    expect(pageState(card('a', 'auto'), undefined, { kind: 'skip' })).toBe('skip');
    expect(pageState(card('a', 'auto'), undefined, { kind: 'none' })).toBe('todo');
  });
});

describe('nextToSettle', () => {
  const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => card(k, 'todo'));
  const states: Record<string, PageCardState> = { a: 'todo', b: 'auto', c: 'done', d: 'skip', e: 'todo', f: 'pending' };

  test('saute les cartes sans problème, validées et écartées', () => {
    expect(nextToSettle(cards, 'a', states)).toBe('e');
  });

  test('une carte « À valider » reste à trancher', () => {
    expect(nextToSettle(cards, 'e', states)).toBe('f');
  });

  test('après la dernière, repart du début', () => {
    expect(nextToSettle(cards, 'f', states)).toBe('a');
  });

  test('plus rien à trancher (hors la carte elle-même) → null', () => {
    expect(nextToSettle(cards, 'a', { ...states, e: 'done', f: 'done' })).toBeNull();
  });
});
