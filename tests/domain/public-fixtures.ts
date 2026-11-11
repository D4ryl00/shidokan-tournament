import { kataBracket } from '../../src/domain/brackets/kata.js';
import { roundRobin, singleMatch } from '../../src/domain/brackets/pools.js';
import type { Bracket, CombatBracket, Entrant } from '../../src/domain/brackets/index.js';
import type { Category } from '../../src/domain/categories.js';
import type { PassagePlan, PlannedPassage } from '../../src/domain/passages/index.js';
import type { PublicSource } from '../../src/domain/public/view.js';
import type { ResultRecord } from '../../src/domain/results.js';
import { defaultSchedule } from '../../src/domain/schedule/durations.js';
import type { DisciplineId } from '../../src/domain/types.js';

/**
 * Compétition de démonstration, construite à la main (sans base) :
 * - A « Karaté -45 kg » (session Matin, Tatami 1) : élimination directe à 4, MARTIN bat FAURE (n° 11),
 *   BONNET contre le masqué SECRET (n° 12), finale sur le Ring (n° 5) contre le vainqueur du n° 12 ;
 * - B « Kata minimes » (Matin, Ring) : bloc de kata entier n° 1, rien de noté ;
 * - C « Karaté -60 kg » (session Après-midi, non lancée) : jamais publique ;
 * - D « Karaté -50 kg » (Matin, Tatami 1) : combat unique n° 10 joué, ROUX bat LEROY ;
 * - E « Karaté -55 kg » (Matin, Tatami 1) : poule de 3, DUPONT a joué ses deux combats (n° 13, 14), reste le n° 15 ;
 * - F « Karaté -40 kg » (Matin, Tatami 2) : élimination directe à 4 avec petite finale, demies et petite finale jouées
 *   (DAVID perd la demie puis la petite finale), finale à jouer.
 */

const fighter = (id: string, lastName: string, firstName: string, clubId: string | null, hidden = false) => ({
  id,
  lastName,
  firstName,
  clubId,
  publicNameHidden: hidden,
  // Champs d'organisation : ne doivent jamais sortir.
  weightKg: 41.5,
  grade: '2e kyu',
  licence: 'L123',
  coachEmail: 'coach@example.org',
});

export const FIGHTERS = [
  fighter('f1', 'MARTIN', 'Léa', 'k1'),
  fighter('f2', 'BONNET', 'Chloé', 'k2'),
  fighter('f3', 'SECRET', 'Zoé', 'k1', true),
  fighter('f4', 'FAURE', 'Jade', 'k2'),
  fighter('f5', 'PETIT', 'Noah', 'k2'),
  fighter('f6', 'ROUX', 'Marc', 'k2'),
  fighter('f7', 'LEROY', 'Axel', 'k1'),
  fighter('f8', 'DUPONT', 'Paul', 'k3'),
  fighter('f9', 'GARNIER', 'Luc', 'k3'),
  fighter('f10', 'HENRY', 'Tom', 'k3'),
  fighter('f11', 'ANDRE', 'Ines', 'k3'),
  fighter('f12', 'BLANC', 'Emma', 'k3'),
  fighter('f13', 'CLEMENT', 'Rose', 'k3'),
  fighter('f14', 'DAVID', 'Lou', 'k3'),
];

const REGISTRATIONS: [string, string][] = [
  ['r1', 'f1'], ['r2', 'f2'], ['r3', 'f3'], ['r4', 'f4'],
  ['r5', 'f1'], ['r6', 'f2'], ['r7', 'f4'],
  ['r9', 'f5'],
  ['r20', 'f6'], ['r21', 'f7'],
  ['r10', 'f8'], ['r11', 'f9'], ['r12', 'f10'],
  ['r30', 'f11'], ['r31', 'f12'], ['r32', 'f13'], ['r33', 'f14'],
];

function entrant(rid: string): Entrant {
  const f = FIGHTERS.find((x) => x.id === REGISTRATIONS.find(([r]) => r === rid)![1])!;
  // Libellé comme celui de l'organisation : le vrai nom.
  return { registrationId: rid, clubId: f.clubId, label: `${f.lastName} ${f.firstName}` };
}

const src = (rid: string) => ({ kind: 'entrant' as const, registrationId: rid });

/** Élimination directe à 4, construite à la main : w1-0 (r2–r3), w1-1 (r1–r4), finale w2-0 (vainqueur w1-0 – vainqueur w1-1). */
export const BRACKET_A: CombatBracket = {
  kind: 'combat',
  format: 'single_elimination',
  entrants: ['r1', 'r2', 'r3', 'r4'].map(entrant),
  matches: [
    { id: 'w1-0', phase: 'main', round: 1, order: 0, a: src('r2'), b: src('r3') },
    { id: 'w1-1', phase: 'main', round: 1, order: 1, a: src('r1'), b: src('r4') },
    { id: 'w2-0', phase: 'main', round: 2, order: 2, a: { kind: 'winner', matchId: 'w1-0' }, b: { kind: 'winner', matchId: 'w1-1' } },
  ],
  options: { repechage: false, thirdPlace: false },
  seed: 1,
};
/** Élimination directe à 4 avec petite finale : w1-0 (r30–r31), w1-1 (r32–r33), third (perdants), w2-0 (vainqueurs). */
const BRACKET_F: CombatBracket = {
  kind: 'combat',
  format: 'single_elimination',
  entrants: ['r30', 'r31', 'r32', 'r33'].map(entrant),
  matches: [
    { id: 'w1-0', phase: 'main', round: 1, order: 0, a: src('r30'), b: src('r31') },
    { id: 'w1-1', phase: 'main', round: 1, order: 1, a: src('r32'), b: src('r33') },
    { id: 'third', phase: 'third_place', round: 2, order: 2, a: { kind: 'loser', matchId: 'w1-0' }, b: { kind: 'loser', matchId: 'w1-1' } },
    { id: 'w2-0', phase: 'main', round: 2, order: 3, a: { kind: 'winner', matchId: 'w1-0' }, b: { kind: 'winner', matchId: 'w1-1' } },
  ],
  options: { repechage: false, thirdPlace: true },
  seed: 1,
};
const BRACKET_B = kataBracket(['r5', 'r6', 'r7'].map(entrant), 2, 1, ['r5', 'r6', 'r7'].map(entrant));
const BRACKET_C = singleMatch(['r9', 'r1'].map(entrant), 1);
const BRACKET_D = singleMatch(['r20', 'r21'].map(entrant), 1);
const E_ENTRANTS = ['r10', 'r11', 'r12'].map(entrant);
const BRACKET_E = roundRobin(E_ENTRANTS, 1, E_ENTRANTS);

export function category(id: string, label: string, discipline: DisciplineId, waveId: string | null, bracket: Bracket, zoneId: string | null = null): Category {
  return {
    id,
    rev: 'rev-secret',
    competitionId: 'c1',
    key: { discipline, ruleset: discipline === 'kata' ? null : 'jiyu', sex: 'F', ageBandCodes: ['MIN'], weightClassIds: ['wc-internal'] },
    label,
    status: 'started',
    format: null,
    repechage: null,
    thirdPlace: null,
    seed: 1,
    bracket,
    zoneId,
    waveId,
    waveOverride: null,
    waveBands: ['MIN'],
    order: 0,
    registrationIds: bracket.entrants.map((e) => e.registrationId),
    absentIds: [],
    aliasKeys: ['alias-internal'],
    effectiveFormat: bracket.kind === 'kata' ? 'kata_two_rounds' : bracket.format,
    stale: false,
    arranged: false,
    numbersUpdatedAt: null,
    launchLocked: true, durations: null,
  };
}

const record = (matchId: string, winner: 'a' | 'b', entrantA: string, entrantB: string): ResultRecord => ({ matchId, winner, method: 'points', entrantA, entrantB });

const eMatches = [...BRACKET_E.matches].sort((x, y) => x.order - y.order);
const withR10 = eMatches.filter((m) => [m.a, m.b].some((s) => s.kind === 'entrant' && s.registrationId === 'r10'));
const withoutR10 = eMatches.find((m) => !withR10.includes(m))!;
const ridOf = (s: { kind: string; registrationId?: string }) => s.registrationId!;
/** DUPONT (r10) gagne ses deux combats de poule. */
const E_RECORDS = withR10.map((m) => {
  const a = ridOf(m.a);
  const b = ridOf(m.b);
  return record(m.id, a === 'r10' ? 'a' : 'b', a, b);
});

const passage = (number: number, categoryId: string, matchId: string | null, waveId = 'w1'): PlannedPassage => ({ number, categoryId, matchId, noRest: false, waveId });

export const PLAN: PassagePlan = {
  categories: { A: { zoneId: 'z1', auto: true }, B: { zoneId: 'z2', auto: true }, C: { zoneId: 'z1', auto: true }, D: { zoneId: 'z1', auto: false }, E: { zoneId: 'z1', auto: true }, F: { zoneId: 'z3', auto: true } },
  zones: [
    {
      zoneId: 'z1',
      passages: [
        passage(1, 'C', 'w1-0', 'w2'),
        passage(10, 'D', 'w1-0'),
        passage(11, 'A', 'w1-1'),
        passage(12, 'A', 'w1-0'),
        passage(13, 'E', withR10[0]!.id),
        passage(14, 'E', withR10[1]!.id),
        passage(15, 'E', withoutR10.id),
      ],
    },
    { zoneId: 'z2', passages: [passage(1, 'B', null), passage(5, 'A', 'w2-0')] },
    { zoneId: 'z3', passages: [passage(1, 'F', 'w1-0'), passage(2, 'F', 'w1-1'), passage(3, 'F', 'third'), passage(4, 'F', 'w2-0')] },
  ],
  impossible: [],
  pending: [],
  frozenWaves: ['w1'],
  finals: {},
};

export function source(over: Partial<PublicSource> = {}): PublicSource {
  return {
    today: '2026-11-22',
    competition: { id: 'c1', name: 'Coupe Démo', date: '2026-11-22', location: 'Lyon', settingsJson: '{"secret":true}' } as PublicSource['competition'],
    waves: [
      { id: 'w2', name: 'Après-midi', order: 2 },
      { id: 'w1', name: 'Matin', order: 1 },
    ],
    launchedWaveKeys: ['w1'],
    zones: [
      { id: 'z2', name: 'Ring', order: 2 },
      { id: 'z1', name: 'Tatami 1', order: 1 },
      { id: 'z3', name: 'Tatami 2', order: 3 },
    ],
    fighters: FIGHTERS,
    clubs: [
      { id: 'k1', name: 'Dojo Lyon', email: 'club@example.org' } as PublicSource['clubs'][number],
      { id: 'k2', name: 'Kime Club' },
      { id: 'k3', name: 'Shido Paris' },
    ],
    registrations: REGISTRATIONS.map(([id, fighterId]) => ({ id, fighterId, weighedKg: 41.5 }) as PublicSource['registrations'][number]),
    categories: [
      category('A', 'Karaté -45 kg', 'karate', 'w1', BRACKET_A),
      category('B', 'Kata minimes', 'kata', 'w1', BRACKET_B),
      category('C', 'Karaté -60 kg', 'karate', 'w2', BRACKET_C),
      { ...category('D', 'Karaté -50 kg', 'karate', 'w1', BRACKET_D), status: 'finished' },
      category('E', 'Karaté -55 kg', 'karate', 'w1', BRACKET_E),
      category('F', 'Karaté -40 kg', 'karate', 'w1', BRACKET_F),
    ],
    results: {
      A: { records: [record('w1-1', 'a', 'r1', 'r4')], kataScores: null, tieBreaks: { pools: {}, kata: [], kataFinal: [] } },
      D: { records: [record('w1-0', 'a', 'r20', 'r21')], kataScores: null, tieBreaks: { pools: {}, kata: [], kataFinal: [] } },
      E: { records: E_RECORDS, kataScores: null, tieBreaks: { pools: {}, kata: [], kataFinal: [] } },
      F: {
        records: [record('w1-0', 'a', 'r30', 'r31'), record('w1-1', 'a', 'r32', 'r33'), record('third', 'a', 'r31', 'r33')],
        kataScores: null,
        tieBreaks: { pools: {}, kata: [], kataFinal: [] },
      },
    },
    lastResultAt: { A: '2026-11-22T09:40:00.000Z', D: '2026-11-22T10:00:00.000Z', E: '2026-11-22T09:50:00.000Z' },
    plan: PLAN,
    launchedCategoryIds: ['A', 'B', 'D', 'E', 'F'],
    schedule: defaultSchedule(),
    triathlonRounds: 3,
    grid: { ageBands: [{ code: 'MIN', label: 'Minimes', minAge: 12, maxAge: 13, isMinor: true, sortOrder: 1 }], weightClasses: [], ageLinks: [] },
    waveSchedules: [],
    endedAt: {},
    ...over,
  };
}
