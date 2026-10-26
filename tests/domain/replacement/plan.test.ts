import { expect, test } from 'vitest';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { manualProposal } from '../../../src/domain/replacement/manual.js';
import { aloneRegistrations, computePlan, planLadder, type PlanChoice, type PlanMove, type PlanOptions } from '../../../src/domain/replacement/plan.js';
import { cardByCardReplay, scoreOf } from '../../../src/domain/replacement/plan-search.js';
import { rulesForMove } from '../../../src/domain/replacement/propose.js';
import { allowedAt } from '../../../src/domain/replacement/rules.js';
import type { Member, State } from '../../../src/domain/replacement/types.js';
import type { RuleId } from '../../../src/domain/settings.js';
import type { Wave } from '../../../src/domain/waves.js';
import { makeState, member } from './fixtures.js';
import { randomState } from './random-state.js';

const kgM = (label: string, wc: string, kg: number) => member({ label, weightClassId: wc, approxWeightKg: kg });
const plan = (s: State, over: Partial<PlanOptions> = {}) => computePlan(s, { waveId: null, level: 'minorsAdults', choices: [], ...over });
const ids = (...ms: Member[]) => ms.map((m) => m.registrationId).sort();
const movedIds = (r: ReturnType<typeof plan>) => r.moves.flatMap((m) => [m.registrationId, ...(m.alsoMoved ?? [])]);

/** Minime seule ; deux cadettes en -47 : la seule solution est la tranche au-dessus. */
function ageUpOnly(over: Partial<State> = {}) {
  const mini = member({ label: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  const c1 = kgM('C1', 'cadet:F:-47', 46);
  const c2 = kgM('C2', 'cadet:F:-47', 46);
  return { mini, c1, c2, s: makeState([mini, c1, c2], over) };
}

test('mieux que carte par carte : Alice avec Bruno, Chloé avec Fanny', () => {
  const [a, b, c, f] = [kgM('A', 'cadet:F:-54', 52), kgM('B', 'cadet:F:-47', 47), kgM('C', 'cadet:F:-61', 56), kgM('F', 'cadet:F:+61', 60)];
  const s = makeState([a, b, c, f]);
  s.settings.replacementRules.off = ['weightGap'];
  const r = computePlan(s, { waveId: null, level: 'minorsAdults', choices: [] });
  expect([r.aloneBefore.length, r.aloneAfter, r.proven]).toEqual([4, [], true]);
  expect(r.moves).toHaveLength(2);
});

test('deux seuls voisins : un seul déplacement', () => {
  const a = kgM('A', 'cadet:F:-47', 46);
  const b = kgM('B', 'cadet:F:-54', 50);
  const r = plan(makeState([a, b]));
  expect(r.aloneBefore).toEqual(ids(a, b));
  expect(r.moves).toHaveLength(1);
  expect(r.moves[0]).toMatchObject({ rules: ['weight'], manual: false, validated: false, outside: null, band: 0 });
  expect(r.aloneAfter).toEqual([]);
  expect(r.proven).toBe(true);
});

test('jamais une règle inactive ni sous la ligne', () => {
  const { s, mini } = ageUpOnly();
  const r = plan(s);
  expect(r.moves.map((m) => [m.registrationId, m.rules])).toEqual([[mini.registrationId, ['ageUp']]]);
  expect(r.aloneAfter).toEqual([]);

  const off = structuredClone(s);
  off.settings.replacementRules.off = ['ageUp'];
  const r2 = plan(off);
  expect(r2.moves).toEqual([]);
  expect(r2.aloneAfter).toEqual([mini.registrationId]);

  const r3 = plan(s, { level: 'split' });
  expect(r3.moves).toEqual([]);
  expect(r3.aloneAfter).toEqual([mini.registrationId]);
});

test('à égalité de seuls, la règle la plus haute de la liste', () => {
  const x = kgM('X', 'cadet:F:-47', 46);
  const y1 = kgM('Y1', 'cadet:F:-54', 50);
  const y2 = kgM('Y2', 'cadet:F:-54', 50);
  const z1 = member({ label: 'Z1', ageBandCode: 'junior', weightClassId: 'junior:F:-48', approxWeightKg: 46 });
  const z2 = member({ label: 'Z2', ageBandCode: 'junior', weightClassId: 'junior:F:-48', approxWeightKg: 46 });
  const s = makeState([x, y1, y2, z1, z2]);
  const r = plan(s);
  expect(r.moves.map((m) => [m.registrationId, m.rules, m.target])).toEqual([[x.registrationId, ['weight'], { categoryId: y1.categoryId }]]);
  expect(r.moves[0]!.details).toEqual([{ rule: 'weight', detail: 'écart 4 kg' }]);

  const ageFirst = structuredClone(s);
  const order: RuleId[] = ['return', 'ageUp', ...s.settings.replacementRules.order.filter((o) => o !== 'return' && o !== 'ageUp')];
  ageFirst.settings.replacementRules.order = order;
  const r2 = plan(ageFirst);
  expect(r2.moves.map((m) => [m.registrationId, m.rules, m.target])).toEqual([[x.registrationId, ['ageUp'], { categoryId: z1.categoryId }]]);
  expect(r2.aloneAfter).toEqual([]);
});

test('retour toujours inclus ; correction de poids toujours incluse', () => {
  // R, déplacée parce qu'elle était seule en -47 : deux cadettes en -47 l'attendent, et elle est bien en -54 (aucun gain).
  const h1 = kgM('H1', 'cadet:F:-47', 45);
  const h2 = kgM('H2', 'cadet:F:-47', 46);
  const back = member({
    label: 'R', weightClassId: 'cadet:F:-54', approxWeightKg: 47, placementLocked: true, recasementType: 'A',
    original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47', reason: 'alone' },
  });
  const p1 = kgM('P1', 'cadet:F:-54', 50);
  const p2 = kgM('P2', 'cadet:F:-54', 51);
  const s = makeState([h1, h2, back, p1, p2]);
  expect(detectCases(s).map((c) => c.id)).toEqual([`return:${back.registrationId}`]);
  const r = plan(s);
  expect(r.moves.map((m) => [m.type, m.registrationId, m.target])).toEqual([['R', back.registrationId, { categoryId: h1.categoryId }]]);
  expect(r.moves[0]).toMatchObject({ rules: ['return'], costRule: 'return', band: 0 });
  expect(r.aloneAfter).toEqual([]);

  // W, pesée 58 kg en -54 : sa correction vers -61 ne change pas le nombre de seuls, elle est faite quand même.
  const w = member({ label: 'W', weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
  const q1 = kgM('Q1', 'cadet:F:-54', 55);
  const q2 = kgM('Q2', 'cadet:F:-54', 55);
  const s1 = kgM('S1', 'cadet:F:-61', 58);
  const s2 = kgM('S2', 'cadet:F:-61', 59);
  const t = makeState([w, q1, q2, s1, s2]);
  const r2 = plan(t);
  expect(r2.moves.map((m) => [m.type, m.registrationId, m.changes, m.target])).toEqual([
    ['A', w.registrationId, { weightClassId: 'cadet:F:-61' }, { categoryId: s1.categoryId }],
  ]);
  expect(r2.moves[0]).toMatchObject({ rules: [], costRule: null, manual: false });
  expect([r2.aloneAfter, r2.onCards]).toEqual([[], []]);
});

test('correction impossible : sur sa carte, pas comptée seule', () => {
  // La catégorie de son poids réel (-61) est lancée : la correction est impossible.
  const w = member({ label: 'W', weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
  const s1 = kgM('S1', 'cadet:F:-61', 58);
  const s2 = kgM('S2', 'cadet:F:-61', 59);
  const s = makeState([w, s1, s2]);
  s.categories.find((c) => c.id === s1.categoryId)!.status = 'started';
  const r = plan(s);
  expect(r.moves).toEqual([]);
  expect(r.onCards).toEqual([w.registrationId]);
  expect(r.aloneBefore).toEqual([w.registrationId]);
  expect(r.aloneAfter).toEqual([]);
  expect(r.proven).toBe(true);
});

test('laissé seul en route : replacé', () => {
  // W (pesée 58) part en -61 : Y reste seule en -54, et rejoint les -47.
  const w = member({ label: 'W', weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
  const y = kgM('Y', 'cadet:F:-54', 53);
  const s1 = kgM('S1', 'cadet:F:-61', 60);
  const s2 = kgM('S2', 'cadet:F:-61', 61);
  const b1 = kgM('B1', 'cadet:F:-47', 48.5);
  const b2 = kgM('B2', 'cadet:F:-47', 49);
  const s = makeState([w, y, s1, s2, b1, b2]);
  expect(detectCases(s).map((c) => c.id)).toEqual([`weight_out:${w.registrationId}`]);
  const r = plan(s);
  expect(r.moves.map((m) => [m.registrationId, m.target])).toEqual([
    [w.registrationId, { categoryId: s1.categoryId }],
    [y.registrationId, { categoryId: b1.categoryId }],
  ]);
  expect([r.aloneBefore, r.aloneAfter]).toEqual([[], []]);
  expect(r.moves[1]!.fromCategoryId).toBe(w.categoryId);
});

test('cartes mises de côté, changement de session : hors du plan', () => {
  const a = kgM('A', 'cadet:F:-47', 46);
  const b = kgM('B', 'cadet:F:-54', 50);
  const s = makeState([a, b], { setAside: [`alone:${a.registrationId}`] });
  // A est mise de côté : elle ne bouge pas, mais B peut la rejoindre.
  expect(plan(s).moves.map((m) => [m.registrationId, m.target])).toEqual([[b.registrationId, { categoryId: a.categoryId }]]);
  const both = { ...s, setAside: [`alone:${a.registrationId}`, `alone:${b.registrationId}`] };
  const r = plan(both);
  expect([r.moves, r.aloneAfter]).toEqual([[], ids(a, b)]);

  // La minime n'a qu'une solution, dans une catégorie de l'après-midi : hors du plan.
  const matin: Wave = { id: 'matin', name: 'Matin', order: 0, rules: { ageBandCodes: ['minime'], disciplines: [] }, weighInClosed: false };
  const aprem: Wave = { id: 'aprem', name: 'Après-midi', order: 1, rules: { ageBandCodes: ['cadet'], disciplines: [] }, weighInClosed: false };
  const { s: w, mini } = ageUpOnly({ waves: [matin, aprem] });
  for (const waveId of [null, 'matin']) {
    const r2 = plan(w, { waveId });
    expect(r2.moves).toEqual([]);
    expect(r2.aloneAfter).toEqual([mini.registrationId]);
  }
  expect(plan(w, { waveId: 'aprem' }).aloneBefore).toEqual([]);
});

test('pour appliquer : seulement sans validation et validés', () => {
  // ageUp seule solution : forApply → 0 déplacement ; avec choices [{ kind: 'validate', proposalId, caseId }] → ce déplacement, validated: true
  const { s, mini } = ageUpOnly();
  const shown = plan(s);
  expect(shown.moves).toHaveLength(1);
  const move = shown.moves[0]!;
  expect(move).toMatchObject({ manual: true, validated: false, costRule: 'ageUp' });

  const bare = plan(s, { forApply: true });
  expect([bare.moves, bare.aloneAfter]).toEqual([[], [mini.registrationId]]);

  const choices: PlanChoice[] = [{ kind: 'validate', proposalId: move.id, caseId: move.caseId }];
  const r = plan(s, { forApply: true, choices });
  expect(r.moves.map((m) => [m.id, m.validated, m.outside])).toEqual([[move.id, true, null]]);
  expect([r.dropped, r.aloneAfter]).toEqual([[], []]);

  // Ce qui n'a pas besoin de validation est gardé.
  const a = kgM('A', 'cadet:F:-54', 52);
  const b = kgM('B', 'cadet:F:-61', 55);
  const t = makeState([...s.members.map((m) => ({ ...m })), a, b], { categories: s.categories.map((c) => ({ ...c })) });
  const r2 = plan(t, { forApply: true });
  expect(r2.moves.map((m) => [m.manual, m.rules])).toEqual([[false, ['weight']]]);
  expect(r2.aloneAfter).toEqual([mini.registrationId]);
});

test('pour appliquer : jamais une règle sans validation sous la ligne', () => {
  // ALONE seule en +84 ; quatre en -84 : seule issue, le « split » (le plus lourd du dessous la rejoint).
  const sen = (label: string, kg: number, wc = 'senior:M:-84') => member({ label, ageBandCode: 'senior', sex: 'M', weightClassId: wc, approxWeightKg: kg });
  const s = makeState([sen('ALONE', 85, 'senior:M:+84'), sen('L1', 72), sen('L2', 78), sen('L3', 83), sen('L4', 84)]);
  const usesCut = (r: ReturnType<typeof plan>) => r.moves.filter((m) => m.rules.some((x) => x === 'split' || x === 'weight'));
  expect(usesCut(plan(s, { level: 'split', forApply: true }))).toHaveLength(1);
  for (const level of ['return', 'weight'] as const) {
    const t = structuredClone(s);
    t.settings.replacementRules.cutAfter = level;
    expect(usesCut(plan(t, { level })), level).toEqual([]);
    expect(usesCut(plan(t, { level, forApply: true })), level).toEqual([]);
  }
  // « Split » rangé en dernier, ligne après « discipline » : ni à l'écran ni pour appliquer.
  const last = structuredClone(s);
  last.settings.replacementRules.order = [...s.settings.replacementRules.order.filter((r) => r !== 'split'), 'split'];
  expect(usesCut(plan(last, { level: 'discipline', forApply: true }))).toEqual([]);
  // « Catégorie de poids voisine » sous la ligne (ligne après « return ») : A et B restent seules, même pour appliquer.
  const a = kgM('A', 'cadet:F:-54', 52);
  const b = kgM('B', 'cadet:F:-61', 55);
  const w = makeState([a, b]);
  expect(plan(w, { level: 'weight', forApply: true }).moves.map((m) => m.rules)).toEqual([['weight']]);
  const r = plan(w, { level: 'return', forApply: true });
  expect([r.moves, r.aloneAfter]).toEqual([[], ids(a, b)]);
});

/** W, pesée 58 kg en -54 avec Y : sa correction vers -61 laisse Y seule, dont la seule issue est la tranche au-dessus. */
function leftAlone(s1Kg = 58) {
  const w = member({ label: 'W', weightClassId: 'cadet:F:-54', weighInKg: 58, presence: 'present' });
  const y = kgM('Y', 'cadet:F:-54', 53);
  const s1 = kgM('S1', 'cadet:F:-61', s1Kg);
  const s2 = kgM('S2', 'cadet:F:-61', s1Kg + 0.5);
  const j1 = member({ label: 'J1', ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: 52 });
  const j2 = member({ label: 'J2', ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: 52.5 });
  const s = makeState([w, y, s1, s2, j1, j2]);
  s.settings.replacementRules.off = ['weightGap'];
  return { s, w, y };
}

test('valider un déplacement qui suit un autre déplacement du plan : gardé, après lui', () => {
  const { s, w, y } = leftAlone();
  const shown = plan(s, { level: 'discipline' });
  expect(shown.moves.map((m) => [m.registrationId, m.manual])).toEqual([[w.registrationId, false], [y.registrationId, true]]);
  const yMove = shown.moves[1]!;
  // Le cas de Y n'existe qu'après la correction de W.
  expect(detectCases(s).some((c) => c.id === yMove.caseId)).toBe(false);
  const choices: PlanChoice[] = [{ kind: 'validate', proposalId: yMove.id, caseId: yMove.caseId }];
  const r = plan(s, { level: 'discipline', choices });
  expect(r.dropped).toEqual([]);
  expect(r.moves.map((m) => [m.id, m.validated])).toEqual([[shown.moves[0]!.id, false], [yMove.id, true]]);
  expect(r.aloneAfter).toEqual([]);
  // Pour appliquer : la correction (sans validation) puis Y, validée.
  const applied = plan(s, { level: 'discipline', choices, forApply: true });
  expect([applied.dropped, applied.waiting]).toEqual([[], []]);
  expect(applied.moves.map((m) => [m.id, m.validated])).toEqual([[shown.moves[0]!.id, false], [yMove.id, true]]);
  // Le diagramme garde le choix à chaque ligne où la correction existe.
  expect(planLadder({ ...s, settings: { ...s.settings, replacementRules: { ...s.settings.replacementRules, cutAfter: 'discipline' } } }, { waveId: null, choices }).plan.dropped).toEqual([]);
});

test('valider un déplacement qui suit un déplacement à valider : en attente pour appliquer, jamais écarté', () => {
  // Les -61 sont légers : la correction de W dépasse l'écart de poids, elle est à valider.
  const { s, w, y } = leftAlone(52);
  const shown = plan(s, { level: 'discipline' });
  expect(shown.moves.map((m) => [m.registrationId, m.manual])).toEqual([[w.registrationId, true], [y.registrationId, true]]);
  const [wMove, yMove] = shown.moves as [PlanMove, PlanMove];
  const onlyY: PlanChoice[] = [{ kind: 'validate', proposalId: yMove.id, caseId: yMove.caseId }];
  expect(plan(s, { level: 'discipline', choices: onlyY }).dropped).toEqual([]);
  const applied = plan(s, { level: 'discipline', choices: onlyY, forApply: true });
  expect([applied.moves, applied.dropped, applied.waiting]).toEqual([[], [], onlyY]);
  // Les deux validés (dans n'importe quel ordre) : les deux appliqués, W d'abord.
  const both: PlanChoice[] = [...onlyY, { kind: 'validate', proposalId: wMove.id, caseId: wMove.caseId }];
  const r = plan(s, { level: 'discipline', choices: both, forApply: true });
  expect([r.dropped, r.waiting]).toEqual([[], []]);
  expect(r.moves.map((m) => [m.id, m.validated])).toEqual([[wMove.id, true], [yMove.id, true]]);
});

test('choix d’une autre session : écarté', () => {
  const matin: Wave = { id: 'matin', name: 'Matin', order: 0, rules: { ageBandCodes: ['minime'], disciplines: [] }, weighInClosed: false };
  const aprem: Wave = { id: 'aprem', name: 'Après-midi', order: 1, rules: { ageBandCodes: ['cadet'], disciplines: [] }, weighInClosed: false };
  const a = kgM('A', 'cadet:F:-54', 52);
  const b = kgM('B', 'cadet:F:-61', 55);
  const s = makeState([a, b], { waves: [matin, aprem] });
  const move = plan(s, { waveId: 'aprem' }).moves[0]!;
  const choices: PlanChoice[] = [
    { kind: 'validate', proposalId: move.id, caseId: move.caseId },
    { kind: 'manual', registrationId: b.registrationId, categoryId: a.categoryId! },
  ];
  const r = plan(s, { waveId: 'matin', choices });
  expect([r.moves, r.dropped]).toEqual([[], choices]);
  expect(plan(s, { waveId: 'aprem', choices }).dropped).toEqual([choices[1]]);
});

test('choix gardés même si leur règle est coupée ensuite', () => {
  // validate puis off ['ageUp'] → toujours là, outside 'disabled'
  const { s } = ageUpOnly();
  const move = plan(s).moves[0]!;
  const choices: PlanChoice[] = [{ kind: 'validate', proposalId: move.id, caseId: move.caseId }];
  const off = structuredClone(s);
  off.settings.replacementRules.off = ['ageUp'];
  const r = plan(off, { choices });
  expect(r.moves.map((m) => [m.id, m.validated, m.outside, m.rules])).toEqual([[move.id, true, 'disabled', ['ageUp']]]);
  expect([r.dropped, r.aloneAfter]).toEqual([[], []]);
  // Sous la ligne : « below-cut ».
  expect(plan(s, { choices, level: 'weightGap' }).moves.map((m) => m.outside)).toEqual(['below-cut']);
});

test('choix « Modifier » : épinglé, avec ses règles et ses écarts', () => {
  const { s, mini, c1, c2 } = ageUpOnly();
  const choices: PlanChoice[] = [{ kind: 'manual', registrationId: mini.registrationId, categoryId: c1.categoryId! }];
  const r = plan(s, { choices });
  expect(r.moves).toHaveLength(1);
  expect(r.moves[0]).toMatchObject({ type: 'M', validated: true, outside: null, rules: ['ageUp'], costRule: 'ageUp', anchor: ids(c1, c2)[0] });
  expect(r.moves[0]!.details).toEqual([{ rule: 'ageUp', detail: 'Minimes → Cadets' }]);

  // Un choix qui enfreint les règles : « breaks-rules ».
  const far = kgM('FAR', 'cadet:F:+61', 70);
  const far2 = kgM('FAR2', 'cadet:F:+61', 70);
  const t = makeState([...s.members.map((m) => ({ ...m })), far, far2], { categories: s.categories.map((c) => ({ ...c })) });
  const r2 = plan(t, { choices: [{ kind: 'manual', registrationId: mini.registrationId, categoryId: far.categoryId! }] });
  expect(r2.moves.map((m) => [m.registrationId, m.validated, m.outside])).toEqual([[mini.registrationId, true, 'breaks-rules']]);
});

test('choix devenu impossible : écarté et signalé', () => {
  // cible lancée → dropped = [choix], pas d’exception
  const { s, mini, c1 } = ageUpOnly();
  const move = plan(s).moves[0]!;
  const choices: PlanChoice[] = [
    { kind: 'validate', proposalId: move.id, caseId: move.caseId },
    { kind: 'manual', registrationId: mini.registrationId, categoryId: c1.categoryId! },
    { kind: 'manual', registrationId: 'inconnu', categoryId: c1.categoryId! },
  ];
  const launched = structuredClone(s);
  launched.categories.find((c) => c.id === c1.categoryId)!.status = 'started';
  const r = plan(launched, { choices });
  expect(r.dropped).toEqual(choices);
  expect([r.moves, r.aloneAfter]).toEqual([[], [mini.registrationId]]);
});

test('catégorie lancée : ni cible ni source', () => {
  // A seule dans une catégorie lancée ; quatre -47 dans une catégorie lancée ; B seule en -54.
  const a = kgM('A', 'cadet:F:-61', 54);
  const l = [46, 46, 47, 47].map((kg, i) => kgM(`L${i}`, 'cadet:F:-47', kg));
  const b = kgM('B', 'cadet:F:-54', 50);
  const s = makeState([a, ...l, b]);
  for (const id of [a.categoryId, l[0]!.categoryId]) s.categories.find((c) => c.id === id)!.status = 'started';
  const r = plan(s);
  expect(r.moves).toEqual([]);
  expect([r.aloneBefore, r.aloneAfter]).toEqual([[b.registrationId], [b.registrationId]]);
  // Les mêmes, ouvertes : B a des solutions.
  const open = structuredClone(s);
  for (const c of open.categories) c.status = 'provisional';
  expect(plan(open).moves.length).toBeGreaterThan(0);
});

test('absents : ni comptés ni déplacés', () => {
  const a = kgM('A', 'cadet:F:-47', 46);
  const b = member({ label: 'B', weightClassId: 'cadet:F:-54', approxWeightKg: 50, presence: 'absent' });
  const c = kgM('C', 'cadet:F:-54', 50);
  const e = member({ label: 'E', weightClassId: 'cadet:F:-61', approxWeightKg: 51, presence: 'absent' });
  const s = makeState([a, b, c, e]);
  const r = plan(s);
  expect(r.aloneBefore).toEqual(ids(a, c));
  expect(r.moves).toHaveLength(1);
  expect(movedIds(r).some((id) => id === b.registrationId || id === e.registrationId)).toBe(false);
  expect(r.aloneAfter).toEqual([]);
  expect(aloneRegistrations(s, null)).toEqual(ids(a, c));
});

test('plusieurs règles : toutes doivent être permises ; coût = la plus basse', () => {
  // rules ['discipline','ageUp'] avec level 'ageDown' → absent du plan ; level 'discipline' → costRule 'discipline'
  const mini = member({ label: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45, otherDisciplines: ['shido-boxing'] });
  const c1 = member({ label: 'C1', discipline: 'shido-boxing', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const c2 = member({ label: 'C2', discipline: 'shido-boxing', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const s = makeState([mini, c1, c2]);
  const low = plan(s, { level: 'ageDown' });
  expect([low.moves, low.aloneAfter]).toEqual([[], [mini.registrationId]]);
  const r = plan(s, { level: 'discipline' });
  expect(r.moves.map((m) => [m.registrationId, m.rules, m.costRule])).toEqual([[mini.registrationId, ['discipline', 'ageUp'], 'discipline']]);
  expect(r.moves[0]!.details).toEqual([
    { rule: 'discipline', detail: 'Karaté → Shido-boxing' },
    { rule: 'ageUp', detail: 'Minimes → Cadets' },
  ]);
  // Coût : la plus basse des deux règles dans la liste (discipline : 5e règle à valider sur 5 → très fortes).
  expect(r.moves[0]!.band).toBe(4);
});

test('shobu qui accepte le jiyu en priorité : G préféré à H à égalité', () => {
  const sen = (over: Partial<Member>) => member({ ageBandCode: 'senior', weightClassId: 'senior:F:-55', approxWeightKg: 53, ...over });
  const build = (acceptsJiyuFirst: boolean) => {
    const x = sen({ label: 'X', ruleset: 'shobu', acceptsJiyuFirst, otherDisciplines: ['shido-boxing'] });
    const g1 = sen({ label: 'G1', ruleset: 'jiyu' });
    const g2 = sen({ label: 'G2', ruleset: 'jiyu' });
    const h1 = sen({ label: 'H1', ruleset: 'shobu', discipline: 'shido-boxing' });
    const h2 = sen({ label: 'H2', ruleset: 'shobu', discipline: 'shido-boxing' });
    const s = makeState([x, g1, g2, h1, h2]);
    s.settings.shobuToJiyu = true;
    return { s, x, g1, h1 };
  };
  const first = build(true);
  expect(plan(first.s).moves.map((m) => [m.registrationId, m.type, m.target])).toEqual([[first.x.registrationId, 'G', { categoryId: first.g1.categoryId }]]);
  const other = build(false);
  expect(plan(other.s).moves.map((m) => [m.registrationId, m.type, m.target])).toEqual([[other.x.registrationId, 'H', { categoryId: other.h1.categoryId }]]);
});

test('même état, même plan', () => {
  // deux appels → même hash ; structuredClone de l’état → même hash
  const ms = [
    kgM('A', 'cadet:F:-54', 52), kgM('B', 'cadet:F:-47', 47), kgM('C', 'cadet:F:-61', 56), kgM('F', 'cadet:F:+61', 60),
    kgM('G', 'cadet:F:-47', 44), member({ label: 'H', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 44 }),
    member({ label: 'I', ageBandCode: 'junior', weightClassId: 'junior:F:-48', approxWeightKg: 47 }),
  ];
  const s = makeState(ms);
  const r1 = plan(s);
  const r2 = plan(s);
  const r3 = plan(structuredClone(s));
  expect(r1.hash).toBe(r2.hash);
  expect(r1.hash).toBe(r3.hash);
  expect(r1.hash).toBe(r1.moves.map((m) => m.id).join('|'));
  expect(r1.moves.length).toBeGreaterThan(0);
});

test('détails des pastilles', () => {
  // ageUp → 'Pupilles → Benjamins' ; weightGap → '6,5 kg (max 5)'
  const p = member({ label: 'P', ageBandCode: 'pupille', weightClassId: 'pupille:F:-35', approxWeightKg: 34 });
  const b1 = member({ label: 'B1', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-35', approxWeightKg: 34 });
  const b2 = member({ label: 'B2', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-35', approxWeightKg: 35 });
  const r = plan(makeState([p, b1, b2]));
  expect(r.moves.map((m) => m.details)).toEqual([[{ rule: 'ageUp', detail: 'Pupilles → Benjamins' }]]);
  expect(r.moves[0]).toMatchObject({ fromCategoryId: p.categoryId, anchor: ids(b1, b2)[0] });
  expect(r.moves[0]!.toLabel).toBe('Karaté · Jiyu · Pupilles / Benjamins F · -35 / -35 kg');

  const a = kgM('A', 'cadet:F:-47', 44);
  const w1 = kgM('W1', 'cadet:F:-54', 50.5);
  const w2 = kgM('W2', 'cadet:F:-54', 50.5);
  const r2 = plan(makeState([a, w1, w2]));
  expect(r2.moves.map((m) => [m.rules, m.details])).toEqual([[['weightGap'], [{ rule: 'weightGap', detail: '6,5 kg (max 5)' }]]]);
});

test('manualProposal du domaine : erreurs sans exception ; rulesForMove', () => {
  const { s, mini, c1 } = ageUpOnly();
  const ok = manualProposal(s, mini.registrationId, c1.categoryId!);
  expect('p' in ok && ok.p).toMatchObject({ type: 'M', rules: [], checks: { ageDirections: [] } });
  expect(manualProposal(s, 'inconnu', c1.categoryId!)).toEqual({ error: 'not-found' });
  const started = structuredClone(s);
  started.categories.find((c) => c.id === c1.categoryId)!.status = 'started';
  expect(manualProposal(started, mini.registrationId, c1.categoryId!)).toEqual({ error: 'locked' });
  const frozen = structuredClone(s);
  frozen.categories.find((c) => c.id === c1.categoryId)!.frozen = true;
  expect(manualProposal(frozen, mini.registrationId, c1.categoryId!)).toEqual({ error: 'frozen' });
  const closed = { ...s, closedEntries: ['cadet|F|karate|jiyu'] };
  expect(manualProposal(closed, mini.registrationId, c1.categoryId!)).toEqual({ error: 'closed' });

  expect(rulesForMove(s, mini.registrationId, c1.categoryId!)).toEqual(['ageUp']);
  const far = kgM('FAR', 'cadet:F:+61', 70);
  const t = makeState([...s.members.map((m) => ({ ...m })), far], { categories: s.categories.map((c) => ({ ...c })) });
  expect(rulesForMove(t, mini.registrationId, far.categoryId!)).toBeNull();
});

test('jamais moins bon que le rejeu carte par carte', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const s = randomState(seed, 60);
    const ctx = { waveId: null, allowed: allowedAt(s.settings, 'minorsAdults'), forApply: false, excluded: new Set<string>() };
    const replay = scoreOf(s, ctx, cardByCardReplay(s, ctx).moves);
    const r = plan(s);
    expect(r.aloneAfter.length).toBeLessThanOrEqual(replay.score.alone);
    // Le même plan à chaque appel.
    expect(plan(structuredClone(s)).hash).toBe(r.hash);
  }
});

test('laissé puis repris : 0 seul', () => {
  // A est essayée en premier ; la laisser puis faire passer B chez W lui ouvre la catégorie de W (élargie à -54).
  const a = member({ label: 'A', weightClassId: 'cadet:F:-47', approxWeightKg: 47, otherDisciplines: ['shido-boxing'] });
  const b = member({ label: 'B', weightClassId: 'cadet:F:-54', approxWeightKg: 52, otherDisciplines: ['shido-boxing'] });
  const w = member({ label: 'W', discipline: 'shido-boxing', weightClassId: 'cadet:F:-61', approxWeightKg: 55 });
  const s = makeState([a, b, w]);
  s.settings.weightGapMaxKg = { ...s.settings.weightGapMaxKg, children: 10 };
  const r = plan(s);
  expect([r.aloneAfter, r.proven]).toEqual([[], true]);
  expect(r.moves.map((m) => [m.registrationId, m.target])).toEqual(expect.arrayContaining([
    [b.registrationId, { categoryId: w.categoryId }],
    [a.registrationId, { categoryId: w.categoryId }],
  ]));
});

test('budget épuisé : pas prouvé', () => {
  const [a, b, c, f] = [kgM('A', 'cadet:F:-54', 52), kgM('B', 'cadet:F:-47', 47), kgM('C', 'cadet:F:-61', 56), kgM('F', 'cadet:F:+61', 60)];
  const s = makeState([a, b, c, f]);
  s.settings.replacementRules.off = ['weightGap'];
  const r = plan(s, { nodeBudget: 1 });
  expect(r.proven).toBe(false);
  // Toujours un plan valable, jamais moins bon que le rejeu carte par carte.
  expect(r.aloneAfter.length).toBeLessThanOrEqual(r.aloneBefore.length);
  expect(plan(s).proven).toBe(true);
});
