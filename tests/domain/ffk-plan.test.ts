import { describe, expect, test } from 'vitest';
import { planFfkImport, planFingerprint, type ExistingData, type FfkRow } from '../../src/domain/ffk-import.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import type { Club, Fighter, Registration } from '../../src/domain/registration.js';

const grid = ffkDefaultGrid();

function club(id: string, name: string, ffkEntity: string | null = null): Club {
  return { id, competitionId: 'c', name, ffkEntity, coachName: null, coachPhone: null, coachEmail: null, preApproval: false };
}
function fighter(id: string, clubId: string | null, lastName: string, firstName: string, over: Partial<Fighter> = {}): Fighter {
  return { id, competitionId: 'c', clubId, lastName, firstName, sex: 'F', ageBandCode: 'cadet', licence: null, ...over };
}
function reg(id: string, fighterId: string, over: Partial<Registration & { ffkConfirmed: boolean }> = {}) {
  return {
    id, competitionId: 'c', fighterId, discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', approxWeightKg: null,
    otherDisciplines: [], acceptsJiyuFirst: null, source: 'club_form', createdAt: '', ffkConfirmed: false, ...over,
  } as Registration & { ffkConfirmed: boolean };
}
let n = 0;
function row(over: Partial<FfkRow> = {}): FfkRow {
  n++;
  return {
    key: `K#${n}`, sheet: 'Karate', line: n + 1, licence: `L${n}`, lastName: 'MARTIN', firstName: 'LEA',
    clubEntity: '0060893 TANI DOJO', clubName: 'TANI DOJO', sex: 'F', ageBandCode: 'cadet', discipline: 'karate',
    ruleset: null, weightLabel: '-54', errors: [], warnings: [], ...over,
  };
}
const base = (): ExistingData => ({
  clubs: [club('c1', 'Tani Dojo'), club('c2', 'Shinsengumi')],
  fighters: [fighter('f1', 'c1', 'MARTIN', 'Léa')],
  registrations: [reg('r1', 'f1')],
  aliases: {},
});

describe('clubs', () => {
  test('nom égal → sûr ; contenu → douteux ; inconnu → nouveau ; alias → sûr', () => {
    const ex = base();
    ex.clubs.push(club('c3', 'Issa'));
    ex.aliases = { ISSA: '0060808 ISSA KYOKUSHIN SCHOOL' };
    const plan = planFfkImport([
      row(),
      row({ clubEntity: '0060789 SHINSENGUMI DOJO VESUBIE', clubName: 'SHINSENGUMI DOJO VESUBIE', lastName: 'X', firstName: 'Y' }),
      row({ clubEntity: '0060999 NOUVEAU CLUB', clubName: 'NOUVEAU CLUB', lastName: 'Z', firstName: 'W' }),
      row({ clubEntity: '0060808 ISSA KYOKUSHIN SCHOOL', clubName: 'ISSA KYOKUSHIN SCHOOL', lastName: 'Q', firstName: 'R' }),
    ], grid, ex);
    const link = (e: string) => plan.clubs.find((c) => c.clubEntity === e)!;
    expect(link('0060893 TANI DOJO')).toMatchObject({ certainty: 'sure', target: { kind: 'existing', clubId: 'c1' } });
    expect(link('0060789 SHINSENGUMI DOJO VESUBIE')).toMatchObject({ certainty: 'doubtful', target: { kind: 'existing', clubId: 'c2' } });
    expect(link('0060999 NOUVEAU CLUB')).toMatchObject({ certainty: 'new', target: { kind: 'new' } });
    expect(link('0060808 ISSA KYOKUSHIN SCHOOL')).toMatchObject({ certainty: 'sure', target: { kind: 'existing', clubId: 'c3' } });
  });
  test('club déjà relié par son entité FFK → sûr', () => {
    const ex = base();
    ex.clubs[1] = club('c2', 'Autre nom', '0060789 SHINSENGUMI DOJO VESUBIE');
    const plan = planFfkImport([row({ clubEntity: '0060789 SHINSENGUMI DOJO VESUBIE', clubName: 'SHINSENGUMI DOJO VESUBIE' })], grid, ex);
    expect(plan.clubs[0]).toMatchObject({ certainty: 'sure', target: { clubId: 'c2' } });
  });
  test('choix explicite « nouveau club »', () => {
    const plan = planFfkImport([row()], grid, base(), { clubLinks: { '0060893 TANI DOJO': 'new' } });
    expect(plan.clubs[0]!.target).toEqual({ kind: 'new' });
  });
});

describe('combattants', () => {
  test('fiche « MARTIN Léa » ↔ FFK « MARTIN LEA », poids changé, règlement vide conservé', () => {
    const plan = planFfkImport([row({ weightLabel: '-61' })], grid, base());
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0]!;
    expect(item).toMatchObject({ kind: 'update', registrationId: 'r1', fighterId: 'f1', weightClassId: 'cadet:F:-61' });
    if (item.kind !== 'update') throw new Error();
    expect(item.changes).toContain('Poids : -54 → -61');
    expect(item.changes.join(' ')).not.toMatch(/Règlement/);
  });
  test('ordre inversé « LEA MARTIN » → sûr', () => {
    const plan = planFfkImport([row({ lastName: 'LEA', firstName: 'MARTIN' })], grid, base());
    expect(plan.items[0]).toMatchObject({ kind: 'update', registrationId: 'r1' });
  });
  test('même licence → sûr, même dans un autre club', () => {
    const ex = base();
    ex.fighters[0]!.licence = 'LIC';
    const plan = planFfkImport([row({ licence: 'LIC', lastName: 'AUTRE', firstName: 'NOM', clubEntity: '1 X', clubName: 'X' })], grid, ex);
    expect(plan.items[0]).toMatchObject({ kind: 'update', fighterId: 'f1' });
  });
  test('« MARTIN LENA » → douteux (même nom de famille)', () => {
    const plan = planFfkImport([row({ firstName: 'LENA' })], grid, base());
    const item = plan.items[0]!;
    expect(item.kind).toBe('doubtful');
    if (item.kind !== 'doubtful') throw new Error();
    expect(item.candidates[0]).toMatchObject({ fighterId: 'f1' });
    expect(item.candidates[0]!.reason).toContain('nom de famille');
    expect(plan.summary.doubtful).toBe(1);
  });
  test('homonymes dans le même club → douteux', () => {
    const ex = base();
    ex.fighters.push(fighter('f2', 'c1', 'MARTIN', 'Lea'));
    expect(planFfkImport([row()], grid, ex).items[0]!.kind).toBe('doubtful');
  });
  test('même nom dans un autre club → douteux', () => {
    const plan = planFfkImport([row({ clubEntity: '2 AUTRE', clubName: 'AUTRE' })], grid, base());
    expect(plan.items[0]!.kind).toBe('doubtful');
  });
  test('décisions explicites', () => {
    const r = row({ firstName: 'LENA' });
    expect(planFfkImport([r], grid, base(), { decisions: { [r.key]: 'new' } }).items[0]).toMatchObject({ kind: 'create', fighterId: 'new' });
    expect(planFfkImport([r], grid, base(), { decisions: { [r.key]: 'f1' } }).items[0]).toMatchObject({ kind: 'update', fighterId: 'f1' });
  });
  test('nouveau combattant', () => {
    const plan = planFfkImport([row({ lastName: 'NOUVEAU', firstName: 'X' })], grid, base());
    expect(plan.items[0]).toMatchObject({ kind: 'create', fighterId: 'new', weightClassId: 'cadet:F:-54' });
  });
  test('combattant connu, nouvelle discipline → création rattachée', () => {
    const plan = planFfkImport([row({ discipline: 'shido-boxing' })], grid, base());
    expect(plan.items[0]).toMatchObject({ kind: 'create', fighterId: 'f1' });
  });
});

describe('catégories, retraits, non confirmées, doublons', () => {
  test('catégorie inconnue créée', () => {
    const plan = planFfkImport([row({ lastName: 'P', ageBandCode: 'poussin', weightLabel: '-20' })], grid, base());
    expect(plan.newWeightClasses).toEqual([{ id: 'poussin:F:-20', ageBandCode: 'poussin', sex: 'F', label: '-20', maxKg: 20, sortOrder: 0 }]);
    expect(plan.items[0]).toMatchObject({ kind: 'create', weightClassId: 'poussin:F:-20' });
  });
  test('réimport : retrait limité aux inscriptions FFK des disciplines importées', () => {
    const ex: ExistingData = {
      clubs: [club('c1', 'Tani Dojo')],
      fighters: [fighter('a', 'c1', 'AAA', 'A', { licence: 'LA' }), fighter('b', 'c1', 'BBB', 'B', { licence: 'LB' }), fighter('x', 'c1', 'XXX', 'X', { licence: 'LX' })],
      registrations: [
        reg('ra', 'a', { source: 'ffk', ffkConfirmed: true }),
        reg('rb', 'b', { source: 'ffk', ffkConfirmed: true }),
        reg('rx', 'x', { source: 'ffk', ffkConfirmed: true, discipline: 'shido-boxing' }),
      ],
      aliases: {},
    };
    const plan = planFfkImport([row({ licence: 'LA', lastName: 'AAA', firstName: 'A' })], grid, ex);
    expect(plan.removals.map((r) => r.registrationId)).toEqual(['rb']);
    expect(plan.summary).toMatchObject({ update: 1, removals: 1 });
  });
  test('fiche club non retrouvée → non confirmée, jamais retirée', () => {
    const ex = base();
    ex.registrations[0]!.ffkConfirmed = true;
    const plan = planFfkImport([row({ lastName: 'AUTRE', firstName: 'X' })], grid, ex);
    expect(plan.removals).toEqual([]);
    expect(plan.unconfirmed.map((u) => u.registrationId)).toEqual(['r1']);
    expect(plan.unconfirmed[0]!.label).toContain('MARTIN');
  });
  test('même licence deux fois dans la même discipline → la seconde en erreur', () => {
    const plan = planFfkImport([row({ licence: 'L', lastName: 'N1' }), row({ licence: 'L', lastName: 'N1' })], grid, base());
    expect(plan.items.map((i) => i.kind)).toEqual(['create', 'error']);
    expect(plan.items[1]!.row.errors.join(' ')).toContain('double');
  });
  test('ligne en erreur → item error', () => {
    const plan = planFfkImport([row({ errors: ['x'] })], grid, base());
    expect(plan.items[0]!.kind).toBe('error');
    expect(plan.summary.errors).toBe(1);
  });
});

describe('corrections de la relecture', () => {
  test('ligne en erreur mais reconnue : l’inscription FFK n’est pas retirée', () => {
    const ex: ExistingData = {
      clubs: [club('c1', 'Tani Dojo')],
      fighters: [fighter('a', 'c1', 'AAA', 'A', { licence: 'LA' })],
      registrations: [reg('ra', 'a', { source: 'ffk', ffkConfirmed: true })],
      aliases: {},
    };
    const plan = planFfkImport([row({ licence: 'LA', lastName: 'AAA', firstName: 'A', errors: ['catégorie inconnue'] })], grid, ex);
    expect(plan.items[0]!.kind).toBe('error');
    expect(plan.removals).toEqual([]);
  });
  test('homonymes avec des licences différentes : jamais fusionnés', () => {
    const ex = base();
    ex.fighters[0]!.licence = 'L1';
    const plan = planFfkImport([row({ licence: 'L1' }), row({ licence: 'L9' })], grid, ex);
    expect(plan.items[0]).toMatchObject({ kind: 'update', fighterId: 'f1' });
    expect(plan.items[1]).toMatchObject({ kind: 'create', fighterId: 'new' });
  });
  test('même nom, deux licences différentes dans l’import, combattant sans licence : la seconde devient douteuse', () => {
    const plan = planFfkImport([row({ licence: 'L1' }), row({ licence: 'L9' })], grid, base());
    expect(plan.items[0]).toMatchObject({ kind: 'update', fighterId: 'f1' });
    expect(plan.items[1]!.kind).toBe('doubtful');
  });
  test('empreinte du plan : identique pour un même plan, différente sinon', () => {
    const r = row({ licence: 'X1' });
    const a = planFfkImport([r], grid, base());
    const b = planFfkImport([r], grid, base());
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(planFingerprint(planFfkImport([{ ...r, weightLabel: '-61' }], grid, base()))).not.toBe(planFingerprint(a));
  });
});

describe('corrections reportées (import FFK)', () => {
  test('deux entités FFK avec le même nom de club : remarque', () => {
    const plan = planFfkImport([row({ clubEntity: '001 SHIDOKAN', clubName: 'SHIDOKAN', lastName: 'A' }), row({ clubEntity: '002 SHIDOKAN', clubName: 'SHIDOKAN', lastName: 'B' })], grid, base());
    expect(plan.clubs.every((c) => c.warning?.includes('même nom'))).toBe(true);
  });
  test('décision vers un combattant déjà rapproché dans la même discipline : erreur', () => {
    const r1 = row({ licence: null });
    const r2 = row({ licence: null, lastName: 'AUTRE', firstName: 'X' });
    const plan = planFfkImport([r1, r2], grid, base(), { decisions: { [r2.key]: 'f1' } });
    expect(plan.items[0]).toMatchObject({ kind: 'update', fighterId: 'f1' });
    expect(plan.items[1]!.kind).toBe('error');
    expect(plan.items[1]!.row.errors.join(' ')).toContain('déjà');
  });
  test('ligne sans licence puis ligne avec licence pour le même combattant : pas de doute', () => {
    const plan = planFfkImport([row({ licence: null }), row({ licence: 'L77', discipline: 'shido-boxing' })], grid, base());
    expect(plan.items.map((i) => i.kind)).toEqual(['update', 'create']);
  });
});
