import { expect, test } from 'vitest';
import { buildTimeline, zoneDrift, type TimelineInput, type TimelineItem } from '../../src/domain/schedule/timeline.js';

const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
const item = (key: string, waveKey: string, durationSec: number, endedAt: number | null = null, finals = false): TimelineItem => ({
  key, waveKey, durationSec, endedAt, finals,
});
const wave = (key: string, plannedStart: number | null, actualStart: number | null = null, finalsStart: number | null = null) => ({
  key, plannedStart, actualStart, finalsStart,
});
const input = (p: Partial<TimelineInput> & Pick<TimelineInput, 'waves' | 'zones'>): TimelineInput => ({
  now: null, changeoverSec: 60, finalsZoneId: null, ...p,
});

test('planned start drives the first wave', () => {
  const t = buildTimeline(input({ now: null, waves: [wave('s1', h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300), item('b', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(9, 30));
  expect(t.starts.get('b')).toBe(h(9, 36));
  expect(t.waveStarts.get('s1')).toEqual({ at: h(9, 30), estimated: false });
});

test('actual start beats planned', () => {
  const t = buildTimeline(input({ now: null, waves: [wave('s1', h(9, 30), h(9, 41))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(9, 41));
});

test('first result estimates the start', () => {
  const t = buildTimeline(input({ now: null, waves: [wave('s1', null)], zones: [{ zoneId: 'z', items: [item('a', 's1', 300, h(9, 50)), item('b', 's1', 300)] }] }));
  expect(t.waveStarts.get('s1')).toEqual({ at: h(9, 45), estimated: true });
  expect(t.starts.get('b')).toBe(h(9, 51));
});

test('now pushes unplayed passages', () => {
  const t = buildTimeline(input({ now: h(10, 20), waves: [wave('s1', null, h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 3600), item('b', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(10, 20));
  expect(t.starts.get('b')).toBe(h(10, 20) + 3600 + 60);
});

test('now does not move a wave not started', () => {
  const t = buildTimeline(input({ now: h(15, 0), waves: [wave('s1', h(14, 0))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300), item('b', 's1', 300)] }] }));
  expect(t.starts.get('a')).toBe(h(14, 0));
  expect(t.starts.get('b')).toBe(h(14, 6));
});

test('out-of-order results never move the cursor back', () => {
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 30))],
    zones: [{ zoneId: 'z', items: [item('1', 's1', 300, h(10, 0)), item('2', 's1', 300, h(10, 10)), item('3', 's1', 300, h(10, 2)), item('4', 's1', 300)] }],
  }));
  expect(t.starts.get('4')).toBe(h(10, 11));
});

test('restart numbering keeps wave order', () => {
  const t = buildTimeline(input({
    now: null,
    waves: [wave('s1', h(9, 0)), wave('s2', h(13, 0))],
    // file triée par numéro : s2 (n° 1, 2) avant s1 (n° 3, 4)
    zones: [{ zoneId: 'z', items: [item('s2-1', 's2', 300), item('s2-2', 's2', 300), item('s1-3', 's1', 300), item('s1-4', 's1', 300)] }],
  }));
  expect(t.starts.get('s1-3')).toBe(h(9, 0));
  expect(t.starts.get('s1-4')).toBe(h(9, 6));
  expect(t.starts.get('s2-1')).toBe(h(13, 0));
  expect(t.starts.get('s1-3')!).toBeLessThan(t.starts.get('s2-1')!);
});

test('a late wave does not shift the next one', () => {
  const zones = [{ zoneId: 'z', items: [item('a', 's1', 3600), item('b', 's2', 300)] }];
  const planned = buildTimeline(input({ now: null, waves: [wave('s1', h(10, 30)), wave('s2', h(11, 0))], zones }));
  expect(planned.starts.get('a')).toBe(h(10, 30));
  expect(planned.starts.get('b')).toBe(h(11, 0));
  const noTime = buildTimeline(input({ now: null, waves: [wave('s1', h(10, 30)), wave('s2', null)], zones }));
  expect(noTime.starts.has('b')).toBe(false);
  expect(noTime.waveStarts.get('s2')).toBeNull();
});

test('finals wait for the other zones', () => {
  const t = buildTimeline(input({
    now: null,
    finalsZoneId: 'f',
    waves: [wave('s1', h(9, 0))],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300, h(10, 30)), item('fin1', 's1', 300, null, true), item('fin2', 's1', 300, null, true)] },
      { zoneId: 'o', items: [item('o1', 's1', 300, h(11, 10))] },
    ],
  }));
  expect(t.starts.get('fin1')).toBe(h(11, 10));
  expect(t.starts.get('fin2')).toBe(h(11, 16));
  expect(t.finalsStarts.get('s1')).toBe(h(11, 10));
});

test('fixed finals time wins', () => {
  const t = buildTimeline(input({
    now: null,
    finalsZoneId: 'f',
    waves: [wave('s1', h(9, 0), null, h(12, 0))],
    zones: [
      { zoneId: 'f', items: [item('f1', 's1', 300, h(10, 30)), item('fin1', 's1', 300, null, true)] },
      { zoneId: 'o', items: [item('o1', 's1', 300, h(11, 0))] },
    ],
  }));
  expect(t.starts.get('fin1')).toBe(h(12, 0));
  expect(t.finalsStarts.get('s1')).toBe(h(12, 0));
});

test('no start known gives no times', () => {
  const inp = input({ now: null, waves: [wave('s1', null)], zones: [{ zoneId: 'z', items: [item('a', 's1', 300)] }] });
  const t = buildTimeline(inp);
  expect(t.starts.size).toBe(0);
  expect(t.waveStarts.get('s1')).toBeNull();
  expect(zoneDrift(inp, 'z')).toBeNull();
});

test('drift compares with planned times only', () => {
  const items = [item('a', 's1', 300, h(9, 50)), item('b', 's1', 300)];
  const withPlan = input({ now: null, waves: [wave('s1', h(9, 30))], zones: [{ zoneId: 'z', items }] });
  expect(zoneDrift(withPlan, 'z')).toBe(h(9, 51) - h(9, 36));
  expect(zoneDrift(input({ now: null, waves: [wave('s1', null)], zones: [{ zoneId: 'z', items }] }), 'z')).toBeNull();
  const done = input({ now: null, waves: [wave('s1', h(9, 30))], zones: [{ zoneId: 'z', items: [item('a', 's1', 300, h(9, 50))] }] });
  expect(zoneDrift(done, 'z')).toBeNull();
});
