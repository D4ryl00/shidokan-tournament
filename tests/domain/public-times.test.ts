import { describe, expect, test } from 'vitest';
import { publicTimes } from '../../src/domain/public/times.js';
import { passageKey, type PublicCompetition, type PublicQueueItem } from '../../src/domain/public/types.js';
import { toPublicCompetition } from '../../src/domain/public/view.js';
import { source } from './public-fixtures.js';

const timing = { rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 };
const item = (over: Partial<PublicQueueItem>): PublicQueueItem => ({
  number: 1, categoryId: 'A', matchId: 'w1-0', kataPart: null, a: null, b: null, aFrom: null, bFrom: null, state: 'ready', waveId: 'w1',
  finals: null, durationSec: 210, timing, kataPassages: null, endedAt: null, ...over,
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
        { zoneId: 'z2', items: [item({ number: 5, matchId: 'w2-0', finals: 'end' })] },
      ],
      finalsZones: { w1: 'z2' },
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

  test('no time once the passage is on the tatami, anywhere', () => {
    const pub = made({ waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: '09:30', actualStart: '09:30', finalsStart: null }] });
    const [first, second] = pub.queues[0]!.items;
    const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
    // Avant 9:30 : le premier n'est pas encore sur le tatami.
    expect(publicTimes(pub, h(9, 29)).at(passageKey(first!))).toBe('9:30');
    // Combat en cours : jamais une heure déjà passée (Zones, Suivis), l'heure du suivant ne bouge pas.
    const during = publicTimes(pub, h(9, 32));
    expect(during.at(passageKey(first!))).toBeNull();
    expect(during.at(passageKey(second!))).toBe('9:35');
    // Hors du jour J : l'heure reste.
    expect(publicTimes(pub, null).at(passageKey(first!))).toBe('9:30');
  });

  test('final of a category already on the tatami shows no time', () => {
    const pub = made({
      waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: '09:30', actualStart: '09:30', finalsStart: null }],
      queues: [
        { zoneId: 'z1', items: [item({ number: 1, matchId: 'w1-0' })] },
        { zoneId: 'z2', items: [item({ number: 5, matchId: 'w2-0', finals: 'end' })] },
      ],
      finalsZones: { w1: 'z2' },
    });
    const start = publicTimes(pub, null).categoryFinalAt('A');
    expect(start).not.toBeNull();
    const [hh, mm] = start!.split(':').map(Number);
    const atStart = (hh! * 60 + mm!) * 60;
    expect(publicTimes(pub, atStart - 60).categoryFinalAt('A')).toBe(start);
    expect(publicTimes(pub, atStart + 60).categoryFinalAt('A')).toBeNull();
  });

  test('history shows no times', () => {
    const pub = made({ phase: 'past' });
    const t = publicTimes(pub, 10 * 3600);
    expect(t.at(passageKey(pub.queues[0]!.items[0]!))).toBeNull();
    expect(t.drift('z1')).toBeNull();
    expect(t.waveStart('w1')).toBeNull();
    expect(t.finalsAt('w1')).toBeNull();
  });
  describe('finals', () => {
    const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
    /** z1 : deux combats de A (9:30 → 9:38) ; z2 : un passage de B (9:30 → 9:31), puis la finale de A. */
    const withFinal = (finals: 'ready' | 'end', over: Partial<PublicCompetition> = {}) => {
      const base = made();
      return made({
        categories: base.categories,
        queues: [
          { zoneId: 'z1', items: [item({ number: 1, matchId: 'w1-0' }), item({ number: 2, matchId: 'w1-1' })] },
          { zoneId: 'z2', items: [item({ number: 1, categoryId: 'B', matchId: null, timing: null, kataPassages: 1, durationSec: 60 }), item({ number: 5, matchId: 'w2-0', finals })] },
        ],
        ...over,
      });
    };
    const finalAt = (pub: PublicCompetition, now: number | null = null) => publicTimes(pub, now).at(passageKey(pub.queues[1]!.items[1]!));

    test('« dès que finie » hors de la zone de sa catégorie : après la fin estimée de ses combats', () => {
      expect(finalAt(withFinal('ready'))).toBe('9:38');
      // Sur la zone de sa catégorie : rien à attendre.
      const own = withFinal('ready');
      own.categories = own.categories.map((c) => (c.id === 'A' ? { ...c, zoneId: 'z2' } : c));
      expect(finalAt(own)).toBe('9:32');
    });

    test('« fin de session » : attend les autres zones sur la zone des finales de la session seulement', () => {
      expect(finalAt(withFinal('end', { finalsZones: { w1: 'z2' } }))).toBe('9:38');
      expect(finalAt(withFinal('end', { finalsZones: { w1: 'z3' } }))).toBe('9:32');
      expect(finalAt(withFinal('end', { finalsZones: {} }))).toBe('9:32');
    });

    test('début des finales : jamais une heure déjà passée', () => {
      const pub = withFinal('end', { finalsZones: { w1: 'z2' } });
      expect(publicTimes(pub, h(9, 37)).finalsAt('w1')).toBe('9:38');
      expect(publicTimes(pub, h(9, 39)).finalsAt('w1')).toBeNull();
    });

    test('finale jouée en avance : les passages qui la précèdent restent à venir, après elle', () => {
      const base = made();
      const pub = made({
        waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: '09:30', actualStart: '09:30', finalsStart: null }],
        categories: base.categories,
        queues: [{ zoneId: 'z1', items: [
          item({ number: 1, matchId: 'w1-0' }), item({ number: 2, matchId: 'w1-1' }),
          item({ number: 3, matchId: 'w2-0', finals: 'ready', endedAt: `${base.date}T09:20:00Z` }),
        ] }],
      });
      // Fin de la finale : 10:20 à Paris ; maintenant 10:20:30.
      const t = publicTimes(pub, h(10, 20) + 30);
      expect(t.at(passageKey(pub.queues[0]!.items[0]!))).toBe('10:21');
      expect(t.at(passageKey(pub.queues[0]!.items[1]!))).toBe('10:26');
    });
  });
});
