import { describe, expect, test } from 'vitest';
import { ageMove } from '../../../src/domain/ages.js';
import { seededRandom } from '../../../src/domain/brackets/seeding.js';
import { DISCIPLINES } from '../../../src/domain/disciplines.js';
import { weightClassesFor } from '../../../src/domain/grid.js';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import { applyProposal, bulkPlan } from '../../../src/domain/replacement/apply.js';
import type { Member, Proposal, State } from '../../../src/domain/replacement/types.js';
import { makeState, member } from './fixtures.js';

const caseOf = (s: State, regId: string) => detectCases(s).find((c) => c.registrationId === regId)!;
const props = (s: State, regId: string) => proposalsFor(s, caseOf(s, regId));
const targetMembers = (s: State, p: Proposal) => ('categoryId' in p.target ? s.members.filter((m) => m.categoryId === (p.target as { categoryId: string }).categoryId) : []);

describe('détection', () => {
  test('seule, absente exclue, catégorie lancée ignorée', () => {
    const a = member({ weightClassId: 'cadet:F:-47' });
    const b = member({ weightClassId: 'cadet:F:-54' });
    const c = member({ weightClassId: 'cadet:F:-54', presence: 'absent' });
    const s = makeState([a, b, c]);
    const kinds = detectCases(s).map((x) => [x.kind, x.registrationId]);
    expect(kinds).toContainEqual(['alone', a.registrationId]);
    expect(kinds).toContainEqual(['alone', b.registrationId]);
    expect(kinds.some(([, r]) => r === c.registrationId)).toBe(false);
    s.categories.find((x) => x.id === a.categoryId)!.status = 'started';
    expect(detectCases(s).some((x) => x.registrationId === a.registrationId)).toBe(false);
  });
  test('poids hors catégorie → weight_out (prioritaire sur alone)', () => {
    const a = member({ weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
    const s = makeState([a]);
    expect(detectCases(s).filter((x) => x.registrationId === a.registrationId).map((x) => x.kind)).toEqual(['weight_out']);
  });
  test('écart trop grand dans une catégorie', () => {
    const ms = [member({ weightClassId: 'cadet:F:-61', approxWeightKg: 54.5 }), member({ weightClassId: 'cadet:F:-61', approxWeightKg: 61 }), member({ weightClassId: 'cadet:F:-61', approxWeightKg: 60 })];
    const s = makeState(ms);
    const gap = detectCases(s).filter((x) => x.kind === 'weight_gap');
    expect(gap.map((x) => x.registrationId)).toEqual([ms[0]!.registrationId]);
  });
});

describe('propositions', () => {
  test('A : -47 seule vers -54 seule (écart 4), cible à un membre en premier', () => {
    const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    const c1 = member({ weightClassId: 'cadet:F:-61', approxWeightKg: 50 });
    const c2 = member({ weightClassId: 'cadet:F:-61', approxWeightKg: 50 });
    const s = makeState([a, b, c1, c2]);
    const ps = props(s, a.registrationId);
    expect(ps[0]).toMatchObject({ type: 'A', manual: false, registrationId: a.registrationId, target: { categoryId: b.categoryId } });
    expect(ps[0]!.checks.weightGapKg).toBeCloseTo(4);
    expect(ps[0]!.reason).toContain('-47');
  });
  test('B : écart au-delà du seuil', () => {
    const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 44 });
    const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 53 });
    expect(props(makeState([a, b]), a.registrationId)[0]).toMatchObject({ type: 'B', manual: true });
  });
  test('C : minime vers cadette ; E seulement si mineurs/adultes autorisé ; D seulement si seniors/vétérans', () => {
    const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
    const cad = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 47 });
    expect(props(makeState([mini, cad]), mini.registrationId)[0]).toMatchObject({ type: 'C', manual: true, checks: { ageMove: 'C' } });

    const jun = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: 52 });
    const sen = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: 53 });
    const s1 = makeState([jun, sen]);
    expect(props(s1, jun.registrationId)).toEqual([]);
    const s2 = makeState([jun, sen].map((m) => ({ ...m, categoryId: null })), { settings: { ...s1.settings, mixMinorsAdults: true } });
    expect(props(s2, jun.registrationId)[0]).toMatchObject({ type: 'E', checks: { crossesMinorAdult: true } });

    const sen2 = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-61', approxWeightKg: 60 });
    const vet = member({ ageBandCode: 'v1', weightClassId: 'v1:F:-61', approxWeightKg: 60 });
    const s3 = makeState([sen2, vet]);
    expect(props(s3, sen2.registrationId)[0]).toMatchObject({ type: 'D' });
    const s4 = makeState([sen2, vet].map((m) => ({ ...m, categoryId: null })), { settings: { ...s3.settings, mixSeniorsVeterans: false } });
    expect(props(s4, sen2.registrationId)).toEqual([]);
  });
  test('F : mixité seulement si activée pour la tranche', () => {
    const f = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
    const m = member({ sex: 'M', weightClassId: 'cadet:M:-52', approxWeightKg: 51 });
    const s = makeState([f, m]);
    expect(props(s, f.registrationId)).toEqual([]);
    const s2 = makeState([f, m].map((x) => ({ ...x, categoryId: null })), { settings: { ...s.settings, mixSexes: { enabled: true, ageBandCodes: ['cadet'] } } });
    expect(props(s2, f.registrationId)[0]).toMatchObject({ type: 'F', checks: { mixedSex: true } });
  });
  test('G et H : ordre selon « jiyu en priorité » et les préférences', () => {
    const mk = (acceptsJiyuFirst: boolean) => {
      const shobu = member({ ageBandCode: 'senior', sex: 'M', ruleset: 'shobu', weightClassId: 'senior:M:-75', approxWeightKg: 74, acceptsJiyuFirst, otherDisciplines: ['shido-mix', 'shido-boxing'] });
      const jiyu = member({ ageBandCode: 'senior', sex: 'M', ruleset: 'jiyu', weightClassId: 'senior:M:-75', approxWeightKg: 74 });
      const box = member({ ageBandCode: 'senior', sex: 'M', ruleset: 'shobu', discipline: 'shido-boxing', weightClassId: 'senior:M:-75', approxWeightKg: 74 });
      const mix = member({ ageBandCode: 'senior', sex: 'M', ruleset: 'shobu', discipline: 'shido-mix', weightClassId: 'senior:M:-75', approxWeightKg: 74 });
      const s = makeState([shobu, jiyu, box, mix]);
      return props(s, shobu.registrationId).map((p) => [p.type, p.changes.discipline ?? p.changes.ruleset]);
    };
    expect(mk(true)).toEqual([['G', 'jiyu'], ['H', 'shido-mix'], ['H', 'shido-boxing']]);
    expect(mk(false)).toEqual([['H', 'shido-mix'], ['H', 'shido-boxing'], ['G', 'jiyu']]);
  });
  test('discipline hors préférences jamais proposée ; kata seul : ni G ni H', () => {
    const a = member({ otherDisciplines: [] });
    const box = member({ discipline: 'shido-boxing' });
    expect(props(makeState([a, box]), a.registrationId)).toEqual([]);
    const k = member({ discipline: 'kata', ruleset: null, weightClassId: null, ageBandCode: 'minime' });
    const kc = member({ discipline: 'kata', ruleset: null, weightClassId: null, ageBandCode: 'cadet' });
    const kp = props(makeState([k, kc]), k.registrationId);
    expect(kp.map((p) => p.type)).toEqual(['C']);
  });
  test('pré-accord sur B et C, pas sur A', () => {
    const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 44, clubPreApproval: true });
    const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 53 });
    expect(props(makeState([a, b]), a.registrationId)[0]).toMatchObject({ type: 'B', preApproved: true });
    const c = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46, clubPreApproval: true });
    const d = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    expect(props(makeState([c, d]), c.registrationId)[0]).toMatchObject({ type: 'A', preApproved: false });
  });
  test('weight_out → A vers la catégorie du poids réel', () => {
    const a = member({ weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
    const ps = props(makeState([a]), a.registrationId);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ type: 'A', changes: { weightClassId: 'cadet:F:-61' }, target: { newKey: { weightClassIds: ['cadet:F:-61'] } } });
  });
  test('return → R ; pas de R si la catégorie actuelle est lancée', () => {
    const moved = member({ weightClassId: 'cadet:F:-47', placementLocked: true, original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47' }, recasementType: 'A' });
    const host = member({ weightClassId: 'cadet:F:-54' });
    const s = makeState([host]);
    moved.categoryId = host.categoryId;
    const newcomer = member({ weightClassId: 'cadet:F:-47' });
    const s2 = makeState([host, newcomer], { categories: s.categories });
    s2.members.push(moved);
    const ret = detectCases(s2).find((c) => c.kind === 'return')!;
    expect(ret.registrationId).toBe(moved.registrationId);
    expect(proposalsFor(s2, ret)[0]).toMatchObject({ type: 'R', manual: false, target: { categoryId: newcomer.categoryId } });
    s2.categories.find((c) => c.id === host.categoryId)!.status = 'started';
    expect(detectCases(s2).some((c) => c.kind === 'return')).toBe(false);
  });
  test('proposition refusée : plus listée', () => {
    const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    const s = makeState([a, b]);
    const first = props(s, a.registrationId)[0]!;
    expect(props({ ...s, refused: [first.id] }, a.registrationId).some((p) => p.id === first.id)).toBe(false);
  });
});

test('contraintes absolues sur un état aléatoire', () => {
  const rand = seededRandom(1234);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const base = makeState([]);
  const settings = { ...base.settings, mixMinorsAdults: true, mixSexes: { enabled: true, ageBandCodes: ['cadet', 'junior'] } };
  const members: Member[] = [];
  for (let i = 0; i < 40; i++) {
    const age = pick(['minime', 'cadet', 'junior', 'senior', 'v1']);
    const sex = pick(['F', 'M'] as const);
    const discipline = pick(['karate', 'shido-boxing', 'shido-mix', 'kata'] as const);
    const band = base.grid.ageBands.find((b) => b.code === age)!;
    const ruleset = discipline === 'kata' ? null : band.isMinor ? 'jiyu' : pick(['jiyu', 'shobu'] as const);
    const classes = weightClassesFor(base.grid, age, sex);
    members.push(member({
      ageBandCode: age, sex, discipline, ruleset, weightClassId: discipline === 'kata' ? null : pick(classes).id,
      presence: pick(['unknown', 'present', 'absent'] as const), acceptsJiyuFirst: ruleset === 'shobu' ? rand() > 0.5 : null,
      otherDisciplines: discipline === 'kata' ? [] : (['karate', 'shido-boxing', 'shido-mix'] as const).filter((d) => d !== discipline && rand() > 0.5),
    }));
  }
  const s = makeState(members, { settings });
  let count = 0;
  for (const c of detectCases(s)) {
    const m = s.members.find((x) => x.registrationId === c.registrationId)!;
    expect(m.presence).not.toBe('absent');
    for (const p of proposalsFor(s, c)) {
      count++;
      const minor = s.grid.ageBands.find((b) => b.code === m.ageBandCode)!.isMinor;
      const target = 'categoryId' in p.target ? s.categories.find((x) => x.id === (p.target as { categoryId: string }).categoryId)! : null;
      const key = target ? target.key : (p.target as { newKey: typeof s.categories[number]['key'] }).newKey;
      const ruleset = p.changes.ruleset ?? key.ruleset;
      if (minor) expect(ruleset).not.toBe('shobu');
      if (m.ruleset === 'jiyu') expect(key.ruleset).not.toBe('shobu');
      if (!key.ageBandCodes.includes(m.ageBandCode)) {
        expect(key.ageBandCodes.some((b) => ['C', 'D'].includes(ageMove(s.grid, m.ageBandCode, b).kind))).toBe(true);
      }
      if (key.discipline !== m.discipline) {
        expect(m.otherDisciplines).toContain(key.discipline);
        expect(DISCIPLINES[key.discipline].inPreferences).toBe(true);
      }
      if (target) {
        expect(['started', 'finished']).not.toContain(target.status);
        expect(targetMembers(s, p).some((x) => x.presence !== 'absent')).toBe(true);
      }
    }
  }
  expect(count).toBeGreaterThan(0);
});

describe('corrections de la relecture (étape 5)', () => {
  test('jamais deux tranches d’écart, même via une catégorie déjà fusionnée', () => {
    const cad = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
    const jun = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: 53 });
    const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 50 });
    const s = makeState([cad, jun, mini]);
    // la cadette rejoint la junior (C) : catégorie [cadet, junior]
    const toJunior = props(s, cad.registrationId).find((p) => p.type === 'C')!;
    const merged = applyProposal(s, toJunior);
    const cases = detectCases(merged).filter((c) => c.registrationId === mini.registrationId);
    for (const c of cases) {
      for (const p of proposalsFor(merged, c)) {
        const target = merged.categories.find((x) => 'categoryId' in p.target && x.id === p.target.categoryId);
        expect(target?.key.ageBandCodes ?? []).not.toContain('junior');
      }
    }
  });
  test('pas de ping-pong : un écart de poids corrigé ne déclenche pas de retour', () => {
    const ms = [
      member({ weightClassId: 'cadet:F:-61', approxWeightKg: 53 }),
      member({ weightClassId: 'cadet:F:-61', approxWeightKg: 60 }),
      member({ weightClassId: 'cadet:F:-61', approxWeightKg: 61 }),
      member({ weightClassId: 'cadet:F:-54', approxWeightKg: 53 }),
    ];
    let s = makeState(ms);
    const gapCase = detectCases(s).find((c) => c.kind === 'weight_gap')!;
    s = applyProposal(s, proposalsFor(s, gapCase)[0]!);
    expect(detectCases(s).filter((c) => c.kind === 'return')).toEqual([]);
    expect(bulkPlan(s, 'simple').steps).toEqual([]);
  });
  test('un combattant plus léger que sa catégorie n’est pas « hors catégorie »', () => {
    const a = member({ weightClassId: 'cadet:F:-61', weighInKg: 50, presence: 'present' });
    const b = member({ weightClassId: 'cadet:F:-61', weighInKg: 60, presence: 'present' });
    expect(detectCases(makeState([a, b])).filter((c) => c.kind === 'weight_out')).toEqual([]);
  });
});

test('catégorie d’une vague lancée (frozen) : ni cas ni cible', () => {
  const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const s = makeState([a, b]);
  expect(props(s, a.registrationId)).toHaveLength(1);
  s.categories.find((c) => c.id === b.categoryId)!.frozen = true;
  expect(props(s, a.registrationId)).toEqual([]);
  expect(detectCases(s).some((c) => c.registrationId === b.registrationId)).toBe(false);
});

