import { describe, expect, test } from 'vitest';
import type { FfkRow } from '../../src/domain/ffk-import.js';
import type { ExistingFighter } from '../../src/domain/ffk-plan/cards.js';
import { planFfkCards, planFingerprint, searchableFighters, type ExistingData, type FfkChoices } from '../../src/domain/ffk-plan/plan.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { FfkPreview } from '../../src/web/api.js';
import { cardsLeftAside, recap, resultMessage } from '../../src/web/components/ffk-import/recap.js';

const grid = ffkDefaultGrid();
const TANI = '0060893 TANI DOJO';
const NOUVEAU = '0060999 NOUVEAU CLUB';

let n = 0;
function row(over: Partial<FfkRow> = {}): FfkRow {
  n++;
  return {
    key: `K#${n}`, sheet: 'Karate', line: n + 1, licence: `L${n}`, lastName: 'MARTIN', firstName: 'LEA',
    clubEntity: TANI, clubName: 'TANI DOJO', sex: 'F', ageBandCode: 'cadet', discipline: 'karate',
    ruleset: null, weightLabel: '-54', weightIssue: null, errors: [], warnings: [], ...over,
  };
}
const fighter = (id: string, lastName: string, firstName: string): ExistingFighter => ({
  fighterId: id, clubId: 'c1', licence: null, publicNameHidden: false, version: `${id}:1`, editable: true, partlyEditable: false, startedDisciplines: [], fromFfk: false,
  line: { lastName, firstName, sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-54', weightKg: null, combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null },
});
const existing = (): ExistingData => ({
  clubs: [{ id: 'c1', name: 'Tani Dojo', ffkEntity: null, affiliationNumber: null }],
  fighters: [fighter('f1', 'MARTIN', 'Léa'), fighter('f2', 'DURAND', 'Zoé')],
  aliases: {},
  rules: { multipleCombats: true, closed: new Set() },
});
function preview(rows: FfkRow[], choices: FfkChoices = {}, rules?: ExistingData['rules']): FfkPreview {
  const ex = { ...existing(), ...(rules ? { rules } : {}) };
  const plan = planFfkCards(rows, grid, ex, choices);
  return { ...plan, fingerprint: planFingerprint(plan), fighters: searchableFighters(ex, grid) };
}
const titles = (blocks: { title: string }[]) => blocks.map((b) => b.title);
const texts = (block: { items?: { text: string; strong?: string }[] } | undefined) => (block?.items ?? []).map((i) => `${i.text}${i.strong ?? ''}`);

describe('récapitulatif de l’import', () => {
  test('laissé de côté : clubs à part, puis les combattants (à trancher, écartés, à valider) avec leur raison ; même nombre que la notification', () => {
    const sure = row(); // MARTIN : rapprochée d’office
    const skipped = row({ lastName: 'DURAND', firstName: 'ZOE' });
    const pending = row({ lastName: 'PETIT', firstName: 'PAUL' });
    const unlinked = row({ lastName: 'ROSSI', firstName: 'NINA', clubEntity: NOUVEAU, clubName: 'NOUVEAU CLUB' });
    const fresh = row({ lastName: 'NEUF', firstName: 'ANA' });
    const p = preview([sure, skipped, pending, unlinked, fresh], {
      cards: { [`L:${skipped.licence}`]: { kind: 'skip' }, [`L:${pending.licence}`]: { kind: 'none' } },
    });
    const blocks = recap(p, { [`L:${pending.licence}`]: 'pending' }, grid, [{ id: 'c1', name: 'Tani Dojo', ffkEntity: TANI }]);
    const aside = blocks.find((b) => b.aside)!;
    expect(aside.title).toBe('Laissé de côté : 1 club · 4 combattants');
    expect(texts(aside)).toEqual([
      'Club NOUVEAU CLUB : pas relié, ses nouveaux combattants ne sont pas créés',
      'DURAND ZOE — Karaté : écartée',
      'PETIT PAUL — Karaté : carte modifiée mais pas validée',
      'ROSSI NINA — Karaté : club pas relié',
      'NEUF ANA — Karaté : nouveau combattant : vérifiez qu’il n’est pas déjà inscrit sous un autre nom',
    ]);
    // Le nombre de combattants laissés de côté est celui que l’import renvoie (`leftAside` = à trancher + écartées).
    expect(cardsLeftAside(p)).toHaveLength(p.summary.todo + p.summary.skip);
    expect(resultMessage({ created: 0, updated: 1, deleted: 0, weightClassesCreated: 0, leftAside: 3 }))
      .toBe('Import FFK : 0 combattant créé, 1 mis à jour, 0 supprimé, 0 catégorie créée, 3 combattants laissés de côté.');
    expect(resultMessage({ created: 2, updated: 0, deleted: 0, weightClassesCreated: 1, leftAside: 0 }))
      .toBe('Import FFK : 2 combattants créés, 0 mis à jour, 0 supprimé, 1 catégorie créée.');
  });

  test('laissé de côté, règles de la compétition : nouveau combattant qui déroge (les deux raisons), écart dont la valeur FFK dérogerait', () => {
    const fresh = row({ lastName: 'NEUF', firstName: 'ANA' });
    const freshBoxe = row({ lastName: 'NEUF', firstName: 'ANA', licence: fresh.licence, sheet: 'Boxe', discipline: 'shido-boxing' });
    const martin = row();
    const martinBoxe = row({ licence: martin.licence, sheet: 'Boxe', discipline: 'shido-boxing' });
    const p = preview([fresh, freshBoxe, martin, martinBoxe], {}, { multipleCombats: false, closed: new Set() });
    const rule = 'Une seule discipline de combat par combattant à cette compétition.';
    expect(texts(recap(p, {}, grid, []).find((b) => b.aside))).toEqual([
      `NEUF ANA — Karaté, Shido-boxing : nouveau combattant : vérifiez qu’il n’est pas déjà inscrit sous un autre nom ; déroge aux règles : ${rule}`,
      `MARTIN LEA — Karaté, Shido-boxing : reste à remplir : Disciplines ; la valeur FFK déroge aux règles : ${rule}`,
    ]);
  });

  test('sans rien de côté : pas de rubrique « Laissé de côté » ; seuls des clubs : « Laissé de côté : 1 club »', () => {
    expect(recap(preview([row()]), {}, grid, []).some((b) => b.aside)).toBe(false);
    const p = preview([row({ lastName: 'MARTIN', clubEntity: NOUVEAU, clubName: 'NOUVEAU CLUB', licence: null })]);
    // MARTIN est rapprochée par son nom d’un autre club : la carte est à trancher, le club n’est pas relié.
    expect(recap(p, {}, grid, []).find((b) => b.aside)!.title).toBe('Laissé de côté : 1 club · 1 combattant');
  });

  test('clubs reliés ou créés : les liens choisis, et les liens sûrs que l’import mémorise (pas ceux déjà mémorisés)', () => {
    const p = preview([row(), row({ lastName: 'ROSSI', firstName: 'NINA', clubEntity: NOUVEAU, clubName: 'NOUVEAU CLUB' })], { clubLinks: { [NOUVEAU]: 'c1' } });
    const linked = (ffkEntity: string | null) => recap(p, {}, grid, [{ id: 'c1', name: 'Tani Dojo', ffkEntity }]).find((b) => b.title === 'Clubs reliés ou créés');
    expect(texts(linked(null))).toEqual(['TANI DOJO → Tani Dojo (lien sûr, mémorisé)', 'NOUVEAU CLUB → Tani Dojo']);
    expect(texts(linked(TANI))).toEqual(['NOUVEAU CLUB → Tani Dojo']);
  });

  test('catégorie de poids créée : tranche d’âge, sexe et poids en clair ; mises à jour marquées « validée » si la carte l’a été', () => {
    const small = row({ lastName: 'PETIT', firstName: 'P', ageBandCode: 'poussin', weightLabel: '-20' });
    const durand = row({ lastName: 'DURAND', firstName: 'ZOE', weightLabel: '-61' });
    const value = { line: { ...existing().fighters[1]!.line, weightClassId: 'cadet:F:-61', licence: durand.licence }, clubId: 'c1', publicNameHidden: false };
    const created = { line: { ...value.line, lastName: 'PETIT', firstName: 'P', ageBandCode: 'poussin', weightClassId: 'poussin:F:-20', licence: small.licence }, clubId: 'c1', publicNameHidden: false };
    const p = preview([small, durand], {
      acceptedWeightClasses: ['poussin:F:-20'],
      cards: { [`L:${durand.licence}`]: { kind: 'validated', fighterId: 'f2', value, version: 'f2:1' }, [`L:${small.licence}`]: { kind: 'validated', fighterId: 'new', value: created } },
    });
    const blocks = recap(p, {}, grid, [{ id: 'c1', name: 'Tani Dojo', ffkEntity: TANI }]);
    expect(texts(blocks.find((b) => b.title === 'Catégories de poids créées'))).toEqual(['Poussins · Féminin · -20 kg']);
    const updates = blocks.find((b) => b.title.startsWith('Inscriptions mises à jour'))!;
    expect(updates.items).toEqual([{ text: `DURAND Zoé — Karaté : Catégorie de poids : -54 kg → -61 kg ; N° de licence : — → ${durand.licence}`, validated: true }]);
    expect(titles(blocks)).toEqual(['Catégories de poids créées', 'Inscriptions mises à jour (1)', 'Confirmées sans changement (0)', 'Combattants créés (1)', 'Fiches club sans inscription FFK gardées (1)']);
  });
});
