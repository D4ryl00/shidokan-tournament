import { describe, expect, test } from 'vitest';
import { keyString, naturalKey } from '../../../src/domain/categories.js';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import type { CategoryState } from '../../../src/domain/replacement/types.js';
import { moveView } from '../../../src/domain/replacement/view.js';
import { categoryGapTolerance } from '../../../src/domain/replacement/weights.js';
import { makeState, member } from './fixtures.js';

const gapCases = (ms: ReturnType<typeof member>[]) => detectCases(makeState(ms)).filter((c) => c.kind === 'weight_gap');
const duo = (wc: string, a: number, b: number, over = {}) => [member({ weightClassId: wc, approxWeightKg: a, ...over }), member({ weightClassId: wc, approxWeightKg: b, ...over })];

describe('écart toléré par la largeur de la catégorie', () => {
  test('cadette -54, 47,5 et 53,5 (écart 6 ≤ 7) : pas de carte', () => {
    expect(gapCases(duo('cadet:F:-54', 47.5, 53.5))).toEqual([]);
  });
  test('cadette -54, 40 et 54 (écart 14 > 7) : carte « max 7 kg »', () => {
    const c = gapCases(duo('cadet:F:-54', 40, 54));
    expect(c).toHaveLength(1);
    expect(c[0]!.detail).toContain('(max 7 kg)');
  });
  test('cadette -47 (sans limite basse) : pas de carte', () => {
    expect(gapCases(duo('cadet:F:-47', 35, 47))).toEqual([]);
  });
  test('cadette +61 (ouverte) : pas de carte', () => {
    expect(gapCases(duo('cadet:F:+61', 62, 80))).toEqual([]);
  });
  test('pupille F -30 (largeur 5) : carte « max 5 kg »', () => {
    const c = gapCases(duo('pupille:F:-30', 24, 30, { ageBandCode: 'pupille' }));
    expect(c).toHaveLength(1);
    expect(c[0]!.detail).toContain('(max 5 kg)');
  });
  test('catégorie fusionnée -54 + -61 : seuil 5 inchangé', () => {
    const base = duo('cadet:F:-54', 50, 50);
    const key = { ...naturalKey(base[0]!, base[0]!), weightClassIds: ['cadet:F:-54', 'cadet:F:-61'] };
    const cat: CategoryState = { id: 'cat:merged', key, status: 'provisional', aliasKeys: [], waveOverride: null };
    const ms = [member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50, categoryId: cat.id }), member({ weightClassId: 'cadet:F:-61', approxWeightKg: 57, categoryId: cat.id })];
    const s = makeState(ms, { categories: [cat] });
    expect(keyString(cat.key)).toContain('-61');
    expect(detectCases(s).filter((c) => c.kind === 'weight_gap')).toHaveLength(1);
  });
  test('retour possible vers une catégorie d’origine ouverte malgré un écart de 9 kg', () => {
    const home = duo('cadet:F:+61', 62, 71).slice(0, 1);
    const back = member({
      label: 'R', weightClassId: 'cadet:F:-54', approxWeightKg: 80, placementLocked: true, recasementType: 'R',
      original: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:+61', reason: 'alone' },
    });
    const s = makeState([...home, back, member({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 })]);
    const r = detectCases(s).find((c) => c.kind === 'return' && c.registrationId === back.registrationId);
    expect(r).toBeDefined();
    const p = proposalsFor(s, r!).find((x) => x.type === 'R');
    expect(p).toBeDefined();
    expect(moveView(s, p!).gap?.max).toBe(Infinity);
  });
});

test('categoryGapTolerance : Infinity, 7 et 5', () => {
  const t = (wc: string, band = 'cadet') => {
    const m = member({ weightClassId: wc, ageBandCode: band, approxWeightKg: 40 });
    const s = makeState([m]);
    return categoryGapTolerance(s.categories[0]!, [m], s);
  };
  expect(t('cadet:F:-47')).toBe(Infinity);
  expect(t('cadet:F:+61')).toBe(Infinity);
  expect(t('cadet:F:-54')).toBe(7);
  expect(t('pupille:F:-30', 'pupille')).toBe(5);
});
