import { describe, expect, test } from 'vitest';
import { generateBracket, type Bracket, type CombatBracket } from '../../../src/domain/brackets/index.js';
import { matchNodes, planPassages, zoneOrder, type OrderCategory, type PlanCategory } from '../../../src/domain/passages/index.js';
import { defaultSettings, readStoredSettings } from '../../../src/domain/settings.js';

let seq = 0;
const entrants = (n: number) => Array.from({ length: n }, () => ({ registrationId: `e${++seq}`, clubId: null, label: `E${seq}` }));
const options = { repechage: false, thirdPlace: false, kataBronzeCount: 2 as const };
const combat = (n: number, format: 'single_elimination' | 'single_match' = 'single_elimination') => generateBracket(format, entrants(n), options, 1) as CombatBracket;
const kata = (n: number) => generateBracket('kata_two_rounds', entrants(n), options, 1);
const cat = (id: string, rank: number, b: Bracket): OrderCategory =>
  b.kind === 'kata' ? { id, rank, kataEntrants: b.entrants.length, nodes: [] } : { id, rank, kataEntrants: null, nodes: matchNodes(b) };
const seqOf = (ps: ReturnType<typeof zoneOrder>) => ps.map((p) => `${p.number}:${p.categoryId}:${p.matchId ?? 'kata'}${p.noRest ? '!' : ''}`);

describe('ordre de passage d’une zone', () => {
  test('kata d’abord : bloc n° 1, puis les combats à partir de 2 ; zone sans kata : combats dès 1', () => {
    expect(seqOf(zoneOrder([cat('A', 0, combat(2, 'single_match')), cat('K', 1, kata(3))], 'rounds', 1))).toEqual(['1:K:kata', '2:A:w1-0']);
    expect(seqOf(zoneOrder([cat('A', 0, combat(2, 'single_match'))], 'rounds', 5))).toEqual(['5:A:w1-0']);
  });

  test('tour par tour : deux catégories de 8 alternées, tour après tour ; le combat unique avec les finales', () => {
    const ps = zoneOrder([cat('A', 0, combat(8)), cat('B', 1, combat(8)), cat('C', 2, combat(2, 'single_match'))], 'rounds', 1);
    const rounds = ps.map((p) => (p.categoryId === 'C' ? 'F' : p.matchId!.startsWith('w3') ? 'F' : p.matchId!.slice(0, 2)));
    expect(rounds).toEqual([...Array(8).fill('w1'), ...Array(4).fill('w2'), 'F', 'F', 'F']);
    expect(ps.slice(0, 4).map((p) => p.categoryId)).toEqual(['A', 'B', 'A', 'B']);
    expect(ps.some((p) => p.noRest)).toBe(false);
  });

  test('tour par tour, deux catégories de 4 : aucun « pas de repos »', () => {
    const ps = zoneOrder([cat('A', 0, combat(4)), cat('B', 1, combat(4))], 'rounds', 1);
    expect(ps).toHaveLength(6);
    expect(ps.some((p) => p.noRest)).toBe(false);
  });

  test('catégorie seule de 4 : w1-0, w1-1, w2-0 sans repos', () => {
    expect(seqOf(zoneOrder([cat('A', 0, combat(4))], 'rounds', 1))).toEqual(['1:A:w1-0', '2:A:w1-1', '3:A:w2-0!']);
  });

  test('catégorie par catégorie : la catégorie de rang 1 en entier, puis la suivante', () => {
    const ps = zoneOrder([cat('B', 1, combat(4)), cat('A', 0, combat(4))], 'categories', 1);
    expect(ps.map((p) => p.categoryId)).toEqual(['A', 'A', 'A', 'B', 'B', 'B']);
    expect(ps.filter((p) => p.noRest).map((p) => p.number)).toEqual([3, 6]);
  });
});

describe('plan de passage', () => {
  const zones = [{ id: 't1', order: 0, disciplines: null }];
  const pc = (id: string, b: Bracket, over: Partial<PlanCategory> = {}): PlanCategory => ({
    id, waveId: null, discipline: b.kind === 'kata' ? 'kata' : 'karate', pinnedZoneId: null, rank: 0, bracket: b, playable: b.entrants.length >= 2, ...over,
  });

  test('numéros continus d’une vague à l’autre, kata en tête de chaque vague ; sans vague (alors qu’il y en a) : ni zone ni numéro', () => {
    const plan = planPassages({
      categories: [pc('A', combat(4), { waveId: 'w1' }), pc('K', kata(3), { waveId: 'w2' }), pc('B', combat(4), { waveId: 'w2', rank: 1 }), pc('N', combat(4))],
      zones,
      waves: [{ id: 'w2', order: 1 }, { id: 'w1', order: 0 }],
      mode: 'rounds',
    });
    const t1 = plan.zones.find((z) => z.zoneId === 't1')!.passages;
    expect(t1.map((p) => `${p.number}:${p.categoryId}:${p.waveId}`)).toEqual(['1:A:w1', '2:A:w1', '3:A:w1', '4:K:w2', '5:B:w2', '6:B:w2', '7:B:w2']);
    expect(plan.categories.N).toEqual({ zoneId: null, auto: false });
  });

  test('sans vague : une seule vague implicite', () => {
    const plan = planPassages({ categories: [pc('A', combat(2, 'single_match')), pc('B', combat(2, 'single_match'), { rank: 1 })], zones, waves: [], mode: 'rounds' });
    expect(plan.zones[0]!.passages.map((p) => [p.number, p.categoryId, p.waveId])).toEqual([[1, 'A', null], [2, 'B', null]]);
  });

  test('épinglée → auto false ; répartie → auto true ; impossible signalé avec sa discipline ; non jouable : zone sans passage', () => {
    const two = [{ id: 't1', order: 0, disciplines: ['karate' as const] }, { id: 't2', order: 1, disciplines: ['karate' as const] }];
    const plan = planPassages({
      categories: [pc('P', combat(4), { pinnedZoneId: 't2' }), pc('A', combat(4)), pc('X', combat(2, 'single_match'), { discipline: 'shido-boxing' }), pc('S', combat(1))],
      zones: two,
      waves: [],
      mode: 'rounds',
    });
    expect(plan.categories).toMatchObject({ P: { zoneId: 't2', auto: false }, A: { zoneId: 't1', auto: true }, X: { zoneId: null, auto: true } });
    expect(plan.categories.S!.zoneId).not.toBeNull();
    expect(plan.impossible).toEqual([{ categoryId: 'X', discipline: 'shido-boxing' }]);
    expect(plan.zones.flatMap((z) => z.passages).some((p) => p.categoryId === 'S')).toBe(false);
  });
});

test('réglages : passageOrder par défaut « rounds », valeur stockée invalide → défaut', () => {
  expect(defaultSettings().passageOrder).toBe('rounds');
  expect(readStoredSettings({ passageOrder: 'n’importe quoi' }).passageOrder).toBe('rounds');
  expect(readStoredSettings({ passageOrder: 'categories' }).passageOrder).toBe('categories');
});
