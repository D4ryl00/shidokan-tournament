import { expect, test } from 'vitest';
import type { FinalsWhen } from '../../src/domain/passages/index.js';
import { estimateDay, type EstimateInput } from '../../src/domain/schedule/estimate.js';

const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
const item = (key: string, waveKey: string, durationSec: number, finals: FinalsWhen | null = null, waitsFor?: string[]) => ({
  key, waveKey, durationSec, finals, ...(waitsFor ? { waitsFor } : {}),
});
const wave = (key: string, plannedStart: number | null, finalsZoneId: string | null = null) => ({ key, plannedStart, finalsZoneId });

/** Session 1 à 9:00 : trois combats de 20 min (fin 10:02) ; session 2 prévue à 9:38 : deux de 30 min. */
const overlapping = (shift: boolean): EstimateInput => ({
  changeoverSec: 60,
  shift,
  waves: [wave('s1', h(9, 0)), wave('s2', h(9, 38))],
  zones: [{ zoneId: 'z', items: [item('a', 's1', 1200), item('b', 's1', 1200), item('c', 's1', 1200), item('d', 's2', 1800), item('e', 's2', 1800)] }],
});

test('a session planned before the end of the previous one on a zone: overlap of 25 min, shift pushes the day by 25 min', () => {
  const plain = estimateDay(overlapping(false));
  expect(plain.relative).toBe(false);
  expect(plain.waves[0]).toEqual({ key: 's1', start: h(9, 0), end: h(10, 2), finalsStart: null, zones: [{ zoneId: 'z', start: h(9, 0), end: h(10, 2), passages: 3 }], overlap: [] });
  // Fin 10:02 + 1 min de changement, prévue à 9:38 : 25 min de chevauchement, dans les deux cas.
  expect(plain.waves[1]!.overlap).toEqual([{ zoneId: 'z', minutes: 25 }]);
  expect(plain.waves[1]!.zones).toEqual([{ zoneId: 'z', start: h(9, 38), end: h(10, 39), passages: 2 }]);
  expect(plain.end).toBe(h(10, 39));

  const shifted = estimateDay(overlapping(true));
  expect(shifted.waves[1]!.overlap).toEqual([{ zoneId: 'z', minutes: 25 }]);
  expect(shifted.waves[1]!.zones).toEqual([{ zoneId: 'z', start: h(10, 3), end: h(11, 4), passages: 2 }]);
  expect(shifted.end - plain.end).toBe(25 * 60);
});

test('overlap minutes are rounded up', () => {
  const e = estimateDay({ ...overlapping(false), waves: [wave('s1', h(9, 0)), wave('s2', h(10, 2) + 30)] });
  expect(e.waves[1]!.overlap).toEqual([{ zoneId: 'z', minutes: 1 }]);
});

test('the busiest zone decides the end of a session and of the day; a session without a start follows the previous one', () => {
  const e = estimateDay({
    changeoverSec: 60,
    shift: true,
    waves: [wave('s1', h(9, 0)), wave('s2', null)],
    zones: [
      { zoneId: 'z1', items: [item('a', 's1', 600), item('b', 's1', 600), item('x', 's2', 300)] },
      { zoneId: 'z2', items: [item('c', 's1', 300)] },
    ],
  });
  expect(e.waves[0]!.zones).toEqual([
    { zoneId: 'z1', start: h(9, 0), end: h(9, 21), passages: 2 },
    { zoneId: 'z2', start: h(9, 0), end: h(9, 5), passages: 1 },
  ]);
  expect(e.waves[0]!.end).toBe(h(9, 21));
  expect(e.waves[1]!.start).toBe(h(9, 22));
  expect(e.waves[1]!.end).toBe(h(9, 27));
  expect(e.waves[1]!.overlap).toEqual([]);
  expect(e.end).toBe(h(9, 27));
});

test('no planned start: relative, seconds from the beginning', () => {
  const e = estimateDay({
    changeoverSec: 60,
    shift: true,
    waves: [wave('s1', null), wave('s2', null)],
    zones: [{ zoneId: 'z', items: [item('a', 's1', 600), item('b', 's2', 300)] }],
  });
  expect(e.relative).toBe(true);
  expect(e.waves.map((w) => [w.start, w.end])).toEqual([[0, 600], [660, 960]]);
  expect(e.end).toBe(960);
});

test('« Fin de session » finals come after the other passages of the session, on the finals zone', () => {
  const e = estimateDay({
    changeoverSec: 60,
    shift: true,
    waves: [wave('s1', h(9, 0), 'z1')],
    zones: [
      { zoneId: 'z1', items: [item('a', 's1', 600), item('f', 's1', 300, 'end')] },
      { zoneId: 'z2', items: [item('b', 's1', 1200)] },
    ],
  });
  // La finale attend la fin de b (9:20) sur l'autre zone, pas seulement celle de a (9:10).
  expect(e.waves[0]!.finalsStart).toBe(h(9, 20));
  expect(e.waves[0]!.zones[0]).toEqual({ zoneId: 'z1', start: h(9, 0), end: h(9, 25), passages: 2 });
  expect(e.end).toBe(h(9, 25));
});

test('a session without passages ends at its start', () => {
  const e = estimateDay({ changeoverSec: 60, shift: true, waves: [wave('s1', h(9, 0))], zones: [] });
  expect(e.waves).toEqual([{ key: 's1', start: h(9, 0), end: h(9, 0), finalsStart: null, zones: [], overlap: [] }]);
  expect(e.end).toBe(h(9, 0));
});
