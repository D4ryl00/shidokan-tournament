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
      { id: 'w1', name: 'Matin', launched: false, plannedStart: null, actualStart: null, finalsStart: null },
      { id: 'w2', name: 'Après-midi', launched: false, plannedStart: null, actualStart: null, finalsStart: null },
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
    expect(Object.keys(view).sort()).toEqual(['categories', 'changeoverSec', 'date', 'entrants', 'finalsZones', 'id', 'location', 'medals', 'name', 'phase', 'queues', 'waves', 'zones']);
    expect(Object.keys(view.categories[0]!).sort()).toEqual(
      ['absentIds', 'bracket', 'discipline', 'finishedAt', 'id', 'kataPassageSec', 'kataScores', 'label', 'matchZones', 'numbers', 'podium', 'registrationIds', 'results', 'status', 'tieBreaks', 'timing', 'waveId', 'zoneId'].sort(),
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
    expect(z1.find((i) => i.number === 12)).toEqual({ number: 12, categoryId: 'A', matchId: 'w1-0', kataPart: null, a: 'r2', b: 'r3', aFrom: null, bFrom: null, state: 'ready', waveId: 'w1', finals: null, durationSec: 210, timing: { rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 }, kataPassages: null, endedAt: null });
    const z2 = view.queues.find((q) => q.zoneId === 'z2')!.items;
    expect(z2).toEqual([
      { number: 1, categoryId: 'B', matchId: null, kataPart: null, a: null, b: null, aFrom: null, bFrom: null, state: 'ready', waveId: 'w1', finals: null, durationSec: 5 * 90, timing: null, kataPassages: 5, endedAt: null },
      { number: 5, categoryId: 'A', matchId: 'w2-0', kataPart: null, a: null, b: 'r1', aFrom: { kind: 'winner', number: 12, zoneId: 'z1' }, bFrom: null, state: 'waiting', waveId: 'w1', finals: null, durationSec: 210, timing: { rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 }, kataPassages: null, endedAt: null },
    ]);
  });

  test('final passages carry when their final is played (plan), whole kata blocks and other passages none', () => {
    const base = source();
    const resolved = (when: 'ready' | 'end') => ({ finalZoneId: 'z2', when, onFinalsZone: true, kataSplit: true, fixed: null, signature: `z2|${when}` });
    const plan = {
      ...base.plan,
      finals: { A: resolved('ready'), B: resolved('end'), F: { ...resolved('end'), finalZoneId: 'z3', onFinalsZone: false } },
      zones: [...base.plan.zones.filter((z) => z.zoneId !== 'z2'), { zoneId: 'z2', passages: [
        { number: 1, categoryId: 'B', matchId: 'kata:tour1', noRest: false, waveId: 'w1' },
        { number: 5, categoryId: 'A', matchId: 'w2-0', noRest: false, waveId: 'w1' },
        { number: 6, categoryId: 'B', matchId: 'kata:finale', noRest: false, waveId: 'w1' },
      ] }],
    };
    const flags = (v: ReturnType<typeof toPublicCompetition>) => v.queues.map((q) => [q.zoneId, q.items.filter((i) => i.finals !== null).map((i) => [i.number, i.finals])]);
    // Partout, pas seulement sur la zone des finales : seuls les combats pour la 1re place (pas la petite finale) et le bloc de finale du kata.
    expect(flags(toPublicCompetition(source({ plan })))).toEqual([['z1', []], ['z2', [[5, 'ready'], [6, 'end']]], ['z3', [[4, 'end']]]]);
    // Bloc de kata entier : pas une finale à part.
    expect(flags(toPublicCompetition(source({ plan: { ...base.plan, finals: { B: resolved('ready') } } })))).toEqual([['z1', []], ['z2', []], ['z3', []]]);
    // Choix inconnu (catégorie absente de `plan.finals`) : pas marquée.
    expect(flags(toPublicCompetition(source()))).toEqual([['z1', []], ['z2', []], ['z3', []]]);
  });

  test('finals zone of each session', () => {
    expect(toPublicCompetition(source({ finalsZones: { w1: 'z2' } })).finalsZones).toEqual({ w1: 'z2', w2: null });
    expect(toPublicCompetition(source()).finalsZones).toEqual({ w1: null, w2: null });
    // Zone inconnue : aucune ; session unique : clé ''.
    expect(toPublicCompetition(source({ finalsZones: { w1: 'disparue' } })).finalsZones).toEqual({ w1: null, w2: null });
    expect(toPublicCompetition(source({ waves: [], finalsZones: { '': 'z3' } })).finalsZones).toEqual({ '': 'z3' });
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

  test('a launched category with fewer than 2 active entrants is not public', () => {
    const base = source();
    // Comme `playableCategory` de l'organisation : un tableau et au moins 2 combattants présents.
    const d = base.categories.find((c) => c.id === 'D')!;
    const lone = { ...d, status: 'ready' as const, absentIds: ['r21'] };
    const noBracket = { ...base.categories.find((c) => c.id === 'E')!, status: 'ready' as const, bracket: null };
    const view = toPublicCompetition(source({ categories: [...base.categories.filter((c) => c.id !== 'D' && c.id !== 'E'), lone, noBracket] }));
    expect(view.categories.map((c) => c.id).sort()).toEqual(['A', 'B', 'F']);
    expect(view.queues.flatMap((q) => q.items).some((i) => i.categoryId === 'D' || i.categoryId === 'E')).toBe(false);
  });

  test('ignored results alone do not start a category', () => {
    const base = source();
    // Résultat d'un ancien tableau (inscrits différents) : écarté, la catégorie n'a pas commencé.
    const stale = { records: [{ matchId: 'w1-0', winner: 'a' as const, method: 'points' as const, entrantA: 'rX', entrantB: 'rY' }], kataScores: null, tieBreaks: { pools: {}, kata: [], kataFinal: [] } };
    const view = toPublicCompetition(source({ results: { ...base.results, D: stale } }));
    expect(view.categories.find((c) => c.id === 'D')).toMatchObject({ status: 'upcoming', results: {} });
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
    expect(view.waves).toEqual([{ id: null, name: 'Session unique', launched: true, plannedStart: null, actualStart: null, finalsStart: null }]);
    expect(view.categories.map((c) => c.id)).toEqual(['D']);
    expect(view.queues).toEqual([{ zoneId: 'z1', items: [expect.objectContaining({ number: 1, categoryId: 'D', state: 'played', waveId: null })] }]);
  });
});

describe('durées et heures (lot 2)', () => {
  const items = (view: ReturnType<typeof toPublicCompetition>) => view.queues.flatMap((q) => q.items);

  test('queue items carry duration and end time', () => {
    const view = toPublicCompetition(source({ endedAt: { A: { matches: { 'w1-1': '2026-11-22T09:20:00.000Z' }, round1: null, final: null } } }));
    const played = items(view).find((i) => i.categoryId === 'A' && i.matchId === 'w1-1')!;
    expect(played.state).toBe('played');
    expect(played.durationSec).toBe(210);
    expect(played.timing?.rounds).toBe(2);
    expect(played.endedAt).toBe('2026-11-22T09:20:00.000Z');
    const waiting = items(view).find((i) => i.categoryId === 'A' && i.matchId === 'w1-0')!;
    expect(waiting.state).not.toBe('played');
    expect(waiting.endedAt).toBeNull();
  });

  test('kata blocks carry passages', () => {
    const base = source();
    const b = base.categories.find((c) => c.id === 'B')!;
    const five = ['r5', 'r6', 'r7', 'r40', 'r41'].map((registrationId) => ({ registrationId, clubId: null, label: registrationId }));
    const kata = { ...b, registrationIds: five.map((e) => e.registrationId), bracket: { ...b.bracket!, entrants: five, order: five.map((e) => e.registrationId) } as never };
    const view = toPublicCompetition({ ...base, categories: base.categories.map((c) => (c.id === 'B' ? kata : c)) });
    const block = items(view).find((i) => i.categoryId === 'B')!;
    expect(block.kataPassages).toBe(7);
    expect(block.durationSec).toBe(7 * 90);
    expect(block.timing).toBeNull();
    const cat = view.categories.find((c) => c.id === 'B')!;
    expect(cat.timing).toBeNull();
    expect(cat.kataPassageSec).toBe(90);
  });

  test('match duration override reaches the item', () => {
    const base = source();
    const a = base.categories.find((c) => c.id === 'A')!;
    const timing = { rounds: 3, roundSec: 90, restSec: 30, overtimeSec: 60 };
    const view = toPublicCompetition({ ...base, categories: base.categories.map((c) => (c.id === 'A' ? { ...a, durations: { bracket: null, matches: { 'w2-0': timing } } } : c)) });
    const final = items(view).find((i) => i.categoryId === 'A' && i.matchId === 'w2-0')!;
    expect(final.timing?.rounds).toBe(3);
    expect(final.durationSec).toBe(3 * 90 + 2 * 30);
    expect(items(view).find((i) => i.categoryId === 'A' && i.matchId === 'w1-0')!.timing?.rounds).toBe(2);
  });

  test('unlaunched wave shows only its planned time', () => {
    const all = { plannedStart: '14:00', actualStart: '14:05', finalsStart: '16:00' };
    const view = toPublicCompetition(source({ waveSchedules: [{ waveId: 'w2', ...all }, { waveId: 'w1', plannedStart: '09:00', actualStart: '09:10', finalsStart: '11:00' }] }));
    expect(view.waves.find((w) => w.id === 'w2')).toMatchObject({ launched: false, plannedStart: '14:00', actualStart: null, finalsStart: null });
    expect(view.waves.find((w) => w.id === 'w1')).toMatchObject({ launched: true, plannedStart: '09:00', actualStart: '09:10', finalsStart: '11:00' });
    expect(view.changeoverSec).toBe(60);
  });

  test('no schedule data leaks', () => {
    const base = source();
    const a = base.categories.find((c) => c.id === 'A')!;
    const view = toPublicCompetition({ ...base, categories: base.categories.map((c) => (c.id === 'A' ? { ...a, durations: { bracket: null, matches: {} } } : c)) });
    const json = JSON.stringify(view);
    expect(json).not.toContain('durations');
    expect(json).not.toContain('under14');
    expect(json).not.toContain('"groups"');
    // Prolongation : seulement dans les timings des passages, jamais un autre groupe (adultes : 120 s).
    expect(json).not.toContain('"overtimeSec":120');
  });
});
