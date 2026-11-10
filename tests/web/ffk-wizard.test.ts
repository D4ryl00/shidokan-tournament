import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import type { FfkFighter, FfkImportPlan, FfkStep } from '../../src/domain/ffk-pdf-plan.js';
import type { ClubLine } from '../../src/web/api.js';
import {
  absentRows,
  fitWeightClass,
  stepView,
  summaryText,
  wizardReducer,
  wizardSummary,
  type StepContext,
  type WizardState,
} from '../../src/web/components/ffk-import/wizard.js';

function fighter(over: Partial<FfkFighter> = {}): FfkFighter {
  return {
    order: 1, fullName: 'MARTIN LEA', lastName: 'MARTIN', firstName: 'Lea', sex: 'F',
    ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', ruleset: 'jiyu', rulesetGiven: false,
    raw: { age: 'Benjamine', weight: '-40' }, ...over,
  };
}
function form(over: Partial<ClubFormLine> = {}): ClubFormLine {
  return {
    lastName: 'MARTIN', firstName: 'Lea', sex: 'F', ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', weightKg: null,
    combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, ...over,
  };
}
function clubLine(fighterId: string, over: Partial<ClubFormLine> = {}, extra: Partial<ClubLine> = {}): ClubLine {
  return {
    fighterId, clubId: 'c1', publicNameHidden: false, version: 'v1', line: form(over), editable: true, partlyEditable: false,
    startedDisciplines: [], reason: null, notices: [], ...extra,
  };
}
const newStep = (order: number): FfkStep => ({ kind: 'new', ffk: fighter({ order }) });
const existingStep = (order: number, fighterId: string): FfkStep => ({
  kind: 'existing', ffk: fighter({ order }), fighterId, diffs: [], addsDiscipline: true, oneCombatBlocked: false, locked: false,
});
const plan = (steps: FfkStep[], absents: string[] = []): FfkImportPlan => ({ steps, upToDate: 0, absents });
const weightClasses: StepContext['weightClasses'] = [
  { id: 'benjamin:F:-40', ageBandCode: 'benjamin', sex: 'F', label: '-40', maxKg: 40 },
  { id: 'benjamin:F:-45', ageBandCode: 'benjamin', sex: 'F', label: '-45', maxKg: 45 },
  { id: 'minime:F:-45', ageBandCode: 'minime', sex: 'F', label: '-45', maxKg: 45 },
];
const ctx = (lines: ClubLine[], over: Partial<StepContext> = {}): StepContext => ({
  lines, discipline: 'karate', multipleCombats: false, mode: 'coach', weightClasses, ...over,
});

type Step = Extract<WizardState, { stage: 'step' }>;
type End = Extract<WizardState, { stage: 'end' }>;
const run = (s: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) => actions.reduce(wizardReducer, s);

describe('wizardReducer', () => {
  test('start : première étape, ou la fin directement sans rien à revoir', () => {
    expect(wizardReducer({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2), newStep(3)]) })).toMatchObject({ stage: 'step', index: 0, done: {} });
    expect(wizardReducer({ stage: 'start' }, { type: 'start', plan: plan([]) })).toMatchObject({ stage: 'end', done: {}, remove: [] });
  });

  test('saved à la dernière étape : la fin, toutes les étapes faites ; skipped : laissée', () => {
    const s = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2)]) }, { type: 'skipped' }, { type: 'saved', fighterId: 'f2' });
    expect(s).toMatchObject({ stage: 'end', done: { 0: 'skipped', 1: 'saved' }, fighters: { 1: 'f2' } });
  });

  test('previous : une étape en arrière, rien à l’index 0', () => {
    const at2 = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2), newStep(3)]) }, { type: 'saved' }, { type: 'saved' }) as Step;
    expect(at2.index).toBe(2);
    expect(wizardReducer(at2, { type: 'previous' })).toMatchObject({ stage: 'step', index: 1 });
    const at0 = wizardReducer({ stage: 'start' }, { type: 'start', plan: plan([newStep(1)]) });
    expect(wizardReducer(at0, { type: 'previous' })).toBe(at0);
  });

  test('stale : même étape, remontée (le composant relit la fiche)', () => {
    const at1 = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), existingStep(2, 'f2')]) }, { type: 'saved' }) as Step;
    const stale = wizardReducer(at1, { type: 'stale' }) as Step;
    expect(stale).toMatchObject({ stage: 'step', index: 1, done: { 0: 'saved' } });
    expect(stale.round).not.toBe(at1.round);
  });

  test('skipped après un enregistrement de la même étape (retour par « Précédent ») : reste enregistrée', () => {
    const s = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2)]) }, { type: 'saved', fighterId: 'f1' }, { type: 'previous' }, { type: 'skipped' }) as Step;
    expect(s).toMatchObject({ index: 1, done: { 0: 'saved' } });
  });

  test('saved d’une fiche existante devenue création (fiche supprimée entre-temps) : comptée comme ajoutée', () => {
    const s = run({ stage: 'start' }, { type: 'start', plan: plan([existingStep(1, 'f1')]) }, { type: 'saved', fighterId: 'f9', created: true }) as End;
    expect(wizardSummary(s)).toEqual({ added: 1, updated: 0, left: 0 });
  });

  test('resolve : un homonyme devient une fiche existante ou un nouveau', () => {
    const homonym: FfkStep = { kind: 'homonym', ffk: fighter(), candidates: ['a', 'b'] };
    const at0 = wizardReducer({ stage: 'start' }, { type: 'start', plan: plan([homonym]) });
    expect((wizardReducer(at0, { type: 'resolve', fighterId: 'b' }) as Step).plan.steps[0]).toMatchObject({ kind: 'existing', fighterId: 'b' });
    expect((wizardReducer(at0, { type: 'resolve', fighterId: null }) as Step).plan.steps[0]).toMatchObject({ kind: 'new' });
  });

  test('toggleAbsent deux fois : rien à retirer ; résumé', () => {
    const end = run(
      { stage: 'start' },
      { type: 'start', plan: plan([newStep(1), newStep(2), existingStep(3, 'f3'), existingStep(4, 'f4')], ['x']) },
      { type: 'saved' }, { type: 'saved' }, { type: 'saved' }, { type: 'skipped' },
    ) as End;
    expect(run(end, { type: 'toggleAbsent', fighterId: 'x' })).toMatchObject({ remove: ['x'] });
    expect(run(end, { type: 'toggleAbsent', fighterId: 'x' }, { type: 'toggleAbsent', fighterId: 'x' })).toMatchObject({ remove: [] });
    expect(wizardSummary(end)).toEqual({ added: 2, updated: 1, left: 1 });
  });
});

describe('fitWeightClass', () => {
  test('une catégorie de poids d’une autre tranche d’âge est vidée', () => {
    expect(fitWeightClass(form({ ageBandCode: 'minime', weightClassId: 'benjamin:F:-40' }), weightClasses).weightClassId).toBeNull();
    expect(fitWeightClass(form({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' }), weightClasses).weightClassId).toBe('minime:F:-45');
    expect(fitWeightClass(form({ sex: 'M' }), weightClasses).weightClassId).toBeNull();
    expect(fitWeightClass(form({ weightClassId: null }), weightClasses).weightClassId).toBeNull();
  });
});

describe('stepView', () => {
  const at = (steps: FfkStep[], index = 0, extra: Partial<Step> = {}): Step => ({ stage: 'step', plan: plan(steps), index, done: {}, fighters: {}, round: 0, ...extra });

  test('nouveau : pré-rempli, marques FFK, phrase du nom en plus de deux mots, champs non traduits', () => {
    const ffk = fighter({ fullName: 'DA SILVA SANTOS INES', lastName: 'DA SILVA SANTOS', firstName: 'Ines', ageBandCode: null, weightClassId: null, raw: { age: 'Seniors Débutants Shindo', weight: '-99' } });
    const v = stepView(at([{ kind: 'new', ffk }]), ctx([]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBeNull();
    expect(v.ffk.initial).toMatchObject({ lastName: 'DA SILVA SANTOS', firstName: 'Ines', combats: ['karate'] });
    expect(v.ffk.marks).toEqual(['name', 'sex', 'discipline']);
    expect(v.ffk.hints).toEqual({
      name: 'La FFK écrit « DA SILVA SANTOS INES » : corrigez la coupure nom / prénom si besoin.',
      ageBandCode: 'La FFK indique « Seniors Débutants Shindo » : choisissez la catégorie.',
      weightClassId: 'La FFK indique « -99 kg » : choisissez la catégorie.',
    });
    expect(v.ffk.skipLabel).toBe('Ne pas l’ajouter');
    expect(v.ffk.banner).toBeNull();
  });

  test('nouveau, tout traduit : toutes les marques, pas de phrase', () => {
    const v = stepView(at([{ kind: 'new', ffk: fighter({ rulesetGiven: true }) }]), ctx([]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.marks).toEqual(['name', 'sex', 'ageBandCode', 'weightClassId', 'ruleset', 'discipline']);
    expect(v.ffk.hints).toEqual({});
  });

  test('existante : comparaison recalculée sur la fiche du moment, encadré, discipline ajoutée et marquée', () => {
    const fresh = clubLine('f1', { combats: [], kata: true, ruleset: null, weightClassId: 'benjamin:F:-45' });
    const v = stepView(at([existingStep(1, 'f1')]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBe(fresh);
    expect(v.ffk.initial).toMatchObject({ combats: ['karate'], kata: true, weightClassId: 'benjamin:F:-40', ruleset: 'jiyu' });
    expect(v.ffk.diffs).toEqual([{ field: 'weightClassId', ffk: 'benjamin:F:-40', fiche: 'benjamin:F:-45' }]);
    expect(v.ffk.marks).toEqual(['discipline']);
    expect(v.ffk.banner).toContain('celle de Lea est inscrite en Kata.');
    expect(v.ffk.hints).toEqual({ discipline: 'Gardé, pas dans ce PDF : Kata.' });
    expect(v.ffk.skipLabel).toBe('Laisser la fiche telle quelle');
  });

  test('existante, une seule discipline de combat et déjà une autre : non cochée, phrase', () => {
    const fresh = clubLine('f1', { combats: ['shido-mix'] });
    const v = stepView(at([existingStep(1, 'f1')]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial.combats).toEqual(['shido-mix']);
    expect(v.ffk.marks).toEqual([]);
    expect(v.ffk.hints.discipline).toBe(
      'Sa fiche est déjà inscrite en Shido-mix-martial : une seule discipline de combat à cette compétition. Cochez Karaté pour changer. Gardé, pas dans ce PDF : Shido-mix-martial.',
    );
  });

  test('existante, tranche d’âge seule différente (kata) : la catégorie de poids de l’ancienne tranche est vidée', () => {
    const fresh = clubLine('f1', { ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', kata: false });
    const ffk = fighter({ ageBandCode: 'minime', weightClassId: null, ruleset: null });
    const step: FfkStep = { kind: 'existing', ffk, fighterId: 'f1', diffs: [], addsDiscipline: true, oneCombatBlocked: false, locked: false };
    const v = stepView(at([step]), ctx([fresh], { discipline: 'kata' }));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toMatchObject({ ageBandCode: 'minime', weightClassId: null, kata: true });
  });

  test('existante modifiée ailleurs jusqu’à être à jour : affichée sans comparaison', () => {
    const v = stepView(at([existingStep(1, 'f1')]), ctx([clubLine('f1')]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.diffs).toEqual([]);
    expect(v.ffk.marks).toEqual([]);
  });

  test('existante supprimée entre-temps : redevient un nouveau', () => {
    const v = stepView(at([existingStep(1, 'f1')]), ctx([]));
    expect(v).toMatchObject({ kind: 'form', line: null, ffk: { skipLabel: 'Ne pas l’ajouter' } });
  });

  test('déjà enregistrée (retour par « Précédent ») : la fiche telle qu’elle est, sans comparaison', () => {
    const saved = clubLine('f9', { lastName: 'MARTIN-DUPONT' });
    const v = stepView(at([newStep(1)], 0, { done: { 0: 'saved' }, fighters: { 0: 'f9' } }), ctx([saved]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBe(saved);
    expect(v.ffk).toMatchObject({ initial: saved.line, marks: [], diffs: [], banner: null, hints: {}, skipLabel: 'Laisser la fiche telle quelle' });
  });

  test('homonymes : les candidats encore présents', () => {
    const a = clubLine('a');
    const v = stepView(at([{ kind: 'homonym', ffk: fighter(), candidates: ['a', 'gone'] }]), ctx([a, clubLine('z')]));
    expect(v).toEqual({ kind: 'homonym', ffk: fighter(), candidates: [a] });
  });
});

describe('absentRows', () => {
  test('encore inscrits dans la discipline ; une fiche verrouillée ne se coche pas', () => {
    const rows = absentRows(plan([], ['a', 'b', 'c', 'gone']), [
      clubLine('a', { kata: true }),
      clubLine('b', { combats: [] , kata: true }),
      clubLine('c', {}, { editable: false, partlyEditable: false, reason: 'Combat commencé' }),
    ], 'karate');
    expect(rows.map((r) => [r.line.fighterId, r.checkable, r.others])).toEqual([['a', true, ['kata']], ['c', false, []]]);
  });
  test('organisateur, fiche en partie modifiable : cochable si la discipline n’a pas commencé', () => {
    const l = clubLine('a', { kata: true }, { editable: false, partlyEditable: true, startedDisciplines: ['kata'] });
    expect(absentRows(plan([], ['a']), [l], 'karate')[0]!.checkable).toBe(true);
    expect(absentRows(plan([], ['a']), [{ ...l, startedDisciplines: ['karate'] }], 'karate')[0]!.checkable).toBe(false);
  });
});

test('summaryText : singulier et pluriel, retraits', () => {
  expect(summaryText({ added: 2, updated: 1, left: 0 }, 0, 'karate')).toBe('Import FFK : 2 ajoutés · 1 mis à jour · 0 laissé tel quel.');
  expect(summaryText({ added: 1, updated: 0, left: 3 }, 2, 'kata')).toBe('Import FFK : 1 ajouté · 0 mis à jour · 3 laissés tels quels · Kata retiré de 2 fiches.');
});
