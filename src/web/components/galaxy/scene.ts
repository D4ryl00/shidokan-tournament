import { CARD_W, type Point } from '../../../domain/galaxy/layout.js';
import { blockedRules, rulesFrom, rulesRank, type GalaxyLink } from '../../../domain/galaxy/links.js';
import { isRuleOn, RULE_LABELS } from '../../../domain/replacement/rules.js';
import type { CompetitionSettings, RuleId } from '../../../domain/settings.js';

// Caméra, rapprochement des voisines et couleurs des règles de la galaxie (spec étape 48, §3.3, §3.4, §4.2).

export const K_FULL = 4; // zoom des cartes rapprochées = zoom maximal
export const PULL_FROM = 0.9;
export const PULL_TO = 3.2;
/** Cases autour de la sélection, dans l'ordre des voisines triées. */
export const SLOTS: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [-2, 0], [2, 0], [-2, -1], [2, -1], [-2, 1], [2, 1],
];
export interface Camera { k: number; px: number; py: number }

const HUES = ['#2fd27a', '#b6dc3c', '#ffd23c', '#ff8a2a', '#ff3b3b'];
/** Lien interdit par les réglages (étape 49) : gris, distinct du rouge « au-delà de la coupure » qui, lui, est permis. */
export const FORBIDDEN_COLOR = '#8a93ad';
const BEYOND = '#ff3b3b';
/** Règles sans couleur de lien : retour, split et écart de poids ne sont pas des liens de la galaxie. */
const NOT_IN_LEGEND: ReadonlySet<RuleId> = new Set<RuleId>(['return', 'split', 'weightGap']);

/** Part du rapprochement : 0 en dézoom, 1 au zoom plein (smoothstep). */
export function pullFactor(k: number): number {
  const t = Math.max(0, Math.min(1, (k - PULL_FROM) / (PULL_TO - PULL_FROM)));
  return t * t * (3 - 2 * t);
}

/** Rapprochée : taille pleine ; à sa place : taille de la carte de la galaxie, qui ne chevauche pas ses voisines. */
export function cardScale(k: number, pull: number): number {
  return ((CARD_W * k) / 220) * (1 - pull) + Math.min(1, k / K_FULL) * pull;
}

/** Écart entre deux cases autour de la sélection, en px à l'écran (le tout tient sur un écran). */
export function slotGap(k: number, viewport: { w: number; h: number }, neighbors: number): { x: number; y: number } {
  const full = Math.min(1, k / K_FULL);
  const cols = neighbors > 8 ? 5 : 3;
  return { x: Math.min(265, (viewport.w - 40) / cols) * full, y: Math.min(205, (viewport.h - 130) / 3) * full };
}

/**
 * Places affichées : les voisines (déjà triées, ≤ 14) glissent vers les cases autour de la sélection selon `pull`.
 * `slots` : écarts à la sélection, en px au zoom plein (`slotLayout`) ; sans eux, la grille fixe `SLOTS`.
 */
export function displayedPositions(
  base: Map<string, Point>, selectedId: string | null, neighborIds: string[], cam: Camera, viewport: { w: number; h: number },
  slots?: Point[],
): Map<string, Point> {
  const pull = pullFactor(cam.k);
  const center = selectedId === null ? undefined : base.get(selectedId);
  if (pull <= 0 || center === undefined) return base;
  const out = new Map(base);
  const gap = slotGap(cam.k, viewport, neighborIds.length);
  const sx = gap.x / cam.k;
  const sy = gap.y / cam.k;
  neighborIds.slice(0, SLOTS.length).forEach((id, i) => {
    const from = base.get(id);
    if (from === undefined) return;
    const full = Math.min(1, cam.k / K_FULL);
    const own = slots?.[i];
    const [cx, cy] = SLOTS[i]!;
    const tx = own ? center.x + (own.x * full) / cam.k : center.x + cx * sx;
    const ty = own ? center.y + (own.y * full) / cam.k : center.y + cy * sy;
    out.set(id, { x: from.x + (tx - from.x) * pull, y: from.y + (ty - from.y) * pull });
  });
  return out;
}

/** Voisines d'une catégorie, triées par rang (règles les plus hautes d'abord), au plus 14. */
export function sortedNeighbors(id: string, links: GalaxyLink[], settings: CompetitionSettings): { id: string; rules: RuleId[] }[] {
  return links
    .filter((l) => l.a === id || l.b === id)
    .map((l) => {
      const rules = rulesFrom(l, id);
      return { id: l.a === id ? l.b : l.a, rules, rank: rulesRank(rules, settings).rank };
    })
    .sort((x, y) => x.rank - y.rank || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, SLOTS.length)
    .map(({ id: nid, rules }) => ({ id: nid, rules }));
}

/**
 * Voisines rapprochées : les permises (triées comme `sortedNeighbors`), puis les interdites par les réglages (même tri),
 * sans doublon, au plus SLOTS.length.
 */
export function orderedNeighbors(
  id: string, allowed: GalaxyLink[], forbidden: GalaxyLink[], settings: CompetitionSettings,
): { id: string; rules: RuleId[]; forbidden: boolean }[] {
  const first = sortedNeighbors(id, allowed, settings).map((n) => ({ ...n, forbidden: false }));
  const seen = new Set(first.map((n) => n.id));
  // Une voisine interdite seulement dans l'autre sens (le sens depuis `id` n'est jamais possible) n'est pas rapprochée.
  const ownWay = forbidden.filter((l) => (l.a === id ? l.fromA : l.fromB) !== null);
  const then = sortedNeighbors(id, ownWay, settings).filter((n) => !seen.has(n.id)).map((n) => ({ ...n, forbidden: true }));
  return [...first, ...then].slice(0, SLOTS.length);
}

/** Étiquette d'un lien interdit vu depuis `fromId` (tranches `fromBands`) : « Interdit : » et les réglages en cause. */
export function forbiddenLabel(link: GalaxyLink, fromId: string, settings: CompetitionSettings, fromBands: string[]): string {
  return `Interdit : ${blockedRules(rulesFrom(link, fromId), settings, fromBands).map((r) => RULE_LABELS[r]).join(' + ')}`;
}

function gradient(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (HUES.length - 1);
  const i = Math.min(HUES.length - 2, Math.floor(x));
  const f = x - i;
  const c = (h: string) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16));
  const a = c(HUES[i]!);
  const b = c(HUES[i + 1]!);
  return '#' + a.map((v, j) => Math.round(v + (b[j]! - v) * f).toString(16).padStart(2, '0')).join('');
}

const legendColor = (i: number, n: number): string => (n <= 1 ? HUES[0]! : gradient(i / (n - 1)));

type Legend = { rule: RuleId; label: string; color: string }[];
/** Légendes déjà calculées, par objet de réglages (les réglages reçus de l'API ne sont pas modifiés en place). */
const legends = new WeakMap<CompetitionSettings, Legend>();

/**
 * Légende : règles actives jusqu'à la coupure, dans l'ordre, avec leur couleur. Une coupure absente de l'ordre (réglage
 * abîmé) ne coupe rien, comme `rulesRank`. Gardée en mémoire par objet de réglages : ne pas modifier le tableau rendu.
 */
export function legendRules(settings: CompetitionSettings): Legend {
  const known = legends.get(settings);
  if (known) return known;
  const { order, cutAfter } = settings.replacementRules;
  const at = order.indexOf(cutAfter);
  const cut = at < 0 ? order.length - 1 : at;
  const rules = order.filter((r, i) => i <= cut && !NOT_IN_LEGEND.has(r) && isRuleOn(settings, r));
  const legend = rules.map((rule, i) => ({ rule, label: RULE_LABELS[rule], color: legendColor(i, rules.length) }));
  legends.set(settings, legend);
  return legend;
}

/** Couleur et pointillés d'un lien vu depuis `fromId` : couleur de sa règle la plus loin dans la légende. */
export function linkStyle(
  link: GalaxyLink, fromId: string, settings: CompetitionSettings,
): { color: string; dashed: boolean } {
  const legend = legendRules(settings);
  const { rank, beyondCut } = rulesRank(rulesFrom(link, fromId), settings);
  if (beyondCut) return { color: BEYOND, dashed: true };
  const { order } = settings.replacementRules;
  // Dernière règle de la légende au rang du lien ou avant (une règle hors légende retombe sur la précédente).
  let idx = -1;
  legend.forEach((l, i) => { if (order.indexOf(l.rule) <= rank) idx = i; });
  return { color: legend[Math.max(0, idx)]?.color ?? HUES[0]!, dashed: false };
}

/** Le meilleur des deux sens d'un lien (rang le plus bas) : le sens d'où il est vu quand rien n'est choisi (spec §5.1). */
export function bestFrom(link: GalaxyLink, settings: CompetitionSettings): string {
  if (link.fromA === null || link.fromB === null) return link.fromA === null ? link.b : link.a;
  return rulesRank(rulesFrom(link, link.b), settings).rank < rulesRank(rulesFrom(link, link.a), settings).rank ? link.b : link.a;
}

/** Durée du vol de caméra, en ms. */
export function flyDuration(distancePx: number, k0: number): number {
  return Math.min(1800, 1100 + 0.6 * distancePx + Math.abs(Math.log(K_FULL / k0)) * 150);
}

/** Tailles des cartes rapprochées (px, à l'échelle 1) : la sélection, puis chaque voisine dans l'ordre. */
export interface CardSizes { sel: { w: number; h: number }; neighbors: { w: number; h: number }[] }
/** Cases des voisines (écarts à la sélection, px à l'écran au zoom plein) et échelle des cartes. */
export interface SlotLayout { slots: Point[]; scale: number }

const GAP = 10;
const MARGIN = 12;
const SCALE_STEP = 0.025;

/** Colonnes candidates, de la plus proche à la plus loin : gauche 1, droite 1, centre (dessus, dessous), gauche 2… */
function columnOrder(sideColumns: number): number[] {
  const out = [-1, 1, 0, 0];
  for (let k = 1; k <= sideColumns; k++) {
    // Chaque colonne de côté reçoit plusieurs cartes ; la première rangée de colonnes passe avant la suivante.
    for (let r = 0; r < 6; r++) out.push(-k, k);
  }
  return out;
}

/** Essai à l'échelle `s` : chaque voisine dans la première colonne qui a la place ; null si elles ne tiennent pas toutes. */
function tryLayout(cards: CardSizes, area: { w: number; h: number }, s: number, force: boolean): Point[] | null {
  const availW = (area.w - 2 * MARGIN) / s;
  const availH = (area.h - 2 * MARGIN) / s;
  const colW = Math.max(0, ...cards.neighbors.map((c) => c.w));
  // Colonnes de côté qui tiennent en largeur ; aucune (téléphone) : toutes les voisines dans la colonne du centre.
  const side = Math.floor((availW - cards.sel.w - 2 * GAP) / 2 / (colW + GAP));
  if (side < 1) return centreColumn(cards, availH, s, force);
  // Piles : colonne → indices des voisines, la première au milieu, puis en alternance dessus et dessous.
  const stacks = new Map<number, number[]>();
  let top: number | null = null;
  let bottom: number | null = null;
  const stackHeight = (ids: number[]) => ids.reduce((sum, i) => sum + cards.neighbors[i]!.h, 0) + GAP * Math.max(0, ids.length - 1);
  const order = side >= 1 ? columnOrder(side) : [0, 0];
  let cursor = 0;
  for (let i = 0; i < cards.neighbors.length; i++) {
    const h = cards.neighbors[i]!.h;
    let placed = false;
    for (let j = cursor; j < order.length && !placed; j++) {
      const col = order[j]!;
      if (col === 0) {
        // Centre : une carte au-dessus de la sélection, une au-dessous.
        const half = cards.sel.h / 2 + GAP + h;
        if (top === null && (force || half <= availH / 2)) { top = i; placed = true; }
        else if (top !== null && bottom === null && (force || half <= availH / 2)) { bottom = i; placed = true; }
      } else {
        const ids = stacks.get(col) ?? [];
        if (force || stackHeight([...ids, i]) <= availH) { stacks.set(col, [...ids, i]); placed = true; }
      }
      if (placed) cursor = j + 1;
    }
    if (!placed) {
      if (!force) return null;
      // Forcé : la colonne de côté la plus proche la moins haute.
      const col = [-1, 1].sort((a, b) => stackHeight(stacks.get(a) ?? []) - stackHeight(stacks.get(b) ?? []))[0]!;
      stacks.set(col, [...(stacks.get(col) ?? []), i]);
    }
  }
  const out: Point[] = cards.neighbors.map(() => ({ x: 0, y: 0 }));
  if (top !== null) out[top] = { x: 0, y: -(cards.sel.h / 2 + GAP + cards.neighbors[top]!.h / 2) };
  if (bottom !== null) out[bottom] = { x: 0, y: cards.sel.h / 2 + GAP + cards.neighbors[bottom]!.h / 2 };
  for (const [col, ids] of stacks) {
    const x = Math.sign(col) * (cards.sel.w / 2 + GAP + colW / 2 + (Math.abs(col) - 1) * (colW + GAP));
    // Pile centrée sur la sélection : la première voisine au milieu, les suivantes dessus puis dessous.
    const arranged: number[] = [];
    ids.forEach((id, k) => (k % 2 === 1 ? arranged.unshift(id) : arranged.push(id)));
    let y = -stackHeight(arranged) / 2;
    for (const id of arranged) {
      const h = cards.neighbors[id]!.h;
      out[id] = { x, y: y + h / 2 };
      y += h + GAP;
    }
  }
  return out.map((p) => ({ x: p.x * s, y: p.y * s }));
}

/**
 * Téléphone : pas de place pour une colonne de côté. Les voisines s'empilent au-dessus et au-dessous de la sélection,
 * la mieux classée juste au-dessus, la suivante juste au-dessous, et ainsi de suite (du côté le moins haut). Sans
 * `force`, null si la colonne dépasse en hauteur ; forcée, elle dépasse en hauteur (on y va en déplaçant la galaxie),
 * jamais sur les côtés.
 */
function centreColumn(cards: CardSizes, availH: number, s: number, force: boolean): Point[] | null {
  const above: number[] = [];
  const below: number[] = [];
  const height = (ids: number[]) => ids.reduce((sum, i) => sum + cards.neighbors[i]!.h + GAP, 0);
  cards.neighbors.forEach((_, i) => (height(above) <= height(below) ? above : below).push(i));
  const half = cards.sel.h / 2;
  if (!force && (half + height(above) > availH / 2 || half + height(below) > availH / 2)) return null;
  const out: Point[] = cards.neighbors.map(() => ({ x: 0, y: 0 }));
  for (const [ids, dir] of [[above, -1], [below, 1]] as const) {
    let edge = half + GAP;
    for (const i of ids) {
      const h = cards.neighbors[i]!.h;
      out[i] = { x: 0, y: dir * (edge + h / 2) * s };
      edge += h + GAP;
    }
  }
  return out;
}

/**
 * Cases des voisines rapprochées autour de la sélection, selon la place à l'écran et la taille réelle des cartes :
 * des colonnes à gauche et à droite (autant que la largeur le permet), une case au-dessus et une au-dessous de la
 * sélection ; les voisines les plus hautes dans la liste des règles prennent les colonnes les plus proches.
 * L'échelle est la plus grande (≤ 1) où rien ne se chevauche, jamais sous `minScale` (alors un chevauchement reste).
 */
export function slotLayout(cards: CardSizes, area: { w: number; h: number }, minScale: number): SlotLayout {
  if (cards.neighbors.length === 0) {
    const scale = Math.max(minScale, Math.min(1, (area.h - 2 * MARGIN) / cards.sel.h, (area.w - 2 * MARGIN) / cards.sel.w));
    return { slots: [], scale };
  }
  for (let s = 1; s >= minScale - 1e-9; s -= SCALE_STEP) {
    if (cards.sel.h * s > area.h - 2 * MARGIN) continue;
    const slots = tryLayout(cards, area, s, false);
    if (slots) return { slots, scale: s };
  }
  return { slots: tryLayout(cards, area, minScale, true) ?? [], scale: minScale };
}
