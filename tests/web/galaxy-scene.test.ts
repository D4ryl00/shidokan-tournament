import { expect, test } from 'vitest';
import type { GalaxyLink } from '../../src/domain/galaxy/links.js';
import type { Point } from '../../src/domain/galaxy/layout.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { K_FULL, SLOTS, displayedPositions, flyDuration, legendRules, linkStyle, pullFactor, slotLayout, sortedNeighbors, type CardSizes } from '../../src/web/components/galaxy/scene.js';

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

// Cases adaptées à l'écran et à la taille des cartes.
type Rect = { x0: number; y0: number; x1: number; y1: number };
function rects(cards: CardSizes, slots: Point[], scale: number): Rect[] {
  const r = (p: Point, c: { w: number; h: number }) => ({ x0: p.x - (c.w * scale) / 2, x1: p.x + (c.w * scale) / 2, y0: p.y - (c.h * scale) / 2, y1: p.y + (c.h * scale) / 2 });
  return [r({ x: 0, y: 0 }, cards.sel), ...slots.map((p, i) => r(p, cards.neighbors[i]!))];
}
const overlaps = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
function anyOverlap(rs: Rect[]): boolean {
  return rs.some((a, i) => rs.some((b, j) => j > i && overlaps(a, b)));
}
const sizes = (heights: number[], sel = 250): CardSizes => ({ sel: { w: 240, h: sel }, neighbors: heights.map((h) => ({ w: 220, h })) });

test('slotLayout : 9 voisines à 1280 × 600, cartes de 150 à 250 px, sans chevauchement à 0,75 au moins, dans l’écran', () => {
  const cards = sizes([250, 150, 200, 250, 180, 150, 230, 250, 160]);
  const { slots, scale } = slotLayout(cards, { w: 1280, h: 600 }, 0.75);
  expect(slots).toHaveLength(9);
  expect(scale).toBeGreaterThanOrEqual(0.75);
  const rs = rects(cards, slots, scale);
  expect(anyOverlap(rs)).toBe(false);
  for (const r of rs) {
    expect(r.x0).toBeGreaterThanOrEqual(-640);
    expect(r.x1).toBeLessThanOrEqual(640);
    expect(r.y0).toBeGreaterThanOrEqual(-300);
    expect(r.y1).toBeLessThanOrEqual(300);
  }
});

test('slotLayout : 14 voisines de 250 px à 1280 × 600 : au moins 0,75, chevauchement seulement si rien d’autre ne tient', () => {
  const cards = sizes(Array.from({ length: 14 }, () => 250));
  const { slots, scale } = slotLayout(cards, { w: 1280, h: 600 }, 0.75);
  expect(slots).toHaveLength(14);
  expect(scale).toBeGreaterThanOrEqual(0.75);
});

test('slotLayout : peu de voisines, grand écran : échelle 1, les règles les plus hautes au plus près', () => {
  const cards = sizes([150, 150, 150, 150, 150], 200);
  const { slots, scale } = slotLayout(cards, { w: 1600, h: 900 }, 0.75);
  expect(scale).toBe(1);
  expect(anyOverlap(rects(cards, slots, scale))).toBe(false);
  const d = slots.map((p) => Math.hypot(p.x, p.y));
  // Les deux premières à gauche et à droite de la sélection, les deux suivantes au-dessus et au-dessous ; la dernière
  // pas plus près que la première.
  expect(slots[0]!.x).toBeLessThan(0);
  expect(slots[1]!.x).toBeGreaterThan(0);
  expect(slots[2]!.x).toBe(0);
  expect(slots[2]!.y).toBeLessThan(0);
  expect(slots[3]!.y).toBeGreaterThan(0);
  expect(d[4]!).toBeGreaterThanOrEqual(d[0]! - 1e-9);
});

test('slotLayout : téléphone 360 × 600 : jamais sous l’échelle minimale', () => {
  const cards = sizes([200, 150, 180, 220, 160]);
  const { slots, scale } = slotLayout(cards, { w: 360, h: 600 }, 0.6);
  expect(slots).toHaveLength(5);
  expect(scale).toBeGreaterThanOrEqual(0.6);
});

test('displayedPositions : avec les cases de slotLayout, la voisine va à son écart en px au zoom plein', () => {
  const base = new Map<string, Point>([['s', { x: 100, y: 50 }], ['n1', { x: 400, y: 400 }]]);
  const out = displayedPositions(base, 's', ['n1'], { k: K_FULL, px: 0, py: 0 }, { w: 1280, h: 720 }, [{ x: -260, y: 40 }]);
  expect(out.get('n1')!.x).toBeCloseTo(100 - 260 / K_FULL, 6);
  expect(out.get('n1')!.y).toBeCloseTo(50 + 40 / K_FULL, 6);
});
