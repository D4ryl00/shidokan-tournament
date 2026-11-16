import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import type { ClubFormItem } from '../../src/domain/club-form-read.js';
import { planClubFormImport } from '../../src/domain/club-form-plan.js';
import type { ClubLine } from '../../src/web/api.js';
import { clubFormAbsentRows, clubFormStepView, clubFormSummaryText, type ClubFormStepContext } from '../../src/web/components/club-form-import/steps.js';
import { wizardReducer, type WizardPlan, type WizardState, type WizardStep } from '../../src/web/components/ffk-import/wizard.js';

function form(over: Partial<ClubFormLine> = {}): ClubFormLine {
  return {
    lastName: 'BERNIER', firstName: 'Zoé', sex: 'F', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', weightKg: 38,
    combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, ...over,
  };
}
const item = (over: Partial<ClubFormLine> = {}, extra: Partial<ClubFormItem> = {}): ClubFormItem => ({ order: 0, rows: [14], line: form(over), notes: [], ...extra });
function clubLine(fighterId: string, over: Partial<ClubFormLine> = {}, extra: Partial<ClubLine> = {}): ClubLine {
  return {
    fighterId, clubId: 'c1', publicNameHidden: false, version: 'v1', line: form(over), editable: true, partlyEditable: false,
    startedDisciplines: [], reason: null, notices: [], ...extra,
  };
}
const ageBands: ClubFormStepContext['ageBands'] = [
  { code: 'benjamin', label: 'Benjamins', ages: '10 à 11 ans', isMinor: true },
  { code: 'senior', label: 'Seniors', ages: '18 à 34 ans', isMinor: false },
];
const weightClasses: ClubFormStepContext['weightClasses'] = [
  { id: 'benjamin:F:-40', ageBandCode: 'benjamin', sex: 'F', label: '-40', maxKg: 40 },
  { id: 'benjamin:F:-45', ageBandCode: 'benjamin', sex: 'F', label: '-45', maxKg: 45 },
  { id: 'senior:F:-60', ageBandCode: 'senior', sex: 'F', label: '-60', maxKg: 60 },
];
const ctx = (lines: ClubLine[]): ClubFormStepContext => ({ lines, ageBands, weightClasses });
const plan = (steps: WizardStep<ClubFormItem>[], absents: string[] = []): WizardPlan<ClubFormItem> => ({ steps, upToDate: 0, absents });
type Step = Extract<WizardState<ClubFormItem>, { stage: 'step' }>;
type End = Extract<WizardState<ClubFormItem>, { stage: 'end' }>;
const at = (steps: WizardStep<ClubFormItem>[], extra: Partial<Step> = {}): Step => ({ stage: 'step', plan: plan(steps), index: 0, done: {}, saved: {}, others: [], round: 0, ...extra });
const labels = { imported: 'Fiche renvoyée', saved: 'Enregistré' };

describe('clubFormStepView, nouveau combattant', () => {
  test('la ligne lue, Jiyu pour un mineur sans règlement, remarques de la fiche, libellés des cases', () => {
    const notes = ['Ordre de reclassement « 4 » ignoré.', 'Grade illisible.'];
    const v = clubFormStepView(at([{ kind: 'new', ffk: item({ ruleset: null }, { rows: [14, 16], notes }) }]), ctx([]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBeNull();
    expect(v.ffk).toEqual({
      initial: form({ ruleset: 'jiyu' }), marks: [], diffs: [], banner: null, hints: {}, skipLabel: 'Ne pas l’ajouter', labels,
      notes: { title: 'Dans la fiche (ligne 14, 16)', lines: notes },
    });
  });

  test('majeur sans règlement : à choisir ; sans remarque : pas d’encadré ; catégorie de poids hors tranche vidée', () => {
    const v = clubFormStepView(at([{ kind: 'new', ffk: item({ ageBandCode: 'senior', ruleset: null, weightClassId: 'benjamin:F:-40' }) }]), ctx([]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toMatchObject({ ageBandCode: 'senior', ruleset: null, weightClassId: null });
    expect(v.ffk.notes).toBeUndefined();
  });

  test('créé ailleurs entre-temps (même nom ; sexe illisible : nom seul) : comparé comme une fiche existante', () => {
    const elsewhere = clubLine('f5', { lastName: 'Bernier', firstName: 'Zoe', weightKg: 40 });
    const v = clubFormStepView(at([{ kind: 'new', ffk: item({ sex: null }) }]), ctx([elsewhere]));
    expect(v).toMatchObject({ kind: 'form', line: elsewhere, ffk: { diffs: [{ field: 'weightKg', ffk: '38', fiche: '40' }], skipLabel: 'Laisser la fiche telle quelle' } });
    // « C’est un autre combattant » : jamais rapproché.
    expect(clubFormStepView(at([{ kind: 'new', ffk: item() }], { others: [0] }), ctx([elsewhere]))).toMatchObject({ kind: 'form', line: null });
  });
});

describe('clubFormStepView, fiche existante', () => {
  const existing = (fighterId: string, file: ClubFormItem): WizardStep<ClubFormItem> => ({ kind: 'existing', ffk: file, fighterId });

  test('différences, valeurs de la fiche renvoyée d’office, encadré, cases « confirmé FFK » sur l’âge et la catégorie', () => {
    const fresh = clubLine('f1', { ageBandCode: 'senior', weightClassId: 'senior:F:-60', weightKg: 55, kata: true, grade: '2e kyu' }, { ffkConfirmed: true });
    const file = item({ weightKg: 38, kata: false }, { notes: ['Grade illisible.'] });
    const v = clubFormStepView(at([existing('f1', file)]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBe(fresh);
    expect(v.ffk.diffs).toEqual([
      { field: 'ageBandCode', ffk: 'benjamin', fiche: 'senior', savedLabel: 'Enregistré · confirmé FFK' },
      { field: 'weightClassId', ffk: 'benjamin:F:-40', fiche: 'senior:F:-60', savedLabel: 'Enregistré · confirmé FFK' },
      { field: 'weightKg', ffk: '38', fiche: '55' },
      { field: 'disciplines', ffk: 'karate', fiche: 'karate,kata' },
    ]);
    expect(v.ffk.initial).toMatchObject({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', weightKg: 38, combats: ['karate'], kata: false });
    expect(v.ffk.banner).toBe('Fiche déjà créée. Une seule fiche par combattant : celle de Zoé est inscrite en Karaté et Kata. Sous chaque différence, choisissez la valeur à garder.');
    expect(v.ffk).toMatchObject({ marks: [], hints: {}, labels, skipLabel: 'Laisser la fiche telle quelle', notes: { title: 'Dans la fiche (ligne 14)', lines: ['Grade illisible.'] } });
  });

  test('pas confirmée FFK : pas de libellé à part', () => {
    const v = clubFormStepView(at([existing('f1', item())]), ctx([clubLine('f1', { ageBandCode: 'senior', weightClassId: 'senior:F:-60' })]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.diffs.map((d) => d.savedLabel)).toEqual([undefined, undefined]);
  });

  test('relue après un refus (409) et devenue identique : plus de différence', () => {
    const file = item({ weightKg: 38 });
    const before = clubLine('f1', { weightKg: 55 });
    const [step] = planClubFormImport([file], [before]).steps;
    expect(step).toMatchObject({ kind: 'existing', diffs: [{ field: 'weightKg' }] });
    const v = clubFormStepView(at([step!]), ctx([clubLine('f1', { weightKg: 38 }, { version: 'v2' })]));
    expect(v).toMatchObject({ kind: 'form', line: { version: 'v2' }, ffk: { diffs: [], initial: { weightKg: 38 } } });
  });

  test('seule nouveauté une licence : la fiche avec la licence remplie, sans écart', () => {
    const [step] = planClubFormImport([item({ licence: '11462640R' })], [clubLine('f1')]).steps;
    expect(step).toMatchObject({ kind: 'existing', diffs: [] });
    const v = clubFormStepView(at([step!]), ctx([clubLine('f1')]));
    expect(v).toMatchObject({ kind: 'form', ffk: { diffs: [], initial: { licence: '11462640R', weightKg: 38 }, skipLabel: 'Laisser la fiche telle quelle' } });
  });

  test('verrouillée : la fiche telle qu’elle est, la fiche renvoyée seulement dans les cases, « Suivant » seul', () => {
    const fresh = clubLine('f1', { weightKg: 55 }, { editable: false, partlyEditable: false, reason: 'Combats commencés.' });
    const v = clubFormStepView(at([existing('f1', item())]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toEqual(fresh.line);
    expect(v.ffk.diffs).toEqual([{ field: 'weightKg', ffk: '38', fiche: '55' }]);
    expect(v.ffk.skipLabel).toBeNull();
    expect(v.ffk.banner).toBe('Fiche déjà créée. Une seule fiche par combattant : celle de Zoé est inscrite en Karaté.');
  });

  test('discipline commencée absente de la fiche : gardée cochée', () => {
    const fresh = clubLine('f1', { kata: true }, { editable: false, partlyEditable: true, startedDisciplines: ['kata'] });
    const v = clubFormStepView(at([existing('f1', item())]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toMatchObject({ combats: ['karate'], kata: true });
  });

  test('sans discipline : encadré sans liste', () => {
    const v = clubFormStepView(at([existing('f1', item())]), ctx([clubLine('f1', { combats: [], kata: false, ruleset: null })]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.banner).toBe('Fiche déjà créée. Une seule fiche par combattant : sous chaque différence, choisissez la valeur à garder.');
  });

  test('verrouillée et sans discipline : encadré sans phrase de choix', () => {
    const fresh = clubLine('f1', { combats: [], kata: false, ruleset: null }, { editable: false, partlyEditable: false, reason: 'Verrouillée.' });
    const v = clubFormStepView(at([existing('f1', item())]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.banner).toBe('Fiche déjà créée. Une seule fiche par combattant.');
  });

  test('supprimée entre-temps : redevient un nouveau', () => {
    expect(clubFormStepView(at([existing('f1', item())]), ctx([]))).toMatchObject({ kind: 'form', line: null, ffk: { skipLabel: 'Ne pas l’ajouter', labels } });
  });

  test('déjà enregistrée (« Précédent ») : la fiche du moment, sans comparaison', () => {
    const now = clubLine('f1', { weightKg: 60 }, { version: 'v3' });
    const v = clubFormStepView(at([existing('f1', item())], { done: { 0: 'saved' }, saved: { 0: clubLine('f1') } }), ctx([now]));
    expect(v).toEqual({ kind: 'form', line: now, ffk: { initial: now.line, marks: [], diffs: [], banner: null, hints: {}, skipLabel: 'Laisser la fiche telle quelle', labels } });
  });

  test('déjà enregistrée : les remarques de la fiche restent affichées', () => {
    const now = clubLine('f1', {}, { version: 'v3' });
    const file = item({}, { rows: [27], notes: ['Catégorie d’âge incompréhensible : « 12 ans ».'] });
    const v = clubFormStepView(at([existing('f1', file)], { done: { 0: 'saved' }, saved: { 0: clubLine('f1') } }), ctx([now]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.notes).toEqual({ title: 'Dans la fiche (ligne 27)', lines: ['Catégorie d’âge incompréhensible : « 12 ans ».'] });
  });
});

describe('homonymes', () => {
  test('les candidats encore présents, puis la fiche choisie comparée ; « C’est un autre combattant » : un nouveau', () => {
    const a = clubLine('a', { weightKg: 41 });
    const b = clubLine('b', { weightKg: 42 });
    const file = item();
    const s = wizardReducer<ClubFormItem>({ stage: 'start' }, { type: 'start', plan: plan([{ kind: 'homonym', ffk: file, candidates: ['a', 'b', 'gone'] }]) }) as Step;
    expect(clubFormStepView(s, ctx([a, b]))).toEqual({ kind: 'homonym', ffk: file, candidates: [a, b] });
    const chosen = wizardReducer(s, { type: 'resolve', fighterId: 'b' }) as Step;
    expect(chosen.plan.steps[0]).toEqual({ kind: 'existing', ffk: file, fighterId: 'b' });
    expect(clubFormStepView(chosen, ctx([a, b]))).toMatchObject({ kind: 'form', line: b, ffk: { diffs: [{ field: 'weightKg', ffk: '38', fiche: '42' }] } });
    const other = wizardReducer(s, { type: 'resolve', fighterId: null }) as Step;
    expect(clubFormStepView(other, ctx([a, b]))).toMatchObject({ kind: 'form', line: null });
  });

  test('candidats tous supprimés : un nouveau', () => {
    expect(clubFormStepView(at([{ kind: 'homonym', ffk: item(), candidates: ['gone'] }]), ctx([]))).toMatchObject({ kind: 'form', line: null });
  });
});

test('le réducteur compte les étapes de la fiche comme celles du PDF FFK', () => {
  const s = [
    { type: 'saved', index: 0, line: clubLine('n1'), created: true },
    { type: 'skipped', index: 1 },
    { type: 'saved', index: 2, line: clubLine('e1') },
  ] as const;
  const start = wizardReducer<ClubFormItem>({ stage: 'start' }, { type: 'start', plan: plan([{ kind: 'new', ffk: item() }, { kind: 'new', ffk: item() }, { kind: 'existing', ffk: item(), fighterId: 'e1' }]) });
  const end = s.reduce((acc, a) => wizardReducer(acc, a), start) as End;
  expect(end).toMatchObject({ stage: 'end', done: { 0: 'saved', 1: 'skipped', 2: 'saved' } });
});

test('clubFormAbsentRows : toutes disciplines ; une fiche non modifiable se liste sans case', () => {
  const rows = clubFormAbsentRows(plan([], ['a', 'b', 'c', 'gone']), [
    clubLine('a'),
    clubLine('b', { combats: [], kata: true }),
    clubLine('c', {}, { editable: false, partlyEditable: true, startedDisciplines: ['karate'] }),
  ]);
  expect(rows.map((r) => [r.line.fighterId, r.checkable])).toEqual([['a', true], ['b', true], ['c', false]]);
});

test('clubFormSummaryText : singulier et pluriel, non ajoutés et fiches supprimées seulement s’il y en a', () => {
  expect(clubFormSummaryText({ added: 2, notAdded: 0, updated: 1, left: 0 }, 1)).toBe('Fiche renvoyée : 2 ajoutés · 1 mis à jour · 0 laissé tel quel · 1 fiche supprimée.');
  expect(clubFormSummaryText({ added: 1, notAdded: 2, updated: 0, left: 3 }, 0)).toBe('Fiche renvoyée : 1 ajouté · 2 non ajoutés · 0 mis à jour · 3 laissés tels quels.');
  expect(clubFormSummaryText({ added: 0, notAdded: 1, updated: 2, left: 1 }, 2)).toBe('Fiche renvoyée : 0 ajouté · 1 non ajouté · 2 mis à jour · 1 laissé tel quel · 2 fiches supprimées.');
});
