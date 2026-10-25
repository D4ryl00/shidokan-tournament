import { expect, test } from 'vitest';
import { categoryLabel, keyString } from '../../../src/domain/categories.js';
import { applyProposal, bulkPlan, recompute, stateFingerprint } from '../../../src/domain/replacement/apply.js';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import type { State } from '../../../src/domain/replacement/types.js';
import { makeState, member } from './fixtures.js';

const best = (s: State, regId: string) => proposalsFor(s, detectCases(s).find((c) => c.registrationId === regId)!)[0]!;
const memberOf = (s: State, regId: string) => s.members.find((m) => m.registrationId === regId)!;

test('A : fusion -47 → -54', () => {
  const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const s = makeState([a, b]);
  const next = applyProposal(s, best(s, a.registrationId));
  const moved = memberOf(next, a.registrationId);
  const target = next.categories.find((c) => c.id === b.categoryId)!;
  expect(moved).toMatchObject({ categoryId: b.categoryId, placementLocked: true, recasementType: 'A', original: { weightClassId: 'cadet:F:-47' } });
  expect(categoryLabel(target.key, next.grid)).toBe('Karaté · Jiyu · Cadets F · -47 / -54 kg');
  expect(target.aliasKeys).toContain(keyString({ discipline: 'karate', ruleset: 'jiyu', sex: 'F', ageBandCodes: ['cadet'], weightClassIds: ['cadet:F:-54'] }));
  expect(next.categories.some((c) => c.id === a.categoryId)).toBe(false);
  expect(detectCases(next).filter((c) => c.kind === 'alone')).toEqual([]);
  expect(memberOf(s, a.registrationId).categoryId).toBe(a.categoryId); // état d'origine intact
});

test('H : changement de discipline, original mémorisé', () => {
  const a = member({ otherDisciplines: ['shido-boxing'] });
  const box = member({ discipline: 'shido-boxing' });
  const s = makeState([a, box]);
  const next = applyProposal(s, best(s, a.registrationId));
  expect(memberOf(next, a.registrationId)).toMatchObject({ discipline: 'shido-boxing', recasementType: 'H', original: { discipline: 'karate' } });
});

test('correction de poids : pas de verrouillage, catégorie naturelle', () => {
  const a = member({ weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
  const b = member({ weightClassId: 'cadet:F:-61' });
  const s = makeState([a, b]);
  const next = applyProposal(s, best(s, a.registrationId));
  expect(memberOf(next, a.registrationId)).toMatchObject({ weightClassId: 'cadet:F:-61', placementLocked: false, categoryId: b.categoryId, original: null });
});

test('R : retour, catégorie fusionnée qui retrouve sa clé', () => {
  const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  let s = makeState([a, b]);
  s = applyProposal(s, best(s, a.registrationId));
  const newcomer = member({ weightClassId: 'cadet:F:-47' });
  s = makeState([...s.members, newcomer], { categories: s.categories });
  const r = best(s, a.registrationId);
  expect(r.type).toBe('R');
  s = applyProposal(s, r);
  expect(memberOf(s, a.registrationId)).toMatchObject({ placementLocked: false, original: null, recasementType: null, categoryId: newcomer.categoryId });
  const host = s.categories.find((c) => c.id === b.categoryId)!;
  expect(host.key.weightClassIds).toEqual(['cadet:F:-54']);
});

test('masse « simple » : 4 seules, deux paires voisines → 2 étapes, plus aucun cas', () => {
  const ms = [
    member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 }), member({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 }),
    member({ ageBandCode: 'senior', sex: 'M', weightClassId: 'senior:M:-67', approxWeightKg: 66 }), member({ ageBandCode: 'senior', sex: 'M', weightClassId: 'senior:M:-75', approxWeightKg: 69 }),
  ];
  const { steps, final, unresolved } = bulkPlan(makeState(ms), 'simple');
  expect(steps).toHaveLength(2);
  expect(new Set(steps.map((x) => x.proposal.registrationId)).size).toBe(2);
  expect(unresolved).toEqual([]);
  expect(detectCases(final)).toEqual([]);
});

test('masse « all » inclut les cas manuels, « simple » non', () => {
  const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  const cad = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 47 });
  const s = makeState([mini, cad]);
  expect(bulkPlan(s, 'simple').steps).toEqual([]);
  const all = bulkPlan(s, 'all');
  expect(all.steps).toHaveLength(1);
  expect(all.steps[0]).toMatchObject({ manual: true, proposal: { type: 'C' } });
});

test('empreinte : change quand un membre change', () => {
  const a = member();
  const s = makeState([a, member()]);
  const f = stateFingerprint(s);
  expect(stateFingerprint(structuredClone(s))).toBe(f);
  const t = structuredClone(s);
  t.members[0]!.weighInKg = 52;
  expect(stateFingerprint(t)).not.toBe(f);
});

test('empreinte : change avec les réglages, la grille et les préférences', () => {
  const s = makeState([member(), member()]);
  const f = stateFingerprint(s);
  expect(stateFingerprint({ ...s, settings: { ...s.settings, weightGapMaxKg: { children: 3, adults: 5 } } })).not.toBe(f);
  const t = structuredClone(s);
  t.members[0]!.otherDisciplines = ['shido-boxing'];
  expect(stateFingerprint(t)).not.toBe(f);
  const g = structuredClone(s);
  g.grid.weightClasses[0]!.label = '-20';
  expect(stateFingerprint(g)).not.toBe(f);
});

test('clé d’une catégorie recalculée sur les membres présents', () => {
  const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const absent = member({ weightClassId: 'cadet:F:-54', presence: 'absent' });
  let s = makeState([a, b, absent]);
  const p = proposalsFor(s, detectCases(s).find((c) => c.registrationId === a.registrationId)!)[0]!;
  s = applyProposal(s, p);
  const host = s.categories.find((c) => c.id === b.categoryId)!;
  expect(host.key.weightClassIds).toEqual(['cadet:F:-47', 'cadet:F:-54']);
  // b devient absent : la clé ne garde que les présents (a seul, -47)
  s.members.find((m) => m.registrationId === b.registrationId)!.presence = 'absent';
  recompute(s, host);
  expect(host.key.weightClassIds).toEqual(['cadet:F:-47']);
});

test('classement automatique : ignore les cartes mises de côté', () => {
  const a = member({ weightClassId: 'cadet:F:-47' });
  const s = makeState([a, member({ weightClassId: 'cadet:F:-54' }), member({ weightClassId: 'cadet:F:-54' })]);
  expect(bulkPlan(s, 'all').steps.map((x) => x.proposal.caseId)).toEqual([`alone:${a.registrationId}`]);
  expect(bulkPlan({ ...s, setAside: [`alone:${a.registrationId}`] }, 'all').steps).toEqual([]);
});
