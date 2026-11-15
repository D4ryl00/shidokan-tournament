import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Point } from '../../../domain/galaxy/layout.js';
import { flyDuration, K_FULL, type Camera } from './scene.js';

// Caméra de la galaxie (maquette v14) : molette et pincement autour du pointeur, glisser pour déplacer, vol vers une
// étoile (accélération puis ralentissement, zoom en échelle log). Les images ne sont demandées que tant que quelque chose
// bouge : la caméra, un vol, ou ce que `draw` signale (anneaux qui pulsent).

export const K_MIN = 0.15;
const EASE = 0.18;
const clampK = (k: number) => Math.max(K_MIN, Math.min(K_FULL, k));
interface Fly { t0: number; ms: number; k0: number; X0: number; Y0: number; X1: number; Y1: number; oy0: number; oy1: number }
interface Gesture { moved: boolean; sx: number; sy: number; dist?: number; mid?: Point }

export function useGalaxyCamera(o: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Élément qui reçoit la molette (le canevas et les cartes posées dessus). */
  wheelRef: RefObject<HTMLElement | null>;
  size: { w: number; h: number };
  /** Dessine une image ; `true` : redessiner à l'image suivante même si la caméra est immobile. */
  draw: (cam: Camera, now: number) => boolean;
  /** Clic ou toucher sans déplacement, en px du canevas. */
  onTap: (x: number, y: number) => void;
  onHover: (x: number | null, y: number | null) => void;
}) {
  const cam = useRef<Camera>({ k: 1, px: 0, py: 0 });
  const target = useRef<Camera>({ k: 1, px: 0, py: 0 });
  const fly = useRef<Fly | null>(null);
  const raf = useRef(0);
  const latest = useRef(o);
  latest.current = o;
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);

  const frameRef = useRef<(now: number) => void>(() => undefined);
  frameRef.current = (now: number) => {
    raf.current = 0;
    const c = cam.current;
    const t = target.current;
    let moving = false;
    const f = fly.current;
    if (f) {
      const u = Math.max(0, Math.min(1, (now - f.t0) / f.ms));
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const k = Math.exp(Math.log(f.k0) + (Math.log(K_FULL) - Math.log(f.k0)) * e);
      c.k = k;
      c.px = -(f.X0 + (f.X1 - f.X0) * e) * k;
      c.py = -(f.Y0 + (f.Y1 - f.Y0) * e) * k + f.oy0 + (f.oy1 - f.oy0) * e;
      Object.assign(t, c);
      if (u >= 1) fly.current = null;
      moving = true;
    } else {
      for (const key of ['k', 'px', 'py'] as const) {
        const d = t[key] - c[key];
        if (Math.abs(d) > (key === 'k' ? 1e-4 : 0.05)) { c[key] += d * EASE; moving = true; } else c[key] = t[key];
      }
    }
    const again = latest.current.draw(c, now);
    // Pour les tests : la caméra est-elle encore en route (vol ou adoucissement) ?
    const cv = latest.current.canvasRef.current;
    if (cv) cv.dataset.flying = moving ? 'true' : 'false';
    if (moving || again) raf.current = requestAnimationFrame((n) => frameRef.current(n));
  };
  const requestDraw = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame((n) => frameRef.current(n));
  }, []);
  useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  /** Zoom autour d'un point du canevas ; `direct` : sans adoucissement (pincement). Annule le vol en cours. */
  const zoomAt = (x: number, y: number, factor: number, direct: boolean) => {
    const t = target.current;
    const nk = clampK(t.k * factor);
    const r = nk / t.k;
    const mx = x - latest.current.size.w / 2;
    const my = y - latest.current.size.h / 2;
    t.px = mx - (mx - t.px) * r;
    t.py = my - (my - t.py) * r;
    t.k = nk;
    fly.current = null;
    if (direct) Object.assign(cam.current, t);
    requestDraw();
  };

  // Molette : écouteur non passif, pour que la page ne défile pas.
  useEffect(() => {
    const el = o.wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const canvas = latest.current.canvasRef.current;
      if (!canvas) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0015), false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // Le canevas et son cadre sont montés avec le composant : l'élément ne change pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const local = (e: ReactPointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const two = (): [Point, Point] => { const [a, b] = [...pointers.current.values()]; return [a!, b!]; };

  const handlers = {
    onPointerDown: (ev: ReactPointerEvent<HTMLCanvasElement>) => {
      const p = local(ev);
      ev.currentTarget.setPointerCapture(ev.pointerId);
      pointers.current.set(ev.pointerId, p);
      if (pointers.current.size === 1) gesture.current = { moved: false, sx: p.x, sy: p.y };
      else if (pointers.current.size === 2 && gesture.current) {
        const [a, b] = two();
        Object.assign(gesture.current, { moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
      }
    },
    onPointerMove: (ev: ReactPointerEvent<HTMLCanvasElement>) => {
      const p = local(ev);
      const prev = pointers.current.get(ev.pointerId);
      const g = gesture.current;
      if (!prev || !g) { if (ev.pointerType === 'mouse') latest.current.onHover(p.x, p.y); return; }
      pointers.current.set(ev.pointerId, p);
      if (pointers.current.size >= 2) {
        // Deux doigts : zoom autour du milieu, et déplacement du milieu.
        const [a, b] = two();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (g.dist && g.mid) {
          zoomAt(mid.x, mid.y, dist / g.dist, true);
          for (const c of [target.current, cam.current]) { c.px += mid.x - g.mid.x; c.py += mid.y - g.mid.y; }
        }
        g.dist = dist;
        g.mid = mid;
        requestDraw();
        return;
      }
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > 4) g.moved = true;
      if (!g.moved) return;
      fly.current = null;
      for (const c of [target.current, cam.current]) { c.px += p.x - prev.x; c.py += p.y - prev.y; }
      ev.currentTarget.style.cursor = 'grabbing';
      requestDraw();
    },
    onPointerUp: (ev: ReactPointerEvent<HTMLCanvasElement>) => {
      const had = pointers.current.delete(ev.pointerId);
      const g = gesture.current;
      ev.currentTarget.style.cursor = 'grab';
      if (pointers.current.size === 0) {
        gesture.current = null;
        if (had && g && !g.moved) { const p = local(ev); latest.current.onTap(p.x, p.y); }
      } else if (g) { g.dist = undefined; g.mid = undefined; }
    },
    onPointerCancel: (ev: ReactPointerEvent<HTMLCanvasElement>) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size === 0) gesture.current = null;
    },
    onPointerLeave: (ev: ReactPointerEvent<HTMLCanvasElement>) => { if (ev.pointerType === 'mouse' && !gesture.current) latest.current.onHover(null, null); },
  };

  /** Vol jusqu'à une place de la galaxie, au zoom maximal ; elle arrive `offsetY` px sous le milieu (barre flottante). */
  const flyTo = useCallback((p: Point, offsetY = 0) => {
    const c = cam.current;
    const X0 = -c.px / c.k;
    const Y0 = -c.py / c.k;
    const dist = Math.hypot(p.x - X0, p.y - Y0) * c.k;
    fly.current = { t0: performance.now(), ms: flyDuration(dist, c.k), k0: c.k, X0, Y0, X1: p.x, Y1: p.y, oy0: 0, oy1: offsetY };
    const cv = latest.current.canvasRef.current;
    if (cv) cv.dataset.flying = 'true';
    requestDraw();
  }, [requestDraw]);

  /** Nouvelle caméra : tout de suite (`snap`) ou en douceur. */
  const setCamera = useCallback((c: Camera, snap: boolean) => {
    fly.current = null;
    target.current = { ...c, k: clampK(c.k) };
    if (snap) cam.current = { ...target.current };
    requestDraw();
  }, [requestDraw]);

  /** La place visée a bougé (clé élargie) : la caméra la suit, en douceur ou en finissant son vol dessus. */
  const follow = useCallback((dx: number, dy: number) => {
    const f = fly.current;
    if (f) { f.X1 += dx; f.Y1 += dy; } else { target.current.px -= dx * target.current.k; target.current.py -= dy * target.current.k; }
    requestDraw();
  }, [requestDraw]);

  return { cam, requestDraw, flyTo, setCamera, follow, handlers };
}
