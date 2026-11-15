import { CARD_W, type Point } from '../../../domain/galaxy/layout.js';
import { rulesFrom, rulesRank, type GalaxyLink } from '../../../domain/galaxy/links.js';
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

/** Places affichées : les voisines (déjà triées, ≤ 14) glissent vers les cases autour de la sélection selon `pull`. */
export function displayedPositions(
  base: Map<string, Point>, selectedId: string | null, neighborIds: string[], cam: Camera, viewport: { w: number; h: number },
): Map<string, Point> {
  const pull = pullFactor(cam.k);
  const center = selectedId === null ? undefined : base.get(selectedId);
  if (pull <= 0 || center === undefined) return base;
  const out = new Map(base);
  const full = Math.min(1, cam.k / K_FULL);
  const cols = neighborIds.length > 8 ? 5 : 3;
  const sx = (Math.min(265, (viewport.w - 40) / cols) * full) / cam.k;
  const sy = (Math.min(205, (viewport.h - 130) / 3) * full) / cam.k;
  neighborIds.slice(0, SLOTS.length).forEach((id, i) => {
    const from = base.get(id);
    if (from === undefined) return;
    const [cx, cy] = SLOTS[i]!;
    const tx = center.x + cx * sx;
    const ty = center.y + cy * sy;
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

/** Légende : règles actives jusqu'à la coupure, dans l'ordre, avec leur couleur. */
export function legendRules(settings: CompetitionSettings): { rule: RuleId; label: string; color: string }[] {
  const { order, cutAfter } = settings.replacementRules;
  const cut = order.indexOf(cutAfter);
  const rules = order.filter((r, i) => i <= cut && !NOT_IN_LEGEND.has(r) && isRuleOn(settings, r));
  return rules.map((rule, i) => ({ rule, label: RULE_LABELS[rule], color: legendColor(i, rules.length) }));
}

/** Couleur et pointillés d'un lien vu depuis `fromId` : couleur de sa règle la plus loin dans la légende. */
export function linkStyle(link: GalaxyLink, fromId: string, settings: CompetitionSettings): { color: string; dashed: boolean } {
  const { rank, beyondCut } = rulesRank(rulesFrom(link, fromId), settings);
  if (beyondCut) return { color: BEYOND, dashed: true };
  const legend = legendRules(settings);
  const { order } = settings.replacementRules;
  // Dernière règle de la légende au rang du lien ou avant (une règle hors légende retombe sur la précédente).
  let idx = -1;
  legend.forEach((l, i) => { if (order.indexOf(l.rule) <= rank) idx = i; });
  return { color: legend[Math.max(0, idx)]?.color ?? HUES[0]!, dashed: false };
}

/** Durée du vol de caméra, en ms. */
export function flyDuration(distancePx: number, k0: number): number {
  return Math.min(1800, 1100 + 0.6 * distancePx + Math.abs(Math.log(K_FULL / k0)) * 150);
}
