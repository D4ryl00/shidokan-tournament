import { describe, expect, test } from 'vitest';
import { fighterTimeline, searchPublic, zoneQueue } from '../../src/domain/public/follow.js';
import { toPublicCompetition } from '../../src/domain/public/view.js';
import { kataBracket } from '../../src/domain/brackets/kata.js';
import type { PassagePlan } from '../../src/domain/passages/index.js';
import { category, source } from './public-fixtures.js';

const pub = toPublicCompetition(source());
const names = (r: ReturnType<typeof searchPublic>) => r.fighters.map((f) => f.name);

describe('searchPublic', () => {
  test('sans accents ni majuscules, sur le nom, le prénom et le club', () => {
    expect(names(searchPublic(pub, 'mart'))).toEqual(['MARTIN Léa']);
    expect(names(searchPublic(pub, 'LEA'))).toContain('MARTIN Léa');
    expect(names(searchPublic(pub, 'chloe'))).toEqual(['BONNET Chloé']);
    expect(searchPublic(pub, 'mart').fighters[0]).toEqual({ fighterId: 'f1', name: 'MARTIN Léa', club: 'Dojo Lyon', clubId: 'k1', registrationIds: ['r1', 'r5'] });
  });

  test('au moins 2 caractères', () => {
    expect(searchPublic(pub, 'm')).toEqual({ clubs: [], fighters: [] });
    expect(searchPublic(pub, '  é ')).toEqual({ clubs: [], fighters: [] });
    // Les espaces ne comptent pas : des lettres isolées ne font pas une recherche.
    expect(searchPublic(pub, 'a b')).toEqual({ clubs: [], fighters: [] });
    expect(searchPublic(pub, 'l   m')).toEqual({ clubs: [], fighters: [] });
    expect(names(searchPublic(pub, 'le m'))).toContain('MARTIN Léa');
  });

  test('un club, avec le nombre de combattants non masqués', () => {
    const r = searchPublic(pub, 'dojo ly');
    expect(r.clubs).toEqual([{ clubId: 'k1', club: 'Dojo Lyon', count: 2 }]);
    expect(names(r)).toEqual(['LEROY Axel', 'MARTIN Léa']);
  });

  test('un masqué n’est jamais trouvé', () => {
    expect(searchPublic(pub, 'secret')).toEqual({ clubs: [], fighters: [] });
    expect(searchPublic(pub, 'masqué').fighters).toEqual([]);
    expect(names(searchPublic(pub, 'dojo'))).not.toContain('Combattant masqué');
  });

  test('une session non lancée ne se cherche pas', () => {
    expect(searchPublic(pub, 'petit').fighters).toEqual([]);
  });
});

describe('fighterTimeline', () => {
  test('fighterTimeline groups registrations of the same fighter', () => {
    const lines = fighterTimeline(pub, 'f1');
    expect(lines.map((l) => [l.categoryId, l.discipline])).toEqual([
      ['A', 'karate'],
      ['B', 'kata'],
    ]);
  });

  test('prochain combat : numéro, zone, passages avant lui, adversaire à venir ; combats joués', () => {
    const [karate, kata] = fighterTimeline(pub, 'f1');
    expect(karate).toEqual({
      categoryId: 'A',
      label: 'Karaté -45 kg',
      discipline: 'karate',
      next: { number: 5, zoneId: 'z2', before: 1, opponent: { from: { kind: 'winner', number: 12, zoneId: 'z1' } } },
      played: [{ number: 11, opponent: 'FAURE Jade', won: true }],
      state: 'upcoming',
    });
    expect(kata).toMatchObject({ categoryId: 'B', next: { number: 1, zoneId: 'z2', before: 0, opponent: null }, played: [], state: 'upcoming' });
  });

  test('adversaire connu : nom et club (masqué compris)', () => {
    const [karate] = fighterTimeline(pub, 'f2');
    expect(karate!.next).toEqual({ number: 12, zoneId: 'z1', before: 0, opponent: { name: 'Combattant masqué', club: 'Dojo Lyon' } });
  });

  test('élimination directe sans repêchage, combat perdu : éliminé', () => {
    const [karate] = fighterTimeline(pub, 'f14');
    expect(karate).toMatchObject({
      categoryId: 'F',
      next: null,
      played: [
        { number: 2, opponent: 'CLEMENT Rose', won: false },
        { number: 3, opponent: 'BLANC Emma', won: false },
      ],
      state: 'eliminated',
    });
  });

  test('demi-finale perdue sans petite finale : bronze', () => {
    const [karate] = fighterTimeline(pub, 'f4');
    expect(karate).toMatchObject({ categoryId: 'A', next: null, played: [{ number: 11, opponent: 'MARTIN Léa', won: false }], state: { medal: 3 } });
  });

  test('demi-finale perdue avec petite finale à jouer : à venir', () => {
    const base = source();
    const view = toPublicCompetition(source({ results: { ...base.results, F: { ...base.results.F!, records: base.results.F!.records.slice(0, 2) } } }));
    expect(fighterTimeline(view, 'f14')[0]).toMatchObject({ next: { number: 3, zoneId: 'z3', before: 0, opponent: { name: 'BLANC Emma', club: 'Shido Paris' } }, state: 'upcoming' });
  });

  test('médailles', () => {
    expect(fighterTimeline(pub, 'f6')).toMatchObject([{ categoryId: 'D', next: null, state: { medal: 1 } }]);
    expect(fighterTimeline(pub, 'f7')).toMatchObject([{ categoryId: 'D', next: null, played: [{ number: 10, opponent: 'ROUX Marc', won: false }], state: { medal: 2 } }]);
  });

  test('poule non terminée sans combat jouable : en attente', () => {
    const [pool] = fighterTimeline(pub, 'f8');
    expect(pool).toMatchObject({ categoryId: 'E', next: null, state: 'waiting' });
    expect(pool!.played.map((p) => [p.number, p.won])).toEqual([
      [13, true],
      [14, true],
    ]);
    expect(fighterTimeline(pub, 'f9')[0]).toMatchObject({ next: { number: 15, zoneId: 'z1', before: 1, opponent: { name: 'HENRY Tom', club: 'Shido Paris' } }, state: 'upcoming' });
  });

  test('kata : la finale seulement pour un finaliste', () => {
    const base = source();
    const plan = {
      ...base.plan,
      zones: [
        { zoneId: 'z1', passages: [{ number: 3, categoryId: 'B', matchId: 'kata:tour1', noRest: false, waveId: 'w1' }] },
        { zoneId: 'z2', passages: [{ number: 9, categoryId: 'B', matchId: 'kata:finale', noRest: false, waveId: 'w1' }] },
      ],
    };
    const scores = { round1: { r5: [8], r6: [7], r7: [6] }, final: {} };
    const view = toPublicCompetition(source({ plan, results: { ...base.results, B: { records: [], kataScores: scores, tieBreaks: { pools: {}, kata: [], kataFinal: [] } } } }));
    expect(fighterTimeline(view, 'f1').find((l) => l.categoryId === 'B')).toMatchObject({ next: { number: 9, zoneId: 'z2', before: 0, opponent: null }, state: 'upcoming' });
    // 3e du tour 1 : bronze, pas de finale.
    expect(fighterTimeline(view, 'f4').find((l) => l.categoryId === 'B')).toMatchObject({ next: null, state: { medal: 3 } });
  });

  test('kata : note et place du tour 1 ; hors de la finale après le tour 1, plus en lice (pas « en attente »)', () => {
    const base = source();
    const four = ['r5', 'r6', 'r7', 'r9'].map((rid) => ({ registrationId: rid, clubId: null, label: rid }));
    const bracket = kataBracket(four, 1, 1, four);
    const cats = base.categories.map((c) => (c.id === 'B' ? { ...category('B', 'Kata minimes', 'kata', 'w1', bracket) } : c));
    const tb = { pools: {}, kata: [], kataFinal: [] };
    const split = {
      ...base.plan,
      zones: [
        { zoneId: 'z1', passages: [{ number: 3, categoryId: 'B', matchId: 'kata:tour1', noRest: false, waveId: 'w1' }] },
        { zoneId: 'z2', passages: [{ number: 9, categoryId: 'B', matchId: 'kata:finale', noRest: false, waveId: 'w1' }] },
      ],
    };
    const view = (round1: Record<string, number[]>, plan: PassagePlan = split, final: Record<string, number[]> = {}) =>
      toPublicCompetition(source({ categories: cats, plan, results: { ...base.results, B: { records: [], kataScores: { round1, final }, tieBreaks: tb } } }));
    const lineOf = (v: ReturnType<typeof view>, f: string) => fighterTimeline(v, f).find((l) => l.categoryId === 'B');

    // Tour 1 en cours : encore à venir, sans place.
    const during = view({ r5: [8], r9: [5] });
    expect(lineOf(during, 'f5')).toMatchObject({ kata: { round1: 5, place: null, final: null }, next: { number: 3 }, state: 'upcoming' });
    expect(lineOf(during, 'f4')).toMatchObject({ kata: { round1: null, place: null }, state: 'upcoming' });

    const done = view({ r5: [8], r6: [7], r7: [6], r9: [5] });
    expect(lineOf(done, 'f1')).toMatchObject({ kata: { round1: 8, place: 1, final: null }, next: { number: 9 }, state: 'upcoming' });
    expect(lineOf(done, 'f4')).toMatchObject({ kata: { round1: 6, place: 3 }, next: null, state: { medal: 3 } });
    expect(lineOf(done, 'f5')).toMatchObject({ kata: { round1: 5, place: 4 }, next: null, state: 'eliminated' });
    // Bloc de kata entier (un seul passage) : hors de la finale, il n'a plus de passage à attendre.
    const whole = view({ r5: [8], r6: [7], r7: [6], r9: [5] }, { ...base.plan, zones: [{ zoneId: 'z2', passages: [{ number: 1, categoryId: 'B', matchId: null, noRest: false, waveId: 'w1' }] }] });
    expect(lineOf(whole, 'f5')).toMatchObject({ next: null, state: 'eliminated' });
    expect(lineOf(whole, 'f1')).toMatchObject({ next: { number: 1 }, state: 'upcoming' });
    // Notes égales : la même place (1re, 2e, 3e, 3e), pas deux places différentes.
    const equal = view({ r5: [8], r6: [7], r7: [6], r9: [6] });
    expect(lineOf(equal, 'f4')).toMatchObject({ kata: { round1: 6, place: 3 } });
    expect(lineOf(equal, 'f5')).toMatchObject({ kata: { round1: 6, place: 3 } });
    // Finale notée : la note de la finale aussi.
    expect(lineOf(view({ r5: [8], r6: [7], r7: [6], r9: [5] }, split, { r5: [9], r6: [8.5] }), 'f2')).toMatchObject({ kata: { round1: 7, place: 2, final: 8.5 }, state: { medal: 2 } });
  });

  test('combats : pas de note de kata', () => {
    expect(fighterTimeline(pub, 'f1')[0]).not.toHaveProperty('kata');
  });

  test('combattant inconnu ou masqué : aucune ligne', () => {
    expect(fighterTimeline(pub, 'f3')).toEqual([]);
    expect(fighterTimeline(pub, 'inconnu')).toEqual([]);
  });
});

describe('zoneQueue', () => {
  test('next est le premier non joué, following la suite', () => {
    const q = zoneQueue(pub, 'z1');
    expect(q.next).toMatchObject({ number: 12, state: 'ready' });
    expect(q.following.map((i) => i.number)).toEqual([15]);
    const ring = zoneQueue(pub, 'z2');
    expect(ring.next).toMatchObject({ number: 1, state: 'ready' });
    expect(ring.following.map((i) => [i.number, i.state])).toEqual([[5, 'waiting']]);
    expect(zoneQueue(pub, 'inconnue')).toEqual({ next: null, following: [] });
  });
});
