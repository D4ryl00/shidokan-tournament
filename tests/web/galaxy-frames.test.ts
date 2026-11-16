import { expect, test } from 'vitest';
import { frameLoop, type FrameEnv } from '../../src/web/components/galaxy/useGalaxyCamera.js';

/** Horloge factice : images à 60 Hz, minuteries ; `advance` fait passer le temps. */
function fakeEnv() {
  let t = 0;
  let nextId = 1;
  const rafs = new Map<number, (now: number) => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  let nextVsync = 1000 / 60;
  const env: FrameEnv = {
    raf: (cb) => { const id = nextId++; rafs.set(id, cb); return id; },
    cancelRaf: (id) => { rafs.delete(id); },
    setTimeout: (cb, ms) => { const id = nextId++; timers.set(id, { at: t + ms, cb }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
    now: () => t,
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const timer = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      const next = Math.min(nextVsync, timer ? timer[1].at : Infinity);
      if (next > end) break;
      t = next;
      if (timer && timer[1].at === next) { timers.delete(timer[0]); timer[1].cb(); continue; }
      nextVsync += 1000 / 60;
      const due = [...rafs.values()];
      rafs.clear();
      for (const cb of due) cb(t);
    }
    t = end;
  };
  return { env, advance };
}

test('frameLoop : pleine cadence tant que la caméra bouge', () => {
  const { env, advance } = fakeEnv();
  let frames = 0;
  const loop = frameLoop(() => { frames++; return { moving: true, again: false }; }, env);
  loop.request();
  advance(1000);
  expect(frames).toBeGreaterThanOrEqual(58);
  loop.stop();
});

test('frameLoop : seul un anneau qui pulse : environ 24 images par seconde, pas 60', () => {
  const { env, advance } = fakeEnv();
  let frames = 0;
  const loop = frameLoop(() => { frames++; return { moving: false, again: true }; }, env);
  loop.request();
  advance(1000);
  expect(frames).toBeGreaterThanOrEqual(20);
  expect(frames).toBeLessThanOrEqual(26);
  // Une demande (la caméra repart) pendant l'attente : une image tout de suite, une seule chaîne d'images ensuite.
  frames = 0;
  loop.request();
  advance(20);
  expect(frames).toBeGreaterThanOrEqual(1);
  frames = 0;
  advance(1000);
  expect(frames).toBeLessThanOrEqual(26);
  loop.stop();
  frames = 0;
  advance(1000);
  expect(frames).toBe(0);
});

test('frameLoop : rien ne bouge : une image, puis plus rien', () => {
  const { env, advance } = fakeEnv();
  let frames = 0;
  const loop = frameLoop(() => { frames++; return { moving: false, again: false }; }, env);
  loop.request();
  loop.request();
  advance(1000);
  expect(frames).toBe(1);
});
