import { seededRandom, shuffle } from './seeding.js';
import type { Entrant, Podium } from './types.js';

export interface KataBracket {
  kind: 'kata';
  entrants: Entrant[];
  /** Ordre de passage du tour 1. */
  order: string[];
  bronzeCount: 1 | 2;
  seed: number;
}

/** Notes des arbitres, par inscription. */
export interface KataScores {
  round1: Record<string, number[]>;
  final: Record<string, number[]>;
}

/** Moins de 5 arbitres : moyenne ; à partir de 5 : sans la plus haute ni la plus basse, puis moyenne (arrondie au centième). */
export function kataScore(notes: number[]): number | null {
  if (notes.length === 0) return null;
  const kept = notes.length >= 5 ? [...notes].sort((a, b) => a - b).slice(1, -1) : notes;
  return Math.round((kept.reduce((s, n) => s + n, 0) / kept.length) * 100) / 100;
}

export function kataBracket(entrants: Entrant[], bronzeCount: 1 | 2, seed: number): KataBracket {
  const shuffled = shuffle(entrants, seededRandom(seed));
  return { kind: 'kata', entrants: shuffled, order: shuffled.map((e) => e.registrationId), bronzeCount, seed };
}

/** Notes retirées (plus basse, plus haute) : départage de la spec §12 quand il y a au moins 5 arbitres. */
function dropped(notes: number[]): [number, number] | null {
  if (notes.length < 5) return null;
  const sorted = [...notes].sort((a, b) => a - b);
  return [sorted[0]!, sorted[sorted.length - 1]!];
}

interface Ranked {
  registrationId: string;
  score: number | null;
  low: number | null;
  high: number | null;
}

/** Classement : note, puis note basse retirée, puis note haute retirée (spec §12), puis ordre de l'organisateur. */
function rank(ids: string[], scores: Record<string, number[]>, tieBreak: string[] = []): Ranked[] {
  const tie = (id: string) => {
    const i = tieBreak.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return ids
    .map((registrationId) => {
      const notes = scores[registrationId] ?? [];
      const d = dropped(notes);
      return { registrationId, score: kataScore(notes), low: d?.[0] ?? null, high: d?.[1] ?? null };
    })
    .sort(
      (a, b) =>
        (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
        (b.low ?? -Infinity) - (a.low ?? -Infinity) ||
        (b.high ?? -Infinity) - (a.high ?? -Infinity) ||
        tie(a.registrationId) - tie(b.registrationId),
    );
}

const sameNotes = (a: Ranked, b: Ranked) => a.score === b.score && a.low === b.low && a.high === b.high;

/** Finale seule pour départager 1er et 2e ; bronzes = suivants du tour 1. */
export function resolveKata(
  b: KataBracket,
  scores: KataScores,
  /** Ordre imposé par l'organisateur pour départager des ex-æquo du tour 1. */
  tieBreak: string[] = [],
  /** Ordre imposé pour une finale à égalité. */
  finalTieBreak: string[] = [],
): { round1Ranking: Ranked[]; finalists: string[]; podium: Podium } {
  const ids = b.order;
  const empty: Podium = { first: null, second: null, thirds: [], complete: true, ties: [] };
  if (ids.length === 0) return { round1Ranking: [], finalists: [], podium: empty };
  if (ids.length === 1) return { round1Ranking: [], finalists: [], podium: { ...empty, first: ids[0]! } };

  const ties: string[][] = [];
  const tieScopes: string[] = [];
  let round1Ranking: Ranked[] = [];
  let finalists: string[];
  let round1Complete = true;
  if (ids.length === 2) finalists = [...ids];
  else {
    round1Ranking = rank(ids, scores.round1, tieBreak);
    round1Complete = round1Ranking.every((r) => r.score !== null);
    finalists = round1Ranking.slice(0, 2).map((r) => r.registrationId);
    // Égalités aux frontières qui comptent : place en finale, places de bronze.
    const lastPlace = Math.min(round1Ranking.length, 2 + b.bronzeCount);
    for (const boundary of [2, lastPlace]) {
      const before = round1Ranking[boundary - 1];
      const after = round1Ranking[boundary];
      if (round1Complete && before && after && sameNotes(before, after)) {
        const group = round1Ranking.filter((r) => sameNotes(r, before)).map((r) => r.registrationId);
        const decided = group.every((id) => tieBreak.includes(id));
        if (!decided && !ties.some((t) => t.join() === group.join())) {
          ties.push(group);
          tieScopes.push('kata');
        }
      }
    }
  }
  const finalRanking = rank(finalists, scores.final, finalTieBreak);
  const finalComplete = finalRanking.every((r) => r.score !== null);
  if (finalComplete && sameNotes(finalRanking[0]!, finalRanking[1]!) && !finalists.every((id) => finalTieBreak.includes(id))) {
    ties.push(finalists);
    tieScopes.push('kata:final');
  }
  const thirds = round1Ranking.slice(2, 2 + b.bronzeCount).map((r) => r.registrationId);
  return {
    round1Ranking,
    finalists,
    podium: {
      first: finalComplete ? finalRanking[0]!.registrationId : null,
      second: finalComplete ? finalRanking[1]!.registrationId : null,
      thirds: round1Complete ? thirds : [],
      complete: round1Complete && finalComplete && ties.length === 0,
      ties,
      tieScopes,
    },
  };
}
