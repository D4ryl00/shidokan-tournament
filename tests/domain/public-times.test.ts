import { describe, expect, test } from 'vitest';
import { publicTimes } from '../../src/domain/public/times.js';
import { passageKey, type PublicCompetition, type PublicQueueItem } from '../../src/domain/public/types.js';
import { toPublicCompetition } from '../../src/domain/public/view.js';
import { source } from './public-fixtures.js';

const timing = { rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 };
const item = (over: Partial<PublicQueueItem>): PublicQueueItem => ({
  number: 1, categoryId: 'A', matchId: 'w1-0', kataPart: null, a: null, b: null, aFrom: null, bFrom: null, state: 'ready', waveId: 'w1',
  finals: false, durationSec: 210, timing, kataPassages: null, endedAt: null, ...over,
});

/** Vue fabriquée : une zone, deux combats de la session Matin (prévue 9:30). */
function made(over: Partial<PublicCompetition> = {}): PublicCompetition {
  const base = toPublicCompetition(source());
  return {
    ...base,
    phase: 'today',
    waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: '09:30', actualStart: null, finalsStart: null }],
    queues: [{ zoneId: 'z1', items: [item({ number: 1, matchId: 'w1-0' }), item({ number: 2, matchId: 'w1-1' })] }],
    ...over,
  };
}

describe('publicTimes', () => {
  test('times of a launched competition', () => {
    const pub = made();
    const t = publicTimes(pub, null);
    const [first, second] = pub.queues[0]!.items;
    expect(t.at(passageKey(first!))).toBe('9:30');
    expect(t.at(passageKey(second!))).toBe('9:35');
    expect(t.waveStart('w1')).toBeNull();
    expect(t.drift('z1')).toBe(0);
  });

  test('category final time', () => {
    const base = made();
    const pub = made({
      queues: [
        { zoneId: 'z1', items: [item({ number: 1, matchId: 'w1-0' })] },
        { zoneId: 'z2', items: [item({ number: 5, matchId: 'w2-0', finals: true })] },
      ],
      finalsZoneId: 'z2',
      categories: base.categories,
    });
    const t = publicTimes(pub, null);
    // La finale de A est sur la zone des finales : elle part après les autres passages de la session.
    expect(t.categoryFinalAt('A')).not.toBeNull();
    expect(t.categoryFinalAt('A')).toBe(t.at(passageKey(pub.queues[1]!.items[0]!)));
    // Kata : le bloc de finale, sinon le bloc entier.
    const kata = (parts: ('tour1' | 'finale' | null)[]): PublicCompetition =>
      made({ queues: [{ zoneId: 'z2', items: parts.map((kataPart, i) => item({ number: i + 1, categoryId: 'B', matchId: null, kataPart, timing: null, kataPassages: 3, durationSec: 270 })) }] });
    const split = kata(['tour1', 'finale']);
    const ts = publicTimes(split, null);
    expect(ts.categoryFinalAt('B')).toBe(ts.at(passageKey(split.queues[0]!.items[1]!)));
    const whole = kata([null]);
    expect(publicTimes(whole, null).categoryFinalAt('B')).toBe('9:30');
  });

  test('history shows no times', () => {
    const pub = made({ phase: 'past' });
    const t = publicTimes(pub, 10 * 3600);
    expect(t.at(passageKey(pub.queues[0]!.items[0]!))).toBeNull();
    expect(t.drift('z1')).toBeNull();
    expect(t.waveStart('w1')).toBeNull();
    expect(t.finalsAt('w1')).toBeNull();
  });
});
