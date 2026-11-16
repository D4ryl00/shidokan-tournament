import { expect, test } from 'vitest';
import type { GalaxyLink } from '../../src/domain/galaxy/links.js';
import type { Point } from '../../src/domain/galaxy/layout.js';
import { defaultSettings, type CompetitionSettings, type RuleId } from '../../src/domain/settings.js';
import { CARD_W } from '../../src/domain/galaxy/layout.js';
import { FORBIDDEN_COLOR, K_FULL, SLOTS, cardScale, forbiddenLabel, orderedNeighbors, displayedPositions, flyDuration, legendRules, linkStyle, pullFactor, slotGap, slotLayout, sortedNeighbors, type CardSizes } from '../../src/web/components/galaxy/scene.js';

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
  // Les 14 gardées sont les mieux classées : six liens « autre discipline » passent après quatorze « poids voisin ».
  const mixed = [
    ...Array.from({ length: 6 }, (_, i) => link('a', `d${i}`, ['discipline'])),
    ...Array.from({ length: 14 }, (_, i) => link('a', `w${String(i).padStart(2, '0')}`, ['weight'])),
  ];
  const kept = sortedNeighbors('a', mixed, s).map((n) => n.id);
  expect(kept).toHaveLength(14);
  expect(kept.every((id) => id.startsWith('w'))).toBe(true);
});

test('sortedNeighbors : règles vues depuis la sélection, égalités départagées par id', () => {
  const s = defaultSettings();
  // Vu de a : ageUp ; vu de b : ageDown. Les voisines de a et de b gardent chacune leur sens.
  const l: GalaxyLink = { a: 'a', b: 'b', fromA: ['ageUp'], fromB: ['ageDown'] };
  expect(sortedNeighbors('a', [l], s)).toEqual([{ id: 'b', rules: ['ageUp'] }]);
  expect(sortedNeighbors('b', [l], s)).toEqual([{ id: 'a', rules: ['ageDown'] }]);
  // Sens interdit depuis la sélection : les règles de l'autre sens.
  expect(sortedNeighbors('a', [{ ...l, fromA: null }], s)).toEqual([{ id: 'b', rules: ['ageDown'] }]);
  const ties = [link('a', 'z', ['weight']), link('a', 'm', ['weight']), link('0', 'a', ['weight'])];
  expect(sortedNeighbors('a', ties, s).map((n) => n.id)).toEqual(['0', 'm', 'z']);
});

test('linkStyle : dégradé vert → rouge, pointillés au-delà de la coupure', () => {
  const s = defaultSettings();
  expect(linkStyle(link('a', 'b', ['weight']), 'a', s)).toEqual({ color: '#2fd27a', dashed: false });
  expect(linkStyle(link('a', 'b', ['discipline']), 'a', s)).toEqual({ color: '#ff3b3b', dashed: false });
  expect(linkStyle(link('a', 'b', ['mixSexes']), 'a', s)).toEqual({ color: '#ff3b3b', dashed: true });
});

const withOrder = (s: CompetitionSettings, order: RuleId[], cutAfter: RuleId = s.replacementRules.cutAfter): CompetitionSettings =>
  ({ ...s, replacementRules: { ...s.replacementRules, order, cutAfter } });

test('linkStyle et legendRules : couleurs intermédiaires du dégradé', () => {
  const s = defaultSettings();
  // Légende par défaut : 5 règles, une teinte de la palette chacune.
  expect(legendRules(s).map((l) => l.color)).toEqual(['#2fd27a', '#b6dc3c', '#ffd23c', '#ff8a2a', '#ff3b3b']);
  expect(linkStyle(link('a', 'b', ['ageUp']), 'a', s).color).toBe('#b6dc3c');
  expect(linkStyle(link('a', 'b', ['ageDown']), 'a', s).color).toBe('#ffd23c');
  // Une règle éteinte : 4 règles, le dégradé est réparti sur elles (le 2e tiers tombe entre deux teintes).
  const off = { ...s, replacementRules: { ...s.replacementRules, off: ['ageUp' as const] } };
  const colors = legendRules(off).map((l) => l.color);
  expect(colors).toHaveLength(4);
  expect(colors[0]).toBe('#2fd27a');
  expect(colors[3]).toBe('#ff3b3b');
  // 1/3 du dégradé (5 teintes) : un tiers du chemin de #b6dc3c à #ffd23c.
  expect(colors[1]).toBe('#ced93c');
});

test('legendRules : suit l’ordre de la compétition ; une coupure absente de l’ordre ne coupe rien', () => {
  const s = defaultSettings();
  const order = s.replacementRules.order;
  const swapped = order.map((r) => (r === 'weight' ? 'discipline' : r === 'discipline' ? 'weight' : r));
  // La coupure suit « poids voisin », passé là où était « autre discipline ».
  const reordered = withOrder(s, swapped, 'weight');
  const legend = legendRules(reordered);
  expect(legend.map((l) => l.rule)).toEqual(['discipline', 'ageUp', 'ageDown', 'seniorsVeterans', 'weight']);
  expect(legend[0]!.color).toBe('#2fd27a');
  expect(linkStyle(link('a', 'b', ['discipline']), 'a', reordered).color).toBe('#2fd27a');
  // Sans « autre discipline » dans l'ordre (la coupure) : toutes les règles actives, rien en pointillés.
  const noCut = withOrder(s, order.filter((r) => r !== s.replacementRules.cutAfter));
  expect(legendRules(noCut).map((l) => l.rule)).toEqual(['weight', 'ageUp', 'ageDown', 'seniorsVeterans']);
  expect(linkStyle(link('a', 'b', ['mixSexes']), 'a', noCut).dashed).toBe(false);
  // Gardée en mémoire : les mêmes réglages rendent la même légende.
  expect(legendRules(s)).toBe(legendRules(s));
});

test('legendRules : règles actives jusqu’à la coupure, sans return, split ni weightGap', () => {
  const s = defaultSettings();
  const ids = legendRules(s).map((l) => l.rule);
  expect(ids).toEqual(['weight', 'ageUp', 'ageDown', 'seniorsVeterans', 'discipline']);
  const off = { ...s, replacementRules: { ...s.replacementRules, off: ['ageUp' as const] } };
  expect(legendRules(off).map((l) => l.rule)).not.toContain('ageUp');
});

test('flyDuration : entre 1100 et 1800 ms, plus long quand on vient de plus loin ou de plus haut', () => {
  for (const [d, k] of [[0, 4], [100, 1], [5000, 0.2]] as const) {
    const t = flyDuration(d, k);
    expect(t).toBeGreaterThanOrEqual(1100);
    expect(t).toBeLessThanOrEqual(1800);
  }
  let prev = 0;
  for (let d = 0; d <= 2000; d += 100) {
    expect(flyDuration(d, 1)).toBeGreaterThanOrEqual(prev);
    prev = flyDuration(d, 1);
  }
  expect(flyDuration(200, 0.3)).toBeGreaterThan(flyDuration(200, 2));
  expect(flyDuration(0, K_FULL)).toBe(1100);
});

test('cardScale : taille de la carte de la galaxie à sa place, taille pleine rapprochée au zoom maximal', () => {
  expect(cardScale(2, 0)).toBeCloseTo((CARD_W * 2) / 220, 9);
  expect(cardScale(K_FULL, 1)).toBe(1);
  expect(cardScale(K_FULL / 2, 1)).toBeCloseTo(0.5, 9);
  // Entre les deux : un mélange, compris entre les deux tailles.
  const mid = cardScale(K_FULL, 0.5);
  expect(mid).toBeGreaterThanOrEqual(Math.min(cardScale(K_FULL, 0), 1));
  expect(mid).toBeLessThanOrEqual(Math.max(cardScale(K_FULL, 0), 1));
});

test('displayedPositions sans cases mesurées : 3 colonnes jusqu’à 8 voisines, 5 au-delà', () => {
  const viewport = { w: 1240, h: 800 };
  expect(slotGap(K_FULL, viewport, 8).x).toBeCloseTo(Math.min(265, (1240 - 40) / 3), 9);
  expect(slotGap(K_FULL, viewport, 9).x).toBeCloseTo((1240 - 40) / 5, 9);
  const ids = Array.from({ length: 10 }, (_, i) => `n${i}`);
  const base = new Map<string, Point>([['s', { x: 0, y: 0 }], ...ids.map((id, i) => [id, { x: 500 + i, y: 500 }] as [string, Point])]);
  const out = displayedPositions(base, 's', ids, { k: K_FULL, px: 0, py: 0 }, viewport);
  // La 9e voisine va à la 2e colonne de gauche (SLOTS[8] = [-2, 0]) : deux écarts de 5 colonnes.
  expect(out.get('n8')!.x).toBeCloseTo((-2 * (1240 - 40)) / 5 / K_FULL, 9);
  expect(out.get('n8')!.y).toBeCloseTo(0, 9);
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

test('slotLayout : téléphone 360 × 640, deux voisines : une colonne (dessus, dessous), sans chevauchement, dans l’écran', () => {
  const cards = sizes([150, 150], 180);
  const { slots, scale } = slotLayout(cards, { w: 360, h: 640 }, 0.6);
  expect(scale).toBeGreaterThanOrEqual(0.6);
  expect(slots.map((p) => p.x)).toEqual([0, 0]);
  const rs = rects(cards, slots, scale);
  expect(anyOverlap(rs)).toBe(false);
  for (const r of rs) {
    expect(r.x0).toBeGreaterThanOrEqual(-180);
    expect(r.x1).toBeLessThanOrEqual(180);
    expect(r.y0).toBeGreaterThanOrEqual(-320);
    expect(r.y1).toBeLessThanOrEqual(320);
  }
});

test('displayedPositions : avec les cases de slotLayout, la voisine va à son écart en px au zoom plein', () => {
  const base = new Map<string, Point>([['s', { x: 100, y: 50 }], ['n1', { x: 400, y: 400 }]]);
  const out = displayedPositions(base, 's', ['n1'], { k: K_FULL, px: 0, py: 0 }, { w: 1280, h: 720 }, [{ x: -260, y: 40 }]);
  expect(out.get('n1')!.x).toBeCloseTo(100 - 260 / K_FULL, 6);
  expect(out.get('n1')!.y).toBeCloseTo(50 + 40 / K_FULL, 6);
});

test('orderedNeighbors : permises d’abord, puis interdites ; sans doublon ; 14 au plus ; seules interdites gardées', () => {
  const s = defaultSettings();
  const allowed = [link('a', 'w', ['weight'])];
  const forbidden = [link('a', 'm', ['minorsAdults']), link('a', 'w', ['minorsAdults'])];
  expect(orderedNeighbors('a', allowed, forbidden, s)).toEqual([
    { id: 'w', rules: ['weight'], forbidden: false },
    { id: 'm', rules: ['minorsAdults'], forbidden: true },
  ]);
  expect(orderedNeighbors('a', [], forbidden.slice(0, 1), s).map((n) => n.id)).toEqual(['m']);
  const many = Array.from({ length: 20 }, (_, i) => link('a', `f${String(i).padStart(2, '0')}`, ['minorsAdults']));
  const kept = orderedNeighbors('a', allowed, many, s);
  expect(kept).toHaveLength(14);
  expect(kept[0]).toEqual({ id: 'w', rules: ['weight'], forbidden: false });
});

test('forbiddenLabel : « Interdit : » et les réglages en cause', () => {
  const s = { ...defaultSettings(), mixMinorsAdults: false };
  expect(forbiddenLabel(link('a', 'b', ['minorsAdults']), 'a', s)).toBe('Interdit : Mélange mineurs / adultes');
  const two = { ...s, replacementRules: { ...s.replacementRules, off: ['discipline' as const] } };
  expect(forbiddenLabel(link('a', 'b', ['discipline', 'minorsAdults']), 'a', two)).toBe('Interdit : Autre discipline (préférences) + Mélange mineurs / adultes');
  expect(FORBIDDEN_COLOR).toBe('#8a93ad');
});

test('orderedNeighbors : une voisine interdite seulement dans l’autre sens n’est pas rapprochée', () => {
  const s = defaultSettings();
  // a → b interdit par les réglages ; b → a jamais possible (null) : vu de b, rien à rapprocher.
  const l: GalaxyLink = { a: 'a', b: 'b', fromA: ['shobuToJiyu'], fromB: null };
  expect(orderedNeighbors('a', [], [l], s).map((n) => n.id)).toEqual(['b']);
  expect(orderedNeighbors('b', [], [l], s)).toEqual([]);
});
