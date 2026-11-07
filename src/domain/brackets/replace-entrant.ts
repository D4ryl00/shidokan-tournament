import type { Bracket } from './index.js';
import type { Entrant } from './types.js';

/** Remplace un combattant par un autre, exactement à sa place (cases, poules, ordre kata). Ne modifie pas `b`. */
export function replaceEntrant(b: Bracket, fromId: string, to: Entrant): Bracket {
  const next = structuredClone(b);
  const swap = (id: string) => (id === fromId ? to.registrationId : id);
  next.entrants = next.entrants.map((e) => (e.registrationId === fromId ? { ...to } : e));
  if (next.kind === 'kata') next.order = next.order.map(swap);
  else {
    for (const m of next.matches) {
      for (const side of ['a', 'b'] as const) {
        const src = m[side];
        if (src.kind === 'entrant') m[side] = { kind: 'entrant', registrationId: swap(src.registrationId) };
      }
    }
    if (next.pools) next.pools = next.pools.map((p) => p.map(swap));
  }
  return next;
}
