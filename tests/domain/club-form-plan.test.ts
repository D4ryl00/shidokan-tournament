import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import type { ClubFormItem } from '../../src/domain/club-form-read.js';
import {
  clubFormDiffs,
  clubHeaderDiff,
  fieldPatch,
  fieldValue,
  hasHeaderDiff,
  planClubFormImport,
  prefillExistingFromFile,
  prefillFromFile,
  type ImportField,
} from '../../src/domain/club-form-plan.js';
import type { PlanLine } from '../../src/domain/ffk-pdf-plan.js';

function line(over: Partial<ClubFormLine> = {}): ClubFormLine {
  return {
    lastName: 'MARTIN', firstName: 'Lea', sex: 'F', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', weightKg: 38.5,
    combats: ['karate'], kata: false, grade: '3e kyu', ruleset: 'jiyu', prefs: {}, shobuKeep: null, ...over,
  };
}
const item = (order: number, over: Partial<ClubFormLine> = {}): ClubFormItem => ({ order, rows: [order + 10], line: line(over), notes: [] });
const saved = (fighterId: string, over: Partial<ClubFormLine> = {}): PlanLine => ({ fighterId, line: line(over), editable: true, partlyEditable: false });

describe('fieldValue / fieldPatch', () => {
  test('aller-retour pour chaque champ', () => {
    const l = line({ weightKg: 41.5, combats: ['shido-mix', 'karate'], kata: true, prefs: { 'shido-mix': 1, triathlon: 2 }, ruleset: 'shobu', shobuKeep: 'discipline' });
    const fields: ImportField[] = ['ageBandCode', 'weightClassId', 'weightKg', 'disciplines', 'ruleset', 'grade', 'prefs', 'shobuKeep'];
    for (const f of fields) {
      const v = fieldValue(l, f);
      expect(v, f).not.toBeNull();
      const back = { ...line({ ageBandCode: null, weightClassId: null, weightKg: null, combats: [], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null }), ...fieldPatch(f, v) };
      expect(fieldValue(back, f), f).toBe(v);
    }
  });
  test('encodages', () => {
    expect(fieldValue(line({ weightKg: 38.5 }), 'weightKg')).toBe('38.5');
    expect(fieldValue(line({ combats: ['shido-mix', 'karate'], kata: true }), 'disciplines')).toBe('karate,shido-mix,kata');
    expect(fieldValue(line({ combats: [], kata: false }), 'disciplines')).toBeNull();
    expect(fieldValue(line({ prefs: {} }), 'prefs')).toBeNull();
    expect(fieldValue(line({ grade: '  1er dan ' }), 'grade')).toBe('1er dan');
    expect(fieldPatch('disciplines', 'karate,kata')).toEqual({ combats: ['karate'], kata: true });
    expect(fieldPatch('prefs', 'shido-mix,karate')).toEqual({ prefs: { 'shido-mix': 1, karate: 2 } });
  });
});

describe('clubFormDiffs', () => {
  test("case vide n'efface rien", () => {
    const file = line({ weightKg: null, grade: null, prefs: {}, shobuKeep: null });
    const sv = line({ weightKg: 40, grade: '1er dan', prefs: { 'shido-mix': 1 }, shobuKeep: 'ruleset' });
    expect(clubFormDiffs(file, sv)).toEqual([]);
  });
  test('discipline retirée = différence', () => {
    expect(clubFormDiffs(line({ combats: ['karate'], kata: false }), line({ combats: ['karate'], kata: true }))).toEqual([
      { field: 'disciplines', ffk: 'karate', fiche: 'karate,kata' },
    ]);
  });
  test('poids et règlement sans combat dans la fiche', () => {
    const file = line({ combats: [], kata: true, weightClassId: 'benjamin:F:-50', ruleset: 'shobu' });
    expect(clubFormDiffs(file, line({ combats: ['karate'], kata: true })).map((d) => d.field)).toEqual(['disciplines']);
  });
  test('grade et priorité shobu selon kata / shobu', () => {
    expect(clubFormDiffs(line({ kata: true, grade: '1er dan' }), line({ kata: true })).map((d) => d.field)).toContain('grade');
    expect(clubFormDiffs(line({ kata: false, grade: '1er dan' }), line()).map((d) => d.field)).not.toContain('grade');
    const shobu = line({ ruleset: 'shobu', shobuKeep: 'discipline', prefs: { 'shido-mix': 1 } });
    expect(clubFormDiffs(shobu, line({ ruleset: 'shobu', shobuKeep: 'ruleset', prefs: { 'shido-mix': 1 } }))).toEqual([
      { field: 'shobuKeep', ffk: 'discipline', fiche: 'ruleset' },
    ]);
  });
});

describe('planClubFormImport', () => {
  test('nouveau, existant, homonyme, à jour, absents', () => {
    const items = [
      item(0, { lastName: 'NEUF', firstName: 'Zoe' }),
      item(1, { lastName: 'DUPONT', firstName: 'Ana', ageBandCode: 'minime' }),
      item(2, { lastName: 'TWIN', firstName: 'Sam' }),
      item(3, { lastName: 'STABLE', firstName: 'Eve' }),
    ];
    const lines = [
      saved('a', { lastName: 'DUPONT', firstName: 'Ana' }),
      saved('t1', { lastName: 'TWIN', firstName: 'Sam' }),
      saved('t2', { lastName: 'TWIN', firstName: 'Sam' }),
      saved('s', { lastName: 'STABLE', firstName: 'Eve' }),
      saved('gone', { lastName: 'ABSENT', firstName: 'Kim', combats: [], kata: true }),
    ];
    const plan = planClubFormImport(items, lines);
    expect(plan.steps.map((s) => s.kind)).toEqual(['new', 'existing', 'homonym']);
    expect(plan.steps[1]).toMatchObject({ fighterId: 'a', diffs: [{ field: 'ageBandCode', ffk: 'minime', fiche: 'benjamin' }] });
    expect(plan.steps[2]).toMatchObject({ candidates: ['t1', 't2'] });
    expect(plan.upToDate).toBe(1);
    expect(plan.absents).toEqual(['gone']);
  });
  test('sexe illisible : rapproché par le nom', () => {
    const one = planClubFormImport([item(0, { sex: null })], [saved('a', { sex: 'M' })]);
    expect(one.steps).toEqual([]);
    expect(one.upToDate).toBe(1);
    const two = planClubFormImport([item(0, { sex: null })], [saved('a', { sex: 'M' }), saved('b', { sex: 'F' })]);
    expect(two.steps[0]).toMatchObject({ kind: 'homonym', candidates: ['a', 'b'] });
    expect(two.absents).toEqual([]);
  });
  test('même nom, autre sexe : nouveau', () => {
    expect(planClubFormImport([item(0, { sex: 'M' })], [saved('a', { sex: 'F' })]).steps[0]!.kind).toBe('new');
  });
  test('réimport : une fiche enregistrée égale à prefillFromFile est à jour', () => {
    const file = line({ ageBandCode: 'benjamin', ruleset: null });
    const filled = prefillFromFile(file, new Set(['benjamin']));
    const plan = planClubFormImport([{ order: 0, rows: [11], line: file, notes: [] }], [saved('a', filled)]);
    expect(plan.upToDate).toBe(1);
    expect(plan.steps).toEqual([]);
  });
});

describe('prefillFromFile', () => {
  test('mineur avec combat sans règlement : jiyu ; adulte : null', () => {
    expect(prefillFromFile(line({ ruleset: null }), new Set(['benjamin'])).ruleset).toBe('jiyu');
    expect(prefillFromFile(line({ ruleset: null, ageBandCode: 'senior' }), new Set(['benjamin'])).ruleset).toBeNull();
    expect(prefillFromFile(line({ ruleset: null, combats: [], kata: true }), new Set(['benjamin'])).ruleset).toBeNull();
  });
  test('reclassement rangé', () => {
    expect(prefillFromFile(line({ prefs: { karate: 1, 'shido-mix': 2 } }), new Set()).prefs).toEqual({ 'shido-mix': 1 });
  });
});

describe('prefillExistingFromFile', () => {
  test('valeurs du fichier pour chaque différence, le reste de l’enregistré', () => {
    const sv = line({ weightKg: 38.5, grade: '3e kyu' });
    const out = prefillExistingFromFile(sv, [{ field: 'ageBandCode', ffk: 'minime', fiche: 'benjamin' }], []);
    expect(out).toEqual({ ...sv, ageBandCode: 'minime' });
  });
  test('discipline commencée gardée', () => {
    const sv = line({ kata: true });
    const diffs = clubFormDiffs(line({ kata: false }), sv);
    expect(prefillExistingFromFile(sv, diffs, []).kata).toBe(false);
    expect(prefillExistingFromFile(sv, diffs, ['kata']).kata).toBe(true);
    const sv2 = line({ combats: ['karate', 'shido-mix'] });
    const out = prefillExistingFromFile(sv2, clubFormDiffs(line({ combats: ['karate'] }), sv2), ['shido-mix']);
    expect(out.combats).toEqual(['karate', 'shido-mix']);
  });
});

describe('clubHeaderDiff', () => {
  const club = { coachName: 'Paul', coachPhone: '0600', coachEmails: ['coach@dojo.fr'], preApproval: false };
  test('e-mails sans casse', () => {
    const d = clubHeaderDiff({ club: 'X', coachName: null, coachPhone: null, coachEmails: ['Coach@Dojo.fr', 'neuf@dojo.fr', 'NEUF@dojo.fr'], preApproval: null }, club);
    expect(d.newEmails).toEqual(['neuf@dojo.fr']);
    expect(hasHeaderDiff(d)).toBe(true);
  });
  test('coordonnées vides ou égales', () => {
    const d = clubHeaderDiff({ club: 'X', coachName: ' ', coachPhone: '0600', coachEmails: [], preApproval: null }, club);
    expect(d).toEqual({ coachName: null, coachPhone: null, preApproval: null, newEmails: [] });
    expect(hasHeaderDiff(d)).toBe(false);
  });
  test('téléphone sur les chiffres, coach sur le nom normalisé', () => {
    const c = { coachName: 'Paul Évrard', coachPhone: '06 12 34 56 78', coachEmails: [], preApproval: false };
    const d = clubHeaderDiff({ club: 'X', coachName: 'paul  evrard', coachPhone: '06.12.34.56.78', coachEmails: [], preApproval: null }, c);
    expect(d).toEqual({ coachName: null, coachPhone: null, preApproval: null, newEmails: [] });
    const d2 = clubHeaderDiff({ club: 'X', coachName: 'Paul Évrard', coachPhone: '06.12.34.56.79', coachEmails: [], preApproval: null }, c);
    expect(d2.coachPhone).toEqual({ fiche: '06.12.34.56.79', saved: '06 12 34 56 78' });
  });
  test('différences', () => {
    const d = clubHeaderDiff({ club: 'X', coachName: 'Pierre', coachPhone: '0611', coachEmails: [], preApproval: true }, club);
    expect(d).toEqual({ coachName: { fiche: 'Pierre', saved: 'Paul' }, coachPhone: { fiche: '0611', saved: '0600' }, preApproval: { fiche: true, saved: false }, newEmails: [] });
  });
});
