import { expect, test } from 'vitest';
import { lineToRows, type ClubFormLine } from '../../src/domain/club-form.js';
import { registrationsToLine, type LineRegistration } from '../../src/domain/club-line.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const TOLERANCE = { M: 0, F: 0 };

/** Inscriptions telles qu'enregistrées à partir d'une ligne (comme l'import d'une fiche). */
function roundTrip(line: ClubFormLine): ClubFormLine {
  const rows = lineToRows(line, 1, grid, TOLERANCE);
  expect(rows.every((r) => r.input), JSON.stringify(rows.map((r) => r.errors))).toBe(true);
  const inputs = rows.map((r) => r.input!);
  const regs: LineRegistration[] = inputs.map((i) => ({
    discipline: i.discipline, ruleset: i.ruleset, weightClassId: i.weightClassId, approxWeightKg: i.approxWeightKg ?? null,
    otherDisciplines: i.otherDisciplines ?? [], acceptsJiyuFirst: i.acceptsJiyuFirst ?? null, originalJson: null,
  }));
  const grade = inputs.find((i) => i.discipline === 'kata')?.grade ?? null;
  return registrationsToLine({ lastName: line.lastName, firstName: line.firstName, sex: line.sex!, ageBandCode: line.ageBandCode!, grade }, regs).line;
}

const BASE: ClubFormLine = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightClassId: null, weightKg: 53.5, combats: [], kata: false, grade: null,
  ruleset: null, prefs: {}, shobuKeep: null,
};

test('aller-retour : une ligne combat + kata (prefs, shobu, catégorie et poids, grade) redonne la même ligne', () => {
  const line: ClubFormLine = { ...BASE, weightClassId: 'senior:F:-61', combats: ['karate'], kata: true, grade: '1er kyu', ruleset: 'shobu', prefs: { 'shido-mix': 1, 'shido-boxing': 2 }, shobuKeep: 'discipline' };
  expect(roundTrip(line)).toEqual(line);
});

test('aller-retour : triathlon en choix ou en discipline, jusqu’à 3 choix', () => {
  const karate: ClubFormLine = { ...BASE, weightClassId: 'senior:F:-61', combats: ['karate'], ruleset: 'jiyu', prefs: { triathlon: 1, 'shido-mix': 2, 'shido-boxing': 3 } };
  expect(roundTrip(karate)).toEqual(karate);
  const triathlon: ClubFormLine = { ...BASE, weightClassId: 'senior:F:-61', combats: ['triathlon'], ruleset: 'jiyu', prefs: { karate: 1 } };
  expect(roundTrip(triathlon)).toEqual(triathlon);
});

test('combat seul, kata seul : idem', () => {
  const combat: ClubFormLine = { ...BASE, weightClassId: 'senior:F:-55', weightKg: null, combats: ['shido-boxing'], ruleset: 'jiyu', prefs: { karate: 1 } };
  expect(roundTrip(combat)).toEqual(combat);
  const kata: ClubFormLine = { ...BASE, kata: true, grade: '2e dan' };
  expect(roundTrip(kata)).toEqual(kata);
});

test('inscription réaffectée (originalJson) → discipline, règlement et catégorie de poids d’origine', () => {
  const { line } = registrationsToLine(
    { lastName: 'DURAND', firstName: 'Hugo', sex: 'M', ageBandCode: 'senior', grade: null },
    [{ discipline: 'shido-mix', ruleset: 'jiyu', weightClassId: 'senior:M:-84', approxWeightKg: 75, otherDisciplines: [], acceptsJiyuFirst: null, originalJson: JSON.stringify({ discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:M:-75' }) }],
  );
  expect(line).toMatchObject({ combats: ['karate'], ruleset: 'shobu', weightClassId: 'senior:M:-75', weightKg: 75 });
});

test('deux inscriptions de combat → une ligne éditable à deux combats, valeurs déclarées, règlement du premier', () => {
  const boxingShobu: LineRegistration = {
    discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:M:-75', approxWeightKg: 70, otherDisciplines: ['shido-mix'], acceptsJiyuFirst: true,
    originalJson: JSON.stringify({ discipline: 'shido-boxing', ruleset: 'shobu', weightClassId: 'senior:M:-75' }),
  };
  const mixJiyu: LineRegistration = { discipline: 'shido-mix', ruleset: 'jiyu', weightClassId: 'senior:M:-75', approxWeightKg: 70, otherDisciplines: [], acceptsJiyuFirst: null, originalJson: null };
  const out = registrationsToLine({ lastName: 'X', firstName: 'Y', sex: 'M', ageBandCode: 'senior', grade: null }, [boxingShobu, mixJiyu]);
  expect(out).toMatchObject({ editable: true, reason: null });
  expect(out.line).toMatchObject({ combats: ['shido-boxing', 'shido-mix'], ruleset: 'shobu', prefs: { 'shido-mix': 1 }, shobuKeep: 'discipline' });
});

test('deux inscriptions qui partagent une discipline saisie → une seule entrée dans combats', () => {
  const reg = (originalJson: string | null): LineRegistration => ({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:M:-75', approxWeightKg: 70, otherDisciplines: [], acceptsJiyuFirst: null, originalJson });
  const { line } = registrationsToLine({ lastName: 'X', firstName: 'Y', sex: 'M', ageBandCode: 'senior', grade: null }, [reg(null), reg(JSON.stringify({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:M:-75' }))]);
  expect(line.combats).toEqual(['karate']);
});
