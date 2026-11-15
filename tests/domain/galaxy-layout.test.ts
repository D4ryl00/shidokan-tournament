import { describe, expect, test } from 'vitest';
import { freeKey, keyString, type CategoryKey } from '../../src/domain/categories.js';
import { CARD_H, CARD_W, galaxyLayout, gridCells, placeCategories, type Point } from '../../src/domain/galaxy/layout.js';
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
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
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
    expect(meanFor('weight')).toBeLessThan(meanFor('discipline'));
    expect(meanFor('discipline')).toBeLessThan(median);
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
});
