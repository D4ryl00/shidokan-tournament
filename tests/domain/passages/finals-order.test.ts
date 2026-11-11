import { describe, expect, test } from 'vitest';
import { generateBracket, type Bracket, type BracketFormat } from '../../../src/domain/brackets/index.js';
import { planPassages, type PlanCategory, type PlanInput, type StoredFinals, type WaveFinals } from '../../../src/domain/passages/index.js';

let seq = 0;
const entrants = (n: number) => Array.from({ length: n }, () => ({ registrationId: `e${++seq}`, clubId: null, label: `E${seq}` }));
const options = { repechage: false, thirdPlace: false, kataBronzeCount: 2 as const };
const br = (n: number, format: BracketFormat = 'single_elimination') => generateBracket(format, entrants(n), options, 1);
const pc = (id: string, b: Bracket, over: Partial<PlanCategory> = {}): PlanCategory => ({
  id, waveId: null, discipline: b.kind === 'kata' ? 'kata' : 'karate', pinnedZoneId: 't1', rank: 0, bracket: b, playable: b.entrants.length >= 2, ...over,
});
const t1 = { id: 't1', order: 0, disciplines: null };
const t2 = { id: 't2', order: 1, disciplines: null };
const ring = { id: 'ring', order: 2, disciplines: null };
const seqOf = (input: PlanInput, zone = 't1') => planPassages(input).zones.find((z) => z.zoneId === zone)!.passages.map((p) => `${p.number}:${p.categoryId}:${p.matchId ?? 'kata'}`);
const on = (finalsZoneId: string | null, waveKey = ''): WaveFinals => ({ waveKey, finalsZoneId, whereDefault: null, whenDefault: null });
const f = (where: StoredFinals['where'], when: StoredFinals['when']): StoredFinals => ({ where, when });

describe('finales sur la zone de la catégorie', () => {
  test('tour par tour, sa zone, dès que finie : juste après le dernier combat de la catégorie', () => {
    const input: PlanInput = {
      categories: [pc('A', br(4), { finals: f('own', 'ready') }), pc('B', br(4), { rank: 1, finals: f('own', 'end') })],
      zones: [t1], waves: [], mode: 'rounds',
    };
    expect(seqOf(input)).toEqual(['1:A:w1-0', '2:B:w1-0', '3:A:w1-1', '4:A:w2-0', '5:B:w1-1', '6:B:w2-0']);
    // Pas de repos entre la demie et la finale qui la suit.
    expect(planPassages(input).zones[0]!.passages.filter((p) => p.noRest).map((p) => p.number)).toEqual([4, 6]);
  });

  test('catégorie par catégorie, fin de session : après tous les combats des autres catégories', () => {
    const input: PlanInput = {
      categories: [pc('A', br(4), { finals: f('own', 'end') }), pc('B', br(4), { rank: 1 })],
      zones: [t1], waves: [], mode: 'categories',
    };
    expect(seqOf(input)).toEqual(['1:A:w1-0', '2:A:w1-1', '3:B:w1-0', '4:B:w1-1', '5:B:w2-0', '6:A:w2-0']);
  });

  test('valeurs par défaut : tour par tour → finales en fin de zone ; catégorie par catégorie → finale après sa catégorie', () => {
    const cats = [pc('A', br(4)), pc('B', br(4), { rank: 1 })];
    expect(seqOf({ categories: cats, zones: [t1], waves: [], mode: 'rounds' }).slice(-2)).toEqual(['5:A:w2-0', '6:B:w2-0']);
    expect(seqOf({ categories: cats, zones: [t1], waves: [], mode: 'categories' })).toEqual(['1:A:w1-0', '2:A:w1-1', '3:A:w2-0', '4:B:w1-0', '5:B:w1-1', '6:B:w2-0']);
  });

  test('combat unique ou meilleur des trois, dès que finie : ordre normal', () => {
    const input: PlanInput = {
      categories: [pc('A', br(4), { finals: f('own', 'end') }), pc('S', br(2, 'single_match'), { rank: 1, finals: f('own', 'ready') }), pc('T', br(2, 'best_of_three'), { rank: 2, finals: f('own', 'ready') })],
      zones: [t1], waves: [], mode: 'categories',
    };
    expect(seqOf(input)).toEqual(['1:A:w1-0', '2:A:w1-1', '3:S:w1-0', '4:T:s1', '5:T:s2', '6:T:s3', '7:A:w2-0']);
  });
});

describe('zone des finales', () => {
  const base = (): PlanInput => ({
    categories: [
      pc('A', br(8), { finals: f('finals', 'ready') }),
      pc('B', br(4), { rank: 1, finals: f('finals', 'end') }),
      pc('R', br(4), { rank: 2, pinnedZoneId: 'ring', finals: f(null, 'ready') }),
    ],
    zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: [on('ring')],
  });

  test('ses combats d’abord, puis dès que finie (ordre des rangs sans durées), puis fin de session', () => {
    expect(seqOf(base(), 'ring')).toEqual(['1:R:w1-0', '2:R:w1-1', '3:A:w3-0', '4:R:w2-0', '5:B:w2-0']);
    expect(seqOf(base()).some((s) => s.endsWith('A:w3-0') || s.endsWith('B:w2-0'))).toBe(false);
  });

  test('dès que finie : dans l’ordre des fins estimées', () => {
    // t1 : A (6 combats non finaux) et B ; ring : R finie après 2 combats.
    expect(seqOf({ ...base(), durationSec: () => 60 }, 'ring')).toEqual(['1:R:w1-0', '2:R:w1-1', '3:R:w2-0', '4:A:w3-0', '5:B:w2-0']);
  });

  test('dès que finie, deux zones : la catégorie finie la première d’abord ; sans durées, ordre des rangs ; à égalité, rang', () => {
    const input: PlanInput = {
      categories: [pc('A', br(8), { finals: f('finals', 'ready') }), pc('B', br(4), { rank: 1, pinnedZoneId: 't2', finals: f('finals', 'ready') })],
      zones: [t1, t2, ring], waves: [], mode: 'rounds', waveFinals: [on('ring')],
    };
    expect(seqOf(input, 'ring')).toEqual(['1:A:w3-0', '2:B:w2-0']);
    expect(seqOf({ ...input, durationSec: () => 60 }, 'ring')).toEqual(['1:B:w2-0', '2:A:w3-0']);
    // Les combats de B sont longs : A finit la première.
    expect(seqOf({ ...input, durationSec: (id) => (id === 'B' ? 1000 : 60) }, 'ring')).toEqual(['1:A:w3-0', '2:B:w2-0']);
    // A : 6 combats de 60 s ; B : 2 combats de 180 s → égalité, rang.
    expect(seqOf({ ...input, durationSec: (id) => (id === 'B' ? 180 : 60) }, 'ring')).toEqual(['1:A:w3-0', '2:B:w2-0']);
  });

  test('durée d’un passage : combat par son id, kata par son bloc', () => {
    const calls = new Set<string>();
    const input: PlanInput = {
      categories: [pc('A', br(4), { finals: f('finals', 'ready') }), pc('K', br(5, 'kata_two_rounds'), { rank: 1, pinnedZoneId: 't2', finals: f('own', 'ready') })],
      zones: [t1, t2, ring], waves: [], mode: 'rounds', waveFinals: [on('ring')],
      durationSec: (id, matchId) => (calls.add(`${id}:${matchId ?? 'kata'}`), 60),
    };
    planPassages(input);
    expect([...calls].sort()).toEqual(['A:w1-0', 'A:w1-1', 'K:kata']);
  });

  test('zone des finales sans combat à elle : finales dès que finie dans l’ordre des fins estimées', () => {
    const input: PlanInput = {
      categories: [pc('A', br(8), { finals: f(null, 'ready') }), pc('B', br(4), { rank: 1, pinnedZoneId: 't2', finals: f(null, 'ready') }), pc('C', br(4), { rank: 2, pinnedZoneId: 't2' })],
      zones: [t1, t2, ring], waves: [], mode: 'rounds', waveFinals: [on('ring')], durationSec: () => 60,
    };
    expect(seqOf(input, 'ring')).toEqual(['1:B:w2-0', '2:A:w3-0', '3:C:w2-0']);
  });

  test('deux sessions, deux zones des finales : chaque session suit la sienne', () => {
    const input: PlanInput = {
      categories: [pc('A', br(4), { waveId: 'w1' }), pc('B', br(4), { waveId: 'w2' })],
      zones: [t1, ring], waves: [{ id: 'w1', order: 0 }, { id: 'w2', order: 1 }], mode: 'rounds',
      waveFinals: [on('ring', 'w1'), on(null, 'w2')],
    };
    expect(seqOf(input)).toEqual(['1:A:w1-0', '2:A:w1-1', '3:B:w1-0', '4:B:w1-1', '5:B:w2-0']);
    expect(seqOf(input, 'ring')).toEqual(['1:A:w2-0']);
  });

  test('zone des finales inconnue : comme sans zone des finales', () => {
    const input: PlanInput = { categories: [pc('A', br(4))], zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: [on('inconnue')] };
    expect(seqOf(input)).toEqual(['1:A:w1-0', '2:A:w1-1', '3:A:w2-0']);
    expect(planPassages(input).finals.A).toMatchObject({ finalZoneId: 't1', onFinalsZone: false });
  });
});

describe('kata', () => {
  const k = (finals?: StoredFinals, over: Partial<PlanCategory> = {}) => pc('K', br(5, 'kata_two_rounds'), { finals, ...over });

  test('sa zone, dès que finie : un seul bloc', () => {
    expect(seqOf({ categories: [k(f('own', 'ready'))], zones: [t1], waves: [], mode: 'rounds' })).toEqual(['1:K:kata']);
  });

  test('sa zone, fin de session : tour 1 en tête de zone, finale en fin', () => {
    const input: PlanInput = { categories: [k(f('own', 'end')), pc('A', br(4), { rank: 1, finals: f('own', 'ready') })], zones: [t1], waves: [], mode: 'rounds' };
    expect(seqOf(input)).toEqual(['1:K:kata:tour1', '2:A:w1-0', '3:A:w1-1', '4:A:w2-0', '5:K:kata:finale']);
  });

  test('zone des finales, dès que finie : la finale sur la zone des finales', () => {
    const input: PlanInput = { categories: [k(f('finals', 'ready'))], zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: [on('ring')] };
    expect(seqOf(input)).toEqual(['1:K:kata:tour1']);
    expect(seqOf(input, 'ring')).toEqual(['1:K:kata:finale']);
  });

  test('kata à deux, séparé : seulement la finale', () => {
    const input: PlanInput = { categories: [pc('L', br(2, 'kata_two_rounds'), { finals: f('own', 'end') })], zones: [t1], waves: [], mode: 'rounds' };
    expect(seqOf(input)).toEqual(['1:L:kata:finale']);
  });

  test('kata sur la zone des finales : toujours séparé, finale après les passages de la zone', () => {
    const input: PlanInput = {
      categories: [k(f('own', 'ready'), { pinnedZoneId: 'ring' }), pc('R', br(4), { rank: 1, pinnedZoneId: 'ring' })],
      zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: [on('ring')],
    };
    expect(seqOf(input, 'ring')).toEqual(['1:K:kata:tour1', '2:R:w1-0', '3:R:w1-1', '4:K:kata:finale', '5:R:w2-0']);
  });
});

test('PassagePlan.finals : choix résolu de chaque catégorie jouable placée', () => {
  const plan = planPassages({
    categories: [
      pc('A', br(4), { waveId: 'w1' }),
      pc('B', br(4), { waveId: 'w2', finals: f(null, 'ready') }),
      pc('K', br(5, 'kata_two_rounds'), { waveId: 'w1', finals: f('own', 'ready') }),
      pc('N', br(2), { waveId: 'w1', playable: false }),
      pc('X', br(4), { waveId: 'w1', discipline: 'shido-boxing', pinnedZoneId: null }),
    ],
    zones: [{ ...t1, disciplines: ['karate', 'kata'] }, { ...ring, disciplines: ['karate'] }], waves: [{ id: 'w1', order: 0 }, { id: 'w2', order: 1 }], mode: 'rounds',
    waveFinals: [on('ring', 'w1')],
  });
  expect(Object.keys(plan.finals).sort()).toEqual(['A', 'B', 'K']);
  expect(plan.finals.A).toMatchObject({ finalZoneId: 'ring', when: 'end', onFinalsZone: true, kataSplit: false, fixed: null, signature: 'ring|end' });
  expect(plan.finals.B).toMatchObject({ finalZoneId: 't1', when: 'ready', onFinalsZone: false, signature: 't1|ready' });
  expect(plan.finals.K).toMatchObject({ finalZoneId: 't1', when: 'ready', kataSplit: false, fixed: 'not-accepted' });
});
