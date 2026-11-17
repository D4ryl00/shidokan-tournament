import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { closedBreaks, ruleBreaks } from '../../src/domain/ffk-plan/rules.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const line = (over: Partial<ClubFormLine> = {}): ClubFormLine => ({
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-54', weightKg: null, combats: ['karate'], kata: false,
  grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null, ...over,
});
const ONE = 'Une seule discipline de combat par combattant à cette compétition.';

describe('règles de la compétition (dérogations)', () => {
  test('plusieurs combats : signalé sans le réglage, sauf s’ils étaient tous déjà enregistrés sur la fiche', () => {
    const two = line({ combats: ['karate', 'shido-boxing'] });
    expect(ruleBreaks(two, null, grid, { multipleCombats: false, closed: new Set() })).toEqual([ONE]);
    expect(ruleBreaks(two, null, grid, { multipleCombats: true, closed: new Set() })).toEqual([]);
    expect(ruleBreaks(two, line({ combats: ['shido-boxing', 'karate'] }), grid, { multipleCombats: false, closed: new Set() })).toEqual([]);
    // Une discipline de plus que la fiche : nouvelle dérogation.
    expect(ruleBreaks(line({ combats: ['karate', 'shido-mix'] }), two, grid, { multipleCombats: false, closed: new Set() })).toEqual([ONE]);
    // Un seul combat : jamais.
    expect(ruleBreaks(line(), null, grid, { multipleCombats: false, closed: new Set() })).toEqual([]);
  });

  test('ce que l’organisateur ne peut pas faire non plus (shobu d’un mineur) n’est pas une dérogation : c’est une erreur d’enregistrement', () => {
    expect(ruleBreaks(line({ ruleset: 'shobu' }), null, grid, { multipleCombats: false, closed: new Set() })).toEqual([]);
  });

  test('catégorie non ouverte : chaque case fermée nommée, sauf celles où la fiche était déjà inscrite', () => {
    const closed = new Set(['cadet|F|karate|jiyu', 'cadet|F|kata|']);
    const both = line({ kata: true });
    expect(closedBreaks(both, null, closed)).toEqual([
      'Catégorie non ouverte à cette compétition (Karaté jiyu).',
      'Catégorie non ouverte à cette compétition (Kata).',
    ]);
    expect(closedBreaks(both, line(), closed)).toEqual(['Catégorie non ouverte à cette compétition (Kata).']);
    // Autre tranche d’âge que la fiche : la case n’est plus la même.
    expect(closedBreaks(line({ ageBandCode: 'junior', weightClassId: 'junior:F:-59' }), line(), new Set(['junior|F|karate|jiyu']))).toEqual(['Catégorie non ouverte à cette compétition (Karaté jiyu).']);
    // Sans règlement, âge ou sexe : rien à dire (il manque un champ, pas une règle).
    expect(closedBreaks(line({ ruleset: null }), null, closed)).toEqual([]);
    expect(ruleBreaks(both, null, grid, { multipleCombats: true, closed })).toHaveLength(2);
  });
});
