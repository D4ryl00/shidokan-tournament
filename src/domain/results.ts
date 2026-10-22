import { resolveBracket, type Bracket, type CombatBracket, type MatchMethod, type MatchResult, type Podium, type ResolvedMatch } from './brackets/index.js';
import { resolveKata, type KataScores } from './brackets/kata.js';
import type { Ruleset } from './types.js';

/** Résultat saisi : il mémorise les deux combattants du combat au moment de la saisie. */
export interface ResultRecord {
  matchId: string;
  winner: 'a' | 'b';
  method: MatchMethod;
  score?: string;
  entrantA: string;
  entrantB: string;
}

/**
 * Résultats encore valides : résolution progressive du tableau ; un enregistrement ne compte que si ses deux
 * combattants sont ceux du combat (côtés inversés acceptés). Les autres sont ignorés, jamais réappliqués.
 */
export function validResults(
  bracket: CombatBracket,
  records: ResultRecord[],
  tieBreaks: Record<number, string[]> = {},
): { results: Record<string, MatchResult>; ignored: ResultRecord[] } {
  const results: Record<string, MatchResult> = {};
  const accepted = new Set<ResultRecord>();
  for (let changed = true; changed; ) {
    changed = false;
    const { matches } = resolveBracket(bracket, results, tieBreaks);
    for (const rec of records) {
      if (accepted.has(rec) || results[rec.matchId]) continue;
      const m = matches.find((x) => x.id === rec.matchId);
      if (!m || !m.playable) continue;
      const same = m.entrantA === rec.entrantA && m.entrantB === rec.entrantB;
      const swapped = m.entrantA === rec.entrantB && m.entrantB === rec.entrantA;
      if (!same && !swapped) continue;
      const winner = same ? rec.winner : rec.winner === 'a' ? 'b' : 'a';
      results[rec.matchId] = { winner, method: rec.method, ...(rec.score ? { score: rec.score } : {}) };
      accepted.add(rec);
      changed = true;
    }
  }
  return { results, ignored: records.filter((r) => !accepted.has(r)) };
}

/**
 * Combats déjà joués dont le résultat deviendrait ignoré si `matchId` changeait de vainqueur (`null` : résultat effacé).
 * Le départage de la poule du combat modifié est effacé avec la correction : il ne compte plus ensuite.
 */
export function affectedBy(
  bracket: CombatBracket,
  records: ResultRecord[],
  matchId: string,
  newWinner: 'a' | 'b' | null,
  tieBreaks: Record<number, string[]> = {},
): string[] {
  const before = new Set(validResults(bracket, records, tieBreaks).ignored.map((r) => r.matchId));
  const changed = newWinner === null ? records.filter((r) => r.matchId !== matchId) : records.map((r) => (r.matchId === matchId ? { ...r, winner: newWinner } : r));
  const pool = bracket.matches.find((m) => m.id === matchId)?.pool;
  const after = pool === undefined ? tieBreaks : Object.fromEntries(Object.entries(tieBreaks).filter(([k]) => Number(k) !== pool));
  return validResults(bracket, changed, after)
    .ignored.map((r) => r.matchId)
    .filter((id) => !before.has(id) && id !== matchId);
}

export function checkResult(match: ResolvedMatch, ruleset: Ruleset | null, method: MatchMethod): string | null {
  if (!match.playable) return "Ce combat n'est pas à disputer.";
  if (method === 'ko' && ruleset !== 'shobu') return "Le KO n'est possible qu'en shobu.";
  return null;
}

export interface CategoryProgress {
  status: 'not_started' | 'started' | 'finished';
  played: number;
  total: number;
  podium: Podium;
  ignored: number;
}

export function categoryProgress(
  bracket: Bracket,
  records: ResultRecord[],
  kataScores: KataScores | null,
  tieBreaks: Record<number, string[]>,
  kataTieBreak: string[] = [],
  kataFinalTieBreak: string[] = [],
): CategoryProgress {
  if (bracket.kind === 'kata') {
    const scores = kataScores ?? { round1: {}, final: {} };
    const { podium, finalists } = resolveKata(bracket, scores, kataTieBreak, kataFinalTieBreak);
    const withNotes = (r: Record<string, number[]>) => Object.values(r).filter((n) => n.length > 0).length;
    const played = (bracket.order.length > 2 ? withNotes(scores.round1) : 0) + finalists.filter((f) => (scores.final[f] ?? []).length > 0).length;
    const total = (bracket.order.length > 2 ? bracket.order.length : 0) + Math.min(2, bracket.order.length);
    return { status: played === 0 ? 'not_started' : podium.complete ? 'finished' : 'started', played, total, podium, ignored: 0 };
  }
  const { results, ignored } = validResults(bracket, records, tieBreaks);
  const { matches, podium } = resolveBracket(bracket, results, tieBreaks);
  const played = Object.keys(results).length;
  const total = matches.filter((m) => !m.bye && (!m.optional || m.playable)).length;
  const status = played === 0 && records.length === 0 ? 'not_started' : podium.complete && played > 0 ? 'finished' : 'started';
  return { status, played, total, podium, ignored: ignored.length };
}

export interface MedalRow {
  clubId: string;
  club: string;
  gold: number;
  silver: number;
  bronze: number;
}

/** Classement des clubs : or, puis argent, puis bronze, puis nom ; les combattants sans club n'y figurent pas. */
export function medalTable(podiums: { podium: Podium }[], clubOf: (registrationId: string) => { id: string | null; name: string }): MedalRow[] {
  const rows = new Map<string, MedalRow>();
  const add = (id: string | null, kind: 'gold' | 'silver' | 'bronze') => {
    if (!id) return;
    const club = clubOf(id);
    if (!club.id) return;
    const row = rows.get(club.id) ?? { clubId: club.id, club: club.name, gold: 0, silver: 0, bronze: 0 };
    row[kind]++;
    rows.set(club.id, row);
  };
  for (const { podium } of podiums) {
    add(podium.first, 'gold');
    add(podium.second, 'silver');
    for (const t of podium.thirds) add(t, 'bronze');
  }
  return [...rows.values()].sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.club.localeCompare(b.club));
}
