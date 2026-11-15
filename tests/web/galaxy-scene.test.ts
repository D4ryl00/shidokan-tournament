import { expect, test } from 'vitest';
import type { GalaxyLink } from '../../src/domain/galaxy/links.js';
import type { Point } from '../../src/domain/galaxy/layout.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { K_FULL, SLOTS, displayedPositions, flyDuration, legendRules, linkStyle, pullFactor, sortedNeighbors } from '../../src/web/components/galaxy/scene.js';

const link = (a: string, b: string, rules: GalaxyLink['fromA']): GalaxyLink => ({ a, b, fromA: rules, fromB: rules });

test('pullFactor : nul en dézoom, plein au zoom maximal, croissant', () => {
  expect(pullFactor(0.5)).toBe(0);
  expect(pullFactor(K_FULL)).toBe(1);
  let prev = -1;
  for (let k = 0.5; k <= K_FULL; k += 0.1) {
    const p = pullFactor(k);
    expect(p).toBeGreaterThanOrEqual(prev);
    prev = p;
  }
});

test('displayedPositions : voisines autour de la sélection au zoom maximal, le reste inchangé', () => {
  const base = new Map<string, Point>([['s', { x: 0, y: 0 }], ['n1', { x: 50, y: 50 }], ['n2', { x: -50, y: 80 }], ['z', { x: 300, y: 300 }]]);
  const viewport = { w: 1200, h: 800 };
  const full = displayedPositions(base, 's', ['n1', 'n2'], { k: K_FULL, px: 0, py: 0 }, viewport);
  expect(full.get('n1')!.x).toBeLessThan(full.get('s')!.x);
  expect(full.get('n2')!.x).toBeGreaterThan(full.get('s')!.x);
  expect(full.get('z')).toEqual(base.get('z'));
  expect(SLOTS).toHaveLength(14);
  expect(displayedPositions(base, null, ['n1', 'n2'], { k: K_FULL, px: 0, py: 0 }, viewport)).toEqual(base);
  const far = displayedPositions(base, 's', ['n1', 'n2'], { k: 0.5, px: 0, py: 0 }, viewport);
  expect(far.get('n1')).toEqual(base.get('n1'));
  expect(far.get('n2')).toEqual(base.get('n2'));
});

test('sortedNeighbors : tri par rang, suit l’ordre de la compétition, coupé à 14', () => {
  const s = defaultSettings();
  const links = [link('a', 'b', ['discipline']), link('a', 'c', ['weight'])];
  expect(sortedNeighbors('a', links, s).map((n) => n.id)).toEqual(['c', 'b']);
  const swapped = { ...s, replacementRules: { ...s.replacementRules, order: s.replacementRules.order.map((r) => (r === 'weight' ? 'discipline' : r === 'discipline' ? 'weight' : r)), cutAfter: 'weight' as const } };
  expect(sortedNeighbors('a', links, swapped).map((n) => n.id)).toEqual(['b', 'c']);
  const many = Array.from({ length: 20 }, (_, i) => link('a', `n${String(i).padStart(2, '0')}`, ['weight']));
  expect(sortedNeighbors('a', many, s)).toHaveLength(14);
});

test('linkStyle : dégradé vert → rouge, pointillés au-delà de la coupure', () => {
  const s = defaultSettings();
  expect(linkStyle(link('a', 'b', ['weight']), 'a', s)).toEqual({ color: '#2fd27a', dashed: false });
  expect(linkStyle(link('a', 'b', ['discipline']), 'a', s)).toEqual({ color: '#ff3b3b', dashed: false });
  expect(linkStyle(link('a', 'b', ['mixSexes']), 'a', s)).toEqual({ color: '#ff3b3b', dashed: true });
});

test('legendRules : règles actives jusqu’à la coupure, sans return, split ni weightGap', () => {
  const s = defaultSettings();
  const ids = legendRules(s).map((l) => l.rule);
  expect(ids).toEqual(['weight', 'ageUp', 'ageDown', 'seniorsVeterans', 'discipline']);
  const off = { ...s, replacementRules: { ...s.replacementRules, off: ['ageUp' as const] } };
  expect(legendRules(off).map((l) => l.rule)).not.toContain('ageUp');
});

test('flyDuration : entre 1100 et 1800 ms', () => {
  for (const [d, k] of [[0, 4], [100, 1], [5000, 0.2]] as const) {
    const t = flyDuration(d, k);
    expect(t).toBeGreaterThanOrEqual(1100);
    expect(t).toBeLessThanOrEqual(1800);
  }
});
