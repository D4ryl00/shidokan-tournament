import { describe, expect, test } from 'vitest';
import { resolveBracket } from '../../src/domain/brackets/index.js';
import { kataBracket, resolveKata } from '../../src/domain/brackets/kata.js';
import { roundRobin } from '../../src/domain/brackets/pools.js';
import { singleElimination } from '../../src/domain/brackets/elimination.js';
import { affectedBy, categoryProgress, checkResult, medalTable, validResults, type ResultRecord } from '../../src/domain/results.js';
import { entrants } from './brackets/helpers.js';

const bracket = singleElimination(entrants(4), { repechage: false, thirdPlace: false }, 3);

/** Joue le tableau (côté a gagnant) et renvoie les enregistrements avec leurs combattants. */
function playAll(b = bracket): ResultRecord[] {
  const records: ResultRecord[] = [];
  for (let i = 0; i < 10; i++) {
    const { results } = validResults(b, records);
    const next = resolveBracket(b, results).matches.find((m) => m.playable && !results[m.id]);
    if (!next) break;
    records.push({ matchId: next.id, winner: 'a', method: 'points', entrantA: next.entrantA!, entrantB: next.entrantB! });
  }
  return records;
}

describe('validResults', () => {
  test('tous valides, podium complet', () => {
    const records = playAll();
    expect(records).toHaveLength(3);
    const { results, ignored } = validResults(bracket, records);
    expect(ignored).toEqual([]);
    expect(resolveBracket(bracket, results).podium.complete).toBe(true);
  });
  test('correction d’une demie : la finale devient ignorée ; affectedBy l’annonce', () => {
    const records = playAll();
    const semi = records.find((r) => r.matchId === 'w1-0')!;
    expect(affectedBy(bracket, records, 'w1-0', 'b')).toEqual(['w2-0']);
    const corrected = records.map((r) => (r === semi ? { ...r, winner: 'b' as const } : r));
    const { results, ignored } = validResults(bracket, corrected);
    expect(ignored.map((r) => r.matchId)).toEqual(['w2-0']);
    expect(resolveBracket(bracket, results).podium.complete).toBe(false);
  });
  test('tableau régénéré : les enregistrements qui ne correspondent plus sont ignorés', () => {
    const records = playAll();
    const other = singleElimination(entrants(4), { repechage: false, thirdPlace: false }, 99);
    const { ignored } = validResults(other, records);
    expect(ignored.length).toBeGreaterThan(0);
  });
  test('côtés inversés dans le même combat : résultat retourné, pas ignoré', () => {
    const records = playAll();
    const flipped = records.map((r) => (r.matchId === 'w1-0' ? { ...r, entrantA: r.entrantB, entrantB: r.entrantA, winner: 'b' as const } : r));
    expect(validResults(bracket, flipped).ignored).toEqual([]);
  });
});

test('checkResult', () => {
  const { matches } = resolveBracket(singleElimination(entrants(3), { repechage: false, thirdPlace: false }, 1), {});
  const bye = matches.find((m) => m.bye)!;
  const real = matches.find((m) => m.playable)!;
  expect(checkResult(bye, 'jiyu', 'points')).toBe("Ce combat n'est pas à disputer.");
  expect(checkResult(real, 'jiyu', 'ko')).toBe("Le KO n'est possible qu'en shobu.");
  expect(checkResult(real, 'shobu', 'ko')).toBeNull();
});

describe('categoryProgress', () => {
  test('non commencée, lancée, terminée', () => {
    const records = playAll();
    expect(categoryProgress(bracket, [], null, {}).status).toBe('not_started');
    expect(categoryProgress(bracket, records.slice(0, 1), null, {})).toMatchObject({ status: 'started', played: 1, total: 3 });
    expect(categoryProgress(bracket, records, null, {})).toMatchObject({ status: 'finished', played: 3 });
  });
  test('poule en cycle : terminée seulement après départage', () => {
    const pool = roundRobin(entrants(3), 1);
    const beats: Record<string, string> = { r1: 'r2', r2: 'r3', r3: 'r1' };
    const records: ResultRecord[] = resolveBracket(pool, {}).matches.map((m) => ({
      matchId: m.id, method: 'points', entrantA: m.entrantA!, entrantB: m.entrantB!, winner: beats[m.entrantA!] === m.entrantB ? 'a' : 'b',
    }));
    expect(categoryProgress(pool, records, null, {}).status).toBe('started');
    expect(categoryProgress(pool, records, null, { 0: ['r2', 'r3', 'r1'] })).toMatchObject({ status: 'finished', podium: { first: 'r2' } });
  });
  test('kata', () => {
    const k = kataBracket(entrants(3), 2, 1);
    expect(categoryProgress(k, [], { round1: {}, final: {} }, {}).status).toBe('not_started');
    const scores = { round1: { r1: [9], r2: [8], r3: [7] }, final: { r1: [8], r2: [9] } };
    expect(categoryProgress(k, [], scores, {})).toMatchObject({ status: 'finished', podium: { first: 'r2', second: 'r1', thirds: ['r3'] } });
  });
});

test('kata : égalité tranchée par l’organisateur', () => {
  const k = kataBracket(entrants(3), 2, 1);
  const scores = { round1: { r1: [9], r2: [8], r3: [8] }, final: { r1: [9], r2: [8] } };
  expect(resolveKata(k, scores).podium.complete).toBe(false);
  const decided = resolveKata(k, scores, ['r3', 'r2']);
  expect(decided.finalists.sort()).toEqual(['r1', 'r3']);
  expect(decided.podium.complete).toBe(false); // la finale doit être rejouée entre r1 et r3
  expect(resolveKata(k, { ...scores, final: { r1: [9], r3: [7] } }, ['r3', 'r2']).podium).toMatchObject({ complete: true, first: 'r1', second: 'r3', thirds: ['r2'] });
});

test('tableau des médailles : or, puis argent, puis bronze', () => {
  const clubs: Record<string, { id: string; name: string }> = {
    a1: { id: 'A', name: 'Alpha' }, a2: { id: 'A', name: 'Alpha' }, b1: { id: 'B', name: 'Bravo' }, b2: { id: 'B', name: 'Bravo' }, c1: { id: 'C', name: 'Charlie' },
  };
  const rows = medalTable(
    [
      { podium: { first: 'a1', second: 'b1', thirds: ['a2'], complete: true, ties: [] } },
      { podium: { first: 'b2', second: 'c1', thirds: [], complete: true, ties: [] } },
    ],
    (id) => clubs[id]!,
  );
  expect(rows.map((r) => [r.club, r.gold, r.silver, r.bronze])).toEqual([
    ['Bravo', 1, 1, 0], ['Alpha', 1, 0, 1], ['Charlie', 0, 1, 0],
  ]);
});

describe('corrections de la relecture (étape 6)', () => {
  test('poules puis tableau : une égalité de poule bloquante est signalée avec sa poule', async () => {
    const { poolsThenBracket } = await import('../../src/domain/brackets/pools.js');
    const b = poolsThenBracket(entrants(6), 1);
    const pool0 = b.pools![0]!;
    const beats: Record<string, string> = { [pool0[0]!]: pool0[1]!, [pool0[1]!]: pool0[2]!, [pool0[2]!]: pool0[0]! };
    const records: ResultRecord[] = resolveBracket(b, {}).matches
      .filter((m) => m.phase === 'pool')
      .map((m) => ({ matchId: m.id, method: 'points', entrantA: m.entrantA!, entrantB: m.entrantB!, winner: (m.pool === 0 ? beats[m.entrantA!] === m.entrantB : true) ? 'a' : 'b' }));
    const p = categoryProgress(b, records, null, {});
    expect(p.podium.ties).toHaveLength(1);
    expect(p.podium.tieScopes).toEqual(['pool:0']);
  });
  test('kata : règle de la spec — note basse retirée, puis haute, avant l’organisateur', () => {
    const k = kataBracket(entrants(3), 1, 1);
    // r2 et r3 ont la même moyenne (8) ; r2 a une note basse retirée plus élevée (7 > 6)
    const scores = { round1: { r1: [9, 9, 9, 9, 9], r2: [7, 8, 8, 8, 9], r3: [6, 8, 8, 8, 10] }, final: {} };
    const res = resolveKata(k, scores);
    expect(res.finalists.sort()).toEqual(['r1', 'r2']);
    expect(res.podium.ties).toEqual([]);
  });
  test('kata : deux égalités distinctes se tranchent l’une après l’autre ; la finale garde son propre départage', () => {
    const k = kataBracket(entrants(5), 2, 1);
    const scores = { round1: { r1: [9], r2: [8], r3: [8], r4: [7], r5: [7] }, final: { r1: [9], r2: [9] } };
    const first = resolveKata(k, scores);
    expect(first.podium.tieScopes).toContain('kata');
    // départages fusionnés : r2 devant r3, puis r4 devant r5
    const both = resolveKata(k, scores, ['r2', 'r3', 'r4', 'r5']);
    expect(both.podium.ties).toEqual([['r1', 'r2']]); // finale à égalité 9-9 : non tranchée par l'ordre du tour 1
    expect(both.podium.tieScopes).toEqual(['kata:final']);
    const done = resolveKata(k, scores, ['r2', 'r3', 'r4', 'r5'], ['r2', 'r1']);
    expect(done.podium).toMatchObject({ complete: true, first: 'r2', second: 'r1', thirds: ['r3', 'r4'] });
  });
});

describe('points reportés (étape 7)', () => {
  test('affectedBy tient compte des départages : celui de la poule modifiée sera effacé', async () => {
    const { poolsThenBracket } = await import('../../src/domain/brackets/pools.js');
    const b = poolsThenBracket(entrants(6), 1);
    const [p0, p1, p2] = b.pools![0]! as [string, string, string];
    const beats: Record<string, string> = { [p0]: p1, [p1]: p2, [p2]: p0 };
    const tb = { 0: [p2, p0, p1] };
    const records: ResultRecord[] = [];
    for (let i = 0; i < 30; i++) {
      const { results } = validResults(b, records, tb);
      const next = resolveBracket(b, results, tb).matches.find((m) => m.playable && !results[m.id]);
      if (!next) break;
      const winner = next.pool === 0 ? (beats[next.entrantA!] === next.entrantB ? 'a' : 'b') : 'a';
      records.push({ matchId: next.id, winner, method: 'points', entrantA: next.entrantA!, entrantB: next.entrantB! });
    }
    expect(validResults(b, records, tb).ignored).toEqual([]);
    const m01 = records.find((r) => [r.entrantA, r.entrantB].sort().join() === [p0, p1].sort().join())!;
    // p1 bat p0 : classement net p1, p2, p0 (le départage p2, p0, p1 disparaît) → les qualifiés changent
    expect(affectedBy(b, records, m01.matchId, m01.entrantA === p1 ? 'a' : 'b', tb).length).toBeGreaterThan(0);
  });

  test('affectedBy : effacer un résultat rend les combats suivants à revoir', () => {
    const records = playAll();
    expect(affectedBy(bracket, records, records[0]!.matchId, null)).toEqual([records.at(-1)!.matchId]);
  });
});
