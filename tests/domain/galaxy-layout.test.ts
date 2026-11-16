import { afterEach, describe, expect, test, vi } from 'vitest';
import { freeKey, keyString, type CategoryKey } from '../../src/domain/categories.js';
import { CARD_H, CARD_W, cachedGalaxyLayout, galaxyLayout, gridCells, placeCategories, separate, type Point } from '../../src/domain/galaxy/layout.js';
import { galaxyLinks, linkKind, rulesFrom, type LinkKind } from '../../src/domain/galaxy/links.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { DisciplineId, Ruleset } from '../../src/domain/types.js';

const grid = ffkDefaultGrid();
const cells = gridCells(grid);
const layout = galaxyLayout(grid);

const key = (discipline: DisciplineId, ruleset: Ruleset | null, sex: 'F' | 'M' | 'X', bands: string[], weights: string[]): CategoryKey => ({
  discipline, ruleset, sex, ageBandCodes: bands, weightClassIds: weights,
});
const at = (k: CategoryKey): Point => layout.get(keyString(k))!;
const dist = (p: Point, q: Point) => Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
afterEach(() => { vi.restoreAllMocks(); });
const overlaps = (p: Point, q: Point) => Math.abs(p.x - q.x) < CARD_W && Math.abs(p.y - q.y) < CARD_H;

describe('gridCells', () => {
  const ids = new Set(cells.map(keyString));

  test('toutes les cases possibles de la grille FFK, sans doublon', () => {
    expect(ids.has(keyString(key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-54'])))).toBe(true);
    expect(ids.has(keyString(key('karate', 'shobu', 'M', ['senior'], ['senior:M:-75'])))).toBe(true);
    expect(cells.some((c) => c.discipline === 'karate' && c.ruleset === 'shobu' && c.ageBandCodes[0] === 'cadet')).toBe(false);
    expect(ids.has(keyString(key('kata', null, 'F', ['cadet'], [])))).toBe(true);
    expect(ids.size).toBe(cells.length);
  });
});

describe('galaxyLayout', () => {
  test('une place pour chaque case', () => {
    expect(layout.size).toBe(cells.length);
    for (const c of cells) expect(layout.has(keyString(c))).toBe(true);
  });

  test('est déterministe', () => {
    expect(galaxyLayout(grid)).toEqual(layout);
  });

  test('les mêmes places sur tous les moteurs : ni Math.hypot ni comparaison selon la langue (spec §5.2)', () => {
    // Math.hypot n'est pas arrondi pareil partout (Safari / Chrome) ; Math.sqrt l'est (IEEE 754).
    const hypot = vi.spyOn(Math, 'hypot').mockImplementation(() => { throw new Error('Math.hypot dans le calcul des places'); });
    const compare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => { throw new Error('localeCompare dans le calcul des places'); });
    const fresh = galaxyLayout(grid);
    expect(fresh).toEqual(layout);
    const cats = [
      { id: 'b', key: freeKey('Open', 'karate', 'jiyu'), label: 'Open' },
      { id: 'a', key: freeKey('Éclair', 'karate', 'jiyu'), label: 'Éclair' },
    ];
    const places = placeCategories(cats, fresh, grid);
    // Rangés par libellé sans accent : Éclair (E) avant Open.
    expect(places.get('a')!.y).toBeLessThan(places.get('b')!.y);
    expect(hypot).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  test('aucune carte ne chevauche une autre', () => {
    const points = [...layout.values()];
    const bad: [Point, Point][] = [];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (overlaps(points[i]!, points[j]!)) bad.push([points[i]!, points[j]!]);
    expect(bad).toEqual([]);
  });

  test('les voisines sont plus proches que les autres', () => {
    const links = galaxyLinks(cells.map((k) => ({ id: keyString(k), key: k })), grid, null);
    // Distance moyenne, case par case, à ses voisines d'une nature donnée ; puis moyenne sur les cases.
    const byCell = new Map<string, Map<LinkKind, number[]>>();
    for (const l of links) {
      const kind = linkKind(rulesFrom(l, l.a));
      const d = dist(layout.get(l.a)!, layout.get(l.b)!);
      for (const id of [l.a, l.b]) {
        const m = byCell.get(id) ?? new Map<LinkKind, number[]>();
        m.set(kind, [...(m.get(kind) ?? []), d]);
        byCell.set(id, m);
      }
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const meanFor = (kind: LinkKind) => mean([...byCell.values()].flatMap((m) => (m.has(kind) ? [mean(m.get(kind)!)] : [])));
    const points = [...layout.values()];
    const all: number[] = [];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) all.push(dist(points[i]!, points[j]!));
    all.sort((a, b) => a - b);
    const median = all[Math.floor(all.length / 2)]!;
    // Plus on s'éloigne en poids, en âge ou en discipline, plus les catégories sont éloignées (avec de la marge).
    expect(meanFor('weight')).toBeLessThanOrEqual(0.7 * meanFor('discipline'));
    expect(meanFor('age')).toBeLessThan(meanFor('discipline'));
    expect(meanFor('discipline')).toBeLessThan(median);
  });
});

describe('cachedGalaxyLayout', () => {
  test('gardé en mémoire tant que la grille ne change pas (spec §5.2), recalculé quand elle change', () => {
    const first = cachedGalaxyLayout(grid);
    expect(first).toEqual(layout);
    // Une grille égale (autre objet, comme après un nouveau chargement) : pas de nouveau calcul, la même Map.
    expect(cachedGalaxyLayout(structuredClone(grid))).toBe(first);
    expect(cachedGalaxyLayout(grid)).toBe(first);
    // Une grille modifiée : nouveau calcul.
    const changed = structuredClone(grid);
    changed.weightClasses = changed.weightClasses.filter((w) => w.id !== 'cadet:F:-54');
    const other = cachedGalaxyLayout(changed);
    expect(other).not.toBe(first);
    expect(other.has(keyString(key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-54'])))).toBe(false);
    expect(cachedGalaxyLayout(changed)).toBe(other);
  });
});

describe('placeCategories', () => {
  test('Cadets+Juniors F -54+-53 au barycentre de ses deux cases ; sexe X entre ses cases F et M', () => {
    const grouped = key('karate', 'jiyu', 'F', ['cadet', 'junior'], ['cadet:F:-54', 'junior:F:-53']);
    const mixed = key('shido-boxing', 'jiyu', 'X', ['minime'], ['minime:F:-40', 'minime:M:-45']);
    const places = placeCategories([{ id: 'g', key: grouped, label: 'g' }], layout, grid);
    const [c, j] = [at(key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-54'])), at(key('karate', 'jiyu', 'F', ['junior'], ['junior:F:-53']))];
    expect(places.get('g')!.x).toBeCloseTo((c.x + j.x) / 2, 9);
    expect(places.get('g')!.y).toBeCloseTo((c.y + j.y) / 2, 9);
    const mixedPlaces = placeCategories([{ id: 'x', key: mixed, label: 'x' }], layout, grid);
    const [f, m] = [at(key('shido-boxing', 'jiyu', 'F', ['minime'], ['minime:F:-40'])), at(key('shido-boxing', 'jiyu', 'M', ['minime'], ['minime:M:-45']))];
    expect(mixedPlaces.get('x')!.x).toBeCloseTo((f.x + m.x) / 2, 9);
    expect(mixedPlaces.get('x')!.y).toBeCloseTo((f.y + m.y) / 2, 9);
  });

  test('une catégorie à sa case garde la place de sa case', () => {
    const k = key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-54']);
    expect(placeCategories([{ id: 'c', key: k, label: 'c' }], layout, grid).get('c')).toEqual(at(k));
  });

  test('tableau libre et clé inconnue dans l’amas à part, à droite de toutes les cases, sans chevauchement, rangés par libellé', () => {
    const cats = [
      { id: 'libre-b', key: freeKey('Open B', 'karate', 'jiyu'), label: 'Open B' },
      { id: 'inconnue', key: key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-99']), label: 'Cadets F -99' },
      { id: 'libre-a', key: freeKey('Open A', 'kata', null), label: 'Open A' },
      { id: 'reelle', key: key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-54']), label: 'Cadets F -54' },
    ];
    const places = placeCategories(cats, layout, grid);
    expect(places.size).toBe(4);
    const maxX = Math.max(...[...layout.values()].map((p) => p.x));
    const apart = ['libre-b', 'inconnue', 'libre-a'].map((id) => places.get(id)!);
    for (const p of apart) expect(p.x - CARD_W / 2).toBeGreaterThan(maxX + CARD_W / 2);
    for (let i = 0; i < apart.length; i++) for (let j = i + 1; j < apart.length; j++) expect(overlaps(apart[i]!, apart[j]!)).toBe(false);
    // Rangés par libellé : Cadets F -99, Open A, Open B (de haut en bas puis de gauche à droite).
    const order = ['inconnue', 'libre-a', 'libre-b'].map((id) => places.get(id)!);
    const rank = (p: Point) => p.x * 1e6 + p.y;
    expect(rank(order[0]!)).toBeLessThan(rank(order[1]!));
    expect(rank(order[1]!)).toBeLessThan(rank(order[2]!));
  });

  test('deux catégories réelles au même endroit sont écartées', () => {
    // Le regroupement F -54 + M -57 tombe entre ses cases ; deux copies au même endroit ne doivent pas se chevaucher.
    const k = key('karate', 'jiyu', 'X', ['cadet'], ['cadet:F:-54', 'cadet:M:-57']);
    const places = placeCategories([{ id: 'a', key: k, label: 'a' }, { id: 'b', key: k, label: 'b' }], layout, grid);
    expect(overlaps(places.get('a')!, places.get('b')!)).toBe(false);
  });

  test('une catégorie garde sa place quand d’autres catégories arrivent ailleurs', () => {
    const k = key('karate', 'jiyu', 'F', ['cadet'], ['cadet:F:-54']);
    const alone = placeCategories([{ id: 'c', key: k, label: 'c' }], layout, grid).get('c');
    const others = [
      { id: 'j', key: key('karate', 'jiyu', 'M', ['junior'], ['junior:M:-60']), label: 'j' },
      { id: 'k', key: key('kata', null, 'F', ['minime'], []), label: 'k' },
      { id: 'l', key: freeKey('Open', 'karate', 'jiyu'), label: 'Open' },
    ];
    expect(placeCategories([...others, { id: 'c', key: k, label: 'c' }], layout, grid).get('c')).toEqual(alone);
  });
});

describe('separate', () => {
  test('deux cartes l’une sur l’autre : écartées sans le repli', () => {
    const [xs, ys] = [Float64Array.from([0, 1]), Float64Array.from([0, 1])];
    expect(separate(xs, ys, CARD_W, CARD_H)).toBe(true);
    expect(overlaps({ x: xs[0]!, y: ys[0]! }, { x: xs[1]!, y: ys[1]! })).toBe(false);
  });

  test('une grille dense (200 cartes au même endroit) finit sans chevauchement, par le repli', () => {
    const n = 200;
    const xs = Float64Array.from({ length: n }, (_, i) => (i % 7) * 0.5);
    const ys = Float64Array.from({ length: n }, (_, i) => Math.floor(i / 7) * 0.5);
    expect(separate(xs, ys, CARD_W, CARD_H)).toBe(false);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) expect(overlaps({ x: xs[i]!, y: ys[i]! }, { x: xs[j]!, y: ys[j]! })).toBe(false);
    }
  });
});
