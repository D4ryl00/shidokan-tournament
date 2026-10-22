import type { Entrant } from './types.js';

/** PRNG reproductible (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Ordre de tirage (= ordre des têtes de série) : mélange au sort, puis les clubs les plus nombreux en tête.
 * Combiné à bracketPositions, les membres d'un même club tombent dans des parties différentes du tableau.
 */
export function drawOrder(entrants: Entrant[], seed: number): Entrant[] {
  const rand = seededRandom(seed);
  const groups = new Map<string, Entrant[]>();
  for (const e of shuffle(entrants, rand)) {
    const key = e.clubId ?? `__${e.registrationId}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length).flat();
}

/** Position (0-based) de chaque tête de série dans un tableau de `size` (puissance de 2) : 1 contre size, 2 contre size-1… */
export function bracketPositions(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    seeds = seeds.flatMap((s) => [s, n + 1 - s]);
  }
  const positions: number[] = [];
  seeds.forEach((seed, slot) => (positions[seed - 1] = slot));
  return positions;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
