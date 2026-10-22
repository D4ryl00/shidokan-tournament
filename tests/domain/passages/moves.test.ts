import { describe, expect, test } from 'vitest';
import { generateBracket, type Bracket, type BracketFormat } from '../../../src/domain/brackets/index.js';
import { appendPassages, planPassages, reshuffleZone, type FrozenPassage, type PlanCategory, type PlanInput } from '../../../src/domain/passages/index.js';

let seq = 0;
const entrants = (n: number) => Array.from({ length: n }, () => ({ registrationId: `e${++seq}`, clubId: null, label: `E${seq}` }));
const options = { repechage: false, thirdPlace: false, kataBronzeCount: 2 as const };
const br = (n: number, format: BracketFormat = 'single_elimination') => generateBracket(format, entrants(n), options, 1);
const pc = (id: string, b: Bracket, over: Partial<PlanCategory> = {}): PlanCategory => ({
  id, waveId: null, discipline: b.kind === 'kata' ? 'kata' : 'karate', pinnedZoneId: 't1', rank: 0, bracket: b, playable: b.entrants.length >= 2, ...over,
});
const zones = [{ id: 't1', order: 0, disciplines: null }, { id: 'ring', order: 1, disciplines: null }];
const freeze = (input: PlanInput, wave: string | null = null): FrozenPassage[] =>
  planPassages(input).zones.flatMap((z) => z.passages.filter((p) => p.waveId === wave).map((p) => ({ waveKey: wave ?? '', zoneId: z.zoneId, number: p.number, categoryId: p.categoryId, matchId: p.matchId, noRest: p.noRest })));
const key = (r: { categoryId: string; matchId: string | null }) => `${r.categoryId}:${r.matchId ?? 'kata'}`;
const show = (rows: FrozenPassage[]) => rows.map((r) => `${r.zoneId}:${r.number}:${key(r)}`);

describe('déplacements', () => {
  const base = (): PlanInput => ({
    categories: [pc('C', br(4)), pc('X', br(4), { pinnedZoneId: 'ring', rank: 1 }), pc('Y', br(4), { pinnedZoneId: 'ring', rank: 2 })],
    zones, waves: [], mode: 'rounds',
  });

  test('à la suite : combats restants seulement, sur la zone imposée, après son dernier numéro', () => {
    const input = base();
    input.frozen = freeze(input);
    const rows = appendPassages(input, null, ['C'], { played: new Set(['C:w1-0']), zoneOf: { C: 'ring' } });
    expect(show(rows)).toEqual(['ring:7:C:w1-1', 'ring:8:C:w2-0']);
  });

  test('mélangés : numéros joués gardés, le reste de la zone renuméroté à partir du plus grand joué + 1', () => {
    const input = base();
    input.frozen = freeze(input);
    const ring = input.frozen.filter((f) => f.zoneId === 'ring');
    const played = new Set(ring.filter((f) => f.number <= 2).map(key));
    const rows = reshuffleZone(input, 'ring', null, ['C'], { played, zoneOf: { C: 'ring' } });
    expect(rows.map((r) => r.number).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(rows.every((r) => r.zoneId === 'ring' && !played.has(key(r)))).toBe(true);
    expect(rows.filter((r) => r.categoryId === 'C')).toHaveLength(3);
    // Ordre habituel : les tours d'abord (alternés), les finales à la fin.
    expect(rows.sort((a, b) => a.number - b.number).slice(-3).map((r) => r.matchId)).toEqual(['w2-0', 'w2-0', 'w2-0']);
  });

  test('mélangés : un numéro joué au-delà d’un non joué → les non joués repartent après lui', () => {
    const input = base();
    input.frozen = freeze(input);
    const rows = reshuffleZone(input, 'ring', null, [], { played: new Set(['X:w2-0']) });
    expect(Math.min(...rows.map((r) => r.number))).toBe(Math.max(...input.frozen.filter((f) => key(f) === 'X:w2-0').map((f) => f.number)) + 1);
  });

  test('deux jours : seuls les numéros du 2e jour comptent', () => {
    const waves = [{ id: 'w1', order: 0 }, { id: 'w2', order: 1 }];
    const input: PlanInput = {
      categories: [pc('A', br(8), { waveId: 'w1', pinnedZoneId: 'ring' }), pc('B', br(4), { waveId: 'w2', pinnedZoneId: 'ring' }), pc('C', br(4), { waveId: 'w2', rank: 1 })],
      zones, waves, mode: 'rounds', restart: ['w2'],
    };
    const f1 = freeze(input, 'w1');
    input.frozen = [...f1, ...freeze({ ...input, frozen: f1 }, 'w2')];
    expect(appendPassages(input, 'w2', ['C'], { zoneOf: { C: 'ring' } }).map((r) => r.number)).toEqual([4, 5, 6]);
    const shuffled = reshuffleZone(input, 'ring', 'w2', ['C'], { zoneOf: { C: 'ring' } });
    expect(shuffled.map((r) => r.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shuffled.some((r) => r.categoryId === 'A')).toBe(false);
  });

  test('kata déplacé : bloc entier ; bloc noté = joué, gardé', () => {
    const input: PlanInput = { categories: [pc('K', br(5, 'kata_two_rounds'))], zones, waves: [], mode: 'rounds' };
    input.frozen = freeze(input);
    expect(show(appendPassages(input, null, ['K'], { zoneOf: { K: 'ring' } }))).toEqual(['ring:1:K:kata']);
    expect(appendPassages(input, null, ['K'], { zoneOf: { K: 'ring' }, played: new Set(['K:kata']) })).toEqual([]);
  });
});
