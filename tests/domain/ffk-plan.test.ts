import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { guessColumnMapping, parseFfkRows, type FfkRow } from '../../src/domain/ffk-import.js';
import type { ExistingFighter } from '../../src/domain/ffk-plan/cards.js';
import type { ExistingClub } from '../../src/domain/ffk-plan/clubs.js';
import { HOMONYM, planFfkCards, planFingerprint, type ExistingData, type FfkCardChoice } from '../../src/domain/ffk-plan/plan.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { FFK_HEADER } from '../helpers/ffk-fixture.js';

const grid = ffkDefaultGrid();
const TANI = '0060893 TANI DOJO';

const club = (id: string, name: string, ffkEntity: string | null = null): ExistingClub => ({ id, name, ffkEntity, affiliationNumber: null });
const line = (lastName: string, firstName: string, over: Partial<ClubFormLine> = {}): ClubFormLine => ({
  lastName, firstName, sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-54', weightKg: null, combats: ['karate'], kata: false,
  grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, licence: null, ...over,
});
function fighter(id: string, clubId: string | null, lastName: string, firstName: string, over: Omit<Partial<ExistingFighter>, 'line'> & { line?: Partial<ClubFormLine> } = {}): ExistingFighter {
  const { line: l, ...rest } = over;
  return {
    fighterId: id, clubId, licence: null, publicNameHidden: false, version: `${id}:1`, editable: true, partlyEditable: false,
    startedDisciplines: [], fromFfk: false, ...rest, line: line(lastName, firstName, { licence: rest.licence ?? null, ...l }),
  };
}
let n = 0;
function row(over: Partial<FfkRow> = {}): FfkRow {
  n++;
  return {
    key: `K#${n}`, sheet: 'Karate', line: n + 1, licence: `L${n}`, lastName: 'MARTIN', firstName: 'LEA',
    clubEntity: TANI, clubName: 'TANI DOJO', sex: 'F', ageBandCode: 'cadet', discipline: 'karate',
    ruleset: null, weightLabel: '-54', weightIssue: null, errors: [], warnings: [], ...over,
  };
}
const base = (): ExistingData => ({
  clubs: [club('c1', 'Tani Dojo'), club('c2', 'Shinsengumi')],
  fighters: [fighter('f1', 'c1', 'MARTIN', 'Léa')],
  aliases: {},
});
const cardOf = (plan: ReturnType<typeof planFfkCards>, r: FfkRow) => plan.cards.find((c) => c.rows.some((x) => x.key === r.key))!;

describe('états des cartes', () => {
  test('défaut : sûr sans écart = auto ; sûr avec écart = todo (fighterId null) ; sans candidat = auto « new »', () => {
    const ex = base();
    ex.fighters.push(fighter('f2', 'c1', 'DURAND', 'Zoé', { line: { ageBandCode: 'junior', weightClassId: 'junior:F:-59' } }));
    const sure = row();
    const differs = row({ lastName: 'DURAND', firstName: 'ZOE' });
    const fresh = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const plan = planFfkCards([sure, differs, fresh], grid, ex);

    expect(cardOf(plan, sure)).toMatchObject({ state: 'auto', fighterId: 'f1', diffs: [], missing: [], reason: null });
    expect(cardOf(plan, sure).value!.line.licence).toBe(sure.licence);
    expect(cardOf(plan, sure).changes).toEqual([`N° de licence : — → ${sure.licence}`]);

    const todo = cardOf(plan, differs);
    expect(todo).toMatchObject({ state: 'todo', fighterId: null, value: null, sure: 'f2', changes: [] });
    expect(todo.diffs.map((d) => d.field)).toEqual(['ageBandCode', 'weightClassId']);
    expect(todo.reason).toBe('reste à remplir : Catégorie d’âge, Catégorie de poids');

    expect(cardOf(plan, fresh)).toMatchObject({ state: 'auto', fighterId: 'new', changes: [], missing: [] });
    expect(cardOf(plan, fresh).value).toMatchObject({ clubId: 'c1', line: { lastName: 'NOUVEAU', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' } });
  });

  test('choix validé : done, value et changes du choix ; un fighterId choisi sans écart reste done', () => {
    const ex = base();
    ex.fighters.push(fighter('f2', 'c1', 'DURAND', 'Zoé', { line: { ageBandCode: 'junior', weightClassId: 'junior:F:-59' } }));
    const sure = row();
    const differs = row({ lastName: 'DURAND', firstName: 'ZOE' });
    const gone = row({ lastName: 'PARTI', firstName: 'Y' });
    const fresh = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const keyOf = (r: FfkRow) => `L:${r.licence}`;
    const chosen = { line: line('DURAND', 'Zoé', { licence: differs.licence }), clubId: 'c1', publicNameHidden: false };
    const cards: Record<string, FfkCardChoice> = {
      [keyOf(differs)]: { kind: 'validated', fighterId: 'f2', value: chosen },
      [keyOf(sure)]: { kind: 'validated', fighterId: 'f1', value: { line: line('MARTIN', 'Léa', { licence: sure.licence }), clubId: 'c1', publicNameHidden: false } },
      [keyOf(gone)]: { kind: 'validated', fighterId: 'f-supprimé', value: chosen },
      [keyOf(fresh)]: { kind: 'validated', fighterId: 'new', value: { line: line('NOUVEAU', 'Xavier', { licence: fresh.licence }), clubId: 'c1', publicNameHidden: true } },
    };
    const plan = planFfkCards([sure, differs, gone, fresh], grid, ex, { cards });

    expect(cardOf(plan, differs)).toMatchObject({ state: 'done', fighterId: 'f2', value: chosen, reason: null });
    expect(cardOf(plan, differs).changes).toEqual([
      'Catégorie d’âge : Juniors → Cadets',
      'Catégorie de poids : -59 kg → -54 kg',
      `N° de licence : — → ${differs.licence}`,
    ]);
    expect(cardOf(plan, differs).diffs.map((d) => d.field)).toEqual(['ageBandCode', 'weightClassId']);
    expect(cardOf(plan, sure)).toMatchObject({ state: 'done', fighterId: 'f1' });
    expect(cardOf(plan, gone)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason: 'combattant introuvable' });
    expect(cardOf(plan, fresh)).toMatchObject({ state: 'done', fighterId: 'new', changes: [], value: { publicNameHidden: true, line: { firstName: 'Xavier' } } });
  });

  test('choix validé incomplet : laissé de côté avec ce qui manque', () => {
    const r = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const value = { line: line('NOUVEAU', 'X', { ageBandCode: null }), clubId: null, publicNameHidden: false };
    const plan = planFfkCards([r], grid, base(), { cards: { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'new', value } } });
    expect(plan.cards[0]).toMatchObject({ state: 'todo', fighterId: null, value: null, missing: ['Catégorie d’âge', 'Club'], reason: 'reste à remplir : Catégorie d’âge, Club' });
  });

  test('choix validé avec une catégorie de poids hors grille (décochée après validation) ou un club inconnu : à trancher, jamais écrit', () => {
    const r = row({ lastName: 'PETIT', firstName: 'P', ageBandCode: 'poussin', weightLabel: '-20' });
    const value = { line: line('PETIT', 'P', { ageBandCode: 'poussin', weightClassId: 'poussin:F:-20', licence: r.licence }), clubId: 'c1', publicNameHidden: false };
    const cards = { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'new', value } as FfkCardChoice };
    expect(planFfkCards([r], grid, base(), { cards, acceptedWeightClasses: ['poussin:F:-20'] }).cards[0]).toMatchObject({ state: 'done', fighterId: 'new' });
    const unticked = planFfkCards([r], grid, base(), { cards });
    expect(unticked.cards[0]).toMatchObject({ state: 'todo', fighterId: null, value: null, reason: 'catégorie de poids absente de la grille' });
    expect(unticked.summary).toMatchObject({ todo: 1, done: 0, creates: 0 });
    // Une catégorie de la grille passe ; un club qui n'est pas dans la compétition, non.
    const inGrid = { ...value, line: { ...value.line, ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' } };
    expect(planFfkCards([r], grid, base(), { cards: { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'new', value: inGrid } } }).cards[0]!.state).toBe('done');
    const ghost = planFfkCards([r], grid, base(), { cards: { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'new', value: { ...inGrid, clubId: 'c-supprimé' } } } });
    expect(ghost.cards[0]).toMatchObject({ state: 'todo', value: null, reason: 'club introuvable' });
  });

  test('homonymes (même nom, même sexe, même club) : aucune carte écrite qui créerait un doublon, laissées de côté', () => {
    // Deux licences différentes, même nom : deux nouveaux combattants qui ne peuvent coexister dans le club.
    const a = row({ licence: 'A1', lastName: 'HOMO', firstName: 'NYME' });
    const b = row({ licence: 'A2', lastName: 'HOMO', firstName: 'NYME' });
    const other = row({ licence: 'A3', lastName: 'HOMO', firstName: 'NYME', sex: 'M', weightLabel: '-52' }); // autre sexe : pas un doublon
    const plan = planFfkCards([a, b, other], grid, base());
    const reason = 'même nom qu’un autre combattant du club : changez le nom ou liez-le';
    expect(cardOf(plan, a)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason });
    expect(cardOf(plan, b)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason });
    expect(cardOf(plan, other)).toMatchObject({ state: 'auto', fighterId: 'new' });
    expect(plan.summary).toMatchObject({ todo: 2, auto: 1, creates: 1 });

    // Nouveau combattant validé au nom d’une fiche existante du club (non retenue par une carte) : à trancher, la fiche reste orpheline.
    const c = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const value = { line: line('MARTIN', 'Lea', { licence: c.licence }), clubId: 'c1', publicNameHidden: false };
    const clash = planFfkCards([c], grid, base(), { cards: { [`L:${c.licence}`]: { kind: 'validated', fighterId: 'new', value } } });
    expect(clash.cards[0]).toMatchObject({ state: 'todo', value: null, reason });
    // Le même nom dans un autre club : écrit.
    const elsewhere = planFfkCards([c], grid, base(), { cards: { [`L:${c.licence}`]: { kind: 'validated', fighterId: 'new', value: { ...value, clubId: 'c2' } } } });
    expect(elsewhere.cards[0]).toMatchObject({ state: 'done', fighterId: 'new' });
    // Une carte qui écrit sa propre fiche sans changer de nom n’est pas un doublon d’elle-même.
    expect(planFfkCards([row()], grid, base()).cards[0]).toMatchObject({ state: 'auto', fighterId: 'f1' });
  });

  test('none et skip : todo / skip, rien importé', () => {
    const a = row();
    const b = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const plan = planFfkCards([a, b], grid, base(), { cards: { [`L:${a.licence}`]: { kind: 'none' }, [`L:${b.licence}`]: { kind: 'skip' } } });
    expect(cardOf(plan, a)).toMatchObject({ state: 'todo', fighterId: null, value: null, changes: [], reason: 'combattant pas choisi', sure: 'f1' });
    expect(cardOf(plan, b)).toMatchObject({ state: 'skip', fighterId: null, value: null, changes: [], reason: null });
    expect(plan.summary).toMatchObject({ todo: 1, skip: 1, auto: 0, done: 0, creates: 0, updates: 0 });
  });

  test('catégorie acceptée : la carte au poids -20 passe de todo à auto', () => {
    const r = row({ lastName: 'PETIT', firstName: 'P', ageBandCode: 'poussin', weightLabel: '-20' });
    const before = planFfkCards([r], grid, base());
    expect(before.weightClasses).toEqual([{ id: 'poussin:F:-20', ageBandCode: 'poussin', sex: 'F', label: '-20', maxKg: 20, sortOrder: 0, rows: 1, fighters: 1, accepted: false }]);
    expect(before.cards[0]).toMatchObject({ state: 'todo', fighterId: null, missing: ['Catégorie de poids'] });
    const after = planFfkCards([r], grid, base(), { acceptedWeightClasses: ['poussin:F:-20'] });
    expect(after.weightClasses[0]!.accepted).toBe(true);
    expect(after.cards[0]).toMatchObject({ state: 'auto', fighterId: 'new', value: { line: { weightClassId: 'poussin:F:-20' } } });
  });

  test('club « none » : un nouveau combattant de ce club est todo « club pas relié » ; un existant sûr par licence reste auto (garde son club)', () => {
    const ex = base();
    ex.fighters.push(fighter('f3', 'c1', 'BERNARD', 'Ana', { licence: 'LIC' }));
    const fresh = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const known = row({ licence: 'LIC', lastName: 'BERNARD', firstName: 'ANA' });
    const plan = planFfkCards([fresh, known], grid, ex, { clubLinks: { [TANI]: 'none' } });
    expect(plan.clubs[0]).toMatchObject({ target: null, chosen: true });
    expect(cardOf(plan, fresh)).toMatchObject({ state: 'todo', fighterId: null, reason: 'club pas relié' });
    expect(cardOf(plan, known)).toMatchObject({ state: 'auto', fighterId: 'f3', value: { clubId: 'c1' }, changes: [] });
    expect(plan.summary.clubsTodo).toBe(1);
  });

  test('ligne illisible d’un combattant reconnu : à trancher, jamais importée d’office', () => {
    const r = row({ errors: ['Discipline incompréhensible : « Judo ».'] });
    const plan = planFfkCards([r], grid, base());
    expect(plan.cards[0]).toMatchObject({ state: 'todo', fighterId: null, sure: 'f1', reason: 'ligne à vérifier : Discipline incompréhensible : « Judo ».' });
    expect(plan.orphans).toEqual([]);
  });

  test('un combattant retenu par deux cartes : le choix validé l’emporte, l’autre carte est à trancher', () => {
    const a = row({ licence: null });
    const b = row({ licence: null, lastName: 'AUTRE', firstName: 'X' });
    const value = { line: line('MARTIN', 'Léa'), clubId: 'c1', publicNameHidden: false };
    const plan = planFfkCards([a, b], grid, base(), { cards: { [`N:AUTRE X|F|${TANI}`]: { kind: 'validated', fighterId: 'f1', value } } });
    expect(cardOf(plan, b)).toMatchObject({ state: 'done', fighterId: 'f1' });
    expect(cardOf(plan, a)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason: 'combattant déjà retenu par une autre carte' });
  });
});

describe('orphelins et récapitulatif', () => {
  test('orphelins : combattants sans carte ; candidats d’une carte todo exclus ; fromFfk pour une inscription ffk ; action par défaut keep', () => {
    const ex = base();
    ex.fighters.push(
      fighter('f2', 'c1', 'BERNARD', 'Léa'),
      fighter('f3', 'c1', 'ABSENT', 'Paul', { fromFfk: true, line: { combats: ['karate', 'shido-boxing'], kata: true } }),
      fighter('f4', null, 'SEUL', 'Jean'),
      fighter('f5', 'c1', 'CARON', 'Inès'),
    );
    const matched = row();
    const doubtful = row({ licence: null, lastName: 'BERNARD', firstName: 'LENA' });
    const skipped = row({ licence: null, lastName: 'CARON', firstName: 'INES' });
    const plan = planFfkCards([matched, doubtful, skipped], grid, ex, {
      cards: { [`N:CARON INES|F|${TANI}`]: { kind: 'skip' } },
      orphans: { f4: 'delete' },
    });
    expect(cardOf(plan, doubtful)).toMatchObject({ state: 'todo', candidates: [{ fighterId: 'f2', reason: 'même nom de famille, prénom différent' }] });
    expect(plan.orphans).toEqual([
      { fighterId: 'f3', label: 'ABSENT Paul', clubName: 'Tani Dojo', disciplines: 'Karaté, Shido-boxing, Kata', fromFfk: true, action: 'keep', deletable: true, version: 'f3:1' },
      { fighterId: 'f4', label: 'SEUL Jean', clubName: 'Sans club', disciplines: 'Karaté', fromFfk: false, action: 'delete', deletable: true, version: 'f4:1' },
    ]);
  });

  test('combattant choisi par la recherche d’une carte validée retombée à trancher : jamais orphelin', () => {
    const ex = base();
    ex.fighters.push(fighter('f9', 'c2', 'LOIN', 'Paula')); // ni candidat, ni rapproché
    const r = row({ lastName: 'PETIT', firstName: 'P', ageBandCode: 'poussin', weightLabel: '-20' });
    const value = { line: line('LOIN', 'Paula', { ageBandCode: 'poussin', weightClassId: 'poussin:F:-20', licence: r.licence }), clubId: 'c2', publicNameHidden: false };
    const cards = { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'f9', value } as FfkCardChoice };
    // Catégorie cochée : la carte est validée, f9 retenu.
    expect(planFfkCards([r], grid, ex, { cards, acceptedWeightClasses: ['poussin:F:-20'] }).cards[0]).toMatchObject({ state: 'done', fighterId: 'f9' });
    // Décochée ensuite : la carte retombe à trancher, f9 n’est pas proposé à la suppression (ni passé non confirmé).
    const plan = planFfkCards([r], grid, ex, { cards, orphans: { f9: 'delete' } });
    expect(plan.cards[0]).toMatchObject({ state: 'todo', reason: 'catégorie de poids absente de la grille' });
    expect(plan.cards[0]!.candidates.map((c) => c.fighterId)).not.toContain('f9');
    expect(plan.orphans.map((o) => o.fighterId)).toEqual(['f1']);
    expect(plan.summary.deletes).toBe(0);
  });

  test('orphelin dont un combat a commencé : pas supprimable, un choix « delete » est ignoré (gardé)', () => {
    const ex = base();
    ex.fighters.push(
      fighter('f2', 'c1', 'COMMENCE', 'Ana', { partlyEditable: true, editable: false, startedDisciplines: ['karate'] }),
      fighter('f3', 'c1', 'LIBRE', 'Eve'),
    );
    const plan = planFfkCards([row()], grid, ex, { orphans: { f2: 'delete', f3: 'delete' } });
    expect(plan.orphans.map((o) => [o.fighterId, o.deletable, o.action])).toEqual([['f2', false, 'keep'], ['f3', true, 'delete']]);
    expect(plan.summary.deletes).toBe(1);
  });

  test('summary compte creates / updates / deletes / clubsTodo', () => {
    const ex = base();
    ex.fighters.push(fighter('f2', 'c1', 'DURAND', 'Zoé', { licence: 'LZ' }), fighter('f9', 'c2', 'ORPHELIN', 'O'));
    const plan = planFfkCards(
      [
        row(), // f1 : licence complétée → mise à jour
        row({ licence: 'LZ', lastName: 'DURAND', firstName: 'ZOE' }), // f2 : rien ne change
        row({ lastName: 'NOUVEAU', firstName: 'X' }), // création
        row({ lastName: 'AUTRE', firstName: 'Y', clubEntity: '0060999 NOUVEAU CLUB', clubName: 'NOUVEAU CLUB' }), // club pas relié
      ],
      grid, ex, { orphans: { f9: 'delete' } },
    );
    expect(plan.summary).toEqual({ todo: 1, auto: 3, done: 0, skip: 0, clubsTodo: 1, creates: 1, updates: 1, deletes: 1 });
  });

  test('empreinte stable pour le même plan, différente si une fiche change de version', () => {
    const rows = [row(), row({ lastName: 'NOUVEAU', firstName: 'X' })];
    const withOrphan = () => {
      const ex = base();
      ex.fighters.push(fighter('f9', 'c2', 'ORPHELIN', 'O'), fighter('f8', 'c2', 'GARDE', 'G'));
      return ex;
    };
    const choices = { orphans: { f9: 'delete' as const } };
    const a = planFingerprint(planFfkCards(rows, grid, withOrphan(), choices));
    expect(planFingerprint(planFfkCards(rows, grid, withOrphan(), { orphans: { f9: 'delete' } }))).toBe(a);

    const retainedChanged = withOrphan();
    retainedChanged.fighters[0] = { ...retainedChanged.fighters[0]!, version: 'f1:2' };
    expect(planFingerprint(planFfkCards(rows, grid, retainedChanged, choices))).not.toBe(a);

    const deletedChanged = withOrphan();
    deletedChanged.fighters[1] = { ...deletedChanged.fighters[1]!, version: 'f9:2' };
    expect(planFingerprint(planFfkCards(rows, grid, deletedChanged, choices))).not.toBe(a);

    // Un orphelin gardé n’est pas écrit : sa version n’entre pas dans l’empreinte.
    const keptChanged = withOrphan();
    keptChanged.fighters[2] = { ...keptChanged.fighters[2]!, version: 'f8:2' };
    expect(planFingerprint(planFfkCards(rows, grid, keptChanged, choices))).toBe(a);

    expect(planFingerprint(planFfkCards(rows, grid, withOrphan()))).not.toBe(a);
  });
});

describe('rapprochements (repris de l’ancien plan)', () => {
  test('clubs : nom égal → relié ; contenu → proposé, pas relié ; inconnu ; alias → relié ; entité déjà enregistrée → relié', () => {
    const ex = base();
    ex.clubs.push(club('c3', 'Issa'), club('c4', 'Autre nom', '0060111 DOJO ENREGISTRE'));
    ex.aliases = { ISSA: '0060808 ISSA KYOKUSHIN SCHOOL' };
    const plan = planFfkCards([
      row(),
      row({ clubEntity: '0060789 SHINSENGUMI DOJO VESUBIE', clubName: 'SHINSENGUMI DOJO VESUBIE', lastName: 'X', firstName: 'Y' }),
      row({ clubEntity: '0060999 NOUVEAU CLUB', clubName: 'NOUVEAU CLUB', lastName: 'Z', firstName: 'W' }),
      row({ clubEntity: '0060808 ISSA KYOKUSHIN SCHOOL', clubName: 'ISSA KYOKUSHIN SCHOOL', lastName: 'Q', firstName: 'R' }),
      row({ clubEntity: '0060111 DOJO ENREGISTRE', clubName: 'DOJO ENREGISTRE', lastName: 'S', firstName: 'T' }),
    ], grid, ex);
    const link = (e: string) => plan.clubs.find((c) => c.clubEntity === e)!;
    expect(link(TANI)).toMatchObject({ target: 'c1', proposal: { certainty: 'sure' }, rows: 1 });
    expect(link('0060789 SHINSENGUMI DOJO VESUBIE')).toMatchObject({ target: null, proposal: { clubId: 'c2', certainty: 'doubtful' } });
    expect(link('0060999 NOUVEAU CLUB')).toMatchObject({ target: null, proposal: null });
    expect(link('0060808 ISSA KYOKUSHIN SCHOOL')).toMatchObject({ target: 'c3' });
    expect(link('0060111 DOJO ENREGISTRE')).toMatchObject({ target: 'c4' });
    expect(plan.summary.clubsTodo).toBe(2);
  });

  test('deux entités FFK avec le même nom de club : remarque', () => {
    const plan = planFfkCards([row({ clubEntity: '001 SHIDOKAN', clubName: 'SHIDOKAN', lastName: 'A' }), row({ clubEntity: '002 SHIDOKAN', clubName: 'SHIDOKAN', lastName: 'B' })], grid, base());
    expect(plan.clubs.every((c) => c.warning?.includes('même nom'))).toBe(true);
  });

  test('ordre inversé « LEA MARTIN » → reconnu (sûr), mais nom et prénom à choisir', () => {
    const [card] = planFfkCards([row({ lastName: 'LEA', firstName: 'MARTIN' })], grid, base()).cards;
    expect(card).toMatchObject({ sure: 'f1', state: 'todo', fighterId: null });
    expect(card!.diffs.map((d) => d.field)).toEqual(['lastName', 'firstName']);
  });

  test('même licence, autre nom : candidat sûr, mais le nom diffère → à trancher', () => {
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { licence: 'LIC' });
    const [card] = planFfkCards([row({ licence: 'LIC', lastName: 'AUTRE', firstName: 'NOM', clubEntity: '1 X', clubName: 'X' })], grid, ex).cards;
    expect(card).toMatchObject({ sure: 'f1', state: 'todo', fighterId: null, candidates: [{ fighterId: 'f1', reason: 'même licence' }] });
    expect(card!.diffs.map((d) => d.field)).toEqual(['lastName', 'firstName']);
  });

  test('« MARTIN LENA », homonymes, même nom dans un autre club : à trancher', () => {
    const lena = planFfkCards([row({ firstName: 'LENA' })], grid, base()).cards[0]!;
    expect(lena).toMatchObject({ state: 'todo', reason: 'combattant pas choisi', candidates: [{ fighterId: 'f1' }] });
    expect(lena.candidates[0]!.reason).toContain('nom de famille');
    const ex = base();
    ex.fighters.push(fighter('f2', 'c1', 'MARTIN', 'Lea'));
    expect(planFfkCards([row()], grid, ex).cards[0]).toMatchObject({ state: 'todo', candidates: [{ reason: 'homonymes dans le même club' }, { reason: 'homonymes dans le même club' }] });
    expect(planFfkCards([row({ clubEntity: '0060789 SHINSENGUMI DOJO VESUBIE', clubName: 'SHINSENGUMI DOJO VESUBIE' })], grid, base(), { clubLinks: { '0060789 SHINSENGUMI DOJO VESUBIE': 'c2' } }).cards[0])
      .toMatchObject({ state: 'todo', candidates: [{ fighterId: 'f1', reason: 'même nom, autre club' }] });
  });

  test('homonymes avec des licences différentes : jamais fusionnés', () => {
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { licence: 'L1' });
    const plan = planFfkCards([row({ licence: 'L1' }), row({ licence: 'L9' })], grid, ex);
    // Le second ne peut pas être créé dans le même club sous le même nom (l’enregistrement le refuserait) : laissé de côté.
    expect(plan.cards.map((c) => [c.state, c.fighterId, c.reason])).toEqual([['auto', 'f1', null], ['todo', null, HOMONYM]]);
  });

  test('même nom, deux licences dans l’import, combattant sans licence : la seconde est à trancher', () => {
    const plan = planFfkCards([row({ licence: 'L1' }), row({ licence: 'L9' })], grid, base());
    expect(plan.cards.map((c) => [c.state, c.fighterId])).toEqual([['auto', 'f1'], ['todo', null]]);
  });

  test('même club, même nom, autre licence enregistrée : à trancher, jamais un nouveau en silence', () => {
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { licence: '11000001A' });
    expect(planFfkCards([row({ licence: '11462640R' })], grid, ex).cards[0]).toMatchObject({ state: 'todo', candidates: [{ fighterId: 'f1', reason: 'même nom, autre licence' }] });
    expect(planFfkCards([row({ licence: '11462640R', lastName: 'NOUVEAU', firstName: 'X' })], grid, ex).cards[0]).toMatchObject({ state: 'auto', fighterId: 'new' });
  });

  test('licence de l’export « 1146 2640 r » ↔ licence enregistrée 11462640R : rapprochés', () => {
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { licence: '11462640R' });
    const [r] = parseFfkRows([FFK_HEADER, ['MARTIN LEA', null, '1146 2640 r', TANI, 'Feminine', 'Karate', 'Cadet', -54, null]], 0, guessColumnMapping(FFK_HEADER), 'Karate', grid);
    expect(planFfkCards([r!], grid, ex).cards[0]).toMatchObject({ sure: 'f1', state: 'auto', fighterId: 'f1' });
  });

  test('ligne sans licence puis ligne avec licence (autre discipline) du même combattant : la seconde n’est pas importée d’office', () => {
    const plan = planFfkCards([row({ licence: null }), row({ licence: 'L77', discipline: 'shido-boxing' })], grid, base());
    expect(plan.cards.map((c) => [c.state, c.fighterId])).toEqual([['auto', 'f1'], ['todo', null]]);
  });
});

describe('nombre de combattants par club', () => {
  test('un combattant sur deux lignes compte une fois ; les lignes restent comptées', () => {
    const karate = row({ licence: 'Y1', discipline: 'karate' });
    const kata = row({ licence: 'Y1', discipline: 'kata', weightLabel: null });
    const other = row({ licence: 'Y2', lastName: 'AUTRE', firstName: 'B' });
    expect(planFfkCards([karate, kata], grid, base()).clubs[0]).toMatchObject({ clubEntity: TANI, rows: 2, fighters: 1 });
    expect(planFfkCards([karate, kata, other], grid, base()).clubs[0]).toMatchObject({ rows: 3, fighters: 2 });
  });
});
