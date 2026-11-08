import { describe, expect, test } from 'vitest';
import { publicPhase, todayInParis, toPublicCompetition } from '../../src/domain/public/view.js';
import { source } from './public-fixtures.js';

describe('publicPhase', () => {
  test('jour même, passé, à venir, lancée en avance', () => {
    expect(publicPhase('2026-11-22', '2026-11-22', false)).toBe('today');
    expect(publicPhase('2026-11-21', '2026-11-22', true)).toBe('past');
    expect(publicPhase('2026-12-06', '2026-11-22', false)).toBe('upcoming');
    expect(publicPhase('2026-12-06', '2026-11-22', true)).toBe('today');
  });
});

describe('todayInParis', () => {
  test('23 h 30 UTC est déjà le lendemain à Paris', () => {
    expect(todayInParis(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11-22');
    expect(todayInParis(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
    expect(todayInParis(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });
});

describe('toPublicCompetition', () => {
  test('only launched categories are public', () => {
    const base = source();
    const view = toPublicCompetition(source({ categories: base.categories.filter((c) => c.id === 'A' || c.id === 'C'), launchedCategoryIds: ['A'] }));
    expect(view.categories.map((c) => c.id)).toEqual(['A']);
    expect(Object.keys(view.entrants).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    // Rien de la session non lancée dans les files.
    expect(view.queues.flatMap((q) => q.items).some((i) => i.categoryId === 'C')).toBe(false);
  });

  test('a launched category of a reopened wave is not public', () => {
    const view = toPublicCompetition(source({ launchedWaveKeys: [] }));
    expect(view.categories).toEqual([]);
    expect(view.queues).toEqual([]);
    expect(view.zones).toEqual([]);
    expect(view.entrants).toEqual({});
    expect(view.waves).toEqual([
      { id: 'w1', name: 'Matin', launched: false },
      { id: 'w2', name: 'Après-midi', launched: false },
    ]);
  });

  test('masked fighter name never appears in public json', () => {
    const view = toPublicCompetition(source());
    const json = JSON.stringify(view);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('Zoé');
    expect(view.entrants.r3).toEqual({
      registrationId: 'r3',
      fighterId: null,
      name: 'Combattant masqué',
      shortName: 'Combattant masqué',
      club: 'Dojo Lyon',
      clubId: 'k1',
      hidden: true,
    });
    const a = view.categories.find((c) => c.id === 'A')!;
    expect(a.bracket.entrants.map((e) => e.label)).toEqual(['MARTIN Léa', 'BONNET Chloé', 'Combattant masqué', 'FAURE Jade']);
    expect(view.entrants.r1).toEqual({ registrationId: 'r1', fighterId: 'f1', name: 'MARTIN Léa', shortName: 'MARTIN L.', club: 'Dojo Lyon', clubId: 'k1', hidden: false });
  });

  test('no organisation field leaks', () => {
    const view = toPublicCompetition(source());
    const json = JSON.stringify(view);
    for (const secret of ['41.5', '2e kyu', 'L123', 'coach@example.org', 'club@example.org', 'rev-secret', 'alias-internal', 'wc-internal', 'settingsJson', 'weighedKg']) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(view).sort()).toEqual(['categories', 'date', 'entrants', 'id', 'location', 'medals', 'name', 'phase', 'queues', 'waves', 'zones']);
    expect(Object.keys(view.categories[0]!).sort()).toEqual(
      ['absentIds', 'bracket', 'discipline', 'finishedAt', 'id', 'kataScores', 'label', 'matchZones', 'numbers', 'podium', 'registrationIds', 'results', 'status', 'tieBreaks', 'waveId', 'zoneId'].sort(),
    );
    expect(view).toMatchObject({ id: 'c1', name: 'Coupe Démo', date: '2026-11-22', location: 'Lyon', phase: 'today' });
  });

  test('queue states', () => {
    const view = toPublicCompetition(source());
    expect(view.zones).toEqual([
      { id: 'z1', name: 'Tatami 1' },
      { id: 'z2', name: 'Ring' },
      { id: 'z3', name: 'Tatami 2' },
    ]);
    const z1 = view.queues.find((q) => q.zoneId === 'z1')!.items;
    expect(z1.map((i) => [i.number, i.state])).toEqual([
      [10, 'played'],
      [11, 'played'],
      [12, 'ready'],
      [13, 'played'],
      [14, 'played'],
      [15, 'ready'],
    ]);
    expect(z1.find((i) => i.number === 12)).toEqual({ number: 12, categoryId: 'A', matchId: 'w1-0', kataPart: null, a: 'r2', b: 'r3', aFrom: null, bFrom: null, state: 'ready', waveId: 'w1' });
    const z2 = view.queues.find((q) => q.zoneId === 'z2')!.items;
    expect(z2).toEqual([
      { number: 1, categoryId: 'B', matchId: null, kataPart: null, a: null, b: null, aFrom: null, bFrom: null, state: 'ready', waveId: 'w1' },
      { number: 5, categoryId: 'A', matchId: 'w2-0', kataPart: null, a: null, b: 'r1', aFrom: { kind: 'winner', number: 12 }, bFrom: null, state: 'waiting', waveId: 'w1' },
    ]);
  });

  test('category contents: numbers, zones of moved finals, results, status, podium, medals', () => {
    const view = toPublicCompetition(source());
    const a = view.categories.find((c) => c.id === 'A')!;
    expect(a).toMatchObject({ label: 'Karaté -45 kg', discipline: 'karate', waveId: 'w1', zoneId: 'z1', status: 'started', finishedAt: null, kataScores: null });
    expect(a.numbers).toEqual({ 'w1-1': 11, 'w1-0': 12, 'w2-0': 5 });
    expect(a.matchZones).toEqual({ 'w2-0': 'Zone des finales : Ring' });
    expect(a.results).toEqual({ 'w1-1': { winner: 'a', method: 'points' } });
    const b = view.categories.find((c) => c.id === 'B')!;
    expect(b).toMatchObject({ status: 'upcoming', numbers: { kata: 1 }, kataScores: { round1: {}, final: {} } });
    expect(b.bracket.kind === 'kata' && b.bracket.order).toEqual(['r5', 'r6', 'r7']);
    const d = view.categories.find((c) => c.id === 'D')!;
    expect(d).toMatchObject({ status: 'finished', finishedAt: '2026-11-22T10:00:00.000Z' });
    expect(d.podium).toMatchObject({ first: 'r20', second: 'r21', complete: true });
    expect(view.medals).toEqual([
      { clubId: 'k2', club: 'Kime Club', gold: 1, silver: 0, bronze: 0 },
      { clubId: 'k1', club: 'Dojo Lyon', gold: 0, silver: 1, bronze: 0 },
    ]);
  });

  test('kata split between its zone and the finals zone', () => {
    const base = source();
    const plan = {
      ...base.plan,
      zones: [
        { zoneId: 'z1', passages: [{ number: 3, categoryId: 'B', matchId: 'kata:tour1', noRest: false, waveId: 'w1' }] },
        { zoneId: 'z2', passages: [{ number: 9, categoryId: 'B', matchId: 'kata:finale', noRest: false, waveId: 'w1' }] },
      ],
    };
    const before = toPublicCompetition(source({ plan }));
    expect(before.queues.map((q) => q.items.map((i) => [i.number, i.kataPart, i.state]))).toEqual([[[3, 'tour1', 'ready']], [[9, 'finale', 'waiting']]]);
    expect(before.categories.find((c) => c.id === 'B')!.numbers).toEqual({ 'kata:tour1': 3, 'kata:finale': 9 });
    const scores = { round1: { r5: [8], r6: [7], r7: [6] }, final: {} };
    const after = toPublicCompetition(source({ plan, results: { ...base.results, B: { records: [], kataScores: scores, tieBreaks: { pools: {}, kata: [], kataFinal: [] } } } }));
    expect(after.queues.map((q) => q.items.map((i) => [i.number, i.state]))).toEqual([[[3, 'played']], [[9, 'ready']]]);
    expect(after.categories.find((c) => c.id === 'B')).toMatchObject({ status: 'started', kataScores: scores });
  });

  test('competition without waves: implicit session', () => {
    const base = source();
    const view = toPublicCompetition(
      source({
        waves: [],
        launchedWaveKeys: [''],
        categories: base.categories.filter((c) => c.id === 'D').map((c) => ({ ...c, waveId: null })),
        plan: { ...base.plan, zones: [{ zoneId: 'z1', passages: [{ number: 1, categoryId: 'D', matchId: 'w1-0', noRest: false, waveId: null }] }] },
      }),
    );
    expect(view.waves).toEqual([{ id: null, name: 'Session unique', launched: true }]);
    expect(view.categories.map((c) => c.id)).toEqual(['D']);
    expect(view.queues).toEqual([{ zoneId: 'z1', items: [expect.objectContaining({ number: 1, categoryId: 'D', state: 'played', waveId: null })] }]);
  });
});
