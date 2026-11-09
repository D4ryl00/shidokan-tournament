import { describe, expect, it } from 'vitest';
import type { PublicCompetition, PublicEntrant } from '../../src/domain/public/types.js';
import { followedFighters, readPins, writePins } from '../../src/web/publicPins.js';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const entrant = (n: string, fighterId: string | null, clubId: string | null, hidden = false): PublicEntrant => ({
  registrationId: `r-${n}`, fighterId, name: n, shortName: n, club: clubId ?? '', clubId, hidden,
});

describe('publicPins', () => {
  it('pins round-trip', () => {
    const s = fakeStorage();
    expect(readPins('c1', s)).toEqual({ fighters: [], clubs: [] });
    writePins('c1', { fighters: ['f1', 'f2'], clubs: ['k1'] }, s);
    expect(s.m.has('spectateur:c1')).toBe(true);
    expect(readPins('c1', s)).toEqual({ fighters: ['f1', 'f2'], clubs: ['k1'] });
    expect(readPins('c2', s)).toEqual({ fighters: [], clubs: [] });
  });

  it('pins survive a throwing localStorage', () => {
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(readPins('c1', bad)).toEqual({ fighters: [], clubs: [] });
    expect(() => writePins('c1', { fighters: ['f1'], clubs: [] }, bad)).not.toThrow();
    expect(readPins('c1', null)).toEqual({ fighters: [], clubs: [] });
    expect(() => writePins('c1', { fighters: [], clubs: [] }, null)).not.toThrow();
    const junk = { getItem: () => '{oops', setItem: () => {} };
    expect(readPins('c1', junk)).toEqual({ fighters: [], clubs: [] });
    expect(readPins('c1', { getItem: () => '{"fighters":[1,"a"],"clubs":"x"}' })).toEqual({ fighters: ['a'], clubs: [] });
  });

  it('followedFighters adds club members and skips masked', () => {
    const pub = {
      entrants: {
        a: entrant('A', 'f1', 'k1'),
        b: entrant('B', 'f2', 'k1'),
        c: entrant('C', null, 'k1', true),
        d: entrant('D', 'f4', 'k2'),
        e: entrant('E', 'f1', 'k1'),
      },
    } as unknown as PublicCompetition;
    expect(followedFighters(pub, { fighters: ['f4', 'f1'], clubs: ['k1'] }).sort()).toEqual(['f1', 'f2', 'f4']);
    expect(followedFighters(pub, { fighters: [], clubs: [] })).toEqual([]);
  });
});
