import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { guessColumnMapping, parseFfkRows, type FfkRow } from '../../src/domain/ffk-import.js';
import type { ExistingFighter } from '../../src/domain/ffk-plan/cards.js';
import type { ExistingClub } from '../../src/domain/ffk-plan/clubs.js';
import { HOMONYM, NEW_FIGHTER, planFfkCards, planFingerprint, type ExistingData, type FfkCardChoice } from '../../src/domain/ffk-plan/plan.js';
import type { CompetitionRules } from '../../src/domain/ffk-plan/rules.js';
import { initialValue } from '../../src/domain/ffk-plan/values.js';
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
  // Règles permissives : seuls les tests des dérogations les resserrent.
  rules: { multipleCombats: true, closed: new Set() },
});
const cardOf = (plan: ReturnType<typeof planFfkCards>, r: FfkRow) => plan.cards.find((c) => c.rows.some((x) => x.key === r.key))!;

describe('états des cartes', () => {
  test('défaut : sûr sans écart = auto ; sûr avec écart = todo (fighterId null) ; sans candidat = todo « nouveau combattant »', () => {
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

    // Nouveau combattant : jamais créé d’office (« Ne pas lier pour l’instant »), créé une fois la carte validée.
    expect(cardOf(plan, fresh)).toMatchObject({ state: 'todo', fighterId: null, value: null, changes: [], missing: [], newFighter: true, reason: NEW_FIGHTER });
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
      [keyOf(differs)]: { kind: 'validated', fighterId: 'f2', value: chosen, version: 'f2:1' },
      [keyOf(sure)]: { kind: 'validated', fighterId: 'f1', value: { line: line('MARTIN', 'Léa', { licence: sure.licence }), clubId: 'c1', publicNameHidden: false }, version: 'f1:1' },
      [keyOf(gone)]: { kind: 'validated', fighterId: 'f-supprimé', value: chosen, version: 'f-supprimé:1' },
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
    expect(cardOf(plan, gone)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason: 'combattant introuvable', rejected: true });
    expect(cardOf(plan, differs).rejected).toBe(false);
    expect(cardOf(plan, fresh)).toMatchObject({ state: 'done', fighterId: 'new', changes: [], value: { publicNameHidden: true, line: { firstName: 'Xavier' } } });
  });

  test('choix validé incomplet : laissé de côté avec ce qui manque', () => {
    const r = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const value = { line: line('NOUVEAU', 'X', { ageBandCode: null }), clubId: null, publicNameHidden: false };
    const plan = planFfkCards([r], grid, base(), { cards: { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'new', value } } });
    expect(plan.cards[0]).toMatchObject({ state: 'todo', fighterId: null, value: null, missing: ['Catégorie d’âge', 'Club'], reason: 'reste à remplir : Catégorie d’âge, Club', rejected: true });
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
    expect(ghost.cards[0]).toMatchObject({ state: 'todo', value: null, reason: 'club introuvable', rejected: true });
  });

  test('homonymes (même nom, même sexe, même club) : aucune carte écrite qui créerait un doublon, laissées de côté', () => {
    // Deux licences différentes, même nom : deux nouveaux combattants qui ne peuvent coexister dans le club.
    const a = row({ licence: 'A1', lastName: 'HOMO', firstName: 'NYME' });
    const b = row({ licence: 'A2', lastName: 'HOMO', firstName: 'NYME' });
    const other = row({ licence: 'A3', lastName: 'HOMO', firstName: 'NYME', sex: 'M', weightLabel: '-52' }); // autre sexe : pas un doublon
    const reason = 'même nom qu’un autre combattant du club : changez le nom ou liez-le';
    // Nouveaux combattants : jamais créés d’office ; validés tous les deux, ils ne peuvent coexister dans le club.
    expect(planFfkCards([a, b, other], grid, base()).cards.map((c) => c.reason)).toEqual([NEW_FIGHTER, NEW_FIGHTER, NEW_FIGHTER]);
    const created = (r: FfkRow) => ({ kind: 'validated', fighterId: 'new', value: { line: line(r.lastName, r.firstName, { sex: r.sex, licence: r.licence, ...(r.sex === 'M' ? { weightClassId: 'cadet:M:-52' } : {}) }), clubId: 'c1', publicNameHidden: false } }) as FfkCardChoice;
    const plan = planFfkCards([a, b, other], grid, base(), { cards: { 'L:A1': created(a), 'L:A2': created(b), 'L:A3': created(other) } });
    expect(cardOf(plan, a)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason, rejected: true });
    expect(cardOf(plan, b)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason, rejected: true });
    expect(cardOf(plan, other)).toMatchObject({ state: 'done', fighterId: 'new' });
    expect(plan.summary).toMatchObject({ todo: 2, done: 1, creates: 1 });
    // Un seul des deux validé : l’autre n’est pas écrit, pas de doublon, la carte validée passe.
    expect(planFfkCards([a, b], grid, base(), { cards: { 'L:A1': created(a) } }).cards.map((c) => [c.state, c.reason])).toEqual([['done', null], ['todo', NEW_FIGHTER]]);

    // Nouveau combattant validé au nom d’une fiche existante du club (non retenue par une carte) : à trancher, la fiche reste orpheline.
    const c = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const value = { line: line('MARTIN', 'Lea', { licence: c.licence }), clubId: 'c1', publicNameHidden: false };
    const clash = planFfkCards([c], grid, base(), { cards: { [`L:${c.licence}`]: { kind: 'validated', fighterId: 'new', value } } });
    expect(clash.cards[0]).toMatchObject({ state: 'todo', value: null, reason, rejected: true });
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
    expect(cardOf(plan, a)).toMatchObject({ state: 'todo', fighterId: null, value: null, changes: [], reason: 'combattant pas choisi', sure: 'f1', rejected: false });
    expect(cardOf(plan, b)).toMatchObject({ state: 'skip', fighterId: null, value: null, changes: [], reason: null });
    expect(plan.summary).toMatchObject({ todo: 1, skip: 1, auto: 0, done: 0, creates: 0, updates: 0 });
  });

  test('catégorie acceptée : la carte au poids -20 n’a plus de poids à choisir (reste un nouveau combattant à valider)', () => {
    const r = row({ lastName: 'PETIT', firstName: 'P', ageBandCode: 'poussin', weightLabel: '-20' });
    const before = planFfkCards([r], grid, base());
    expect(before.weightClasses).toEqual([{ id: 'poussin:F:-20', ageBandCode: 'poussin', sex: 'F', label: '-20', maxKg: 20, sortOrder: 0, rows: 1, fighters: 1, accepted: false }]);
    expect(before.cards[0]).toMatchObject({ state: 'todo', fighterId: null, missing: ['Catégorie de poids'] });
    const after = planFfkCards([r], grid, base(), { acceptedWeightClasses: ['poussin:F:-20'] });
    expect(after.weightClasses[0]!.accepted).toBe(true);
    expect(after.cards[0]).toMatchObject({ state: 'todo', fighterId: null, missing: [], reason: NEW_FIGHTER });
    expect(initialValue(after.cards[0]!, null).line.weightClassId).toBe('poussin:F:-20');
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
    const plan = planFfkCards([a, b], grid, base(), { cards: { [`N:AUTRE X|F|${TANI}`]: { kind: 'validated', fighterId: 'f1', value, version: 'f1:1' } } });
    expect(cardOf(plan, b)).toMatchObject({ state: 'done', fighterId: 'f1', rejected: false });
    // La carte rapprochée d’office cède la place : pas un choix validé refusé.
    expect(cardOf(plan, a)).toMatchObject({ state: 'todo', fighterId: null, value: null, reason: 'combattant déjà retenu par une autre carte', rejected: false });
  });
});

describe('choix validé : version de la fiche et écriture vérifiées par le plan', () => {
  const differs = () => row({ lastName: 'DURAND', firstName: 'ZOE' });
  const withDurand = (version = 'f2:1') => {
    const ex = base();
    ex.fighters.push(fighter('f2', 'c1', 'DURAND', 'Zoé', { version, line: { ageBandCode: 'junior', weightClassId: 'junior:F:-59' } }));
    return ex;
  };
  const durandValue = (r: FfkRow) => ({ line: line('DURAND', 'Zoé', { licence: r.licence }), clubId: 'c1', publicNameHidden: false });

  test('fiche modifiée depuis la validation (autre version) : à trancher, « revalidez la carte », signalée comme rejet', () => {
    const r = differs();
    const choice = (version?: string): FfkCardChoice => ({ kind: 'validated', fighterId: 'f2', value: durandValue(r), ...(version ? { version } : {}) });
    expect(cardOf(planFfkCards([r], grid, withDurand(), { cards: { [`L:${r.licence}`]: choice('f2:1') } }), r)).toMatchObject({ state: 'done', fighterId: 'f2', rejected: false, version: 'f2:1' });
    const stale = cardOf(planFfkCards([r], grid, withDurand('f2:2'), { cards: { [`L:${r.licence}`]: choice('f2:1') } }), r);
    expect(stale).toMatchObject({ state: 'todo', fighterId: null, value: null, version: null, rejected: true, reason: 'fiche modifiée depuis la validation : revalidez la carte' });
    expect(stale.diffs.map((d) => d.field)).toEqual(['ageBandCode', 'weightClassId']);
    // Sans version pour une fiche existante : jamais écrite à l’aveugle.
    expect(cardOf(planFfkCards([r], grid, withDurand(), { cards: { [`L:${r.licence}`]: choice() } }), r)).toMatchObject({ state: 'todo', rejected: true });
  });

  test('règlement shobu chez un mineur (rapprochement d’office ou carte validée) : à trancher avec l’erreur de l’enregistrement, jamais écrit', () => {
    const fresh = row({ lastName: 'NOUVEAU', firstName: 'X', ruleset: 'shobu' });
    const auto = planFfkCards([fresh], grid, base());
    expect(auto.cards[0]).toMatchObject({ state: 'todo', fighterId: null, value: null, rejected: false, reason: 'le Shobu ippon kumite est réservé aux adultes (Cadets)' });
    expect(auto.summary).toMatchObject({ todo: 1, auto: 0, creates: 0 });
    const value = { line: line('NOUVEAU', 'X', { ruleset: 'shobu', licence: fresh.licence }), clubId: 'c1', publicNameHidden: false };
    const validated = planFfkCards([fresh], grid, base(), { cards: { [`L:${fresh.licence}`]: { kind: 'validated', fighterId: 'new', value } } });
    expect(validated.cards[0]).toMatchObject({ state: 'todo', rejected: true, reason: 'le Shobu ippon kumite est réservé aux adultes (Cadets)' });
  });

  test('combats commencés : un club donné à un combattant sans club, ou une discipline commencée retirée, est refusé ; le reste passe', () => {
    const ex = base();
    ex.fighters.push(fighter('f2', null, 'SANSCLUB', 'Ana', { licence: 'LX', editable: false, partlyEditable: false, startedDisciplines: ['karate'] }));
    const r = row({ licence: 'LX', lastName: 'SANSCLUB', firstName: 'ANA' });
    // Rapprochée à sa licence, la carte lui donnerait le club de l’export : l’enregistrement le refuserait (club verrouillé).
    expect(cardOf(planFfkCards([r], grid, ex), r)).toMatchObject({ state: 'todo', fighterId: null, rejected: false, reason: 'combats commencés : le club ne change plus' });

    const started = base();
    started.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { editable: false, partlyEditable: true, startedDisciplines: ['karate'] });
    const m = row({ discipline: 'kata', weightLabel: null });
    const kataOnly = { line: line('MARTIN', 'Léa', { combats: [], kata: true, weightClassId: null, ruleset: null, licence: m.licence }), clubId: 'c1', publicNameHidden: false };
    const removed = planFfkCards([m], grid, started, { cards: { [`L:${m.licence}`]: { kind: 'validated', fighterId: 'f1', value: kataOnly, version: 'f1:1' } } });
    expect(removed.cards[0]).toMatchObject({ state: 'todo', rejected: true, reason: 'karaté : commencé, ne se retire pas' });
    // Karaté gardé, kata ajouté, poids hors de la tranche : ce qui a commencé reste tel quel à l’écriture, la carte passe.
    const both = { ...kataOnly, line: { ...kataOnly.line, combats: ['karate' as const], weightClassId: 'junior:F:-59', ruleset: 'jiyu' as const } };
    expect(planFfkCards([m], grid, started, { cards: { [`L:${m.licence}`]: { kind: 'validated', fighterId: 'f1', value: both, version: 'f1:1' } } }).cards[0])
      .toMatchObject({ state: 'done', rejected: false });
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
    const cards = { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'f9', value, version: 'f9:1' } as FfkCardChoice };
    // Catégorie cochée : la carte est validée, f9 retenu.
    expect(planFfkCards([r], grid, ex, { cards, acceptedWeightClasses: ['poussin:F:-20'] }).cards[0]).toMatchObject({ state: 'done', fighterId: 'f9' });
    // Décochée ensuite : la carte retombe à trancher, f9 n’est pas proposé à la suppression (ni passé non confirmé).
    const plan = planFfkCards([r], grid, ex, { cards, orphans: { f9: 'delete' } });
    expect(plan.cards[0]).toMatchObject({ state: 'todo', reason: 'catégorie de poids absente de la grille' });
    expect(plan.cards[0]!.candidates.map((c) => c.fighterId)).not.toContain('f9');
    expect(plan.orphans.map((o) => o.fighterId)).toEqual(['f1']);
    expect(plan.summary.deletes).toBe(0);
  });

  test('combattant choisi sur une carte pas encore validée (« Rapprocher… », recherche) : jamais orphelin, ses inscriptions ne changent pas', () => {
    const ex = base();
    ex.fighters.push(fighter('f9', 'c2', 'LOIN', 'Paula'));
    const r = row({ lastName: 'PETIT', firstName: 'P' });
    expect(planFfkCards([r], grid, ex).orphans.map((o) => o.fighterId)).toEqual(['f1', 'f9']);
    const plan = planFfkCards([r], grid, ex, { cards: { [`L:${r.licence}`]: { kind: 'none', fighterId: 'f9' } }, orphans: { f9: 'delete' } });
    expect(plan.cards[0]).toMatchObject({ state: 'todo', reason: 'combattant pas choisi' });
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
        row({ lastName: 'NOUVEAU', firstName: 'X', licence: 'LX' }), // création (carte validée)
        row({ lastName: 'AUTRE', firstName: 'Y', clubEntity: '0060999 NOUVEAU CLUB', clubName: 'NOUVEAU CLUB' }), // club pas relié
        row({ lastName: 'ENCORE', firstName: 'Z' }), // nouveau combattant pas validé
      ],
      grid, ex, { orphans: { f9: 'delete' }, cards: { 'L:LX': { kind: 'validated', fighterId: 'new', value: { line: line('NOUVEAU', 'X', { licence: 'LX' }), clubId: 'c1', publicNameHidden: false } } } },
    );
    expect(plan.summary).toEqual({ todo: 2, auto: 2, done: 1, skip: 0, clubsTodo: 1, creates: 1, updates: 1, deletes: 1 });
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
    // Le second est un nouveau combattant : jamais créé d’office ; validé, il ne peut pas l’être dans le même club sous le même nom.
    expect(plan.cards.map((c) => [c.state, c.fighterId, c.reason])).toEqual([['auto', 'f1', null], ['todo', null, NEW_FIGHTER]]);
    const value = { line: line('MARTIN', 'Lea', { licence: 'L9' }), clubId: 'c1', publicNameHidden: false };
    const validated = planFfkCards([row({ licence: 'L1' }), row({ licence: 'L9' })], grid, ex, { cards: { 'L:L9': { kind: 'validated', fighterId: 'new', value } } });
    expect(validated.cards.map((c) => [c.state, c.fighterId, c.reason])).toEqual([['auto', 'f1', null], ['todo', null, HOMONYM]]);
  });

  test('même nom, deux licences dans l’import, combattant sans licence : la seconde est à trancher', () => {
    const plan = planFfkCards([row({ licence: 'L1' }), row({ licence: 'L9' })], grid, base());
    expect(plan.cards.map((c) => [c.state, c.fighterId])).toEqual([['auto', 'f1'], ['todo', null]]);
  });

  test('même club, même nom, autre licence enregistrée : à trancher, jamais un nouveau en silence', () => {
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { licence: '11000001A' });
    expect(planFfkCards([row({ licence: '11462640R' })], grid, ex).cards[0]).toMatchObject({ state: 'todo', candidates: [{ fighterId: 'f1', reason: 'même nom, autre licence' }] });
    expect(planFfkCards([row({ licence: '11462640R', lastName: 'NOUVEAU', firstName: 'X' })], grid, ex).cards[0]).toMatchObject({ state: 'todo', newFighter: true, reason: NEW_FIGHTER });
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

describe('nouveaux combattants et dérogations aux règles : « À trancher »', () => {
  const ruled = (over: Partial<CompetitionRules>, ex = base()): ExistingData => ({ ...ex, rules: { multipleCombats: false, closed: new Set(), ...over } });
  const validatedNew = (r: FfkRow, value: ReturnType<typeof initialValue>) => ({ cards: { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'new', value } as FfkCardChoice } });

  test('nouveau combattant (aucune fiche trouvée) : à trancher, « Ne pas lier » par défaut, avec la raison ; validé « ➕ Nouveau combattant » → créé', () => {
    const fresh = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const plan = planFfkCards([fresh], grid, base());
    expect(NEW_FIGHTER).toBe('nouveau combattant : vérifiez qu’il n’est pas déjà inscrit sous un autre nom');
    expect(plan.cards[0]).toMatchObject({ state: 'todo', fighterId: null, value: null, changes: [], newFighter: true, rejected: false, reason: NEW_FIGHTER });
    expect(plan.summary).toMatchObject({ todo: 1, auto: 0, creates: 0 });

    const validated = planFfkCards([fresh], grid, base(), validatedNew(fresh, initialValue(plan.cards[0]!, null)));
    expect(validated.cards[0]).toMatchObject({ state: 'done', fighterId: 'new', newFighter: true, reason: null, rejected: false });
    expect(validated.cards[0]!.value).toMatchObject({ clubId: 'c1', line: { lastName: 'NOUVEAU', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' } });
    expect(validated.summary).toMatchObject({ todo: 0, done: 1, creates: 1 });

    // Un combattant reconnu n’est pas « nouveau » ; un club pas relié non plus (rien ne peut être créé).
    expect(planFfkCards([row()], grid, base()).cards[0]).toMatchObject({ state: 'auto', fighterId: 'f1', newFighter: false });
    const unlinked = row({ lastName: 'AUTRE', firstName: 'Y', clubEntity: '0060999 NOUVEAU CLUB', clubName: 'NOUVEAU CLUB' });
    expect(planFfkCards([unlinked], grid, base()).cards[0]).toMatchObject({ state: 'todo', reason: 'club pas relié', newFighter: false });
  });

  test('premier import d’un club entier : une carte à trancher par combattant, rien créé d’office', () => {
    const ex = { ...base(), fighters: [] };
    const rows = [row({ lastName: 'UN', firstName: 'A' }), row({ lastName: 'DEUX', firstName: 'B' }), row({ lastName: 'TROIS', firstName: 'C', discipline: 'kata', weightLabel: null })];
    const plan = planFfkCards(rows, grid, ex);
    expect(plan.cards.map((c) => [c.state, c.fighterId, c.reason, c.newFighter])).toEqual(rows.map(() => ['todo', null, NEW_FIGHTER, true]));
    expect(plan.summary).toMatchObject({ todo: 3, auto: 0, creates: 0 });
  });

  test('plusieurs disciplines de combat alors que le réglage ne le permet pas : à trancher, la raison nomme la règle ; validée telle quelle → écrite', () => {
    const k = row({ lastName: 'NOUVEAU', firstName: 'X' });
    const b = row({ licence: k.licence, lastName: 'NOUVEAU', firstName: 'X', sheet: 'Boxe', discipline: 'shido-boxing' });
    const plan = planFfkCards([k, b], grid, ruled({ multipleCombats: false }));
    const reason = 'déroge aux règles : Une seule discipline de combat par combattant à cette compétition.';
    expect(plan.cards[0]).toMatchObject({ state: 'todo', fighterId: null, value: null, newFighter: true, rejected: false, reason });

    const value = initialValue(plan.cards[0]!, null);
    expect(value.line.combats).toEqual(['karate', 'shido-boxing']);
    // L’organisateur peut y déroger : la carte validée est acceptée, avec ses deux combats.
    const validated = planFfkCards([k, b], grid, ruled({ multipleCombats: false }), validatedNew(k, value));
    expect(validated.cards[0]).toMatchObject({ state: 'done', fighterId: 'new', reason: null, rejected: false });
    expect(validated.cards[0]!.value!.line.combats).toEqual(['karate', 'shido-boxing']);
    // Ou la corriger (une discipline décochée).
    const fixed = planFfkCards([k, b], grid, ruled({ multipleCombats: false }), validatedNew(k, { ...value, line: { ...value.line, combats: ['karate'] } }));
    expect(fixed.cards[0]).toMatchObject({ state: 'done', fighterId: 'new' });
    // Réglage activé : la dérogation n’en est pas une, la carte n’est à trancher que comme nouveau combattant.
    expect(planFfkCards([k, b], grid, ruled({ multipleCombats: true })).cards[0]).toMatchObject({ state: 'todo', reason: NEW_FIGHTER });
  });

  test('catégorie non ouverte : un rapprochement d’office qui y inscrirait le combattant est à trancher ; validé → écrit', () => {
    // Fiche sans règlement : l’export le complète (jiyu), ce qui l’inscrirait en Karaté jiyu, fermé chez les cadettes.
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { line: { ruleset: null } });
    const r = row({ ruleset: 'jiyu' });
    const closed = new Set(['cadet|F|karate|jiyu']);
    const plan = planFfkCards([r], grid, ruled({ multipleCombats: true, closed }, ex));
    expect(cardOf(plan, r)).toMatchObject({
      state: 'todo', fighterId: null, value: null, sure: 'f1', newFighter: false, rejected: false,
      reason: 'déroge aux règles : Catégorie non ouverte à cette compétition (Karaté jiyu).',
    });
    expect(plan.orphans).toEqual([]);
    const value = initialValue(cardOf(plan, r), ex.fighters[0]!);
    const validated = planFfkCards([r], grid, ruled({ multipleCombats: true, closed }, ex), { cards: { [`L:${r.licence}`]: { kind: 'validated', fighterId: 'f1', value, version: 'f1:1' } } });
    expect(cardOf(validated, r)).toMatchObject({ state: 'done', fighterId: 'f1', rejected: false, reason: null });
    // Sans case fermée : sans problème.
    expect(cardOf(planFfkCards([r], grid, ruled({ multipleCombats: true }, ex)), r)).toMatchObject({ state: 'auto', fighterId: 'f1' });
  });

  test('fiche qui déroge déjà de la même façon (exception acceptée) : pas signalée à chaque import ; une dérogation nouvelle l’est', () => {
    const ex = base();
    ex.fighters[0] = fighter('f1', 'c1', 'MARTIN', 'Léa', { licence: 'LM', line: { combats: ['karate', 'shido-boxing'] } });
    const k = row({ licence: 'LM' });
    const b = row({ licence: 'LM', sheet: 'Boxe', discipline: 'shido-boxing' });
    // Déjà inscrite en karaté et en boxing, dans une catégorie fermée : rien de nouveau, sans problème.
    const closed = new Set(['cadet|F|karate|jiyu', 'cadet|F|shido-boxing|jiyu']);
    expect(cardOf(planFfkCards([k, b], grid, ruled({ closed }, ex)), k)).toMatchObject({ state: 'auto', fighterId: 'f1', reason: null });

    // Un nouveau combattant aux mêmes valeurs, lui, est signalé (aucune fiche n’avait cette exception).
    const fresh = row({ lastName: 'NOUVEAU', firstName: 'X', licence: 'LN' });
    const freshB = row({ lastName: 'NOUVEAU', firstName: 'X', licence: 'LN', sheet: 'Boxe', discipline: 'shido-boxing' });
    const reasons = cardOf(planFfkCards([fresh, freshB], grid, ruled({ closed }, ex)), fresh).reason;
    expect(reasons).toBe('déroge aux règles : Une seule discipline de combat par combattant à cette compétition. Catégorie non ouverte à cette compétition (Karaté jiyu). Catégorie non ouverte à cette compétition (Shido-boxing jiyu).');
  });
});
