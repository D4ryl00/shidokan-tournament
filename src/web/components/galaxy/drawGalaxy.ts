import type { CategoryKey } from '../../../domain/categories.js';
import { CARD_W, type Point } from '../../../domain/galaxy/layout.js';
import type { GalaxyLink } from '../../../domain/galaxy/links.js';
import { FORBIDDEN_COLOR, type Camera } from './scene.js';

// Dessin de la galaxie des catégories dans un <canvas> (spec étape 48, §3.2, §3.3, §5.3), repris de la maquette v14
// (« nuage à plat ») : ciel étoilé, liens, étoiles et leurs noms, puis cartes dessinées quand on zoome. Sans React.

/** Fond : un ciel sombre dans les deux thèmes (identité de la vue). */
export const SKY = '#05060a';
const FONT = 'Inter, system-ui, sans-serif';
/** Une carte dessinée à partir de cette largeur à l'écran (en px) ; en dessous, une étoile. */
const CARD_FROM_PX = 70;
const MAX_NAMES = 4;

/** Teinte d'une étoile : une par discipline · règlement (celles de la maquette). */
const HUES: Record<string, { color: string; label: string; short: string }> = {
  'karate|jiyu': { color: '#7aa2ff', label: 'Karaté · Jiyu', short: 'Karaté J' },
  'karate|shobu': { color: '#b48cff', label: 'Karaté · Shobu', short: 'Karaté S' },
  'shido-boxing': { color: '#ffb454', label: 'Shido-boxing', short: 'Boxing' },
  'shido-mix': { color: '#4fd1a5', label: 'Shido-mix-martial', short: 'Mix' },
  triathlon: { color: '#f78fb3', label: 'Triathlon', short: 'Triathlon' },
  kata: { color: '#e6e6a0', label: 'Kata', short: 'Kata' },
};
const hueKey = (k: Pick<CategoryKey, 'discipline' | 'ruleset'>): string =>
  k.discipline === 'karate' ? `karate|${k.ruleset === 'shobu' ? 'shobu' : 'jiyu'}` : k.discipline;
/** Teinte, nom et nom court de la discipline · règlement d'une catégorie. */
export const disciplineHue = (k: Pick<CategoryKey, 'discipline' | 'ruleset'>) => ({ key: hueKey(k), ...HUES[hueKey(k)]! });

export interface Star {
  id: string;
  color: string;
  /** « Karaté J · Cadets F · -54 kg » (tableau libre : son nom). */
  label: string;
  /** Titre de la carte dessinée (« Cadets F · -54 kg ») et sa seconde ligne (discipline). */
  title: string;
  sub: string;
  /** Noms des présents. */
  names: string[];
  /** Un seul combattant présent : anneau blanc qui pulse, nom en gras. */
  lone: boolean;
  /** Catégorie lancée ou terminée : plus pâle. */
  pale: boolean;
}

export interface Scene {
  stars: Star[];
  /** Places affichées (voisines rapprochées comprises). */
  pos: Map<string, Point>;
  /** Liens entre étoiles dessinées. */
  links: GalaxyLink[];
  selectedId: string | null;
  hoverId: string | null;
  /** Étoiles montrées en vraies cartes par-dessus : le canevas ne les dessine pas. */
  overlaid: ReadonlySet<string>;
  /** Voisines rapprochées de la sélection (nom de la règle sur leur lien). */
  pulledIds: string[];
  /** Étoiles trouvées (recherche, « Seulement les seuls ») ; null : pas de filtre. */
  matched: ReadonlySet<string> | null;
  allLinks: boolean;
  pull: number;
  linkStyle: (l: GalaxyLink, fromId: string) => { color: string; dashed: boolean };
  /** Sens d'où voir un lien qui ne touche pas l'étoile choisie : le meilleur des deux. */
  linkFrom: (l: GalaxyLink) => string;
  linkLabel: (l: GalaxyLink, fromId: string) => string;
  /** Liens interdits par les réglages (étape 49) : dessinés seulement pour l'étoile en focus. */
  forbidden: GalaxyLink[];
  forbiddenLabel: (l: GalaxyLink, fromId: string) => string;
}

/** Ciel de fond : points fixes (graine fixe), légère parallaxe. */
const SKY_DOTS: [number, number, number][] = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 600 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 0.9 + 0.1] as [number, number, number]);
})();

export const toScreen = (p: Point, cam: Camera, w: number, h: number): Point => ({ x: w / 2 + cam.px + p.x * cam.k, y: h / 2 + cam.py + p.y * cam.k });

/** Rayon d'une étoile : selon le nombre de présents et le zoom. */
const starRadius = (s: Star, k: number) => Math.max(1.6, (2.2 + Math.sqrt(s.names.length) * 2.2) * Math.max(0.5, Math.min(k, 2.2)));

/** Taille à l'écran d'une carte dessinée (largeur CARD_W, noms au-delà d'un certain zoom). */
function cardBox(s: Star, k: number): { w: number; h: number; kk: number; names: boolean } {
  const kk = (CARD_W * k) / 150;
  const names = kk >= 0.68;
  const lines = Math.min(s.names.length, MAX_NAMES) + (s.names.length > MAX_NAMES ? 1 : 0);
  return { w: 150 * kk, h: (30 + (names ? lines * 13 + 4 : 0)) * kk, kk, names };
}

function roundRect(cx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
}

/**
 * Dessine une image de la galaxie. Rend `true` si un anneau qui pulse est visible (l'appelant redessine alors à
 * l'image suivante ; sinon, rien ne bouge et il s'arrête).
 */
export function drawGalaxy(cx: CanvasRenderingContext2D, w: number, h: number, cam: Camera, s: Scene, now: number): boolean {
  cx.fillStyle = SKY;
  cx.fillRect(0, 0, w, h);
  for (const [sx, sy, b] of SKY_DOTS) {
    cx.fillStyle = `rgba(200,210,255,${b * 0.35})`;
    cx.fillRect((sx * 0.5 + 0.5) * w + cam.px * b * 0.05, (sy * 0.5 + 0.5) * h + cam.py * b * 0.05, b * 1.2, b * 1.2);
  }

  const P = new Map<string, Point>();
  for (const st of s.stars) {
    const p = s.pos.get(st.id);
    if (p) P.set(st.id, toScreen(p, cam, w, h));
  }
  const focus = s.selectedId ?? s.hoverId;
  const focusN = new Set<string>();
  if (focus) for (const l of [...s.links, ...s.forbidden]) if (l.a === focus) focusN.add(l.b); else if (l.b === focus) focusN.add(l.a);
  const vis = (id: string) => s.matched === null || s.matched.has(id);

  // Liens : ceux de l'étoile survolée ou sélectionnée ; tous, très légers, avec « Tous les liens ».
  cx.lineCap = 'round';
  for (const l of s.links) {
    const a = P.get(l.a);
    const b = P.get(l.b);
    if (!a || !b) continue;
    const hot = focus !== null && (l.a === focus || l.b === focus);
    if (!hot && (!s.allLinks || !vis(l.a) || !vis(l.b))) continue;
    const st = s.linkStyle(l, hot ? focus! : s.linkFrom(l));
    cx.strokeStyle = st.color;
    cx.globalAlpha = hot ? 0.95 : focus ? 0.04 : Math.min(0.28, 0.08 + cam.k * 0.12);
    cx.lineWidth = hot ? (s.selectedId ? 3 : 2.2) : 1;
    cx.setLineDash(st.dashed ? [7, 6] : []);
    cx.beginPath();
    cx.moveTo(a.x, a.y);
    cx.lineTo(b.x, b.y);
    cx.stroke();
  }
  // Liens interdits par les réglages : seulement ceux de l'étoile en focus, gris en pointillés fins.
  if (focus) {
    cx.strokeStyle = FORBIDDEN_COLOR;
    cx.globalAlpha = 0.9;
    cx.lineWidth = 1.5;
    cx.setLineDash([2, 5]);
    for (const l of s.forbidden) {
      if (l.a !== focus && l.b !== focus) continue;
      const a = P.get(l.a);
      const b = P.get(l.b);
      if (!a || !b) continue;
      cx.beginPath();
      cx.moveTo(a.x, a.y);
      cx.lineTo(b.x, b.y);
      cx.stroke();
    }
  }
  cx.setLineDash([]);
  cx.globalAlpha = 1;

  // Nom de la règle sur chaque lien rapproché (pour un lien interdit : le réglage qui l'interdit).
  if (s.selectedId && s.pull > 0.3) {
    const a = P.get(s.selectedId);
    const pulled = new Set(s.pulledIds);
    cx.font = `11px ${FONT}`;
    const labelled = [...s.links.map((l) => ({ l, forbidden: false })), ...s.forbidden.map((l) => ({ l, forbidden: true }))];
    for (const { l, forbidden } of labelled) {
      const other = l.a === s.selectedId ? l.b : l.b === s.selectedId ? l.a : null;
      const b = other ? P.get(other) : undefined;
      if (!a || !b || !pulled.has(other!)) continue;
      const st = forbidden ? { color: FORBIDDEN_COLOR } : s.linkStyle(l, s.selectedId);
      const text = forbidden ? s.forbiddenLabel(l, s.selectedId) : s.linkLabel(l, s.selectedId);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const tw = cx.measureText(text).width;
      cx.globalAlpha = Math.min(1, (s.pull - 0.3) * 3);
      cx.fillStyle = '#0b0e16';
      roundRect(cx, mx - tw / 2 - 7, my - 9, tw + 14, 18, 9);
      cx.fill();
      cx.strokeStyle = `${st.color}88`;
      cx.lineWidth = 1;
      cx.stroke();
      cx.fillStyle = st.color;
      cx.fillText(text, mx - tw / 2, my + 4);
    }
    cx.globalAlpha = 1;
  }

  // Étoiles (ou cartes dessinées), puis leurs noms par ordre de priorité, sans chevauchement.
  let ring = false;
  const asCard = CARD_W * cam.k >= CARD_FROM_PX;
  const labels: { st: Star; x: number; y: number; r: number; alpha: number; rank: number }[] = [];
  for (const st of s.stars) {
    if (s.overlaid.has(st.id)) continue;
    const p = P.get(st.id);
    if (!p || p.x < -200 || p.y < -200 || p.x > w + 200 || p.y > h + 200) continue;
    const near = focus !== null && (st.id === focus || focusN.has(st.id));
    const dim = (!vis(st.id) && !near) || (focus !== null && !near);
    const alpha = (dim ? (s.selectedId ? 0.4 : 0.12) : 1) * (st.pale ? 0.5 : 1);
    cx.globalAlpha = alpha;
    if (!asCard) {
      const r = starRadius(st, cam.k);
      const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
      g.addColorStop(0, st.color);
      g.addColorStop(0.35, `${st.color}66`);
      g.addColorStop(1, `${st.color}00`);
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
      cx.fill();
      cx.fillStyle = '#fff';
      cx.beginPath();
      cx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2);
      cx.fill();
      if (st.lone) {
        const onScreen = p.x > -20 && p.y > -20 && p.x < w + 20 && p.y < h + 20;
        ring ||= onScreen;
        const ph = (now / 900) % 1;
        cx.strokeStyle = '#ffffff';
        cx.lineWidth = 1.5;
        cx.beginPath();
        cx.arc(p.x, p.y, r * 1.25 + 2, 0, Math.PI * 2);
        cx.stroke();
        cx.globalAlpha = alpha * (1 - ph);
        cx.beginPath();
        cx.arc(p.x, p.y, r * 1.25 + 2 + ph * 10, 0, Math.PI * 2);
        cx.stroke();
        cx.globalAlpha = alpha;
      }
      if (!dim || (s.selectedId && vis(st.id))) {
        labels.push({ st, x: p.x, y: p.y, r, alpha, rank: st.id === focus ? 0 : focusN.has(st.id) ? 1 : st.lone ? 2 : s.matched ? 3 : 4 });
      }
    } else {
      drawCard(cx, st, p, cam.k, st.id === focus);
    }
  }

  const boxes: [number, number, number, number][] = [];
  labels.sort((a, b) => a.rank - b.rank);
  const fs = Math.max(9, Math.min(13, 8 + cam.k * 4));
  for (const { st, x, y, r, alpha, rank } of labels) {
    cx.font = `${st.lone || rank === 0 ? 600 : 400} ${fs}px ${FONT}`;
    const tw = cx.measureText(st.label).width;
    const lx = x + r + 4;
    const ly = y + fs * 0.35;
    const box: [number, number, number, number] = [lx, ly - fs, lx + tw, ly + 2];
    if (rank > 1 && boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
    boxes.push(box);
    cx.globalAlpha = alpha;
    cx.fillStyle = st.lone || rank === 0 ? '#ffffff' : 'rgba(200,206,225,.8)';
    cx.fillText(st.label, lx, ly);
  }
  cx.globalAlpha = 1;
  return ring;
}

/** Carte dessinée (vue rapprochée) : titre, discipline et nombre, puis les noms. */
function drawCard(cx: CanvasRenderingContext2D, st: Star, p: Point, k: number, focused: boolean) {
  const { w, h, kk, names } = cardBox(st, k);
  const n = st.names.length;
  const alpha = cx.globalAlpha;
  roundRect(cx, p.x - w / 2, p.y - h / 2, w, h, 6 * kk);
  cx.fillStyle = '#121726f2';
  cx.fill();
  cx.lineWidth = focused || st.lone ? 2.5 : 1.2;
  cx.strokeStyle = st.lone ? '#ffffff' : st.color;
  if (st.lone) cx.setLineDash([6 * kk, 4 * kk]);
  cx.stroke();
  cx.setLineDash([]);
  cx.fillStyle = st.color;
  cx.fillRect(p.x - w / 2, p.y - h / 2 + 6 * kk, 3 * kk, 18 * kk);
  cx.fillStyle = '#fff';
  cx.font = `600 ${11 * kk}px ${FONT}`;
  cx.fillText(st.title, p.x - w / 2 + 8 * kk, p.y - h / 2 + 14 * kk, w - 14 * kk);
  cx.fillStyle = st.lone ? '#ffffff' : '#9aa3bd';
  cx.font = `${st.lone ? '600 ' : ''}${9.5 * kk}px ${FONT}`;
  cx.fillText(`${st.sub} · ${n} combattant${n > 1 ? 's' : ''}${st.lone ? ' — seul' : ''}`, p.x - w / 2 + 8 * kk, p.y - h / 2 + 25 * kk, w - 14 * kk);
  if (names) {
    cx.font = `${10 * kk}px ${FONT}`;
    cx.fillStyle = st.lone ? '#ffffff' : '#d5dae8';
    st.names.slice(0, MAX_NAMES).forEach((f, i) => cx.fillText(`• ${f}`, p.x - w / 2 + 10 * kk, p.y - h / 2 + (40 + i * 13) * kk, w - 16 * kk));
    if (n > MAX_NAMES) {
      cx.fillStyle = '#9aa3bd';
      cx.fillText(`+ ${n - MAX_NAMES} autre${n - MAX_NAMES > 1 ? 's' : ''}`, p.x - w / 2 + 10 * kk, p.y - h / 2 + (40 + MAX_NAMES * 13) * kk, w - 16 * kk);
    }
  }
  cx.globalAlpha = alpha;
}

/** Étoile sous le pointeur (places affichées), hors cartes posées par-dessus. */
export function starAt(s: Pick<Scene, 'stars' | 'pos' | 'overlaid'>, cam: Camera, w: number, h: number, mx: number, my: number): string | null {
  const asCard = CARD_W * cam.k >= CARD_FROM_PX;
  let best: string | null = null;
  let bd = Infinity;
  for (const st of s.stars) {
    if (s.overlaid.has(st.id)) continue;
    const base = s.pos.get(st.id);
    if (!base) continue;
    const p = toScreen(base, cam, w, h);
    const dx = Math.abs(p.x - mx);
    const dy = Math.abs(p.y - my);
    const d = Math.hypot(dx, dy);
    const hit = asCard ? (() => { const b = cardBox(st, cam.k); return dx <= b.w / 2 && dy <= b.h / 2; })() : d < 14;
    if (hit && d < bd) { bd = d; best = st.id; }
  }
  return best;
}

/** Caméra qui cadre ces places (zoom borné entre `kMin` et 2). */
export function fitCamera(points: Point[], w: number, h: number, kMin: number): Camera {
  if (points.length === 0) return { k: 1, px: 0, py: 0 };
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const k = Math.max(kMin, Math.min(2, (w - 40) / (x1 - x0 + 160), (h - 40) / (y1 - y0 + 100)));
  return { k, px: -((x0 + x1) / 2) * k, py: -((y0 + y1) / 2) * k };
}
