import { describe, expect, test } from 'vitest';
import { distributeZones, zonesFor, type DistributionCategory, type ZoneSpec } from '../../../src/domain/passages/index.js';

const t1: ZoneSpec = { id: 't1', order: 0, disciplines: null };
const t2: ZoneSpec = { id: 't2', order: 1, disciplines: null };
const cat = (id: string, weight: number, over: Partial<DistributionCategory> = {}): DistributionCategory => ({ id, discipline: 'karate', pinnedZoneId: null, weight, rank: 0, ...over });
const zonesOf = (r: ReturnType<typeof distributeZones>) => Object.fromEntries(r.zoneOf);

describe('répartition sur les zones', () => {
  test('équilibre : poids 7, 3, 3, 1 sur deux zones → 7 | 3+3+1, plus lourde d’abord', () => {
    const r = distributeZones([cat('c', 3, { rank: 2 }), cat('a', 7, { rank: 0 }), cat('d', 1, { rank: 3 }), cat('b', 3, { rank: 1 })], [t1, t2]);
    expect(zonesOf(r)).toEqual({ a: 't1', b: 't2', c: 't2', d: 't2' });
    expect(r.impossible).toEqual([]);
  });

  test('égalité : la première zone dans l’ordre', () => {
    expect(zonesOf(distributeZones([cat('a', 2)], [{ ...t2, order: 1 }, { ...t1, order: 0 }]))).toEqual({ a: 't1' });
  });

  test('discipline limitée au Ring', () => {
    const ring: ZoneSpec = { id: 'ring', order: 1, disciplines: ['shido-boxing'] };
    const tatami: ZoneSpec = { ...t1, disciplines: ['karate', 'kata', 'shido-mix', 'triathlon'] };
    expect(zonesFor('shido-boxing', [tatami, ring]).map((z) => z.id)).toEqual(['ring']);
    const r = distributeZones([cat('box', 9, { discipline: 'shido-boxing' }), cat('k1', 1), cat('k2', 1)], [tatami, ring]);
    expect(zonesOf(r)).toEqual({ box: 'ring', k1: 't1', k2: 't1' });
  });

  test('épinglée : reste sur sa zone même si la discipline n’y est pas acceptée, et compte dans la charge', () => {
    const ring: ZoneSpec = { id: 'ring', order: 1, disciplines: ['shido-boxing'] };
    const r = distributeZones([cat('pin', 5, { pinnedZoneId: 'ring' }), cat('a', 3), cat('b', 3, { discipline: 'shido-boxing' })], [{ ...t1, disciplines: ['karate'] }, ring]);
    expect(zonesOf(r)).toEqual({ pin: 'ring', a: 't1', b: 'ring' });
    const r2 = distributeZones([cat('pin', 5, { pinnedZoneId: 't1' }), cat('a', 3)], [t1, t2]);
    expect(zonesOf(r2)).toEqual({ pin: 't1', a: 't2' });
  });

  test('discipline acceptée nulle part : zone null, impossible ; épinglage vers une zone disparue : automatique', () => {
    const r = distributeZones([cat('box', 2, { discipline: 'shido-boxing' }), cat('lost', 1, { pinnedZoneId: 'gone' })], [{ ...t1, disciplines: ['karate'] }]);
    expect(zonesOf(r)).toEqual({ box: null, lost: 't1' });
    expect(r.impossible).toEqual(['box']);
  });
});
