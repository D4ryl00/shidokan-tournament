import { describe, expect, test } from 'vitest';
import { freeKey, naturalKey } from '../../../src/domain/categories.js';
import { entryKey } from '../../../src/domain/closed-categories.js';
import { detectCases, isLocked, isLockedForManual, isManualPlacement, manualProposal, moveTargetsFor } from '../../../src/domain/replacement/index.js';
import { applyProposal } from '../../../src/domain/replacement/move.js';
import { aloneRegistrations, computePlan, type PlanOptions } from '../../../src/domain/replacement/plan.js';
import type { CategoryState, Member, State } from '../../../src/domain/replacement/types.js';
import { allProposals } from '../../../src/server/repositories/replacement.js';
import { makeState, member } from './fixtures.js';

const kgM = (label: string, wc: string, kg: number, over: Partial<Member> = {}) => member({ label, weightClassId: wc, approxWeightKg: kg, ...over });
const plan = (s: State, over: Partial<PlanOptions> = {}) => computePlan(s, { waveId: null, level: 'minorsAdults', choices: [], ...over });
const movedIds = (r: ReturnType<typeof plan>) => r.moves.flatMap((m) => [m.registrationId, ...(m.alsoMoved ?? [])]);
/** Placé à la main (déplacement manuel) depuis sa catégorie d'origine. */
const manual = (over: Partial<Member> = {}): Partial<Member> => ({
  placementLocked: true, recasementType: 'M', original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47', reason: 'manual' }, ...over,
});
const freeCategory = (id: string, name: string, discipline: CategoryState['key']['discipline'] = 'karate', ruleset: CategoryState['key']['ruleset'] = 'jiyu'): CategoryState => ({
  id, key: freeKey(name, discipline, ruleset), status: 'provisional', aliasKeys: [], waveOverride: null,
});
const allTargets = (s: State) => [...allProposals(s).values()].flat();

describe('placements manuels et tableaux libres', () => {
  test('isManualPlacement, isLocked et isLockedForManual', () => {
    expect(isManualPlacement(member(manual()))).toBe(true);
    expect(isManualPlacement(member({ placementLocked: true, recasementType: 'A' }))).toBe(false);
    expect(isManualPlacement(member({ recasementType: 'M' }))).toBe(false);
    const free = freeCategory('libre', 'Gala 1');
    expect([isLocked(free), isLockedForManual(free)]).toEqual([true, false]);
    const started: CategoryState = { ...free, key: naturalKey(member(), member()), status: 'started' };
    expect([isLocked(started), isLockedForManual(started)]).toEqual([true, true]);
    expect(isLockedForManual({ ...started, status: 'provisional', frozen: true })).toBe(true);
    expect(isLockedForManual(undefined)).toBe(false);
  });

  test('seul placé à la main : carte d\'alerte', () => {
    const x = kgM('X', 'cadet:F:-54', 52, manual());
    const s = makeState([x]);
    const cases = detectCases(s);
    expect(cases).toEqual([
      { id: `alone:${x.registrationId}`, kind: 'alone', alert: true, registrationId: x.registrationId, categoryId: x.categoryId, detail: 'Placée à la main, seule dans sa catégorie' },
    ]);
    expect(allProposals(s).get(cases[0]!.id)).toEqual([]);
    expect(aloneRegistrations(s, null)).not.toContain(x.registrationId);
    expect(plan(s).moves).toEqual([]);

    const boy = member({ sex: 'M', weightClassId: 'cadet:M:-63', approxWeightKg: 60, ...manual() });
    expect(detectCases(makeState([boy])).map((c) => [c.alert, c.detail])).toEqual([[true, 'Placé à la main, seul dans sa catégorie']]);
  });

  test('seul dans un tableau libre : carte d\'alerte', () => {
    const x = kgM('X', 'cadet:F:-54', 52, manual({ categoryId: 'libre' }));
    const s = makeState([x], { categories: [freeCategory('libre', 'Gala 1')] });
    const cases = detectCases(s);
    expect(cases).toEqual([
      { id: `alone:${x.registrationId}`, kind: 'alone', alert: true, registrationId: x.registrationId, categoryId: 'libre', detail: 'Seule dans le tableau libre Gala 1' },
    ]);
    expect(allProposals(s).get(cases[0]!.id)).toEqual([]);
    expect(aloneRegistrations(s, null)).toEqual([]);

    const boy = member({ sex: 'M', weightClassId: 'cadet:M:-63', approxWeightKg: 60, ...manual({ categoryId: 'libre' }) });
    const t = makeState([boy], { categories: [freeCategory('libre', 'Gala 1')] });
    expect(detectCases(t).map((c) => [c.alert, c.detail])).toEqual([[true, 'Seul dans le tableau libre Gala 1']]);
  });

  test('tableau libre vide : rien', () => {
    const a = kgM('A', 'cadet:F:-54', 50);
    const b = kgM('B', 'cadet:F:-54', 51);
    const s = makeState([a, b], { categories: [freeCategory('libre', 'Gala 1')] });
    expect(detectCases(s)).toEqual([]);

    // Un autre déplacement : la catégorie libre vide reste.
    const c = kgM('C', 'cadet:F:-47', 46);
    const d = kgM('D', 'cadet:F:-61', 56);
    const t = makeState([c, d], { categories: [freeCategory('libre', 'Gala 1')] });
    const after = applyProposal(t, { type: 'A', registrationId: c.registrationId, target: { categoryId: d.categoryId! }, changes: {}, caseId: `alone:${c.registrationId}` });
    expect(after.categories.map((x) => x.id)).toContain('libre');
    expect(after.categories.find((x) => x.id === 'libre')!.key).toEqual(freeKey('Gala 1', 'karate', 'jiyu'));
  });

  test('écart de poids mesuré sans lui', () => {
    const a = kgM('A', 'cadet:F:-54', 50);
    const b = kgM('B', 'cadet:F:-54', 52);
    const x = kgM('X', 'cadet:F:-54', 70, manual());
    const s = makeState([a, b, x]);
    expect(detectCases(s).filter((c) => c.kind === 'weight_gap')).toEqual([]);
  });

  test('pas de retour', () => {
    // Comme le retour de plan.test.ts, mais déplacée à la main : deux cadettes en -47 l'attendent, elle ne revient pas.
    const h1 = kgM('H1', 'cadet:F:-47', 45);
    const h2 = kgM('H2', 'cadet:F:-47', 46);
    const back = member({
      label: 'R', weightClassId: 'cadet:F:-54', approxWeightKg: 47, placementLocked: true, recasementType: 'M',
      original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47', reason: 'alone' },
    });
    const p1 = kgM('P1', 'cadet:F:-54', 50);
    const p2 = kgM('P2', 'cadet:F:-54', 51);
    const s = makeState([h1, h2, back, p1, p2]);
    expect(detectCases(s).filter((c) => c.kind === 'return')).toEqual([]);
    expect(movedIds(plan(s))).not.toContain(back.registrationId);
    expect(movedIds(plan(s, { forApply: true }))).not.toContain(back.registrationId);
  });

  test('un combattant normal seul peut le rejoindre', () => {
    const x = kgM('X', 'cadet:F:-54', 52, manual());
    const o = kgM('O', 'cadet:F:-61', 55);
    const s = makeState([x, o]);
    expect(aloneRegistrations(s, null)).toEqual([o.registrationId]);
    const r = plan(s);
    expect(r.moves.map((m) => [m.registrationId, m.alsoMoved ?? [], m.target])).toEqual([[o.registrationId, [], { categoryId: x.categoryId }]]);
    expect(r.aloneAfter).toEqual([]);
  });

  test('tableau libre : jamais cible ni source', () => {
    // A, seule en -54, et un tableau libre où elle serait compatible : aucune proposition ni déplacement vers lui.
    const a = kgM('A', 'cadet:F:-54', 52);
    const y = kgM('Y', 'cadet:F:-54', 51, manual({ categoryId: 'libre' }));
    const s = makeState([a, y], { categories: [freeCategory('libre', 'Gala 1')] });
    const toFree = (p: { target: object }) => 'categoryId' in p.target && p.target.categoryId === 'libre';
    expect(allTargets(s).filter(toFree)).toEqual([]);
    expect(plan(s).moves.filter(toFree)).toEqual([]);

    // Un tableau libre de 3 (non verrouillés) proches en poids : jamais source d'un « split ».
    const b = kgM('B', 'cadet:F:-54', 53);
    const f = [50, 51, 52].map((kg, i) => kgM(`F${i}`, 'cadet:F:-54', kg, { categoryId: 'libre2' }));
    const t = makeState([b, ...f], { categories: [freeCategory('libre2', 'Gala 2')] });
    const freeIds = f.map((m) => m.registrationId);
    const touchesFree = (p: { registrationId: string; alsoMoved?: string[] }) => [p.registrationId, ...(p.alsoMoved ?? [])].some((r) => freeIds.includes(r));
    expect(allTargets(t).filter(touchesFree)).toEqual([]);
    expect(movedIds(plan(t)).filter((r) => freeIds.includes(r))).toEqual([]);
    expect(detectCases(t).map((c) => c.registrationId)).toEqual([b.registrationId]);
  });

  test('déplacement manuel vers un tableau libre', () => {
    const z = member({ label: 'Z', sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-90', approxWeightKg: 88, categoryId: 'libre', ...manual() });
    const m = kgM('M', 'cadet:F:-54', 52);
    const n = kgM('N', 'cadet:F:-54', 53);
    const s = makeState([z, m, n], { categories: [freeCategory('libre', 'Gala 1', 'shido-boxing', 'shobu')] });
    const r = manualProposal(s, m.registrationId, 'libre');
    if (!('p' in r)) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.p.changes).toEqual({ discipline: 'shido-boxing', ruleset: 'shobu' });
    const after = applyProposal(s, r.p);
    const table = after.categories.find((c) => c.id === 'libre')!;
    expect(table.key).toEqual(freeKey('Gala 1', 'shido-boxing', 'shobu'));
    expect(table.aliasKeys).toEqual([]);
    expect(after.members.find((x) => x.registrationId === m.registrationId)).toMatchObject({ categoryId: 'libre', discipline: 'shido-boxing', ruleset: 'shobu', recasementType: 'M', placementLocked: true });
    expect(isManualPlacement(after.members.find((x) => x.registrationId === m.registrationId)!)).toBe(true);
  });

  test('moveTargetsFor', () => {
    const m = kgM('M', 'cadet:F:-54', 52);
    const o = kgM('O', 'cadet:F:-61', 56);
    const st = kgM('S', 'cadet:F:-47', 46);
    const fr = kgM('F', 'cadet:F:-68', 64);
    const j = member({ label: 'J', ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
    const s = makeState([m, o, st, fr, j], {
      categories: [freeCategory('libre', 'Gala 1')],
      closedEntries: [entryKey({ ageBandCode: 'junior', sex: 'F', discipline: 'karate', ruleset: 'jiyu' })],
    });
    s.categories.find((c) => c.id === st.categoryId)!.status = 'started';
    s.categories.find((c) => c.id === fr.categoryId)!.frozen = true;
    const targets = moveTargetsFor(s, m.registrationId);
    expect(targets.map((t) => [t.categoryId, t.free])).toEqual([['libre', true], [o.categoryId, false]]);
    expect(targets[0]!.warnings).toEqual([]);
    const r = manualProposal(s, m.registrationId, o.categoryId!);
    expect(targets[1]!.warnings).toEqual('p' in r ? r.warnings : null);
    expect(moveTargetsFor(s, 'inconnu')).toEqual([]);
  });
});
