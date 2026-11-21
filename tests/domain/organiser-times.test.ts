import { describe, expect, test } from 'vitest';
import { kataBracket } from '../../src/domain/brackets/kata.js';
import type { Entrant } from '../../src/domain/brackets/index.js';
import { organiserTimes } from '../../src/domain/schedule/organiser-times.js';
import type { PublicCompetition, PublicQueueItem } from '../../src/domain/public/types.js';
import { toPublicCompetition } from '../../src/domain/public/view.js';
import { source } from './public-fixtures.js';

const timing = { rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 };
const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
/** Passage de 4 min (+ 1 min de changement) : la session prévue à 10:30 donne 10:30, 10:35, 10:40… */
const item = (over: Partial<PublicQueueItem>): PublicQueueItem => ({
  number: 1, categoryId: 'A', matchId: 'w1-0', kataPart: null, a: null, b: null, aFrom: null, bFrom: null, state: 'ready', waveId: 'w1',
  finals: null, durationSec: 240, timing, kataPassages: null, endedAt: null, ...over,
});

/** Zone z1 : A w1-0 (10:30), A w1-1 (10:35), A w2-0 (10:40, finale). Session Matin lancée, prévue 10:30. */
function made(items: PublicQueueItem[] = [item({ number: 1, matchId: 'w1-0' }), item({ number: 2, matchId: 'w1-1' }), item({ number: 3, matchId: 'w2-0' })], over: Partial<PublicCompetition> = {}): PublicCompetition {
  return {
    ...toPublicCompetition(source()),
    phase: 'today',
    waves: [{ id: 'w1', name: 'Matin', launched: true, plannedStart: '10:30', actualStart: null, finalsStart: null }],
    queues: [{ zoneId: 'z1', items }],
    ...over,
  };
}
const A = () => toPublicCompetition(source()).categories.find((c) => c.id === 'A')!;
const at = (clock: string, planned = false) => ({ kind: 'at', clock, planned });

describe('organiserTimes', () => {
  test('passage d\'une session lancée : vers H:MM, jamais une heure passée', () => {
    const pub = made();
    expect(organiserTimes(pub, null, h(10, 32)).passage('A', 'w1-1')).toEqual(at('10:35'));
    expect(organiserTimes(pub, null, null).passage('A', 'w1-1')).toEqual(at('10:35'));
    expect(organiserTimes(pub, null, h(10, 36)).passage('A', 'w2-0')).toEqual(at('10:40'));
    expect(organiserTimes(pub, null, h(10, 41)).passage('A', 'w2-0')).toBeNull();
  });

  test('premier passage non joué de la zone : sur le tatami ; onCall garde l\'heure même dépassée', () => {
    const t = organiserTimes(made(), null, h(10, 40));
    expect(t.passage('A', 'w1-0')).toEqual({ kind: 'onTatami' });
    expect(t.onCall('A', 'w1-0')).toBe('10:30');
    expect(t.onCall('A', 'inconnu')).toBeNull();
  });

  test('résultat saisi en retard : le passage sauté n\'est ni sur le tatami ni daté', () => {
    const pub = made([
      item({ number: 1, matchId: 'w1-0', endedAt: `${made().date}T09:31:00Z` }),
      item({ number: 2, matchId: 'w1-1' }),
      item({ number: 3, matchId: 'w2-0', endedAt: `${made().date}T09:44:00Z` }),
    ]);
    const t = organiserTimes(pub, null, h(10, 50));
    expect(t.passage('A', 'w1-0')).toBeNull();
    expect(t.passage('A', 'w1-1')).toEqual({ kind: 'onTatami' });
    // Deux passages sans résultat, le second déjà dépassé : ni sur le tatami ni daté.
    const late = organiserTimes(made(), null, h(10, 41));
    expect(late.passage('A', 'w1-1')).toBeNull();
  });

  test('session non lancée : heure prévue', () => {
    const t = organiserTimes(made(), { 'C:w1-0': '15:10' }, h(10, 32));
    expect(t.passage('C', 'w1-0')).toEqual(at('15:10', true));
    expect(t.passage('C', 'w1-9')).toBeNull();
  });

  test('catégorie : 1er combat puis prochain, finale', () => {
    const ended = `${made().date}T09:36:00Z`;
    const items = [item({ categoryId: 'D', matchId: 'w1-0' }), item({ number: 2, matchId: 'w1-1' }), item({ number: 3, matchId: 'w2-0' })];
    const c = { id: 'A', bracket: A().bracket };
    expect(organiserTimes(made(items), null, h(10, 20)).category(c)).toEqual({ first: true, next: at('10:35'), final: at('10:40') });
    const played = items.map((i) => (i.matchId === 'w1-1' ? { ...i, endedAt: ended } : i));
    const after = organiserTimes(made(played), null, h(10, 36) + 30).category(c)!;
    expect(after.first).toBe(false);
    expect(after.next).toEqual(after.final);
    expect(after.next).toMatchObject({ kind: 'at', planned: false });
  });

  test('catégorie d\'une session non lancée : heures prévues', () => {
    const c = { id: 'C', bracket: A().bracket };
    const t = organiserTimes(made(), { 'C:w1-0': '15:10', 'C:w2-0': '15:30' }, h(10, 32));
    expect(t.category(c)).toEqual({ first: true, next: at('15:10', true), final: at('15:30', true) });
    expect(t.category({ id: 'Z', bracket: null })).toBeNull();
  });

  test('kata à deux katakas : finale seule datée ; kataka absent sans ligne : null', () => {
    const ent = (registrationId: string): Entrant => ({ registrationId, clubId: null, label: registrationId });
    const bracket = kataBracket([ent('r1'), ent('r2')], 1, 1, [ent('r1'), ent('r2')]);
    const kata = (matchId: string, number: number) => item({ categoryId: 'k', number, matchId, kataPart: 'finale', timing: null, kataPassages: 1, durationSec: 120 });
    const pub = made([item({ categoryId: 'D', matchId: 'w1-0' }), kata('kata:finale:1', 2), kata('kata:finale:2', 3)]);
    const t = organiserTimes(pub, null, h(10, 20));
    expect(t.passage('k', 'kata:finale:1')).toEqual(at('10:35'));
    expect(t.passage('k', 'kata:finale:2')).toEqual(at('10:38'));
    expect(t.category({ id: 'k', bracket })).toEqual({ first: true, next: at('10:35'), final: at('10:35') });
    expect(t.passage('k', 'kata:tour1:r9')).toBeNull();
  });

  test('session lancée : présente et lancée dans la vue des heures ; session implicite = waveKey(null)', () => {
    const waves = [
      { id: 'w1', name: 'Matin', launched: true, plannedStart: '10:30', actualStart: null, finalsStart: null },
      { id: 'w2', name: 'Après-midi', launched: false, plannedStart: '14:00', actualStart: null, finalsStart: null },
    ];
    const t = organiserTimes(made(undefined, { waves }), null, h(10, 20));
    expect(t.waveLaunched('w1')).toBe(true);
    expect(t.waveLaunched('w2')).toBe(false);
    expect(t.waveLaunched('inconnue')).toBe(false);
    expect(t.waveLaunched(null)).toBe(false);
    const implicit = organiserTimes(made(undefined, { waves: [{ ...waves[0]!, id: null, name: 'Session unique' }] }), null, h(10, 20));
    expect(implicit.waveLaunched(null)).toBe(true);
    expect(implicit.waveLaunched('w1')).toBe(false);
  });

  test('compétition passée : tout est null', () => {
    const t = organiserTimes(made(undefined, { phase: 'past' }), { 'A:w1-0': '15:10' }, h(10, 20));
    expect(t.passage('A', 'w1-0')).toBeNull();
    expect(t.onCall('A', 'w1-0')).toBeNull();
    expect(t.category({ id: 'A', bracket: A().bracket })).toBeNull();
    expect(t.drift('z1')).toBeNull();
    expect(t.waveLaunched('w1')).toBe(false);
    expect(organiserTimes(null, null, null).passage('A', 'w1-0')).toBeNull();
  });
});
