import { expect, test } from 'vitest';
import { caseFingerprint } from '../../../src/domain/replacement/ignore.js';
import { computePlan } from '../../../src/domain/replacement/plan.js';
import type { Case, Member, State } from '../../../src/domain/replacement/types.js';
import { makeState, member } from './fixtures.js';

const OPTS = { waveId: null, level: 'minorsAdults' as const, choices: [] };
const kg = (wc: string, over: Partial<Member> = {}) => member({ weightClassId: wc, approxWeightKg: 50, ...over });
// Carte « seul » synthétique : seule la catégorie de la carte compte pour l'empreinte.
const caseOf = (_s: State, m: Member): Case => ({ id: `alone:${m.registrationId}`, kind: 'alone', registrationId: m.registrationId, categoryId: m.categoryId, detail: 'Seule dans sa catégorie' });
const fp = (s: State, m: Member) => caseFingerprint(s, caseOf(s, m));

test('même situation : même empreinte', () => {
  const a = kg('cadet:F:-54');
  expect(fp(makeState([a]), a)).toBe(fp(makeState([a]), a));
});

test('un adversaire pesé (weighInKg change) : empreinte différente', () => {
  const a = kg('cadet:F:-54');
  const b = kg('cadet:F:-54');
  const before = fp(makeState([a, b]), a);
  expect(fp(makeState([a, { ...b, weighInKg: 53, presence: 'present' }]), a)).not.toBe(before);
});

test('un nouvel arrivant dans la catégorie : empreinte différente', () => {
  const a = kg('cadet:F:-54');
  const b = kg('cadet:F:-54');
  const s1 = makeState([a]);
  const s2 = makeState([a, b]);
  expect(caseFingerprint(s2, caseOf(s1, a))).not.toBe(fp(s1, a));
});

test('un adversaire absent : empreinte différente', () => {
  const a = kg('cadet:F:-54');
  const b = kg('cadet:F:-54');
  const s = makeState([a, b]);
  const c = caseOf(makeState([a]), a);
  expect(caseFingerprint({ ...s, members: [a, { ...b, presence: 'absent' }] }, c)).not.toBe(caseFingerprint(s, c));
});

test("retour : un changement dans la catégorie d'origine change l'empreinte", () => {
  const origin = kg('cadet:F:-47');
  const a = kg('cadet:F:-54', { original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47' } });
  const s = makeState([origin, a]);
  const c: Case = { id: `return:${a.registrationId}`, kind: 'return', registrationId: a.registrationId, categoryId: a.categoryId, detail: 'x' };
  const s2 = makeState([{ ...origin, weighInKg: 46, presence: 'present' }, a], { categories: s.categories });
  expect(caseFingerprint(s2, c)).not.toBe(caseFingerprint(s, c));
});

test("plan : une carte ignorée n'est pas un départ du plan", () => {
  const a = kg('cadet:F:-47');
  const b = kg('cadet:F:-54');
  const s = makeState([a, b], { ignored: [`alone:${a.registrationId}`] });
  expect(computePlan(s, OPTS).moves.map((m) => m.registrationId)).toEqual([b.registrationId]);
  const both = { ...s, ignored: [`alone:${a.registrationId}`, `alone:${b.registrationId}`] };
  expect(computePlan(both, OPTS).moves).toEqual([]);
});
