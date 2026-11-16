import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { ALREADY_RETAINED, type FfkCard, type FfkCardState } from '../../src/domain/ffk-plan/plan.js';
import type { ExistingFighter } from '../../src/domain/ffk-plan/cards.js';
import type { FfkCardValue } from '../../src/domain/ffk-plan/values.js';
import { nextToSettle, pageState, workingDraft, type CardDraft, type PageCardState } from '../../src/web/components/ffk-import/cardState.js';

const line: ClubFormLine = {
  lastName: 'NAVARO', firstName: 'Tess', sex: 'F', ageBandCode: 'B', weightClassId: 'B:F:-35', weightKg: null, combats: ['karate'], kata: false,
  grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null,
};
const value: FfkCardValue = { line, clubId: 'club-1', publicNameHidden: false };

const card = (key: string, state: FfkCardState, reason: string | null = state === 'todo' ? 'combattant pas choisi' : null, rejected = false): FfkCard => ({
  key, rows: [], exportLine: line, clubEntity: '0060690 ETOILE', clubId: 'club-1', weightIssue: null, notes: [], candidates: [], sure: null,
  state, fighterId: state === 'auto' || state === 'done' ? 'f-1' : null, value: state === 'auto' || state === 'done' ? value : null,
  diffs: [], missing: [], changes: [], reason, version: null, rejected,
});

const draft = (patch: Partial<CardDraft> = {}): CardDraft => ({ fighterId: 'f-1', value, dirty: true, version: 'v1', ...patch });

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

  test('choix validé que l’aperçu a refusé (combattant déjà retenu, club disparu, fiche modifiée…) → « À trancher »', () => {
    expect(pageState(card('a', 'todo', ALREADY_RETAINED, true), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('todo');
    expect(pageState(card('a', 'todo', 'club introuvable', true), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('todo');
    // Remise à trancher d’une autre carte, sans refus : la validation passe.
    expect(pageState(card('a', 'todo', ALREADY_RETAINED), undefined, { kind: 'validated', fighterId: 'f-1', value })).toBe('done');
  });

  test('écartée, ou « Ne pas lier pour l’instant »', () => {
    expect(pageState(card('a', 'auto'), undefined, { kind: 'skip' })).toBe('skip');
    expect(pageState(card('a', 'auto'), undefined, { kind: 'none' })).toBe('todo');
  });
});

describe('workingDraft : version de la fiche', () => {
  const saved = (version: string): ExistingFighter => ({
    fighterId: 'f-1', clubId: 'club-1', licence: null, line: { ...line, weightKg: 31 }, publicNameHidden: true, version,
    editable: true, partlyEditable: false, startedDisciplines: [], fromFfk: false,
  });
  test('carte non touchée : la version de la fiche rapprochée ; nouveau combattant : aucune', () => {
    expect(workingDraft(card('a', 'auto'), undefined, undefined, () => saved('v1'))).toMatchObject({ fighterId: 'f-1', version: 'v1' });
    expect(workingDraft({ ...card('a', 'auto'), fighterId: 'new' }, undefined, undefined, () => null)).toMatchObject({ fighterId: 'new', version: null });
  });
  test('choix validé : ses valeurs et sa version ; fiche modifiée depuis : repart de la fiche actuelle', () => {
    const choice = { kind: 'validated' as const, fighterId: 'f-1', value, version: 'v1' };
    expect(workingDraft(card('a', 'done'), undefined, choice, () => saved('v1'))).toEqual({ fighterId: 'f-1', value, dirty: false, version: 'v1' });
    const fresh = workingDraft(card('a', 'todo', 'fiche modifiée', true), undefined, choice, () => saved('v2'))!;
    expect(fresh).toMatchObject({ fighterId: 'f-1', version: 'v2', value: { publicNameHidden: true, line: { weightKg: 31 } } });
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
