import { describe, expect, test } from 'vitest';
import { generateBracket, type Bracket, type BracketFormat } from '../../../src/domain/brackets/index.js';
import { appendPassages, finalMatchIds, planPassages, reshuffleZone, type FrozenPassage, type PlanCategory, type PlanInput, type WaveFinals } from '../../../src/domain/passages/index.js';
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
/** Zone des finales de la session implicite (null : aucune). */
const finalsOn = (finalsZoneId: string | null): WaveFinals[] => [{ waveKey: '', finalsZoneId, whereDefault: null, whenDefault: null }];
/** Kata en bloc unique sur sa zone (« Sa zone » + « Dès que finie »). */
const whole = { finals: { where: 'own' as const, when: 'ready' as const } };
const seqOf = (input: PlanInput, zone = 't1') => planPassages(input).zones.find((z) => z.zoneId === zone)!.passages.map((p) => `${p.number}:${p.categoryId}:${p.matchId ?? 'kata'}`);
const freeze = (input: PlanInput, wave: string | null = null): FrozenPassage[] => {
  const plan = planPassages(input);
  return plan.zones.flatMap((z) => z.passages.filter((p) => p.waveId === wave).map((p) => ({ waveKey: wave ?? '', zoneId: z.zoneId, number: p.number, categoryId: p.categoryId, matchId: p.matchId, noRest: p.noRest, finalsChoice: plan.finals[p.categoryId]?.signature ?? null })));
};

describe('numéros figés', () => {
  test('session figée : numéros repris tels quels, trous compris', () => {
    const input: PlanInput = { categories: [pc('A', br(4))], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(input).map((f) => ({ ...f, number: f.number * 10 }));
    expect(seqOf({ ...input, frozen })).toEqual(['10:A:w1-0', '20:A:w1-1', '30:A:w2-0']);
    expect(planPassages({ ...input, frozen }).frozenWaves).toEqual(['']);
  });

  test('session suivante : après le plus grand numéro figé de chaque zone ; restart → 1', () => {
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
    expect(plan.pending).toEqual([{ waveId: null, categoryId: 'B', reason: 'shape' }, { waveId: null, categoryId: 'C', reason: 'shape' }]);
    expect(plan.zones[0]!.passages.map((p) => p.categoryId)).toEqual(['A', 'A', 'A']);
    expect(plan.zones[0]!.passages.map((p) => p.number)).toEqual(frozen.filter((f) => f.categoryId === 'A').map((f) => f.number));
  });

  test('appendPassages : après le dernier numéro figé de la zone, toutes sessions', () => {
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

  test('finales sur le Ring, à la fin de la session, dans l’ordre des rangs', () => {
    const input: PlanInput = {
      categories: [pc('A', br(8)), pc('B', br(4), { rank: 1 }), pc('R', br(4), { pinnedZoneId: 'ring', rank: 2 })],
      zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: finalsOn('ring'),
    };
    expect(seqOf(input, 'ring')).toEqual(['1:R:w1-0', '2:R:w1-1', '3:A:w3-0', '4:B:w2-0', '5:R:w2-0']);
    expect(seqOf(input).some((s) => s.endsWith('A:w3-0') || s.endsWith('B:w2-0'))).toBe(false);
    for (const zoneId of [null, 'inconnue']) expect(seqOf({ ...input, waveFinals: finalsOn(zoneId) }, 'ring')).toEqual(['1:R:w1-0', '2:R:w1-1', '3:R:w2-0']);
  });

  test('poule unique : rien ne bouge ; meilleur des trois : s1-s3 sur la zone des finales', () => {
    const input: PlanInput = { categories: [pc('P', br(3, 'round_robin')), pc('S', br(2, 'best_of_three'), { rank: 1 })], zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: finalsOn('ring') };
    expect(seqOf(input).every((s) => s.includes(':P:'))).toBe(true);
    expect(seqOf(input, 'ring').map((s) => s.split(':').slice(1).join(':'))).toEqual(['S:s1', 'S:s2', 'S:s3']);
  });

  test('kata : sa zone dès que finie, bloc entier ; par défaut, tour 1 sur sa zone et finale sur le Ring ; kata à 2 : seulement la finale', () => {
    const cats = [pc('K', br(5, 'kata_two_rounds')), pc('L', br(2, 'kata_two_rounds'), { rank: 1 })];
    const input: PlanInput = { categories: cats.map((c) => ({ ...c, ...whole })), zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: finalsOn('ring') };
    expect(seqOf(input)).toEqual(['1:K:kata', '2:L:kata']);
    const on = { ...input, categories: cats };
    expect(seqOf(on)).toEqual(['1:K:kata:tour1']);
    expect(seqOf(on, 'ring')).toEqual(['1:K:kata:finale', '2:L:kata:finale']);
  });
});

describe('numéros figés (relecture)', () => {
  test('reprendre à 1 : la session suivante continue la nouvelle numérotation, pas celle de la veille', () => {
    const waves = [{ id: 'w1', order: 0 }, { id: 'w2', order: 1 }, { id: 'w3', order: 2 }];
    const cats = [pc('A', br(16), { waveId: 'w1' }), pc('B', br(4), { waveId: 'w2' }), pc('C', br(2, 'single_match'), { waveId: 'w3' })];
    const input: PlanInput = { categories: cats, zones: [t1], waves, mode: 'rounds' };
    const f1 = freeze(input, 'w1');
    const f2 = freeze({ ...input, frozen: f1, restart: ['w2'] }, 'w2');
    expect(f2.map((f) => f.number)).toEqual([1, 2, 3]);
    expect(seqOf({ ...input, frozen: [...f1, ...f2], restart: ['w2'] })).toContain('4:C:w1-0');
    // À la suite dans la vague du 2e jour : après ses numéros, pas après ceux de la veille.
    const changed = { ...input, frozen: [...f1, ...f2], restart: ['w2'], categories: [cats[0]!, pc('B', br(5), { waveId: 'w2' }), cats[2]!] };
    expect(appendPassages(changed, 'w2', ['B'])[0]!.number).toBe(4);
  });

  test('zone changée après réouverture : la catégorie est à numéroter', () => {
    const input: PlanInput = { categories: [pc('A', br(4))], zones: [t1, ring], waves: [], mode: 'rounds' };
    const frozen = freeze(input);
    expect(planPassages({ ...input, frozen }).pending).toEqual([]);
    expect(planPassages({ ...input, frozen, categories: [pc('A', br(4), { pinnedZoneId: 'ring' })] }).pending).toEqual([{ waveId: null, categoryId: 'A', reason: 'shape' }]);
  });

  test('choix changé après réouverture : à numéroter (finals)', () => {
    const own = (when: 'end' | 'ready') => pc('A', br(8), { finals: { where: 'own', when } });
    const base: PlanInput = { categories: [own('end')], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(base);
    expect(planPassages({ ...base, frozen }).pending).toEqual([]);
    expect(planPassages({ ...base, frozen, categories: [own('ready')] }).pending).toEqual([{ waveId: null, categoryId: 'A', reason: 'finals' }]);
  });

  test('zone des finales de la session changée : à numéroter pour les catégories concernées', () => {
    const base: PlanInput = { categories: [pc('A', br(8)), pc('R', br(4), { pinnedZoneId: 'ring', rank: 1 })], zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: finalsOn('ring') };
    const frozen = freeze(base);
    expect(planPassages({ ...base, frozen }).pending).toEqual([]);
    const pending = planPassages({ ...base, frozen, waveFinals: finalsOn(null) }).pending;
    expect(pending).toEqual([{ waveId: null, categoryId: 'A', reason: 'finals' }]);
  });

  test('signatures mélangées : une ligne ancienne suffit (à numéroter) ; courante + null : rien', () => {
    const base: PlanInput = { categories: [pc('A', br(8), { finals: { where: 'own', when: 'end' } })], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(base);
    const old = (f: FrozenPassage[]) => f.map((r, i) => (i === f.length - 1 ? { ...r, finalsChoice: 'ancienne|ready' } : r));
    expect(planPassages({ ...base, frozen: old(frozen) }).pending).toEqual([{ waveId: null, categoryId: 'A', reason: 'finals' }]);
    expect(planPassages({ ...base, frozen: old(frozen).reverse() }).pending).toEqual([{ waveId: null, categoryId: 'A', reason: 'finals' }]);
    expect(planPassages({ ...base, frozen: frozen.map((r, i) => (i === 0 ? { ...r, finalsChoice: null } : r)) }).pending).toEqual([]);
  });

  test('signature null (figé avant l’étape 43) : rien à numéroter', () => {
    const cats = [pc('K', br(5, 'kata_two_rounds')), pc('A', br(8), { rank: 1 })];
    const wholeKata = [{ ...cats[0]!, ...whole }, cats[1]!];
    const base: PlanInput = { categories: wholeKata, zones: [t1, ring], waves: [], mode: 'rounds', waveFinals: finalsOn('ring') };
    const legacy = freeze(base).map(({ finalsChoice: _drop, ...f }) => ({ ...f, finalsChoice: null }));
    const absent = freeze(base).map(({ finalsChoice: _drop, ...f }) => f);
    for (const frozen of [legacy, absent]) {
      for (const change of [{ categories: cats }, { waveFinals: finalsOn(null) }]) expect(planPassages({ ...base, frozen, ...change }).pending).toEqual([]);
    }
  });

  test('forme changée en même temps que le choix : reason shape', () => {
    const base: PlanInput = { categories: [pc('A', br(8), { finals: { where: 'own', when: 'end' } })], zones: [t1], waves: [], mode: 'rounds' };
    const frozen = freeze(base);
    const changed = pc('A', br(5), { finals: { where: 'own', when: 'ready' } });
    expect(planPassages({ ...base, frozen, categories: [changed] }).pending).toEqual([{ waveId: null, categoryId: 'A', reason: 'shape' }]);
  });

  test('appendPassages : chaque ligne porte la signature actuelle de sa catégorie', () => {
    const base: PlanInput = { categories: [pc('A', br(4)), pc('B', br(4), { rank: 1 })], zones: [t1], waves: [], mode: 'rounds' };
    const input: PlanInput = { ...base, frozen: freeze(base), categories: [pc('A', br(4)), pc('B', br(5), { rank: 1, finals: { where: 'own', when: 'ready' } })] };
    const sig = planPassages(input).finals['B']!.signature;
    const rows = appendPassages(input, null, ['B']);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.finalsChoice === sig)).toBe(true);
  });

  test('reshuffleZone : chaque ligne porte la signature actuelle de sa catégorie', () => {
    const input: PlanInput = { categories: [pc('A', br(4)), pc('B', br(4), { rank: 1, finals: { where: 'own', when: 'ready' } })], zones: [t1], waves: [], mode: 'rounds' };
    const full = { ...input, frozen: freeze(input) };
    const rows = reshuffleZone(full, 't1', null, []);
    const plan = planPassages(full);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.finalsChoice === plan.finals[r.categoryId]!.signature)).toBe(true);
  });

  test('poule unique : signature constante, ses choix et la zone des finales ne la rendent jamais à numéroter', () => {
    const pool = (finals?: PlanCategory['finals']) => pc('P', br(3, 'round_robin'), finals ? { finals } : {});
    const base: PlanInput = { categories: [pool()], zones: [t1, ring], waves: [], mode: 'rounds' };
    const frozen = freeze(base);
    expect(planPassages(base).finals['P']!.signature).toBe('none');
    for (const change of [
      { categories: [pool({ where: null, when: 'ready' })] },
      { categories: [pool({ where: 'finals', when: 'end' })], waveFinals: finalsOn('ring') },
      { mode: 'categories' as const },
    ]) expect(planPassages({ ...base, frozen, ...change }).pending).toEqual([]);
  });

  test('reshuffleZone, tour par tour : une finale « dès que finie » dont tous les combats non finaux sont joués passe en tête', () => {
    const input: PlanInput = {
      categories: [pc('A', br(4), { finals: { where: 'own', when: 'ready' } }), pc('B', br(8), { rank: 1, finals: { where: 'own', when: 'end' } })],
      zones: [t1], waves: [], mode: 'rounds',
    };
    const frozen = freeze(input);
    const played = new Set(['A:w1-0', 'A:w1-1']);
    const top = Math.max(...frozen.filter((f) => played.has(`${f.categoryId}:${f.matchId}`)).map((f) => f.number));
    const rows = reshuffleZone({ ...input, frozen, played }, 't1', null, []).sort((a, b) => a.number - b.number);
    expect(rows[0]).toMatchObject({ number: top + 1, categoryId: 'A', matchId: 'w2-0' });
    // Les autres gardent l'ordre habituel ; rien de joué n'est renuméroté.
    expect(rows.slice(1).every((r) => r.categoryId === 'B')).toBe(true);
    expect(rows.some((r) => played.has(`${r.categoryId}:${r.matchId}`))).toBe(false);
  });

  test('zone des finales qui n’accepte pas la discipline : la finale reste sur sa zone', () => {
    const tatami2 = { id: 't2', order: 1, disciplines: ['karate' as const, 'kata' as const] };
    const input: PlanInput = { categories: [pc('B', br(4), { discipline: 'shido-boxing', pinnedZoneId: 'ring' }), pc('K', br(5, 'kata_two_rounds'))], zones: [t1, { ...ring, disciplines: ['shido-boxing' as const] }, tatami2], waves: [], mode: 'rounds', waveFinals: finalsOn('t2') };
    expect(seqOf(input, 'ring')).toEqual(['1:B:w1-0', '2:B:w1-1', '3:B:w2-0']);
    const noKata: PlanInput = { ...input, zones: [t1, ring, { ...tatami2, disciplines: ['karate' as const] }] };
    expect(seqOf(noKata)).toEqual(['1:K:kata']);
  });
});
