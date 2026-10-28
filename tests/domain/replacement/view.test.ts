import { expect, test } from 'vitest';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { manualProposal } from '../../../src/domain/replacement/manual.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import type { Member, Proposal, State } from '../../../src/domain/replacement/types.js';
import { moveView } from '../../../src/domain/replacement/view.js';
import { makeState, member } from './fixtures.js';

const caseProps = (s: State, id: string) => proposalsFor(s, detectCases(s).find((c) => c.id === id)!);

test('pesée hors catégorie vers une catégorie encore vide', () => {
  const girard = member({ label: 'GIRARD Emma', ageBandCode: 'minime', weightClassId: 'minime:F:-40', weighInKg: 41, presence: 'present' });
  const jade = member({ label: 'RICHARD Jade', ageBandCode: 'minime', weightClassId: 'minime:F:-40', weighInKg: 39, presence: 'present' });
  const s = makeState([girard, jade]);
  const p = caseProps(s, `weight_out:${girard.registrationId}`).find((x) => 'newKey' in x.target)!;
  const v = moveView(s, p);
  expect(v.why).toEqual({ kind: 'weight_out', weighInKg: 41, limitLabel: '-40', toleranceKg: 0.5 });
  expect(v).toMatchObject({ sex: 'F', fromCount: 2, fromRemaining: 1, opponents: [] });
  expect(v.from?.weightClassIds).toEqual(['minime:F:-40']);
  expect(v.to.weightClassIds).toEqual(['minime:F:-45']);
});

test('split de la démo : GARNIER Sacha vers ROUSSEAU Tom', () => {
  const rousseau = member({ label: 'ROUSSEAU Tom', sex: 'M', ageBandCode: 'minime', weightClassId: 'minime:M:-50', weighInKg: 45, presence: 'present' });
  const boys = [40, 39, 39].map((kg, i) => member({ label: i === 0 ? 'GARNIER Sacha' : `B${i}`, sex: 'M', ageBandCode: 'benjamin', weightClassId: 'benjamin:M:-40', weighInKg: kg, presence: 'present' }));
  const s = makeState([rousseau, ...boys]);
  const p = caseProps(s, `alone:${rousseau.registrationId}`).find((x) => x.registrationId === boys[0]!.registrationId)!;
  const v = moveView(s, p);
  expect(v.why).toEqual({ kind: 'split', forLabel: 'ROUSSEAU Tom', forCategoryLabel: 'Karaté · Jiyu · Minimes M · -50 kg', count: 1 });
  expect(v).toMatchObject({ sex: 'M', fromCount: 3, fromRemaining: 2, opponents: ['ROUSSEAU Tom'], gap: { kg: 5, max: 5 } });
  expect(v.from).toMatchObject({ ageBandCodes: ['benjamin'], weightClassIds: ['benjamin:M:-40'] });
  expect(v.to).toMatchObject({ ageBandCodes: ['benjamin', 'minime'], weightClassIds: ['benjamin:M:-40', 'minime:M:-50'] });
  expect(v.details.map((d) => d.rule)).toEqual(['split', 'ageUp']);
});

test('déplacement manuel : « choisi à la main »', () => {
  const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const s = makeState([a, b]);
  const r = manualProposal(s, a.registrationId, b.categoryId!);
  if ('error' in r) throw new Error(r.error);
  const v = moveView(s, r.p);
  expect(v.why).toEqual({ kind: 'manual' });
  expect(v.opponents).toEqual([b.label]);
});

test('retour et catégorie fermée', () => {
  const a = member({ weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-boxing'] });
  const c = member({ weightClassId: 'cadet:F:-54', discipline: 'shido-boxing' });
  const d = member({ weightClassId: 'cadet:F:-54', discipline: 'shido-boxing' });
  const s = makeState([a, c, d], { closedEntries: ['cadet|F|karate|jiyu'] });
  const closed = caseProps(s, `closed:${a.registrationId}`)[0]!;
  expect(moveView(s, closed).why).toEqual({ kind: 'closed' });
  const back: Proposal = { ...closed, id: `R:${a.registrationId}`, caseId: `return:${a.registrationId}`, type: 'R' };
  expect(moveView(s, back).why).toEqual({ kind: 'return' });
});

test('kata : pas d’écart de poids', () => {
  const kata = (over: Partial<Member> = {}) => member({ discipline: 'kata', ruleset: null, weightClassId: null, ...over });
  const a = kata({ ageBandCode: 'cadet' });
  const b = kata({ ageBandCode: 'junior' });
  const s = makeState([a, b]);
  const r = manualProposal(s, a.registrationId, b.categoryId!);
  if ('error' in r) throw new Error(r.error);
  expect(moveView(s, r.p).gap).toBeNull();
});
