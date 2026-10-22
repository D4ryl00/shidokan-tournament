import { describe, expect, test } from 'vitest';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import { applyProposal, bulkPlan, stateFingerprint } from '../../../src/domain/replacement/apply.js';
import { casesOfWave, categoryWave, memberWave, waveMoves } from '../../../src/domain/replacement/waves.js';
import type { State } from '../../../src/domain/replacement/types.js';
import type { Wave } from '../../../src/domain/waves.js';
import { makeState, member } from './fixtures.js';

const matin: Wave = { id: 'matin', name: 'Matin', order: 0, rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] }, weighInClosed: false };
const aprem: Wave = { id: 'aprem', name: 'Après-midi', order: 1, rules: { ageBandCodes: ['cadet', 'junior', 'espoir', 'senior'], disciplines: [] }, weighInClosed: false };
const waves = [matin, aprem];

const caseOf = (s: State, regId: string) => detectCases(s).find((c) => c.registrationId === regId)!;
const props = (s: State, regId: string) => proposalsFor(s, caseOf(s, regId));

/** Minime seule (Matin) dont la seule proposition est la catégorie cadette (Après-midi). */
function minimeAlone(over: Partial<State> = {}) {
  const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45, clubPreApproval: true });
  const c1 = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const c2 = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  return { mini, cadet: c1, s: makeState([mini, c1, c2], { waves, ...over }) };
}

describe('recasement par vague', () => {
  test('sans vague : waveChange toujours null', () => {
    const { s } = minimeAlone({ waves: [] });
    const all = detectCases(s).flatMap((c) => proposalsFor(s, c));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => p.waveChange === null)).toBe(true);
  });

  test('proposition vers une catégorie d’une autre vague : waveChange { from: matin, to: aprem }, preApproved faux', () => {
    const { s, mini, cadet } = minimeAlone();
    const [p] = props(s, mini.registrationId);
    expect(p).toMatchObject({ type: 'C', target: { categoryId: cadet.categoryId }, waveChange: { from: 'matin', to: 'aprem' }, preApproved: false });
    // Sans vague, la même proposition est pré-approuvée (club en pré-accord).
    const [q] = props({ ...s, waves: [] }, mini.registrationId);
    expect(q).toMatchObject({ type: 'C', preApproved: true, waveChange: null });
  });

  test('même vague : waveChange null', () => {
    const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    const s = makeState([a, b], { waves });
    expect(props(s, a.registrationId)[0]).toMatchObject({ type: 'A', waveChange: null });
  });

  test('catégorie en attente : waveChange vers ou depuis null', () => {
    const { s, mini } = minimeAlone({ waves: [matin] });
    expect(props(s, mini.registrationId)[0]!.waveChange).toEqual({ from: 'matin', to: null });
  });

  test('catégorie d’arrivée fusionnée : garde sa vague', () => {
    const { s, mini, cadet } = minimeAlone();
    const after = applyProposal(s, props(s, mini.registrationId)[0]!);
    const merged = after.categories.find((c) => c.id === cadet.categoryId)!;
    expect(merged.key.ageBandCodes).toEqual(['cadet', 'minime']);
    expect(categoryWave(after, merged)).toBe('aprem');
    expect(memberWave(after, after.members.find((m) => m.registrationId === mini.registrationId)!)).toBe('aprem');
  });

  test('validation globale « tout » : pas de changement de vague', () => {
    const { s, mini } = minimeAlone();
    const plan = bulkPlan(s, 'all');
    expect(plan.steps).toEqual([]);
    expect(plan.unresolved.map((c) => c.registrationId)).toEqual([mini.registrationId]);

    // Une autre catégorie cadette, choisie à la main pour le Matin : c'est elle qui est prise.
    const far = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
    const far2 = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
    const s2 = makeState([...s.members, far, far2], { waves, categories: s.categories });
    const farCat = s2.categories.find((c) => c.id === far.categoryId)!;
    farCat.waveOverride = 'matin';
    const ps = props(s2, mini.registrationId);
    expect(ps.map((p) => p.waveChange?.to ?? 'matin')).toEqual(['aprem', 'matin']);
    const plan2 = bulkPlan(s2, 'all');
    expect(plan2.steps.map((x) => [x.proposal.registrationId, (x.proposal.target as { categoryId: string }).categoryId])).toEqual([[mini.registrationId, farCat.id]]);
  });

  test('validation globale limitée à la vague', () => {
    const p1 = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 40 });
    const p2 = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 43 });
    const p3 = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 43 });
    const c1 = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const c2 = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    const c3 = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    const s = makeState([p1, p2, p3, c1, c2, c3], { waves });
    const cases = detectCases(s);
    expect(casesOfWave(s, cases, 'aprem').map((c) => c.registrationId)).toEqual([c1.registrationId]);
    expect(casesOfWave(s, cases, 'matin').map((c) => c.registrationId)).toEqual([p1.registrationId]);
    expect(casesOfWave(s, cases, null)).toEqual(cases);
    const plan = bulkPlan(s, 'all', 'aprem');
    expect(plan.steps.map((x) => x.proposal.registrationId)).toEqual([c1.registrationId]);
    expect(bulkPlan(s, 'all').steps.map((x) => x.proposal.registrationId).sort()).toEqual([c1.registrationId, p1.registrationId].sort());
  });

  test('empreinte : change si une règle de vague ou un choix individuel change', () => {
    const { s, cadet } = minimeAlone();
    const base = stateFingerprint(s);
    expect(stateFingerprint({ ...s, waves: [matin, { ...aprem, rules: { ...aprem.rules, ageBandCodes: ['cadet'] } }] })).not.toBe(base);
    const s2 = structuredClone(s);
    s2.categories.find((c) => c.id === cadet.categoryId)!.waveOverride = 'matin';
    expect(stateFingerprint(s2)).not.toBe(base);
  });

  test('changement de vague entraîné : la catégorie qui perd ses derniers combattants d’origine change de vague avec ses recasés', () => {
    const { s, mini, cadet } = minimeAlone();
    const s1 = applyProposal(s, props(s, mini.registrationId)[0]!);
    // Les deux cadettes d'origine pèsent 52 kg : hors catégorie, vers les -54.
    const [c1, c2] = s1.members.filter((m) => m.categoryId === cadet.categoryId && m.registrationId !== mini.registrationId);
    for (const c of [c1!, c2!]) Object.assign(c, { weighInKg: 52, presence: 'present' });
    const p1 = props(s1, c1!.registrationId)[0]!;
    expect(p1).toMatchObject({ type: 'A', waveChange: null, waveShifts: [] });
    const s2 = applyProposal(s1, p1);
    // La dernière cadette d'origine partie, la catégorie redevient « Minimes » : la minime repasse au Matin.
    const p2 = props(s2, c2!.registrationId)[0]!;
    expect(p2).toMatchObject({ type: 'A', waveChange: null, preApproved: false, waveShifts: [{ registrationId: mini.registrationId, label: mini.label, from: 'aprem', to: 'matin' }] });
    expect(waveMoves(s2, applyProposal(s2, p2))).toEqual([{ registrationId: mini.registrationId, from: 'aprem', to: 'matin' }]);
    // La validation globale ne la prend pas.
    expect(bulkPlan(s1, 'simple', 'aprem').steps.map((x) => x.proposal.registrationId)).toEqual([c1!.registrationId]);
  });
});
