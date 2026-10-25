import { describe, expect, test } from 'vitest';
import { ageMove } from '../../../src/domain/ages.js';
import { seededRandom } from '../../../src/domain/brackets/seeding.js';
import { DISCIPLINES } from '../../../src/domain/disciplines.js';
import { weightClassesFor } from '../../../src/domain/grid.js';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { moveViolations, proposalsFor } from '../../../src/domain/replacement/propose.js';
import { defaultSettings } from '../../../src/domain/settings.js';
import { applyAll, applyProposal, bulkPlan } from '../../../src/domain/replacement/apply.js';
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
  test('détail du cas « seul » accordé au sexe du combattant', () => {
    const girl = member({ weightClassId: 'cadet:F:-47' });
    const boy = member({ sex: 'M', ageBandCode: 'cadet', weightClassId: 'cadet:M:-63' });
    const s = makeState([girl, boy]);
    expect(caseOf(s, girl.registrationId).detail).toBe('Seule dans sa catégorie');
    expect(caseOf(s, boy.registrationId).detail).toBe('Seul dans sa catégorie');
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
      const s = makeState([shobu, jiyu, box, mix], { settings: { ...defaultSettings(), shobuToJiyu: true } });
      return props(s, shobu.registrationId).map((p) => [p.type, p.changes.discipline ?? p.changes.ruleset]);
    };
    expect(mk(true)).toEqual([['G', 'jiyu'], ['H', 'shido-mix'], ['H', 'shido-boxing']]);
    expect(mk(false)).toEqual([['H', 'shido-mix'], ['H', 'shido-boxing'], ['G', 'jiyu']]);
  });
  test('G seulement si le passage shobu → jiyu est autorisé dans les réglages', () => {
    const shobu = member({ ageBandCode: 'senior', sex: 'M', ruleset: 'shobu', weightClassId: 'senior:M:-75', approxWeightKg: 74, acceptsJiyuFirst: true });
    const jiyu = member({ ageBandCode: 'senior', sex: 'M', ruleset: 'jiyu', weightClassId: 'senior:M:-75', approxWeightKg: 74 });
    const off = makeState([shobu, jiyu]);
    expect(props(off, shobu.registrationId)).toEqual([]);
    const target = off.categories.find((c) => c.id === jiyu.categoryId)!;
    expect(moveViolations(off, shobu, target)).toContain('Passage de shobu à jiyu non autorisé (réglages).');
    const on = { ...off, settings: { ...off.settings, shobuToJiyu: true } };
    expect(props(on, shobu.registrationId).map((p) => p.type)).toEqual(['G']);
    expect(moveViolations(on, shobu, target)).toEqual([]);
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
        expect(key.ageBandCodes.some((b) => [ageMove(s.grid, m.ageBandCode, b).kind, ageMove(s.grid, b, m.ageBandCode).kind].some((k) => k === 'C' || k === 'D'))).toBe(true);
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

test('catégorie d’une session lancée (frozen) : ni cas ni cible', () => {
  const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const s = makeState([a, b]);
  expect(props(s, a.registrationId)).toHaveLength(1);
  s.categories.find((c) => c.id === b.categoryId)!.frozen = true;
  expect(props(s, a.registrationId)).toEqual([]);
  expect(detectCases(s).some((c) => c.registrationId === b.registrationId)).toBe(false);
});


describe('déplacement manuel : âge', () => {
  test('deux tranches voisines dans les deux sens sans avertissement ; la tranche au-dessous est aussi proposée', () => {
    const benj = member({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-30', approxWeightKg: 29 });
    const p1 = member({ ageBandCode: 'pupille', weightClassId: 'pupille:F:-30', approxWeightKg: 28 });
    const p2 = member({ ageBandCode: 'pupille', weightClassId: 'pupille:F:-30', approxWeightKg: 28 });
    const s = makeState([benj, p1, p2]);
    const pupilles = s.categories.find((c) => c.id === p1.categoryId)!;
    expect(moveViolations(s, benj, pupilles)).toEqual([]);
    expect(props(s, benj.registrationId).some((p) => 'categoryId' in p.target && p.target.categoryId === pupilles.id)).toBe(true);
  });
  test('messages : plus d’une tranche, mineurs / adultes', () => {
    const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-35', approxWeightKg: 30 });
    const pup = member({ ageBandCode: 'pupille', weightClassId: 'pupille:F:-30', approxWeightKg: 28 });
    const jun = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: 52 });
    const sen = member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: 53 });
    const s = makeState([mini, pup, jun, sen]);
    const cat = (m: Member) => s.categories.find((c) => c.id === m.categoryId)!;
    expect(moveViolations(s, mini, cat(pup))).toContain("Écart d'âge de plus d'une tranche.");
    expect(moveViolations(s, sen, cat(jun))).toContain('Mélange mineurs / adultes non autorisé (réglages).');
    expect(moveViolations(s, sen, cat(jun))).not.toContain("Écart d'âge de plus d'une tranche.");
  });
});

describe('split : le combattant seul reçoit les plus lourds de la catégorie du dessous', () => {
  const sen = (kg: number, wc = 'senior:M:-84') => member({ ageBandCode: 'senior', sex: 'M', weightClassId: wc, approxWeightKg: kg });
  test('poule de 3 d’abord, puis un seul adversaire ; jamais en cas simple', () => {
    const alone = sen(85, 'senior:M:+84');
    const below = [sen(72), sen(78), sen(83), sen(84)];
    const s = makeState([alone, ...below]);
    const pulls = props(s, alone.registrationId).filter((p) => p.registrationId !== alone.registrationId);
    expect(pulls.map((p) => [p.type, [p.registrationId, ...(p.alsoMoved ?? [])]])).toEqual([
      ['A', [below[3]!.registrationId, below[2]!.registrationId]],
      ['A', [below[3]!.registrationId]],
    ]);
    expect(pulls.every((p) => !p.manual && p.rules.join() === 'split' && p.target && 'categoryId' in p.target && p.target.categoryId === alone.categoryId)).toBe(true);
    expect(pulls[0]!.reason).toContain('pour donner une poule');
    // Le déplacement du combattant seul lui-même (écart 13 kg, B) passe après.
    expect(props(s, alone.registrationId).at(-1)).toMatchObject({ type: 'B', registrationId: alone.registrationId });

    const after = applyAll(s, pulls[0]!);
    expect(after.members.filter((m) => m.categoryId === alone.categoryId)).toHaveLength(3);
    expect(after.members.find((m) => m.registrationId === below[3]!.registrationId)!.original?.reason).toBe('pulled');
    expect(detectCases(after).some((c) => c.kind === 'alone' || c.kind === 'return')).toBe(false);
    expect(bulkPlan(s, 'simple').steps).toEqual([]);
    expect(bulkPlan(s, 'all').steps.map((x) => x.proposal.registrationId)).toEqual([alone.registrationId]);
  });
  test('il en reste au moins deux dans la catégorie du dessous ; jamais vers le bas', () => {
    const alone = sen(85, 'senior:M:+84');
    const s = makeState([alone, sen(83), sen(84)]);
    expect(props(s, alone.registrationId).some((p) => p.registrationId !== alone.registrationId)).toBe(false);
    const light = sen(74, 'senior:M:-75');
    const s2 = makeState([light, sen(76), sen(77), sen(80)]);
    expect(props(s2, light.registrationId).some((p) => p.registrationId !== light.registrationId)).toBe(false);
    const alone3 = sen(85, 'senior:M:+84');
    const s3 = makeState([alone3, sen(83), sen(84), sen(84)]);
    expect(props(s3, alone3.registrationId).filter((p) => p.registrationId !== alone3.registrationId).map((p) => 1 + (p.alsoMoved?.length ?? 0))).toEqual([1]);
  });
});

describe('poids hors catégorie : catégorie du poids réel vide', () => {
  test('aussi les catégories existantes où il aurait un adversaire (en premier) ; « il y sera seul » en dernier', () => {
    const boy = (over: Partial<Member>) => member({ sex: 'M', ageBandCode: 'benjamin', weightClassId: 'benjamin:M:-40', approxWeightKg: 38, ...over });
    const garnier = boy({ weighInKg: 41, presence: 'present' });
    const others = [boy({}), boy({}), boy({})];
    const rousseau = member({ sex: 'M', ageBandCode: 'minime', weightClassId: 'minime:M:-50', weighInKg: 45, presence: 'present' });
    const s = makeState([garnier, ...others, rousseau]);
    expect(caseOf(s, garnier.registrationId).detail).toBe('Pesé 41 kg : trop lourd pour -40 kg (tolérance 0,3 kg) — sa catégorie de poids est -45 kg');
    const ps = props(s, garnier.registrationId);
    expect(ps.map((p) => p.type)).toEqual(['C', 'A']);
    expect(ps[0]).toMatchObject({ target: { categoryId: rousseau.categoryId }, changes: { weightClassId: 'benjamin:M:-45' }, manual: true });
    expect(ps[0]!.reason).toBe(`${garnier.label} : Karaté · Jiyu · Benjamins M · -40 kg → Karaté · Jiyu · Benjamins / Minimes M · -45 / -50 kg (1 adversaire) — lui en -45 kg, la catégorie de son poids réel`);
    expect(ps[1]!.reason).toBe(`${garnier.label} : Karaté · Jiyu · Benjamins M · -40 kg → Karaté · Jiyu · Benjamins M · -45 kg — il y sera seul (sans adversaire), à réaffecter ensuite`);
    // Validée, la proposition C le met avec ROUSSEAU, en -45 ; il ne « revient » pas en -40.
    const after = applyProposal(s, ps[0]!);
    const g = after.members.find((m) => m.registrationId === garnier.registrationId)!;
    expect(g).toMatchObject({ categoryId: rousseau.categoryId, weightClassId: 'benjamin:M:-45' });
    expect(detectCases(after).filter((c) => c.registrationId === garnier.registrationId)).toEqual([]);
  });
  test('jamais une catégorie trop légère pour son poids réel', () => {
    const garnier = member({ sex: 'M', ageBandCode: 'benjamin', weightClassId: 'benjamin:M:-40', weighInKg: 41, presence: 'present' });
    const light = member({ sex: 'M', ageBandCode: 'minime', weightClassId: 'minime:M:-40', weighInKg: 39, presence: 'present' });
    const ps = props(makeState([garnier, light]), garnier.registrationId);
    expect(ps.some((p) => 'categoryId' in p.target && p.target.categoryId === light.categoryId)).toBe(false);
  });
});

describe('règles des propositions', () => {
  const withOff = (off: ('ageDown' | 'weight' | 'weightGap')[]): Partial<State> => {
    const settings = defaultSettings();
    settings.replacementRules = { ...settings.replacementRules, off };
    return { settings };
  };
  const minimeAndBenjamines = () => {
    const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
    const benj = [
      member({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', approxWeightKg: 37 }),
      member({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', approxWeightKg: 38 }),
    ];
    return { mini, benj };
  };
  const toCategory = (ps: Proposal[], id: string | null) => ps.find((x) => 'categoryId' in x.target && x.target.categoryId === id);

  test('tranche d’âge au-dessous : minime seule vers des benjamines dans l’écart', () => {
    const { mini, benj } = minimeAndBenjamines();
    const p = toCategory(props(makeState([mini, ...benj]), mini.registrationId), benj[0]!.categoryId)!;
    expect(p).toMatchObject({ type: 'C', manual: true, rules: ['ageDown'], checks: { ageDirections: ['down'] } });
  });
  test('interrupteur coupé : la règle n’est plus proposée sur les cartes', () => {
    const { mini, benj } = minimeAndBenjamines();
    const s = makeState([mini, ...benj], withOff(['ageDown']));
    expect(toCategory(props(s, mini.registrationId), benj[0]!.categoryId)).toBeUndefined();
    const fresh = (over: Partial<State>) => {
      const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
      const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
      return props(makeState([a, b], over), a.registrationId);
    };
    expect(fresh({}).some((p) => p.type === 'A')).toBe(true);
    expect(fresh(withOff(['weight'])).some((p) => p.type === 'A')).toBe(false);
  });
  test('split dans l’écart réglé : cas simple', () => {
    const sen = (kg: number, wc = 'senior:M:-84') => member({ ageBandCode: 'senior', sex: 'M', weightClassId: wc, approxWeightKg: kg });
    const alone = sen(85, 'senior:M:+84');
    const s = makeState([alone, sen(72), sen(78), sen(83), sen(84)]);
    const pulls = props(s, alone.registrationId).filter((p) => p.registrationId !== alone.registrationId);
    expect(pulls).toHaveLength(2);
    for (const p of pulls) expect(p).toMatchObject({ manual: false, rules: ['split'] });
  });
  test('correction de poids au-dessus de l’écart : à valider, jamais retirée', () => {
    for (const over of [[], ['weightGap' as const]]) {
      const a = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 53, weighInKg: 70, presence: 'present' });
      const b = member({ weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
      const c = member({ weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
      const lonely = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 40 });
      const s = makeState([a, b, c, lonely], withOff(over));
      expect(props(s, a.registrationId)[0]).toMatchObject({ type: 'A', rules: ['weightGap'], manual: true, target: { categoryId: b.categoryId } });
    }
  });
  test('plusieurs règles : autre discipline et tranche au-dessus', () => {
    const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39, otherDisciplines: ['shido-boxing'] });
    const cad = [
      member({ discipline: 'shido-boxing', ageBandCode: 'cadet', weightClassId: 'cadet:F:-47', approxWeightKg: 40 }),
      member({ discipline: 'shido-boxing', ageBandCode: 'cadet', weightClassId: 'cadet:F:-47', approxWeightKg: 41 }),
    ];
    const s = makeState([mini, ...cad]);
    const p = toCategory(props(s, mini.registrationId), cad[0]!.categoryId)!;
    expect(p.rules).toEqual(['discipline', 'ageUp']);
    expect(p.manual).toBe(true);
  });
  test('pré-accord : aussi pour la tranche au-dessous, jamais pour une discipline', () => {
    const { mini, benj } = minimeAndBenjamines();
    mini.clubPreApproval = true;
    expect(toCategory(props(makeState([mini, ...benj]), mini.registrationId), benj[0]!.categoryId)).toMatchObject({ preApproved: true });
    const d = member({ ageBandCode: 'cadet', weightClassId: 'cadet:F:-47', approxWeightKg: 40, otherDisciplines: ['shido-boxing'], clubPreApproval: true });
    const sb = [member({ discipline: 'shido-boxing', ageBandCode: 'cadet', weightClassId: 'cadet:F:-47', approxWeightKg: 40 }), member({ discipline: 'shido-boxing', ageBandCode: 'cadet', weightClassId: 'cadet:F:-47', approxWeightKg: 41 })];
    const p = toCategory(props(makeState([d, ...sb]), d.registrationId), sb[0]!.categoryId)!;
    expect(p).toMatchObject({ rules: ['discipline'], preApproved: false });
  });
});
