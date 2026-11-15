import { keyString, type CategoryKey } from '../categories.js';
import { DISCIPLINES, RULESETS } from '../disciplines.js';
import { weightClassesFor } from '../grid.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from '../types.js';
import { cellsOf, galaxyLinks, linkKind, rulesFrom, type LinkKind } from './links.js';

// Places de la galaxie des catégories (spec étape 48, §5.2) : calculées une fois sur toutes les cases possibles de la
// grille (ressorts sur les voisinages + répulsion, puis écartement des cartes), elles ne dépendent que de la grille.

export const CARD_W = 40; // largeur d'une carte, en unités de la galaxie
export const CARD_H = (34 + 13 * 5) * 40 / 150; // carte pleine : 4 noms + « + n autres »
export interface Point { x: number; y: number }

const SEXES: Sex[] = ['F', 'M'];
/** Longueurs relatives des liens (Global Constraints) : un ordre naturel fixe, pas l'ordre des règles de la compétition. */
const LENGTH: Record<LinkKind, number> = { weight: 1, age: 1.6, ruleset: 2.2, discipline: 2.8, sex: 3.2 };
const L = 70;
const ITERATIONS = 500;
const REPULSION = 1400;
const REPULSION_RADIUS = 200;
const STIFFNESS = 0.12;
const MAX_STEP = 25;
const SEPARATION_PASSES = 120;
/** Écart de départ entre deux étages (discipline × règlement). */
const FLOOR = 300;
const GAP_W = CARD_W + 6;
const GAP_H = CARD_H + 5;

/** Toutes les cases possibles : discipline avec poids × {jiyu ; shobu si tranche adulte} × F/M × tranche × classe ; kata × F/M × tranche. */
export function gridCells(grid: CategoryGrid): CategoryKey[] {
  const bands = [...grid.ageBands].sort((a, b) => a.sortOrder - b.sortOrder);
  const out: CategoryKey[] = [];
  for (const discipline of Object.keys(DISCIPLINES) as DisciplineId[]) {
    const weighted = DISCIPLINES[discipline].hasWeight;
    const rulesets: (Ruleset | null)[] = weighted ? (Object.keys(RULESETS) as Ruleset[]) : [null];
    for (const ruleset of rulesets) {
      for (const sex of SEXES) {
        for (const band of bands) {
          if (ruleset && RULESETS[ruleset].adultsOnly && band.isMinor) continue;
          const cell = (weightClassIds: string[]): CategoryKey => ({ discipline, ruleset, sex, ageBandCodes: [band.code], weightClassIds });
          if (weighted) for (const w of weightClassesFor(grid, band.code, sex)) out.push(cell([w.id]));
          else out.push(cell([]));
        }
      }
    }
  }
  return out;
}

/** Générateur à graine fixe (Park-Miller), comme la maquette : mêmes tirages à chaque calcul. */
function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Paires candidates (i < j) d'une grille spatiale de pas `size` : les points des 9 seaux autour de chaque point. Toute
 * paire à moins de `size` sur chaque axe y figure une fois, dans un ordre stable (calcul en n plutôt qu'en n²).
 * Les `count` premières valeurs de `pairs` : i, j, i, j…
 */
function nearPairs(xs: Float64Array, ys: Float64Array, size: number): { pairs: Int32Array; count: number } {
  const n = xs.length;
  if (n === 0) return { pairs: new Int32Array(0), count: 0 };
  const bx = new Int32Array(n);
  const by = new Int32Array(n);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    bx[i] = Math.floor(xs[i]! / size);
    by[i] = Math.floor(ys[i]! / size);
    minX = Math.min(minX, bx[i]!);
    minY = Math.min(minY, by[i]!);
    maxX = Math.max(maxX, bx[i]!);
    maxY = Math.max(maxY, by[i]!);
  }
  // Tri par seau (comptage) : les points de chaque seau, par indice croissant.
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const start = new Int32Array(width * height + 1);
  for (let i = 0; i < n; i++) start[(bx[i]! - minX) + (by[i]! - minY) * width + 1]!++;
  for (let c = 0; c < width * height; c++) start[c + 1]! += start[c]!;
  const fill = start.slice(0, width * height);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[(bx[i]! - minX) + (by[i]! - minY) * width]!++] = i;

  let pairs = new Int32Array(n * 64);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const [cx, cy] = [bx[i]! - minX, by[i]! - minY];
    for (let x = Math.max(0, cx - 1); x <= Math.min(width - 1, cx + 1); x++) {
      for (let y = Math.max(0, cy - 1); y <= Math.min(height - 1, cy + 1); y++) {
        const c = x + y * width;
        for (let k = start[c]!; k < start[c + 1]!; k++) {
          const j = order[k]!;
          if (j <= i) continue;
          if (count + 2 > pairs.length) {
            const bigger = new Int32Array(pairs.length * 2);
            bigger.set(pairs);
            pairs = bigger;
          }
          pairs[count++] = i;
          pairs[count++] = j;
        }
      }
    }
  }
  return { pairs, count };
}

/**
 * Écartement : deux cartes dont les rectangles se recouvrent (détection `w` × `h`) s'écartent sur l'axe du plus petit
 * recouvrement, jusqu'à GAP_W × GAP_H. S'arrête plus tôt quand plus rien ne se recouvre.
 */
function separate(xs: Float64Array, ys: Float64Array, w: number, h: number): void {
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let moved = false;
    const { pairs, count } = nearPairs(xs, ys, Math.max(GAP_W, GAP_H));
    for (let p = 0; p < count; p += 2) {
      const i = pairs[p]!;
      const j = pairs[p + 1]!;
      const dx = xs[j]! - xs[i]!;
      const dy = ys[j]! - ys[i]!;
      if (Math.abs(dx) >= w || Math.abs(dy) >= h) continue;
      const ox = GAP_W - Math.abs(dx);
      const oy = GAP_H - Math.abs(dy);
      moved = true;
      if (ox < oy) {
        const m = (ox / 2) * (dx < 0 ? -1 : 1);
        xs[i] = xs[i]! - m;
        xs[j] = xs[j]! + m;
      } else {
        const m = (oy / 2) * (dy < 0 ? -1 : 1);
        ys[i] = ys[i]! - m;
        ys[j] = ys[j]! + m;
      }
    }
    if (!moved) return;
  }
}

/** Place de chaque case (clé : keyString). Déterministe, ne dépend que de la grille. */
export function galaxyLayout(grid: CategoryGrid): Map<string, Point> {
  const cells = gridCells(grid);
  const ids = cells.map(keyString);
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = cells.length;

  // Point de départ : x selon la tranche et le sexe, y selon le rang de poids, décalé par discipline et règlement.
  const bandRank = new Map([...grid.ageBands].sort((a, b) => a.sortOrder - b.sortOrder).map((b, i) => [b.code, i]));
  const rnd = random(7);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const mid = (bandRank.size * 2 - 1) / 2;
  // Un « étage » par discipline et règlement, comme les étages de la maquette : les liens les rapprochent ensuite.
  const floorOf = (c: CategoryKey) => `${c.discipline}|${c.ruleset ?? ''}`;
  const floors = [...new Set(cells.map(floorOf))];
  const midFloor = (floors.length - 1) / 2;
  cells.forEach((c, i) => {
    const band = c.ageBandCodes[0]!;
    const sex = c.sex as Sex;
    const weightRank = c.weightClassIds.length ? weightClassesFor(grid, band, sex).findIndex((w) => w.id === c.weightClassIds[0]) : 0;
    xs[i] = ((bandRank.get(band) ?? 0) * 2 + (sex === 'M' ? 1 : 0) - mid) * 48 * 1.2 + (rnd() - 0.5) * 40;
    ys[i] = (140 - weightRank * 40) * 1.2 + (floors.indexOf(floorOf(c)) - midFloor) * FLOOR + (rnd() - 0.5) * 40;
  });

  // Ressorts : tous les voisinages possibles (toutes les règles), longueur selon leur nature.
  const springs = galaxyLinks(cells.map((key, i) => ({ id: ids[i]!, key })), grid, null).map((l) => ({
    i: index.get(l.a)!,
    j: index.get(l.b)!,
    length: L * LENGTH[linkKind(rulesFrom(l, l.a))],
  }));

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const r2 = REPULSION_RADIUS * REPULSION_RADIUS;
  for (let it = 0; it < ITERATIONS; it++) {
    fx.fill(0);
    fy.fill(0);
    const cool = 1 - it / ITERATIONS;
    const { pairs, count } = nearPairs(xs, ys, REPULSION_RADIUS);
    for (let p = 0; p < count; p += 2) {
      const i = pairs[p]!;
      const j = pairs[p + 1]!;
      const dx = xs[i]! - xs[j]!;
      const dy = ys[i]! - ys[j]!;
      const d2 = dx * dx + dy * dy + 1;
      if (d2 > r2) continue;
      const f = REPULSION / d2;
      fx[i] = fx[i]! + dx * f;
      fy[i] = fy[i]! + dy * f;
      fx[j] = fx[j]! - dx * f;
      fy[j] = fy[j]! - dy * f;
    }
    for (const { i, j, length } of springs) {
      const dx = xs[j]! - xs[i]!;
      const dy = ys[j]! - ys[i]!;
      const d = Math.hypot(dx, dy) + 0.01;
      const k = ((d - length) / d) * STIFFNESS;
      fx[i] = fx[i]! + dx * k;
      fy[i] = fy[i]! + dy * k;
      fx[j] = fx[j]! - dx * k;
      fy[j] = fy[j]! - dy * k;
    }
    const step = 0.15 + cool;
    for (let i = 0; i < n; i++) {
      xs[i] = xs[i]! + Math.max(-MAX_STEP, Math.min(MAX_STEP, fx[i]!)) * step;
      ys[i] = ys[i]! + Math.max(-MAX_STEP, Math.min(MAX_STEP, fy[i]!)) * step;
    }
  }

  separate(xs, ys, GAP_W, GAP_H);
  return new Map(ids.map((id, i) => [id, { x: xs[i]!, y: ys[i]! }]));
}

/**
 * Place d'une catégorie : barycentre de ses cases connues ; tableaux libres et clés inconnues dans un amas à part
 * (droite du nuage), rangés par libellé. Deux catégories réelles qui tombent l'une sur l'autre (regroupement) sont
 * écartées ; les autres gardent la place de leurs cases.
 */
export function placeCategories(cats: { id: string; key: CategoryKey; label: string }[], layout: Map<string, Point>, grid: CategoryGrid): Map<string, Point> {
  const out = new Map<string, Point>();
  const placed: { id: string; x: number; y: number }[] = [];
  const apart: { id: string; label: string }[] = [];
  for (const c of cats) {
    const points = cellsOf(c.key, grid).map((k) => layout.get(keyString(k))).filter((p): p is Point => p !== undefined);
    if (points.length === 0) apart.push(c);
    else placed.push({ id: c.id, x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length });
  }

  // Écartement des catégories réelles qui se chevauchent vraiment (cartes de CARD_W × CARD_H).
  const xs = Float64Array.from(placed, (p) => p.x);
  const ys = Float64Array.from(placed, (p) => p.y);
  separate(xs, ys, CARD_W, CARD_H);
  placed.forEach((p, i) => out.set(p.id, { x: xs[i]!, y: ys[i]! }));

  // Amas à part : colonnes de haut en bas, à droite de toutes les cases de la grille, centré sur le nuage.
  if (apart.length > 0) {
    const all = [...layout.values()];
    const maxX = all.length ? Math.max(...all.map((p) => p.x)) : 0;
    const cy = all.length ? (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2 : 0;
    const rows = Math.ceil(Math.sqrt(apart.length));
    apart.sort((a, b) => a.label.localeCompare(b.label, 'fr') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    apart.forEach((c, i) => {
      out.set(c.id, { x: maxX + 2 * CARD_W + Math.floor(i / rows) * GAP_W, y: cy + (i % rows - (rows - 1) / 2) * GAP_H });
    });
  }
  return out;
}
