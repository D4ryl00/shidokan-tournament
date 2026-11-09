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

  test('category final time: earliest unplayed final, none once played', () => {
    const base = made();
    const ended = `${base.date}T08:40:00Z`;
    const single = made({ queues: [{ zoneId: 'z1', items: [item({ number: 1, matchId: 'w2-0', endedAt: ended })] }] });
    expect(publicTimes(single, null).categoryFinalAt('A')).toBeNull();
    // Au meilleur des trois : le premier combat de la série pas encore joué.
    const a = base.categories.find((c) => c.id === 'A')!;
    const br = a.bracket;
    if (br.kind !== 'combat') throw new Error('A est un tableau de combat');
    const series = { ...a, bracket: { ...br, format: 'best_of_three' as const, matches: ['s1', 's2', 's3'].map((id) => ({ ...br.matches[0]!, id, phase: 'series' as const })) } };
    const bo3 = made({
      categories: [series, ...base.categories.filter((c) => c.id !== 'A')] as PublicCompetition['categories'],
      queues: [{ zoneId: 'z1', items: [item({ number: 1, matchId: 's1', endedAt: ended }), item({ number: 2, matchId: 's2' }), item({ number: 3, matchId: 's3' })] }],
    });
    const t = publicTimes(bo3, null);
    expect(t.categoryFinalAt('A')).not.toBeNull();
    expect(t.categoryFinalAt('A')).toBe(t.at(passageKey(bo3.queues[0]!.items[1]!)));
    const done = made({
      categories: bo3.categories,
      queues: [{ zoneId: 'z1', items: [item({ number: 1, matchId: 's1', endedAt: ended }), item({ number: 2, matchId: 's2', endedAt: ended })] }],
    });
    expect(publicTimes(done, null).categoryFinalAt('A')).toBeNull();
  });

  test('an unreadable session time gives no time, never NaN', () => {
    const pub = made({ waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: 'xx', actualStart: null, finalsStart: 'xx' }] });
    const t = publicTimes(pub, null);
    expect(t.at(passageKey(pub.queues[0]!.items[0]!))).toBeNull();
    expect(t.finalsAt('w1')).toBeNull();
    expect(t.waveStart('w1')).toBeNull();
  });

  test('next time hidden once the passage is on the tatami', () => {
    const pub = made({ waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: '09:30', actualStart: '09:30', finalsStart: null }] });
    const [first, second] = pub.queues[0]!.items;
    const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
    // Avant 9:30 : le premier n'est pas encore sur le tatami.
    expect(publicTimes(pub, h(9, 29)).nextAt(passageKey(first!))).toBe('9:30');
    // Combat en cours : pas d'heure en tête de zone, l'heure du suivant ne bouge pas.
    const during = publicTimes(pub, h(9, 32));
    expect(during.nextAt(passageKey(first!))).toBeNull();
    expect(during.at(passageKey(first!))).toBe('9:30');
    expect(during.at(passageKey(second!))).toBe('9:35');
    // Hors du jour J : l'heure reste.
    expect(publicTimes(pub, null).nextAt(passageKey(first!))).toBe('9:30');
  });

  test('history shows no times', () => {
    const pub = made({ phase: 'past' });
    const t = publicTimes(pub, 10 * 3600);
    expect(t.at(passageKey(pub.queues[0]!.items[0]!))).toBeNull();
    expect(t.drift('z1')).toBeNull();
    expect(t.waveStart('w1')).toBeNull();
    expect(t.finalsAt('w1')).toBeNull();
    expect(t.nextAt(passageKey(pub.queues[0]!.items[0]!))).toBeNull();
  });
});
