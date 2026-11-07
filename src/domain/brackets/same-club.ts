import type { Bracket } from './index.js';

const FORMATS = ['single_elimination', 'double_elimination', 'single_match'];

/** Paires de combattants du même club qui se rencontrent au 1er tour (élimination, double élimination, match unique). */
export function sameClubFirstRound(b: Bracket | null): [string, string][] {
  if (!b || b.kind !== 'combat' || !FORMATS.includes(b.format)) return [];
  const club = new Map(b.entrants.map((e) => [e.registrationId, e.clubId]));
  const pairs: [string, string][] = [];
  for (const m of b.matches) {
    if (m.phase !== 'main' || m.round !== 1 || m.a.kind !== 'entrant' || m.b.kind !== 'entrant') continue;
    const [x, y] = [m.a.registrationId, m.b.registrationId];
    const c = club.get(x);
    if (c != null && c === club.get(y)) pairs.push([x, y]);
  }
  return pairs;
}

const key = (p: [string, string]) => [...p].sort().join('|');

/** Paires du même club présentes après un changement et absentes avant. */
export function newSameClubPairs(before: Bracket | null, after: Bracket | null): [string, string][] {
  const old = new Set(sameClubFirstRound(before).map(key));
  return sameClubFirstRound(after).filter((p) => !old.has(key(p)));
}

export function sameClubSentence(pair: [string, string], info: (id: string) => { name: string; club: string }): string {
  const [a, b] = [info(pair[0]), info(pair[1])];
  return `${a.name} et ${b.name} (${a.club}) se rencontrent au 1er tour.`;
}
