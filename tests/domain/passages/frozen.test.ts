import { describe, expect, test } from 'vitest';
import { generateBracket, type Bracket, type BracketFormat } from '../../../src/domain/brackets/index.js';
import { appendPassages, finalMatchIds, planPassages, type FrozenPassage, type PlanCategory, type PlanInput } from '../../../src/domain/passages/index.js';
import { defaultSettings } from '../../../src/domain/settings.js';
import type { CombatBracket } from '../../../src/domain/brackets/index.js';

let seq = 0;
const entrants = (n: number) => Array.from({ length: n }, () => ({ registrationId: `e${++seq}`, clubId: null, label: `E${seq}` }));
const options = { repechage: false, thirdPlace: false, kataBronzeCount: 2 as const };
const br = (n: number, format: BracketFormat = 'single_elimination') => generateBracket(format, entrants(n), options, 1);
const pc = (id: string, b: Bracket, over: Partial<PlanCategory> = {}): PlanCategory => ({
  id, waveId: null, discipline: b.kind === 'kata' ? 'kata' : 'karate', pinnedZoneId: 't1', rank: 0, bracket: b, playable: b.entrants.length >= 2, ...over,
});
const t1 = { id: 't1', order: 0, disciplines: null };
const ring = { id: 'ring', order: 1, disciplines: null };
const seqOf = (input: PlanInput, zone = 't1') => planPassages(input).zones.find((z) => z.zoneId === zone)!.passages.map((p) => `${p.number}:${p.categoryId}:${p.matchId ?? 'kata'}`);
const freeze = (input: PlanInput, wave: string | null = null): FrozenPassage[] =>
  planPassages(input).zones.flatMap((z) => z.passages.filter((p) => p.waveId === wave).map((p) => ({ waveKey: wave ?? '', zoneId: z.zoneId, number: p.number, categoryId: p.categoryId, matchId: p.matchId, noRest: p.noRest })));

describe('numéros figés', () => {
  test('vague figée : numéros repris tels quels, trous compris', () => {
    const input: PlanInput = { categories: [pc('A', br(4))], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(input).map((f) => ({ ...f, number: f.number * 10 }));
    expect(seqOf({ ...input, frozen })).toEqual(['10:A:w1-0', '20:A:w1-1', '30:A:w2-0']);
    expect(planPassages({ ...input, frozen }).frozenWaves).toEqual(['']);
  });

  test('vague suivante : après le plus grand numéro figé de chaque zone ; restart → 1', () => {
    const waves = [{ id: 'w1', order: 0 }, { id: 'w2', order: 1 }];
    const input: PlanInput = { categories: [pc('A', br(4), { waveId: 'w1' }), pc('B', br(2, 'single_match'), { waveId: 'w2' })], zones: [t1], waves, mode: 'rounds' };
    const frozen = freeze(input, 'w1').map((f) => (f.matchId === 'w2-0' ? { ...f, number: 7 } : f));
    expect(seqOf({ ...input, frozen })).toEqual(['1:A:w1-0', '2:A:w1-1', '7:A:w2-0', '8:B:w1-0']);
    expect(seqOf({ ...input, frozen, restart: ['w2'] })).toContain('1:B:w1-0');
  });

  test('à numéroter : catégorie nouvelle ou changée → pending, sans passage ; les autres gardent leurs numéros', () => {
    const base: PlanInput = { categories: [pc('A', br(4)), pc('B', br(4), { rank: 1 })], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(base);
    const changed: PlanInput = { ...base, frozen, categories: [pc('A', br(4)), pc('B', br(5), { rank: 1 }), pc('C', br(2, 'single_match'), { rank: 2 })] };
    const plan = planPassages(changed);
    expect(plan.pending).toEqual([{ waveId: null, categoryId: 'B' }, { waveId: null, categoryId: 'C' }]);
    expect(plan.zones[0]!.passages.map((p) => p.categoryId)).toEqual(['A', 'A', 'A']);
    expect(plan.zones[0]!.passages.map((p) => p.number)).toEqual(frozen.filter((f) => f.categoryId === 'A').map((f) => f.number));
  });

  test('appendPassages : après le dernier numéro figé de la zone, toutes vagues', () => {
    const base: PlanInput = { categories: [pc('A', br(4)), pc('B', br(4), { rank: 1 })], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(base);
    const input: PlanInput = { ...base, frozen, categories: [pc('A', br(4)), pc('B', br(5), { rank: 1 })] };
    const rows = appendPassages(input, null, ['B']);
    expect(rows.map((r) => r.number)).toEqual([7, 8, 9, 10]);
    expect(rows.every((r) => r.categoryId === 'B' && r.zoneId === 't1' && r.waveKey === '')).toBe(true);
  });
});

describe('finales sur une zone', () => {
  test('finalMatchIds selon le format', () => {
    expect(finalMatchIds(br(8) as CombatBracket)).toEqual(['w3-0']);
    expect(finalMatchIds(br(4, 'double_elimination') as CombatBracket)).toEqual(['gf']);
    expect(finalMatchIds(br(3, 'three_with_repechage') as CombatBracket)).toEqual(['m3']);
    expect(finalMatchIds(br(2, 'single_match') as CombatBracket)).toEqual(['w1-0']);
    expect(finalMatchIds(br(2, 'best_of_three') as CombatBracket)).toEqual(['s1', 's2', 's3']);
    expect(finalMatchIds(br(4, 'round_robin') as CombatBracket)).toEqual([]);
  });

  test('finales sur le Ring, à la fin de la vague, dans l’ordre des rangs', () => {
    const input: PlanInput = {
      categories: [pc('A', br(8)), pc('B', br(4), { rank: 1 }), pc('R', br(4), { pinnedZoneId: 'ring', rank: 2 })],
      zones: [t1, ring], waves: [], mode: 'rounds', finals: { zoneId: 'ring', kata: false },
    };
    expect(seqOf(input, 'ring')).toEqual(['1:R:w1-0', '2:R:w1-1', '3:A:w3-0', '4:B:w2-0', '5:R:w2-0']);
    expect(seqOf(input).some((s) => s.endsWith('A:w3-0') || s.endsWith('B:w2-0'))).toBe(false);
    for (const zoneId of [null, 'inconnue']) expect(seqOf({ ...input, finals: { zoneId, kata: false } }, 'ring')).toEqual(['1:R:w1-0', '2:R:w1-1', '3:R:w2-0']);
  });

  test('poule unique : rien ne bouge ; meilleur des trois : s1-s3 sur la zone des finales', () => {
    const input: PlanInput = { categories: [pc('P', br(3, 'round_robin')), pc('S', br(2, 'best_of_three'), { rank: 1 })], zones: [t1, ring], waves: [], mode: 'rounds', finals: { zoneId: 'ring', kata: false } };
    expect(seqOf(input).every((s) => s.includes(':P:'))).toBe(true);
    expect(seqOf(input, 'ring').map((s) => s.split(':').slice(1).join(':'))).toEqual(['S:s1', 'S:s2', 'S:s3']);
  });

  test('kata : sans l’option, bloc entier ; avec, tour 1 sur sa zone et finale sur le Ring ; kata à 2 : seulement la finale', () => {
    const input: PlanInput = { categories: [pc('K', br(5, 'kata_two_rounds')), pc('L', br(2, 'kata_two_rounds'), { rank: 1 })], zones: [t1, ring], waves: [], mode: 'rounds', finals: { zoneId: 'ring', kata: false } };
    expect(seqOf(input)).toEqual(['1:K:kata', '2:L:kata']);
    const on = { ...input, finals: { zoneId: 'ring', kata: true } };
    expect(seqOf(on)).toEqual(['1:K:kata:tour1']);
    expect(seqOf(on, 'ring')).toEqual(['1:K:kata:finale', '2:L:kata:finale']);
  });
});

test('réglages : pas de zone des finales par défaut', () => {
  expect(defaultSettings()).toMatchObject({ finalsZoneId: null, kataFinalsOnFinalsZone: false });
});
