import { expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { entryKey } from '../../src/domain/closed-categories.js';
import { ageBandChoices, applyChange, combatChoices, reclassChoices, rulesetChoices, toggleCombat, type LineFormContext } from '../../src/web/components/club-line/lineForm.js';

const bands = [
  { code: 'cadet', label: 'Cadets', ages: '14 à 15 ans', isMinor: true },
  { code: 'senior', label: 'Seniors', ages: '18 à 34 ans', isMinor: false },
];
const classes = [
  { id: 'c-54', ageBandCode: 'cadet', sex: 'F' as const, label: '-54', maxKg: 54 },
  { id: 's-60', ageBandCode: 'senior', sex: 'F' as const, label: '-60', maxKg: 60 },
];
const blank: ClubFormLine = { lastName: 'A', firstName: 'B', sex: 'F', ageBandCode: 'senior', weightClassId: 's-60', weightKg: null, combats: [], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null };
const shut = (band: string, discipline: string, ruleset: 'jiyu' | 'shobu' | null) => entryKey({ ageBandCode: band, sex: 'F', discipline, ruleset } as never);
const ctx = (over: Partial<LineFormContext> = {}): LineFormContext => ({
  mode: 'coach', multipleCombats: true, closed: new Set([shut('senior', 'triathlon', 'jiyu'), shut('senior', 'triathlon', 'shobu'), shut('senior', 'karate', 'shobu')]),
  ageBands: bands, weightClasses: classes, saved: null, ...over,
});
const labels = (c: [string, string][]) => c.map(([, l]) => l);

test('organiser sees closed choices marked « (non ouverte) », coach does not', () => {
  expect(labels(combatChoices(blank, ctx()))).toEqual(['Karaté', 'Boxing', 'Mix']);
  expect(labels(combatChoices(blank, ctx({ mode: 'organiser' })))).toEqual(['Karaté', 'Boxing', 'Mix', 'Triathlon (non ouverte)']);
  const withKarate = { ...blank, combats: ['karate' as const] };
  expect(labels(rulesetChoices(withKarate, ctx()))).toEqual(['Jiyu']);
  expect(labels(rulesetChoices(withKarate, ctx({ mode: 'organiser' })))).toEqual(['Jiyu', 'Shobu (non ouverte)']);
});

test('multiple combats: ticking a second combat keeps the first; one ruleset for both', () => {
  const c = ctx();
  const one = applyChange(blank, { combats: toggleCombat(blank, 'karate', c) }, c);
  const two = applyChange(one, { combats: toggleCombat(one, 'shido-boxing', c), ruleset: 'jiyu' }, c);
  expect(two.combats).toEqual(['karate', 'shido-boxing']);
  expect(two.ruleset).toBe('jiyu');
  // Shobu fermé en karaté : pas proposé pour l'ensemble.
  expect(labels(rulesetChoices(two, c))).toEqual(['Jiyu']);
  expect(toggleCombat(two, 'karate', c)).toEqual(['shido-boxing']);
});

test('setting off: a saved second combat stays and can be unticked, a new one replaces', () => {
  const saved = { ...blank, combats: ['karate' as const, 'shido-boxing' as const], ruleset: 'jiyu' as const };
  const c = ctx({ multipleCombats: false, saved });
  expect(toggleCombat(saved, 'karate', c)).toEqual(['shido-boxing']);
  // Décocher puis recocher un combat enregistré : permis (tous déjà enregistrés).
  expect(toggleCombat({ ...saved, combats: ['shido-boxing'] }, 'karate', c)).toEqual(['shido-boxing', 'karate']);
  // Un combat nouveau remplace.
  expect(toggleCombat(saved, 'shido-mix', c)).toEqual(['shido-mix']);
  expect(toggleCombat({ ...blank, combats: ['karate'] }, 'shido-mix', ctx({ multipleCombats: false }))).toEqual(['shido-mix']);
});

test('changing the age band removes closed choices for the coach only', () => {
  const closed = new Set([shut('senior', 'triathlon', 'jiyu'), shut('senior', 'triathlon', 'shobu'), shut('senior', 'shido-mix', 'jiyu'), shut('senior', 'shido-mix', 'shobu'), shut('senior', 'karate', 'shobu')]);
  const line: ClubFormLine = { ...blank, ageBandCode: 'cadet', weightClassId: 'c-54', combats: ['karate', 'triathlon'], ruleset: 'jiyu', prefs: { 'shido-mix': 1 } };
  const coach = applyChange(line, { ageBandCode: 'senior' }, ctx({ closed }));
  expect(coach.combats).toEqual(['karate']);
  expect(coach.prefs).toEqual({});
  expect(coach.weightClassId).toBeNull();
  const organiser = applyChange(line, { ageBandCode: 'senior' }, ctx({ closed, mode: 'organiser' }));
  expect(organiser.combats).toEqual(['karate', 'triathlon']);
  expect(organiser.prefs).toEqual({ 'shido-mix': 1 });
  // Seul le shobu des mineurs reste exclu.
  expect(applyChange({ ...line, ageBandCode: 'senior', ruleset: 'shobu' }, { ageBandCode: 'cadet' }, ctx({ mode: 'organiser' })).ruleset).toBeNull();
});

test('closed age bands are marked for the organiser', () => {
  const closed = new Set(['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata'].flatMap((d) => (d === 'kata' ? [shut('senior', d, null)] : [shut('senior', d, 'jiyu'), shut('senior', d, 'shobu')])));
  expect(ageBandChoices(blank, ctx({ closed, mode: 'organiser' })).map((b) => b.label)).toEqual(['Cadets (14 à 15 ans)', 'Seniors (18 à 34 ans) (non ouverte)']);
  expect(ageBandChoices(blank, ctx({ closed })).map((b) => b.label)).toEqual(['Cadets (14 à 15 ans)', 'Seniors (18 à 34 ans)']);
});

test('reclassement choices exclude every ticked combat', () => {
  const line = { ...blank, combats: ['karate' as const, 'shido-boxing' as const] };
  expect(labels(reclassChoices(line, ctx()))).toEqual(['Shido-mix-martial']);
  expect(labels(reclassChoices(line, ctx({ mode: 'organiser' })))).toEqual(['Shido-mix-martial', 'Triathlon (non ouverte)']);
});
