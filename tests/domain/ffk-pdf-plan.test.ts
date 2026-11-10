import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import type { FfkPdfEntry } from '../../src/domain/ffk-pdf.js';
import {
  hasDiscipline,
  planFfkImport,
  prefillExisting,
  prefillNew,
  translateFfkEntries,
  withoutDiscipline,
  type FfkFighter,
  type FfkStep,
  type PlanLine,
} from '../../src/domain/ffk-pdf-plan.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { Sex } from '../../src/domain/types.js';

const grid = ffkDefaultGrid();

function entry(order: number, fullName: string, sex: Sex, ageLabel: string, weightLabel: string | null, rulesetLabel: string | null = null): FfkPdfEntry {
  return { order, fullName, category: `${ageLabel}`, title: { sex, ageLabel, weightLabel, rulesetLabel } };
}
function fighter(over: Partial<FfkFighter> = {}): FfkFighter {
  return {
    order: 1, fullName: 'MARTIN LEA', lastName: 'MARTIN', firstName: 'Lea', sex: 'F',
    ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', ruleset: 'jiyu', rulesetGiven: false,
    raw: { age: 'Benjamine', weight: '-40' }, ...over,
  };
}
function line(over: Partial<ClubFormLine> = {}): ClubFormLine {
  return {
    lastName: 'MARTIN', firstName: 'Lea', sex: 'F', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', weightKg: null,
    combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, ...over,
  };
}
const pl = (id: string, l: ClubFormLine, editable = true, partlyEditable = true): PlanLine => ({ fighterId: id, line: l, editable, partlyEditable });
type Opts = { multipleCombats: boolean; mode: 'coach' | 'organiser' };
const coach: Opts = { multipleCombats: false, mode: 'coach' };
const plan = (f: FfkFighter[], lines: PlanLine[], d: 'karate' | 'kata' | 'shido-mix' = 'karate', opts: Opts = coach) => planFfkImport(f, lines, d, opts);
type Existing = Extract<FfkStep, { kind: 'existing' }>;

describe('translateFfkEntries', () => {
  test('karaté, minime féminine', () => {
    const [f] = translateFfkEntries([entry(1, 'DA SILVA SANTOS INES', 'F', 'Minime', '-45')], grid, 'karate');
    expect(f).toMatchObject({
      lastName: 'DA SILVA SANTOS', firstName: 'Ines', sex: 'F', ageBandCode: 'minime', weightClassId: 'minime:F:-45', ruleset: 'jiyu', rulesetGiven: false,
    });
  });
  test('shobu donné', () => {
    const [f] = translateFfkEntries([entry(1, 'DUPONT PAUL', 'M', 'Séniors', '-75', 'shobu')], grid, 'karate');
    expect(f).toMatchObject({ ruleset: 'shobu', rulesetGiven: true, ageBandCode: 'senior' });
  });
  test('Vétéran 1', () => {
    expect(translateFfkEntries([entry(1, 'DUPONT PAUL', 'M', 'Vétéran 1', '-75')], grid, 'karate')[0]!.ageBandCode).toBe('v1');
  });
  test('poids absent de la grille', () => {
    const [f] = translateFfkEntries([entry(1, 'DUPONT PAUL', 'M', 'Poussin', '-99')], grid, 'karate');
    expect(f!.weightClassId).toBeNull();
    expect(f!.raw).toEqual({ age: 'Poussin', weight: '-99' });
  });
  test('kata : ni poids ni règlement', () => {
    const [f] = translateFfkEntries([entry(1, 'DUPONT PAUL', 'M', 'Séniors', '-75', 'shobu')], grid, 'kata');
    expect(f).toMatchObject({ weightClassId: null, ruleset: null });
  });
  test('tranche inconnue', () => {
    const [f] = translateFfkEntries([entry(1, 'DUPONT PAUL', 'M', 'Seniors Débutants Shindo', null)], grid, 'karate');
    expect(f!.ageBandCode).toBeNull();
    expect(f!.raw.age).toBe('Seniors Débutants Shindo');
  });
});

describe('planFfkImport', () => {
  test('inconnu : nouveau', () => {
    expect(plan([fighter()], []).steps).toEqual([{ kind: 'new', ffk: fighter() }]);
  });
  test('fiche égale : à jour', () => {
    const r = plan([fighter({ lastName: 'MARTIN', fullName: 'MARTIN LEA' })], [pl('a', line({ lastName: 'martin', firstName: 'LEA' }))]);
    expect(r).toEqual({ steps: [], upToDate: 1, absents: [] });
  });
  test('reprise : la fiche créée par prefillNew est à jour', () => {
    const f = translateFfkEntries([entry(1, 'DA SILVA SANTOS INES', 'F', 'Minime', '-45')], grid, 'karate')[0]!;
    const r = plan([f], [pl('a', prefillNew(f, 'karate'))]);
    expect(r.steps).toEqual([]);
    expect(r.upToDate).toBe(1);
  });
  test('poids différent', () => {
    const r = plan([fighter()], [pl('a', line({ weightClassId: 'benjamin:F:-35' }))]);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ kind: 'existing', fighterId: 'a', diffs: [{ field: 'weightClassId', ffk: 'benjamin:F:-40', fiche: 'benjamin:F:-35' }] });
  });
  test('règlement : seulement si donné', () => {
    const fiche = line({ ruleset: 'shobu', ageBandCode: 'senior', weightClassId: 'senior:F:-60' });
    const base = { ageBandCode: 'senior', weightClassId: 'senior:F:-60' };
    expect(plan([fighter({ ...base })], [pl('a', fiche)]).upToDate).toBe(1);
    const r = plan([fighter({ ...base, rulesetGiven: true })], [pl('a', fiche)]);
    expect((r.steps[0] as Existing).diffs).toEqual([{ field: 'ruleset', ffk: 'jiyu', fiche: 'shobu' }]);
  });
  test('fiche en kata seulement', () => {
    const r = plan([fighter()], [pl('a', line({ combats: [], kata: true, ruleset: null }))]);
    expect(r.steps[0]).toMatchObject({ kind: 'existing', addsDiscipline: true, oneCombatBlocked: false });
  });
  test('une seule discipline', () => {
    const fiche = pl('a', line({ combats: ['shido-mix'] }));
    expect(plan([fighter()], [fiche]).steps[0]).toMatchObject({ addsDiscipline: true, oneCombatBlocked: true });
    expect(plan([fighter()], [fiche], 'karate', { multipleCombats: false, mode: 'organiser' }).steps[0]).toMatchObject({ oneCombatBlocked: false });
    expect(plan([fighter()], [fiche], 'karate', { multipleCombats: true, mode: 'coach' }).steps[0]).toMatchObject({ oneCombatBlocked: false });
  });
  test('homonymes', () => {
    const r = plan([fighter()], [pl('1', line()), pl('2', line())]);
    expect(r.steps).toEqual([{ kind: 'homonym', ffk: fighter(), candidates: ['1', '2'] }]);
    expect(r.absents).toEqual([]);
  });
  test('fiche verrouillée et différente', () => {
    const r = plan([fighter()], [pl('a', line({ weightClassId: 'benjamin:F:-35' }), false, false)]);
    expect(r.steps[0]).toMatchObject({ kind: 'existing', locked: true });
    expect(plan([fighter()], [pl('a', line({ weightClassId: 'benjamin:F:-35' }), false, true)]).steps[0]).toMatchObject({ locked: false });
  });
  test('absents', () => {
    const r = plan([fighter()], [pl('a', line()), pl('b', line({ lastName: 'DURAND' })), pl('c', line({ lastName: 'LEROY', combats: ['shido-boxing'] }))]);
    expect(r.absents).toEqual(['b']);
  });
  test('absents pour kata', () => {
    const r = plan([], [pl('a', line({ combats: [], kata: true })), pl('b', line({ lastName: 'X' }))], 'kata');
    expect(r.absents).toEqual(['a']);
  });
  test('ordre du PDF', () => {
    const r = plan([fighter({ order: 1, lastName: 'AA', fullName: 'AA LEA' }), fighter({ order: 2, lastName: 'BB', fullName: 'BB LEA' })], []);
    expect(r.steps.map((s) => s.ffk.lastName)).toEqual(['AA', 'BB']);
  });
});

test('hasDiscipline', () => {
  expect(hasDiscipline(line(), 'karate')).toBe(true);
  expect(hasDiscipline(line(), 'kata')).toBe(false);
  expect(hasDiscipline(line({ kata: true }), 'kata')).toBe(true);
});

describe('prefillExisting', () => {
  test('garde la fiche, applique FFK, ajoute la discipline', () => {
    const fiche = line({ combats: [], kata: true, ruleset: null, weightKg: 38, grade: '3e kyu', weightClassId: null });
    const r = plan([fighter()], [pl('a', fiche)]);
    const step = r.steps[0] as Existing;
    const out = prefillExisting(fiche, step, 'karate');
    expect(out).toMatchObject({ combats: ['karate'], kata: true, weightKg: 38, grade: '3e kyu', weightClassId: 'benjamin:F:-40', ruleset: 'jiyu' });
  });
  test('discipline bloquée : non ajoutée ; valeurs FFK appliquées', () => {
    const fiche = line({ combats: ['shido-mix'], weightClassId: 'benjamin:F:-35', weightKg: 36 });
    const step = plan([fighter()], [pl('a', fiche)]).steps[0] as Existing;
    expect(prefillExisting(fiche, step, 'karate')).toMatchObject({ combats: ['shido-mix'], weightClassId: 'benjamin:F:-40', weightKg: 36 });
  });
});

describe('withoutDiscipline', () => {
  test('retrait du karaté, kata gardé', () => {
    const out = withoutDiscipline(line({ kata: true, prefs: { 'shido-mix': 1 }, ruleset: 'shobu' }), 'karate');
    expect(out).toMatchObject({ combats: [], kata: true, prefs: {}, ruleset: null });
  });
  test('karaté seul : null', () => expect(withoutDiscipline(line(), 'karate')).toBeNull());
  test('retrait du kata', () => {
    expect(withoutDiscipline(line({ kata: true }), 'kata')).toMatchObject({ kata: false, combats: ['karate'] });
  });
});
