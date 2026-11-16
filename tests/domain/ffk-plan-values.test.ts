import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import type { ExistingFighter, FfkCardDraft } from '../../src/domain/ffk-plan/cards.js';
import { cardChanges, ffkCardDiffs, initialValue, missingFields, type ChangeLabels, type FfkCardValue } from '../../src/domain/ffk-plan/values.js';
import { clubFormDiffs } from '../../src/domain/club-form-plan.js';

const baseLine: ClubFormLine = {
  lastName: 'MARTIN', firstName: 'LEA', sex: 'F', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-35', weightKg: null,
  combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null,
};
function card(over: Partial<ClubFormLine> & { clubId?: string | null; weightIssue?: string | null } = {}): FfkCardDraft {
  const { clubId, weightIssue, ...line } = over;
  return {
    key: 'k', rows: [], exportLine: { ...baseLine, ...line }, clubEntity: 'E', clubId: clubId === undefined ? 'c1' : clubId,
    weightIssue: weightIssue ?? null, notes: [], candidates: [], sure: null,
  };
}
function saved(over: Partial<ClubFormLine> & { clubId?: string | null } = {}): ExistingFighter {
  const { clubId, ...line } = over;
  return {
    fighterId: 'f1', clubId: clubId === undefined ? 'c1' : clubId, licence: line.licence ?? null, line: { ...baseLine, ...line },
    publicNameHidden: false, version: 'v', editable: true, partlyEditable: false, startedDisciplines: [], fromFfk: false,
  };
}
const labels: ChangeLabels = {
  ageBand: (c) => ({ pupille: 'Pupilles', benjamin: 'Benjamins' })[c] ?? c,
  weightClass: (id) => id.split(':')[2]!.replace('-', '−') + ' kg',
  discipline: (d) => (({ karate: 'Karaté', kata: 'Kata', 'shido-boxing': 'Boxing' }) as Record<string, string>)[d] ?? d,
  ruleset: (r) => (r === 'shobu' ? 'Shobu' : 'Jiyu'),
  club: (id) => `Club ${id}`,
};
const value = (v: Partial<FfkCardValue> = {}): FfkCardValue => ({ line: baseLine, clubId: 'c1', publicNameHidden: false, ...v });

describe('écarts et valeur de départ', () => {
  test('aucun écart : valeur = fiche, licence FFK complète une fiche vide', () => {
    const v = initialValue(card({ licence: '11462640R' }), saved({ licence: null }));
    expect(ffkCardDiffs(card({ licence: '11462640R' }), saved({ licence: null }))).toEqual([]);
    expect(v.line.licence).toBe('11462640R');
  });
  test('écarts âge et poids : ces champs démarrent vides (rien d’office)', () => {
    const c = card({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-35' });
    const s = saved({ ageBandCode: 'pupille', weightClassId: 'pupille:F:-30' });
    expect(ffkCardDiffs(c, s).map((d) => d.field)).toEqual(['ageBandCode', 'weightClassId']);
    expect(initialValue(c, s).line).toMatchObject({ ageBandCode: null, weightClassId: null });
    expect(missingFields(initialValue(c, s))).toEqual(['Catégorie d’âge', 'Catégorie de poids']);
  });
  test('nom, sexe, club et licence qui diffèrent sont des écarts ; discipline de la fiche absente de l’export = écart « disciplines »', () => {
    const fields = (c: FfkCardDraft, s: ExistingFighter) => ffkCardDiffs(c, s).map((d) => d.field);
    expect(fields(card({ lastName: 'MARTINI' }), saved({ lastName: 'MARTINNI' }))).toEqual(['lastName']);
    expect(fields(card({ sex: 'M' }), saved({ sex: 'F' }))).toEqual(['sex']);
    expect(fields(card({ clubId: 'c1' }), saved({ clubId: 'c2' }))).toEqual(['clubId']);
    expect(fields(card({ licence: 'AAA1' }), saved({ licence: 'BBB2' }))).toEqual(['licence']);
    expect(fields(card({ combats: ['karate'] }), saved({ combats: ['karate', 'shido-boxing'] }))).toEqual(['disciplines']);
    // même nom à la casse et aux accents près : pas d’écart
    expect(fields(card({ lastName: 'Martin' }), saved({ lastName: 'MARTIN' }))).toEqual([]);
    // champ vidé côté écart : la valeur de départ est vide
    const v = initialValue(card({ clubId: 'c1', lastName: 'MARTINI' }), saved({ clubId: 'c2', lastName: 'MARTINNI' }));
    expect(v.clubId).toBeNull();
    expect(v.line.lastName).toBe('');
  });
  test('export sans règlement : celui de la fiche ; nouveau combattant sans règlement : jiyu', () => {
    expect(initialValue(card({ ruleset: null }), saved({ ruleset: 'shobu' })).line.ruleset).toBe('shobu');
    expect(initialValue(card({ ruleset: null }), null).line.ruleset).toBe('jiyu');
  });
  test('poids à problème : champ vide même pour un nouveau combattant', () => {
    expect(initialValue(card({ weightClassId: null, weightIssue: '« +60 » n’existe pas pour les cadettes.' }), null).line.weightClassId).toBeNull();
  });
  test('nouveau combattant : valeur de l’export, club relié', () => {
    const v = initialValue(card(), null);
    expect(v).toMatchObject({ clubId: 'c1', publicNameHidden: false });
    expect(v.line.lastName).toBe('MARTIN');
    expect(missingFields(v)).toEqual([]);
  });
  test('un existant garde son masquage et ses champs vides sont complétés par l’export', () => {
    const s = { ...saved({ ageBandCode: null, sex: null }), publicNameHidden: true };
    const v = initialValue(card(), s);
    expect(v.publicNameHidden).toBe(true);
    expect(v.line).toMatchObject({ ageBandCode: 'benjamin', sex: 'F' });
  });
  test('clubFormDiffs (Import Fiche Club) ne compte ni nom ni sexe', () => {
    expect(clubFormDiffs({ ...baseLine, lastName: 'X', sex: 'M' }, baseLine)).toEqual([]);
  });
});

describe('champs manquants', () => {
  test('dans l’ordre, selon ce que l’import enregistrerait', () => {
    const empty: ClubFormLine = { ...baseLine, lastName: '', firstName: ' ', sex: null, ageBandCode: null, weightClassId: null, combats: [], kata: false, ruleset: null };
    expect(missingFields({ line: empty, clubId: null, publicNameHidden: false }))
      .toEqual(['Nom', 'Prénom', 'Sexe', 'Catégorie d’âge', 'Disciplines', 'Club']);
    expect(missingFields({ line: { ...empty, combats: ['karate'] }, clubId: 'c1', publicNameHidden: false }))
      .toEqual(['Nom', 'Prénom', 'Sexe', 'Catégorie d’âge', 'Catégorie de poids', 'Règlement']);
  });
});

describe('cardChanges', () => {
  test('libellés lisibles', () => {
    const out = cardChanges(saved({ ageBandCode: 'pupille' }), value({ line: { ...baseLine, ageBandCode: 'benjamin' } }), labels);
    expect(out).toContain('Catégorie d’âge : Pupilles → Benjamins');
  });
  test('poids, disciplines, règlement, club, vide', () => {
    const out = cardChanges(
      saved({ weightClassId: 'pupille:F:-30', combats: ['karate', 'shido-boxing'], ruleset: 'shobu', clubId: 'c2' }),
      value({ line: { ...baseLine, weightClassId: null } }), labels);
    expect(out).toEqual([
      'Catégorie de poids : −30 kg → —',
      'Disciplines : Karaté, Boxing → Karaté',
      'Règlement : Shobu → Jiyu',
      'Club : Club c2 → Club c1',
    ]);
  });
  test('rien de changé ou nouveau combattant : aucune ligne', () => {
    expect(cardChanges(saved(), value(), labels)).toEqual([]);
    expect(cardChanges(null, value(), labels)).toEqual([]);
  });
});
