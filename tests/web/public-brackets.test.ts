import { expect, test } from 'vitest';
import { categoryPassages, categoryText, filterCategories, finishedPodiums, kataText, NO_FILTERS } from '../../src/web/components/public/bracketsModel.js';
import type { PublicCategory, PublicCompetition } from '../../src/domain/public/types.js';

const cat = (id: string, over: Partial<PublicCategory>): PublicCategory => ({
  id, label: id, discipline: 'karate', waveId: 'w1', zoneId: 'z1', status: 'finished', finishedAt: null,
  bracket: { kind: 'kata', order: [] } as never, registrationIds: [], absentIds: [], results: {}, kataScores: null,
  tieBreaks: { pools: {}, kata: [], kataFinal: [] }, numbers: {}, matchZones: {},
  podium: { first: 'r1', second: 'r2', thirds: ['r3'], complete: true, ties: [] }, ...over,
});

test('filterCategories : discipline, session, zone et état se cumulent', () => {
  const cats = [cat('A', {}), cat('B', { discipline: 'kata', zoneId: 'z2' }), cat('C', { waveId: 'w2', status: 'started' })];
  expect(filterCategories(cats, NO_FILTERS)).toHaveLength(3);
  expect(filterCategories(cats, { ...NO_FILTERS, discipline: 'kata' }).map((c) => c.id)).toEqual(['B']);
  expect(filterCategories(cats, { ...NO_FILTERS, waveId: 'w2' }).map((c) => c.id)).toEqual(['C']);
  expect(filterCategories(cats, { ...NO_FILTERS, zoneId: 'z1', status: 'finished' }).map((c) => c.id)).toEqual(['A']);
});

test('finishedPodiums : plus récent d\'abord, sans date en dernier, seulement les terminées', () => {
  const cats = [cat('old', { finishedAt: '2026-01-01T10:00:00Z' }), cat('none', {}), cat('new', { finishedAt: '2026-01-01T12:00:00Z' }), cat('run', { status: 'started' }), cat('k', { discipline: 'kata', finishedAt: '2026-01-01T11:00:00Z' })];
  expect(finishedPodiums(cats, 'all').map((p) => p.category.id)).toEqual(['new', 'k', 'old', 'none']);
  expect(finishedPodiums(cats, 'kata').map((p) => p.category.id)).toEqual(['k']);
  expect(finishedPodiums(cats, 'all')[0]!.lines.map((l) => l.place)).toEqual([1, 2, 3]);
});

test('categoryPassages : numéro, zone, noms et résultat', () => {
  const c = cat('A', { results: { m1: { winner: 'a', method: 'points', score: '3-1' } as never } });
  const pub = {
    zones: [{ id: 'z1', name: 'Tatami 1' }],
    entrants: { r1: { name: 'MARTIN Léa' }, r2: { name: 'DUPONT Zoé' } },
    queues: [{ zoneId: 'z1', items: [
      { number: 3, categoryId: 'A', matchId: 'm1', kataPart: null, a: 'r1', b: 'r2', state: 'played' },
      { number: 4, categoryId: 'B', matchId: 'm9', kataPart: null, a: null, b: null, state: 'waiting' },
      { number: 5, categoryId: 'A', matchId: 'm2', kataPart: null, a: 'r1', b: null, state: 'waiting' },
    ] }],
  } as unknown as PublicCompetition;
  const rows = categoryPassages(pub, c);
  expect(rows.map((r) => r.number)).toEqual([3, 5]);
  expect(rows[0]).toMatchObject({ zone: 'Tatami 1', a: 'MARTIN Léa', b: 'DUPONT Zoé', result: 'MARTIN Léa gagne · points 3-1', played: true });
  expect(rows[1]).toMatchObject({ b: null, result: '' });
});

test('categoryText : la discipline n’est pas répétée après un libellé qui la contient déjà', () => {
  expect(categoryText('Kata · Minimes M', 'kata')).toBe('Kata · Minimes M');
  expect(categoryText('Karaté · Jiyu · Cadets F · -54 kg', 'karate')).toBe('Karaté · Jiyu · Cadets F · -54 kg');
  // Tableau libre : nom choisi, sans la discipline.
  expect(categoryText('Coupe des petits', 'kata')).toBe('Coupe des petits · Kata');
});

test('kataText : note et place du tour 1, puis la note de la finale', () => {
  expect(kataText({ round1: null, place: null, final: null })).toBeNull();
  expect(kataText({ round1: 7.85, place: null, final: null })).toBe('Tour 1 : 7,85');
  expect(kataText({ round1: 7.85, place: 3, final: null })).toBe('Tour 1 : 7,85 · 3e');
  expect(kataText({ round1: 8, place: 1, final: 8.1 })).toBe('Tour 1 : 8 · 1er · Finale : 8,1');
  expect(kataText({ round1: null, place: null, final: 8.5 })).toBe('Finale : 8,5');
});
