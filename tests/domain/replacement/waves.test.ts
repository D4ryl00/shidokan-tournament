import { describe, expect, test } from 'vitest';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import { applyProposal, stateFingerprint } from '../../../src/domain/replacement/apply.js';
import { computePlan } from '../../../src/domain/replacement/plan.js';
import { casesOfWave, categoryWave, mayMoveOthers, memberWave, waveEffects, waveMoves } from '../../../src/domain/replacement/waves.js';
import type { Move } from '../../../src/domain/replacement/move.js';
import type { Member, State } from '../../../src/domain/replacement/types.js';
import { WAVE_NONE, type Wave } from '../../../src/domain/waves.js';
import { naturalKey } from '../../../src/domain/categories.js';
import { weightClassesFor } from '../../../src/domain/grid.js';
import { makeState, member } from './fixtures.js';
import { randomState } from './random-state.js';

const matin: Wave = { id: 'matin', name: 'Matin', order: 0, rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] }, weighInClosed: false };
const aprem: Wave = { id: 'aprem', name: 'Après-midi', order: 1, rules: { ageBandCodes: ['cadet', 'junior', 'espoir', 'senior'], disciplines: [] }, weighInClosed: false };
const waves = [matin, aprem];

const caseOf = (s: State, regId: string) => detectCases(s).find((c) => c.registrationId === regId)!;
const props = (s: State, regId: string) => proposalsFor(s, caseOf(s, regId));
const planOf = (s: State, waveId: string | null = null, forApply = false) => computePlan(s, { waveId, level: 'minorsAdults', choices: [], ...(forApply ? { forApply: true } : {}) });

/** Minime seule (Matin) dont la seule proposition est la catégorie cadette (Après-midi). */
function minimeAlone(over: Partial<State> = {}) {
  const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45, clubPreApproval: true });
  const c1 = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const c2 = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  return { mini, cadet: c1, s: makeState([mini, c1, c2], { waves, ...over }) };
}

describe('réaffectation par session', () => {
  test('sans session : waveChange toujours null', () => {
    const { s } = minimeAlone({ waves: [] });
    const all = detectCases(s).flatMap((c) => proposalsFor(s, c));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => p.waveChange === null)).toBe(true);
  });

  test('proposition vers une catégorie d’une autre session : waveChange { from: matin, to: aprem }, preApproved faux', () => {
    const { s, mini, cadet } = minimeAlone();
    const [p] = props(s, mini.registrationId);
    expect(p).toMatchObject({ type: 'C', target: { categoryId: cadet.categoryId }, waveChange: { from: 'matin', to: 'aprem' }, preApproved: false });
    // Sans vague, la même proposition est pré-approuvée (club en pré-accord).
    const [q] = props({ ...s, waves: [] }, mini.registrationId);
    expect(q).toMatchObject({ type: 'C', preApproved: true, waveChange: null });
  });

  test('même session : waveChange null', () => {
    const a = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const b = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    const s = makeState([a, b], { waves });
    expect(props(s, a.registrationId)[0]).toMatchObject({ type: 'A', waveChange: null });
  });

  test('catégorie en attente : waveChange vers ou depuis null', () => {
    // Catégorie cadette mise en attente à la main : du Matin vers aucune session.
    const { s, mini, cadet } = minimeAlone();
    s.categories.find((c) => c.id === cadet.categoryId)!.waveOverride = WAVE_NONE;
    expect(props(s, mini.registrationId)[0]!.waveChange).toEqual({ from: 'matin', to: null });
    // Aucune session ne prend les minimes : la minime ne vote pas, les cadettes gardent l'Après-midi.
    const t = minimeAlone({ waves: [aprem] });
    expect(props(t.s, t.mini.registrationId)[0]!.waveChange).toEqual({ from: null, to: 'aprem' });
    // Aucune session ne prend les cadettes : seule la minime vote, la catégorie l'emmène au Matin avec les cadettes.
    const u = minimeAlone({ waves: [matin] });
    const q = props(u.s, u.mini.registrationId)[0]!;
    expect(q.waveChange).toBeNull();
    const cadettes = u.s.members.filter((m) => m.categoryId === u.cadet.categoryId).map((m) => m.registrationId);
    expect(q.waveShifts.map((x) => [x.registrationId, x.from, x.to])).toEqual(cadettes.map((id) => [id, null, 'matin']));
  });

  test('catégorie d’arrivée fusionnée : garde sa session', () => {
    const { s, mini, cadet } = minimeAlone();
    const after = applyProposal(s, props(s, mini.registrationId)[0]!);
    const merged = after.categories.find((c) => c.id === cadet.categoryId)!;
    expect(merged.key.ageBandCodes).toEqual(['cadet', 'minime']);
    expect(categoryWave(after, merged)).toBe('aprem');
    expect(memberWave(after, after.members.find((m) => m.registrationId === mini.registrationId)!)).toBe('aprem');
  });

  test('validation globale « tout » : pas de changement de session', () => {
    const { s, mini } = minimeAlone();
    const plan = planOf(s);
    expect(plan.moves).toEqual([]);
    expect(plan.aloneAfter).toEqual([mini.registrationId]);

    // Une autre catégorie cadette, choisie à la main pour le Matin : c'est elle qui est prise.
    const far = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
    const far2 = member({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
    const s2 = makeState([...s.members, far, far2], { waves, categories: s.categories });
    const farCat = s2.categories.find((c) => c.id === far.categoryId)!;
    farCat.waveOverride = 'matin';
    const ps = props(s2, mini.registrationId);
    expect(ps.map((p) => p.waveChange?.to ?? 'matin')).toEqual(['aprem', 'matin']);
    const plan2 = planOf(s2);
    expect(plan2.moves.map((x) => [x.registrationId, (x.target as { categoryId: string }).categoryId])).toEqual([[mini.registrationId, farCat.id]]);
  });

  test('validation globale limitée à la session', () => {
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
    const plan = planOf(s, 'aprem');
    expect(plan.moves.map((x) => x.registrationId)).toEqual([c1.registrationId]);
    expect(planOf(s).moves.map((x) => x.registrationId).sort()).toEqual([c1.registrationId, p1.registrationId].sort());
  });

  test('empreinte : change si une règle de session ou un choix individuel change', () => {
    const { s, cadet } = minimeAlone();
    const base = stateFingerprint(s);
    expect(stateFingerprint({ ...s, waves: [matin, { ...aprem, rules: { ...aprem.rules, ageBandCodes: ['cadet'] } }] })).not.toBe(base);
    const s2 = structuredClone(s);
    s2.categories.find((c) => c.id === cadet.categoryId)!.waveOverride = 'matin';
    expect(stateFingerprint(s2)).not.toBe(base);
  });

  test('changement de session entraîné : la catégorie qui perd sa majorité change de session avec ses autres combattants', () => {
    const { mini, cadet, s: s0 } = minimeAlone();
    // Une troisième cadette dans la catégorie de la cible.
    const c0 = member({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const s = makeState([...s0.members, c0], { waves, categories: s0.categories });
    const s1 = applyProposal(s, props(s, mini.registrationId)[0]!);
    // Trois cadettes et une minime recasée : la majorité garde l'Après-midi.
    expect(categoryWave(s1, s1.categories.find((c) => c.id === cadet.categoryId)!)).toBe('aprem');
    // Les trois cadettes pèsent 52 kg : hors catégorie, vers les -54.
    const [c1, c2, c3] = s1.members.filter((m) => m.categoryId === cadet.categoryId && m.registrationId !== mini.registrationId);
    for (const c of [c1!, c2!, c3!]) Object.assign(c, { weighInKg: 52, presence: 'present' });
    // Une cadette part : deux cadettes contre une minime, la catégorie garde l'Après-midi.
    const p0 = props(s1, c1!.registrationId)[0]!;
    expect(p0).toMatchObject({ type: 'A', waveChange: null, waveShifts: [] });
    const s2 = applyProposal(s1, p0);
    // Une deuxième part : une cadette contre une minime, l'égalité va à la tranche la plus jeune → la catégorie passe au
    // Matin et emmène la minime et l'autre cadette.
    const p1 = props(s2, c2!.registrationId)[0]!;
    const shifted = [{ registrationId: mini.registrationId, from: 'aprem', to: 'matin' }, { registrationId: c3!.registrationId, from: 'aprem', to: 'matin' }];
    expect(p1).toMatchObject({ type: 'A', waveChange: null, preApproved: false, waveShifts: shifted.map((x, i) => ({ ...x, label: [mini.label, c3!.label][i] })) });
    expect(waveMoves(s2, applyProposal(s2, p1))).toEqual(shifted);
    const s3 = applyProposal(s2, p1);
    // La dernière cadette part à son tour : elle quitte le Matin, la minime y reste.
    const p2 = props(s3, c3!.registrationId)[0]!;
    expect(p2).toMatchObject({ type: 'A', waveChange: { from: 'matin', to: 'aprem' }, waveShifts: [] });
    // La validation globale prend un premier départ, pas le suivant : il emmènerait d'autres combattants.
    expect(planOf(s1, 'aprem', true).moves.map((x) => x.registrationId)).toEqual([c1!.registrationId]);
  });
});

describe('bascules de session à la majorité', () => {
  const J: Wave = { id: 'J', name: 'Juniors', order: 0, rules: { ageBandCodes: ['junior'], disciplines: [] }, weighInClosed: false };
  const S: Wave = { id: 'S', name: 'Seniors', order: 1, rules: { ageBandCodes: ['senior'], disciplines: [] }, weighInClosed: false };
  const senior = (weightClassId = 'senior:F:-61') => member({ ageBandCode: 'senior', weightClassId });
  const junior = (weightClassId = 'junior:F:-59') => member({ ageBandCode: 'junior', weightClassId });
  const moveTo = (m: Member, categoryId: string): Move => ({ caseId: `alone:${m.registrationId}`, type: 'M', registrationId: m.registrationId, target: { categoryId }, changes: {} });
  const shifts = (e: ReturnType<typeof waveEffects>) => e.waveShifts.map((x) => [x.registrationId, x.from, x.to]);
  /** État où `guests` sont déjà recasés dans la catégorie de `host`. */
  function stateWith(members: Member[], host: Member, guests: Member[]): State {
    const s = makeState(members, { waves: [J, S] });
    for (const g of guests) g.categoryId = host.categoryId;
    s.categories = s.categories.filter((c) => s.members.some((m) => m.categoryId === c.id));
    return s;
  }

  test('arrivée qui bascule : la catégorie d’arrivée change de session et emmène ses combattants', () => {
    // Un senior seul : le premier junior qui arrive fait égalité, la tranche la plus jeune l'emporte.
    const s0 = senior();
    const j0 = junior();
    const t = makeState([s0, j0], { waves: [J, S] });
    const e0 = waveEffects(t, moveTo(j0, s0.categoryId!));
    expect(e0.waveChange).toBeNull();
    expect(shifts(e0)).toEqual([[s0.registrationId, 'S', 'J']]);

    // Deux seniors : le premier junior ne change rien à la majorité, le second fait égalité et la catégorie bascule.
    const [s1, s2, j1, j2] = [senior(), senior(), junior(), junior()];
    const s = makeState([s1, s2, j1, j2], { waves: [J, S] });
    const first = moveTo(j1, s1.categoryId!);
    expect(waveEffects(s, first)).toEqual({ waveChange: { from: 'J', to: 'S' }, waveShifts: [] });
    const after = applyProposal(s, first);
    const e = waveEffects(after, moveTo(j2, s1.categoryId!));
    expect(e.waveChange).toBeNull();
    expect(shifts(e)).toEqual([[s1.registrationId, 'S', 'J'], [s2.registrationId, 'S', 'J'], [j1.registrationId, 'S', 'J']]);
  });

  test('départ qui bascule : la catégorie de départ perd sa majorité et emmène ses autres combattants', () => {
    // Deux seniors et une junior (session S) ; un senior part vers une autre catégorie senior.
    const [s1, s2, j1, s3] = [senior(), senior(), junior(), senior('senior:F:-68')];
    const s = stateWith([s1, s2, j1, s3], s1, [j1]);
    expect(categoryWave(s, s.categories.find((c) => c.id === s1.categoryId)!)).toBe('S');
    const p = moveTo(s1, s3.categoryId!);
    expect(mayMoveOthers(s, s1, p)).toBe(true);
    const e = waveEffects(s, p);
    expect(e.waveChange).toBeNull();
    expect(shifts(e)).toEqual([[s2.registrationId, 'S', 'J'], [j1.registrationId, 'S', 'J']]);
  });

  test('départ sans bascule : la majorité ne change pas', () => {
    // Deux juniors et un senior (session J) ; un junior part, il reste un contre un : toujours J.
    const [j1, j2, s1, j3] = [junior(), junior(), senior(), junior('junior:F:-66')];
    const s = stateWith([j1, j2, s1, j3], j1, [s1]);
    const p = moveTo(j1, j3.categoryId!);
    expect(waveEffects(s, p)).toEqual({ waveChange: null, waveShifts: [] });
  });

  test('figée : pas de bascule', () => {
    const [s1, s2, j1, j2] = [senior(), senior(), junior(), junior()];
    const s = makeState([s1, s2, j1, j2], { waves: [J, S] });
    s.categories.find((c) => c.id === s1.categoryId)!.frozenWave = 'S';
    const after = applyProposal(s, moveTo(j1, s1.categoryId!));
    const p = moveTo(j2, s1.categoryId!);
    expect(mayMoveOthers(after, j2, p)).toBe(false);
    expect(waveEffects(after, p)).toEqual({ waveChange: { from: 'J', to: 'S' }, waveShifts: [] });
    // Session figée d'une session supprimée : sans effet, la catégorie bascule.
    after.categories.find((c) => c.id === s1.categoryId)!.frozenWave = 'disparue';
    expect(shifts(waveEffects(after, p))).toHaveLength(3);
  });

  test('pas d’applyProposal sans bascule : le filtre écarte un déplacement qui ne change aucune majorité', () => {
    // Départ : deux juniors et un senior (J) → un junior et un senior (J). Arrivée : un junior (J) → deux juniors (J).
    const [j1, j2, s1, j3] = [junior(), junior(), senior(), junior('junior:F:-66')];
    const s = stateWith([j1, j2, s1, j3], j1, [s1]);
    expect(mayMoveOthers(s, j1, moveTo(j1, j3.categoryId!))).toBe(false);
    // Un senior seul (S) qui rejoint un junior seul (J) : l'arrivée fait égalité et reste J, le départ n'a personne.
    const [s4, j4] = [senior('senior:F:-55'), junior('junior:F:-53')];
    const t = makeState([s4, j4], { waves: [J, S] });
    expect(mayMoveOthers(t, s4, moveTo(s4, j4.categoryId!))).toBe(false);
    // Le junior qui rejoint le senior seul fait basculer la catégorie : il faut vérifier.
    expect(mayMoveOthers(t, j4, moveTo(j4, s4.categoryId!))).toBe(true);
  });
});

describe('sessions figées', () => {
  const J: Wave = { id: 'J', name: 'Juniors', order: 0, rules: { ageBandCodes: ['junior'], disciplines: [] }, weighInClosed: false };
  const S: Wave = { id: 'S', name: 'Seniors', order: 1, rules: { ageBandCodes: ['senior'], disciplines: [] }, weighInClosed: false };
  const moveTo = (m: Member, categoryId: string): Move => ({ caseId: `alone:${m.registrationId}`, type: 'M', registrationId: m.registrationId, target: { categoryId }, changes: {} });

  test('absents : ils votent avant le gel, plus après (catégorie non figée)', () => {
    // Deux juniors absentes et une senior dans une catégorie regroupée, non figée.
    const [s1, j1, j2] = [member({ ageBandCode: 'senior', weightClassId: 'senior:F:-61' }), member({ ageBandCode: 'junior', weightClassId: 'junior:F:-59', presence: 'absent' }), member({ ageBandCode: 'junior', weightClassId: 'junior:F:-59', presence: 'absent' })];
    const s = makeState([s1, j1, j2], { waves: [J, S] });
    j1.categoryId = s1.categoryId;
    j2.categoryId = s1.categoryId;
    s.categories = s.categories.filter((c) => c.id === s1.categoryId);
    const cat = s.categories[0]!;
    expect(categoryWave(s, cat)).toBe('J');
    const frozen = { ...s, sessionsFrozen: true };
    expect(categoryWave(frozen, cat)).toBe('S');
    expect(memberWave(frozen, j1)).toBe('S');
  });

  test('catégorie nouvelle simulée après le gel : figée à sa création, puis ne bouge plus', () => {
    const [s1, j1, j2] = [member({ ageBandCode: 'senior', weightClassId: 'senior:F:-61' }), member({ ageBandCode: 'junior', weightClassId: 'junior:F:-59' }), member({ ageBandCode: 'junior', weightClassId: 'junior:F:-59' })];
    const s = { ...makeState([s1, j1, j2], { waves: [J, S] }), sessionsFrozen: true };
    for (const c of s.categories) c.frozenWave = categoryWave(s, c) ?? WAVE_NONE;
    // Le senior part vers une catégorie qui n'existe pas encore (senior -68) : elle naît en S et y reste.
    const newKey = { discipline: 'karate' as const, ruleset: 'jiyu' as const, sex: 'F' as const, ageBandCodes: ['senior'], weightClassIds: ['senior:F:-68'] };
    const s2 = applyProposal(s, { caseId: `alone:${s1.registrationId}`, type: 'A', registrationId: s1.registrationId, target: { newKey }, changes: { weightClassId: 'senior:F:-68' } });
    const created = s2.categories.find((c) => c.id.startsWith('new:'))!;
    expect(created.frozenWave).toBe('S');
    // Deux juniors y arrivent : la majorité change, la session non.
    const s3 = applyProposal(applyProposal(s2, moveTo(j1, created.id)), moveTo(j2, created.id));
    expect(categoryWave(s3, s3.categories.find((c) => c.id === created.id)!)).toBe('S');
    // Sans gel, la catégorie nouvelle n'est pas figée.
    const loose = applyProposal({ ...s, sessionsFrozen: false }, { caseId: `alone:${s1.registrationId}`, type: 'A', registrationId: s1.registrationId, target: { newKey }, changes: { weightClassId: 'senior:F:-68' } });
    expect(loose.categories.find((c) => c.id.startsWith('new:'))!.frozenWave).toBeNull();
  });

  test('empreinte : change avec le gel et avec la session figée d’une catégorie', () => {
    const [s1] = [member({ ageBandCode: 'senior', weightClassId: 'senior:F:-61' })];
    const s = makeState([s1], { waves: [J, S] });
    const base = stateFingerprint(s);
    expect(stateFingerprint({ ...s, sessionsFrozen: true })).not.toBe(base);
    const s2 = structuredClone(s);
    s2.categories[0]!.frozenWave = 'S';
    expect(stateFingerprint(s2)).not.toBe(base);
  });
});

describe('mayMoveOthers reflète applyProposal (propriété bornée)', () => {
  const young: Wave = { id: 'jeunes', name: 'Jeunes', order: 0, rules: { ageBandCodes: ['benjamin', 'minime', 'cadet'], disciplines: [] }, weighInClosed: false };
  const adults: Wave = { id: 'adultes', name: 'Adultes', order: 1, rules: { ageBandCodes: ['junior', 'senior', 'v1'], disciplines: [] }, weighInClosed: false };
  const DISCIPLINES = ['karate', 'shido-boxing', 'shido-mix'] as const;

  /** Générateur reproductible (LCG). */
  const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

  /** État aléatoire, regroupé par quelques déplacements manuels (catégories à plusieurs tranches). */
  function grouped(frozen: boolean): State {
    const rnd = lcg(7);
    let s: State = { ...randomState(11, 90), waves: [young, adults], sessionsFrozen: frozen };
    for (let i = 0; i < 40; i++) {
      const m = s.members[Math.floor(rnd() * s.members.length)]!;
      const c = s.categories[Math.floor(rnd() * s.categories.length)]!;
      if (c.id === m.categoryId) continue;
      s = applyProposal(s, { caseId: `alone:${m.registrationId}`, type: 'M', registrationId: m.registrationId, target: { categoryId: c.id }, changes: {} });
    }
    if (frozen) {
      // Une catégorie sur trois figée : sa session, l'autre, ou « en attente ».
      s = { ...s, categories: s.categories.map((c, i) => (i % 3 === 0 ? { ...c, frozenWave: [young.id, adults.id, WAVE_NONE][i % 9 / 3]! } : c)) };
    }
    return s;
  }

  /** Quelques centaines de déplacements candidats : M, R, corrections de poids sur place, nouvelles clés, changements de discipline. */
  function candidates(s: State): { m: Member; mv: Move }[] {
    const rnd = lcg(3);
    const out: { m: Member; mv: Move }[] = [];
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    for (let i = 0; i < 300; i++) {
      const m = pick(s.members);
      const base = { caseId: `alone:${m.registrationId}`, registrationId: m.registrationId };
      const kind = i % 5;
      if (kind === 0) out.push({ m, mv: { ...base, type: 'M', target: { categoryId: pick(s.categories).id }, changes: {} } });
      else if (kind === 1) out.push({ m, mv: { ...base, type: 'R', target: { categoryId: pick(s.categories).id }, changes: { discipline: m.discipline, ruleset: m.ruleset, weightClassId: m.weightClassId } } });
      else if (kind === 2 && m.categoryId) {
        const wc = pick(weightClassesFor(s.grid, m.ageBandCode, m.sex)).id;
        out.push({ m, mv: { ...base, type: 'A', target: { categoryId: m.categoryId }, changes: { weightClassId: wc } } });
      } else if (kind === 3) {
        const wc = pick(weightClassesFor(s.grid, m.ageBandCode, m.sex)).id;
        const key = naturalKey({ discipline: m.discipline, ruleset: m.ruleset, weightClassId: wc }, m);
        out.push({ m, mv: { ...base, type: 'A', target: { newKey: key }, changes: { weightClassId: wc } } });
      } else {
        const discipline = pick(DISCIPLINES.filter((d) => d !== m.discipline));
        const key = naturalKey({ discipline, ruleset: m.ruleset, weightClassId: m.weightClassId }, m);
        out.push({ m, mv: { ...base, type: 'B', target: rnd() < 0.5 ? { newKey: key } : { categoryId: pick(s.categories).id }, changes: { discipline } } });
      }
    }
    return out;
  }

  for (const frozen of [false, true]) {
    test(frozen ? 'sessions figées, catégories figées en partie' : 'sessions non figées', () => {
      const s = grouped(frozen);
      expect(s.categories.some((c) => c.key.ageBandCodes.length > 1)).toBe(true);
      let shifted = 0;
      for (const { m, mv } of candidates(s)) {
        const real = waveMoves(s, applyProposal(s, mv)).some((x) => x.registrationId !== mv.registrationId);
        if (real) shifted++;
        expect(mayMoveOthers(s, m, mv), `${mv.type} ${mv.registrationId} → ${JSON.stringify(mv.target)}`).toBe(real);
      }
      // Le jeu de déplacements contient des bascules réelles, sinon la propriété ne prouve rien.
      expect(shifted).toBeGreaterThan(0);
    });
  }
});
