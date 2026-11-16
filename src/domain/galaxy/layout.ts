import { keyString, type CategoryKey } from '../categories.js';
import { DISCIPLINES, RULESETS } from '../disciplines.js';
import { weightClassesFor } from '../grid.js';
import { normalizeName } from '../names.js';
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
/**
 * Raideur relative par nature de lien. Chaque ressort est aussi divisé par le nombre moyen de liens de sa nature sur
 * ses deux cases : sans cela, les quelque 12 liens « autre discipline » d'une case écrasent ses 2 liens « poids
 * voisin », et les poids voisins finissent aussi loin que les autres disciplines. Le poids et l'âge tiennent plus fort,
 * pour que la distance suive la nature du lien (poids, puis âge, puis discipline).
 */
const STRENGTH: Record<LinkKind, number> = { weight: 2, age: 3, ruleset: 1, discipline: 1, sex: 1 };
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
 * recouvrement, jusqu'à GAP_W × GAP_H. S'arrête plus tôt quand plus rien ne se recouvre. Repli (grille trop dense pour
 * converger en SEPARATION_PASSES passes) : chaque carte encore en recouvrement va à la place libre la plus proche.
 * Rend false si ce repli a servi.
 */
export function separate(xs: Float64Array, ys: Float64Array, w: number, h: number): boolean {
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
    if (!moved) return true;
  }
  settle(xs, ys, w, h);
  return false;
}

/**
 * Repli de `separate` : les cartes sont reprises dans l'ordre ; une carte qui recouvre une carte déjà posée va à la
 * place libre la plus proche, cherchée sur des anneaux de plus en plus grands de pas GAP_W × GAP_H. Déterministe, et
 * sans recouvrement à la fin.
 */
function settle(xs: Float64Array, ys: Float64Array, w: number, h: number): void {
  // Cartes posées, rangées par seau de GAP_W × GAP_H : un recouvrement ne se cherche que dans les seaux voisins.
  const buckets = new Map<string, number[]>();
  const cell = (x: number, y: number) => [Math.floor(x / GAP_W), Math.floor(y / GAP_H)] as const;
  const free = (x: number, y: number) => {
    const [cx, cy] = cell(x, y);
    for (let bx = cx - 1; bx <= cx + 1; bx++) {
      for (let by = cy - 1; by <= cy + 1; by++) {
        for (const j of buckets.get(`${bx},${by}`) ?? []) if (Math.abs(xs[j]! - x) < w && Math.abs(ys[j]! - y) < h) return false;
      }
    }
    return true;
  };
  for (let i = 0; i < xs.length; i++) {
    const [x0, y0] = [xs[i]!, ys[i]!];
    if (!free(x0, y0)) {
      search: for (let r = 1; ; r++) {
        // Anneau r : les places à r pas (sur l'un des axes au moins), de la plus proche à la plus loin.
        const ring: [number, number][] = [];
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (Math.max(Math.abs(a), Math.abs(b)) === r) ring.push([a * GAP_W, b * GAP_H]);
        ring.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]) || p[1] - q[1] || p[0] - q[0]);
        for (const [dx, dy] of ring) {
          if (free(x0 + dx, y0 + dy)) { xs[i] = x0 + dx; ys[i] = y0 + dy; break search; }
        }
      }
    }
    const [cx, cy] = cell(xs[i]!, ys[i]!);
    const k = `${cx},${cy}`;
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
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

  // Ressorts : tous les voisinages possibles (toutes les règles), longueur et raideur selon leur nature.
  const links = galaxyLinks(cells.map((key, i) => ({ id: ids[i]!, key })), grid, null).map((l) => ({
    i: index.get(l.a)!,
    j: index.get(l.b)!,
    kind: linkKind(rulesFrom(l, l.a)),
  }));
  const kinds = Object.keys(LENGTH) as LinkKind[];
  const kindIndex = new Map(kinds.map((k, i) => [k, i]));
  const perCell = new Int32Array(n * kinds.length); // nombre de liens de chaque nature, par case
  const slot = (cell: number, kind: LinkKind) => cell * kinds.length + kindIndex.get(kind)!;
  for (const { i, j, kind } of links) {
    perCell[slot(i, kind)]!++;
    perCell[slot(j, kind)]!++;
  }
  const springs = links.map(({ i, j, kind }) => {
    const shared = (perCell[slot(i, kind)]! + perCell[slot(j, kind)]!) / 2;
    return { i, j, length: L * LENGTH[kind], stiffness: (STIFFNESS * STRENGTH[kind]) / shared };
  });

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
    for (const { i, j, length, stiffness } of springs) {
      const dx = xs[j]! - xs[i]!;
      const dy = ys[j]! - ys[i]!;
      // Math.sqrt, pas Math.hypot : la racine est arrondie pareil sur tous les moteurs (mêmes places sur tous les postes).
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const k = ((d - length) / d) * stiffness;
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

/** Dernière grille calculée : sa signature, la grille elle-même (raccourci) et ses places. */
let cache: { grid: CategoryGrid; signature: string; layout: Map<string, Point> } | null = null;

/**
 * `galaxyLayout`, gardé en mémoire tant que la grille ne change pas (spec §5.2) : d'une ouverture de la galaxie à
 * l'autre, le calcul (≈ 350 ms) n'est pas refait. Une seule grille retenue (la compétition ouverte). La Map rendue est
 * partagée : ne pas la modifier.
 */
export function cachedGalaxyLayout(grid: CategoryGrid): Map<string, Point> {
  if (cache?.grid === grid) return cache.layout;
  const signature = JSON.stringify(grid);
  if (cache?.signature === signature) {
    cache.grid = grid;
    return cache.layout;
  }
  cache = { grid, signature, layout: galaxyLayout(grid) };
  return cache.layout;
}

/** Ordre des libellés, le même sur tous les postes (sans dépendre de la langue du navigateur) : sans accents ni casse, puis tel quel. */
function compareLabels(a: string, b: string): number {
  const [x, y] = [normalizeName(a), normalizeName(b)];
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
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
    // Bornes en boucle (pas de Math.max(...) : sa liste d'arguments est limitée, une grande grille la dépasserait).
    let [maxX, minY, maxY] = [-Infinity, Infinity, -Infinity];
    for (const p of layout.values()) {
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (layout.size === 0) [maxX, minY, maxY] = [0, 0, 0];
    const cy = (minY + maxY) / 2;
    const rows = Math.ceil(Math.sqrt(apart.length));
    apart.sort((a, b) => compareLabels(a.label, b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    apart.forEach((c, i) => {
      out.set(c.id, { x: maxX + 2 * CARD_W + Math.floor(i / rows) * GAP_W, y: cy + (i % rows - (rows - 1) / 2) * GAP_H });
    });
  }
  return out;
}
