import { expect, test } from 'vitest';
import type { GalaxyLink } from '../../src/domain/galaxy/links.js';
import type { Point } from '../../src/domain/galaxy/layout.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { drawGalaxy, type Scene, type Star } from '../../src/web/components/galaxy/drawGalaxy.js';
import { bestFrom, linkStyle } from '../../src/web/components/galaxy/scene.js';

/** Contexte 2D factice : relève la couleur de chaque trait tracé. */
function fakeContext(): { cx: CanvasRenderingContext2D; strokes: string[] } {
  const strokes: string[] = [];
  const state: Record<string, unknown> = {};
  const cx = new Proxy(state, {
    get(t, k) {
      if (k === 'stroke') return () => strokes.push(String(t.strokeStyle));
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      if (k in t) return t[k as string];
      return () => undefined;
    },
    set(t, k, v) { t[k as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { cx, strokes };
}

const star = (id: string): Star => ({ id, color: '#7aa2ff', label: id, title: id, sub: '', names: ['x', 'y'], lone: false, pale: false });

test('bestFrom : le sens du lien au rang le plus bas (le meilleur des deux sens)', () => {
  const s = defaultSettings();
  const l: GalaxyLink = { a: 'a', b: 'b', fromA: ['discipline'], fromB: ['weight'] };
  expect(bestFrom(l, s)).toBe('b');
  expect(bestFrom({ ...l, fromA: ['weight'], fromB: ['discipline'] }, s)).toBe('a');
  // Un sens interdit : l'autre.
  expect(bestFrom({ ...l, fromA: null, fromB: ['discipline'] }, s)).toBe('b');
});

test('« Tous les liens », rien de choisi : chaque lien a la couleur du meilleur des deux sens (spec §5.1)', () => {
  const settings = defaultSettings();
  // Depuis a : autre discipline (rouge) ; depuis b : poids voisin (vert). Le meilleur sens est b.
  const l: GalaxyLink = { a: 'a', b: 'b', fromA: ['discipline'], fromB: ['weight'] };
  const pos = new Map<string, Point>([['a', { x: -50, y: 0 }], ['b', { x: 50, y: 0 }]]);
  const scene: Scene = {
    stars: [star('a'), star('b')], pos, links: [l], selectedId: null, hoverId: null, overlaid: new Set(), pulledIds: [], matched: null,
    allLinks: true, pull: 0, linkStyle: (x, from) => linkStyle(x, from, settings), linkFrom: (x) => bestFrom(x, settings), linkLabel: () => '',
  };
  const { cx, strokes } = fakeContext();
  drawGalaxy(cx, 800, 600, { k: 1, px: 0, py: 0 }, scene, 0);
  expect(strokes[0]).toBe(linkStyle(l, 'b', settings).color);
  expect(strokes[0]).not.toBe(linkStyle(l, 'a', settings).color);
});
