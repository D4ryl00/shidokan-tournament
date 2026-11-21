import { expect, test } from 'vitest';
import type { PassagePlan } from '../../src/domain/passages/index.js';
import { categoryPassages, kataPassageText } from '../../src/web/passages.js';

const zones = [{ id: 'z1', name: 'Tatami 1' }, { id: 'ring', name: 'Ring' }];
const mk = (matchId: string, number: number) => ({ categoryId: 'k', matchId, number, waveId: null }) as never;
/** Plan d'une catégorie de kata (sur z1) : numéros du tour 1 sur la zone `zt`, de la finale sur la zone `zf`. */
function passagesOf(tour1: number[], finale: number[], zt: string, zf: string) {
  const t = tour1.map((n, i) => mk(`kata:tour1:r${i}`, n));
  const f = finale.map((n, i) => mk(`kata:finale:${i + 1}`, n));
  const planZones = zt === zf ? [{ zoneId: zt, passages: [...t, ...f] }] : [{ zoneId: zt, passages: t }, { zoneId: zf, passages: f }];
  const plan = { categories: { k: { zoneId: 'z1', auto: false } }, zones: planZones } as unknown as PassagePlan;
  return categoryPassages(plan, 'k');
}

test('kataPassageText : plage du kata entier, ou tour 1 et finale séparés', () => {
  expect(kataPassageText(passagesOf([14, 15, 16, 17, 18], [19, 20], 'z1', 'z1'), zones)).toBe('n° 14 à 20');
  expect(kataPassageText(passagesOf([14, 15, 16, 17, 18], [3, 4], 'z1', 'ring'), zones)).toBe('tour 1 : n° 14 à 18 · finale : n° 3 et 4 (Ring)');
  expect(kataPassageText(passagesOf([], [14, 15], 'z1', 'z1'), zones)).toBe('finale : n° 14 et 15');
});

test('kataPassageText : numéros non consécutifs listés, kata sans passage vide', () => {
  expect(kataPassageText(passagesOf([14, 15, 17], [18, 19], 'z1', 'z1'), zones)).toBe('tour 1 : n° 14, 15, 17 · finale : n° 18 et 19');
  expect(kataPassageText(passagesOf([], [], 'z1', 'z1'), zones)).toBe('');
});

test('categoryPassages : les clés de kata sont dans numbers', () => {
  const p = passagesOf([14, 15, 16], [17, 18], 'z1', 'z1');
  expect(p.numbers?.get('kata:tour1:r1')).toBe(15);
  expect(p.numbers?.get('kata:finale:2')).toBe(18);
});
