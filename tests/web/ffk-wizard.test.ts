import { describe, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import type { FfkFighter, FfkImportPlan, FfkStep } from '../../src/domain/ffk-pdf-plan.js';
import type { ClubLine } from '../../src/web/api.js';
import {
  absentRows,
  fitWeightClass,
  NO_DISCIPLINE_BANNER,
  sameSaved,
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
    const f2 = clubLine('f2');
    const s = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2)]) }, { type: 'skipped', index: 0 }, { type: 'saved', index: 1, line: f2 });
    expect(s).toMatchObject({ stage: 'end', done: { 0: 'skipped', 1: 'saved' }, saved: { 1: f2 } });
  });

  test('previous : une étape en arrière, rien à l’index 0', () => {
    const at2 = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2), newStep(3)]) }, { type: 'saved', index: 0 }, { type: 'saved', index: 1 }) as Step;
    expect(at2.index).toBe(2);
    expect(wizardReducer(at2, { type: 'previous' })).toMatchObject({ stage: 'step', index: 1 });
    const at0 = wizardReducer({ stage: 'start' }, { type: 'start', plan: plan([newStep(1)]) });
    expect(wizardReducer(at0, { type: 'previous' })).toBe(at0);
  });

  test('stale : même étape, remontée (le composant relit la fiche)', () => {
    const at1 = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), existingStep(2, 'f2')]) }, { type: 'saved', index: 0 }) as Step;
    const stale = wizardReducer(at1, { type: 'stale' }) as Step;
    expect(stale).toMatchObject({ stage: 'step', index: 1, done: { 0: 'saved' } });
    expect(stale.round).not.toBe(at1.round);
  });

  test('saved de l’étape i arrivé après « Précédent » : noté sur l’étape i, sans faire avancer', () => {
    const at1 = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2), newStep(3)]) }, { type: 'skipped', index: 0 }) as Step;
    const back = wizardReducer(at1, { type: 'previous' }) as Step;
    const s = wizardReducer(back, { type: 'saved', index: 1, line: clubLine('f2'), created: true }) as Step;
    expect(s).toMatchObject({ stage: 'step', index: 0, done: { 0: 'skipped', 1: 'saved' }, saved: { 1: { fighterId: 'f2' } } });
    // Une réponse tardive de l'étape i ne fait pas non plus avancer la fin.
    const end = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1)]) }, { type: 'skipped', index: 0 }) as End;
    expect(wizardReducer(end, { type: 'saved', index: 0, line: clubLine('f1'), created: true })).toMatchObject({ stage: 'end', done: { 0: 'saved' } });
  });

  test('skipped après un enregistrement de la même étape (retour par « Précédent ») : reste enregistrée', () => {
    const s = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2)]) }, { type: 'saved', index: 0, line: clubLine('f1') }, { type: 'previous' }, { type: 'skipped', index: 0 }) as Step;
    expect(s).toMatchObject({ index: 1, done: { 0: 'saved' } });
  });

  test('saved d’une fiche existante devenue création (fiche supprimée entre-temps) : comptée comme ajoutée', () => {
    const s = run({ stage: 'start' }, { type: 'start', plan: plan([existingStep(1, 'f1')]) }, { type: 'saved', index: 0, line: clubLine('f9'), created: true }) as End;
    expect(wizardSummary(s)).toEqual({ added: 1, notAdded: 0, updated: 0, left: 0 });
  });

  test('saved d’un nouveau rapproché d’une fiche apparue entre-temps : compté mis à jour ; un nouveau créé puis rouvert reste ajouté', () => {
    const matched = run({ stage: 'start' }, { type: 'start', plan: plan([newStep(1)]) }, { type: 'saved', index: 0, line: clubLine('f1'), created: false }) as End;
    expect(wizardSummary(matched)).toEqual({ added: 0, notAdded: 0, updated: 1, left: 0 });
    const reopened = run(
      { stage: 'start' }, { type: 'start', plan: plan([newStep(1), newStep(2)]) },
      { type: 'saved', index: 0, line: clubLine('f1'), created: true }, { type: 'previous' }, { type: 'saved', index: 0, line: clubLine('f1'), created: false },
      { type: 'skipped', index: 1 },
    ) as End;
    // Le second, un nouveau passé : « non ajouté », pas « laissé tel quel ».
    expect(wizardSummary(reopened)).toEqual({ added: 1, notAdded: 1, updated: 0, left: 0 });
  });

  test('resolve : un homonyme devient une fiche existante ou un nouveau', () => {
    const homonym: FfkStep = { kind: 'homonym', ffk: fighter(), candidates: ['a', 'b'] };
    const at0 = wizardReducer({ stage: 'start' }, { type: 'start', plan: plan([homonym]) });
    expect((wizardReducer(at0, { type: 'resolve', fighterId: 'b' }) as Step).plan.steps[0]).toMatchObject({ kind: 'existing', fighterId: 'b' });
    expect(wizardReducer(at0, { type: 'resolve', fighterId: null })).toMatchObject({ plan: { steps: [{ kind: 'new' }] }, others: [0] });
  });

  test('toggleAbsent deux fois : rien à retirer ; résumé', () => {
    const end = run(
      { stage: 'start' },
      { type: 'start', plan: plan([newStep(1), newStep(2), existingStep(3, 'f3'), existingStep(4, 'f4')], ['x']) },
      { type: 'saved', index: 0 }, { type: 'saved', index: 1 }, { type: 'saved', index: 2 }, { type: 'skipped', index: 3 },
    ) as End;
    expect(run(end, { type: 'toggleAbsent', fighterId: 'x' })).toMatchObject({ remove: ['x'] });
    expect(run(end, { type: 'toggleAbsent', fighterId: 'x' }, { type: 'toggleAbsent', fighterId: 'x' })).toMatchObject({ remove: [] });
    expect(wizardSummary(end)).toEqual({ added: 2, notAdded: 0, updated: 1, left: 1 });
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
  const at = (steps: FfkStep[], index = 0, extra: Partial<Step> = {}): Step => ({ stage: 'step', plan: plan(steps), index, done: {}, saved: {}, others: [], round: 0, ...extra });

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
    // À part : la fenêtre ne l'affiche que tant que Karaté n'est pas coché.
    expect(v.ffk.switchHint).toEqual({
      text: 'Sa fiche est déjà inscrite en Shido-mix-martial : une seule discipline de combat à cette compétition. Cochez Karaté pour changer.',
      discipline: 'karate',
    });
    expect(v.ffk.hints.discipline).toBeUndefined();
  });

  test('existante, un combat bloquant et kata gardé : deux lignes, sans doublon pour la discipline de combat', () => {
    const fresh = clubLine('f1', { combats: ['shido-mix'], kata: true });
    const v = stepView(at([existingStep(1, 'f1')]), ctx([fresh]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.switchHint?.text).toBe('Sa fiche est déjà inscrite en Shido-mix-martial : une seule discipline de combat à cette compétition. Cochez Karaté pour changer.');
    expect(v.ffk.hints.discipline).toBe('Gardé, pas dans ce PDF : Kata.');
  });

  test('existante, catégorie de poids et tranche d’âge de la FFK absentes de la grille : indication sous le champ', () => {
    const ffk = fighter({ ageBandCode: null, weightClassId: null, raw: { age: 'Cadet Feminine', weight: '-60' } });
    const step = { ...existingStep(1, 'f1'), ffk } as FfkStep;
    const v = stepView(at([step]), ctx([clubLine('f1')]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.hints.weightClassId).toBe('La FFK indique « -60 kg », absente de la grille de cette compétition : vérifiez la catégorie.');
    expect(v.ffk.hints.ageBandCode).toBe('La FFK indique « Cadet Feminine », absente de la grille de cette compétition : vérifiez la catégorie.');
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
    const returned = clubLine('f9', { lastName: 'MARTIN' });
    const now = clubLine('f9', { lastName: 'MARTIN-DUPONT' }, { version: 'v2' });
    const v = stepView(at([newStep(1)], 0, { done: { 0: 'saved' }, saved: { 0: returned } }), ctx([now]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBe(now);
    expect(v.ffk).toMatchObject({ initial: now.line, marks: [], diffs: [], banner: null, hints: {}, skipLabel: 'Laisser la fiche telle quelle' });
  });

  test('déjà enregistrée, liste pas rechargée : la fiche renvoyée par l’enregistrement (pas une seconde création)', () => {
    const returned = clubLine('f9');
    const v = stepView(at([newStep(1)], 0, { done: { 0: 'saved' }, saved: { 0: returned } }), ctx([]));
    expect(v).toMatchObject({ kind: 'form', line: returned });
  });

  test('nouveau dont la fiche a été créée ailleurs entre-temps (même nom, même sexe) : comparé comme une fiche existante', () => {
    const elsewhere = clubLine('f5', { lastName: 'Martin', firstName: 'Léa', combats: [], kata: true, ruleset: null });
    const v = stepView(at([newStep(1)]), ctx([elsewhere, clubLine('m', { sex: 'M' })]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.line).toBe(elsewhere);
    expect(v.ffk).toMatchObject({ marks: ['discipline'], skipLabel: 'Laisser la fiche telle quelle' });
    expect(v.ffk.initial).toMatchObject({ combats: ['karate'], kata: true });
    // « C’est un autre combattant » : jamais rapproché.
    expect(stepView(at([newStep(1)], 0, { others: [0] }), ctx([elsewhere]))).toMatchObject({ kind: 'form', line: null });
  });

  test('fiche existante sans discipline : encadré sans liste', () => {
    const v = stepView(at([existingStep(1, 'f1')]), ctx([clubLine('f1', { combats: [], kata: false, ruleset: null })]));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.banner).toBe(NO_DISCIPLINE_BANNER);
    expect(v.ffk.banner).toBe('Fiche déjà créée. Une seule fiche par combattant : ce que vous choisissez ici vaut pour toutes ses disciplines.');
  });

  test('existante verrouillée : la fiche telle qu’elle est, les valeurs FFK seulement dans les cases', () => {
    const fresh = clubLine('f1', { weightClassId: 'benjamin:F:-45' }, { editable: false, partlyEditable: false, reason: 'Combats commencés.' });
    const step: FfkStep = { ...existingStep(1, 'f1'), addsDiscipline: false, locked: true } as FfkStep;
    const v = stepView(at([step]), ctx([fresh], { discipline: 'kata' }));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toEqual(fresh.line);
    const v2 = stepView(at([step]), ctx([fresh]));
    if (v2.kind !== 'form') throw new Error('formulaire attendu');
    expect(v2.ffk.initial).toEqual(fresh.line);
    expect(v2.ffk.diffs).toEqual([{ field: 'weightClassId', ffk: 'benjamin:F:-40', fiche: 'benjamin:F:-45' }]);
    // Rien à choisir : l'encadré ne dit pas « ce que vous choisissez ici… », et seul « Suivant » fait passer (pas de second bouton).
    expect(v2.ffk.skipLabel).toBeNull();
    expect(v2.ffk.banner).toBe('Fiche déjà créée. Une seule fiche par combattant : celle de Lea est inscrite en Karaté.');
  });

  test('existante en partie modifiable, combat commencé : tranche d’âge, poids et règlement de la fiche gardés', () => {
    const fresh = clubLine('f1', { weightClassId: 'benjamin:F:-45', kata: false }, { editable: false, partlyEditable: true, startedDisciplines: ['karate'] });
    const ffk = fighter({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', ruleset: 'shobu', rulesetGiven: true });
    const step: FfkStep = { kind: 'existing', ffk, fighterId: 'f1', diffs: [], addsDiscipline: false, oneCombatBlocked: false, locked: false };
    const v = stepView(at([step]), ctx([fresh], { mode: 'organiser' }));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toEqual(fresh.line);
    expect(v.ffk.diffs.map((d) => d.field)).toEqual(['ageBandCode', 'weightClassId', 'ruleset']);
    // En partie modifiable : il y a quelque chose à enregistrer, « Laisser la fiche telle quelle » reste.
    expect(v.ffk.skipLabel).toBe('Laisser la fiche telle quelle');
  });

  test('existante en partie modifiable, kata seul commencé : tranche d’âge gardée, le combat ajouté prend poids et règlement FFK', () => {
    const fresh = clubLine('f1', { combats: [], kata: true, weightClassId: null, ruleset: null }, { editable: false, partlyEditable: true, startedDisciplines: ['kata'] });
    const v = stepView(at([existingStep(1, 'f1')]), ctx([fresh], { mode: 'organiser' }));
    if (v.kind !== 'form') throw new Error('formulaire attendu');
    expect(v.ffk.initial).toMatchObject({ ageBandCode: 'benjamin', combats: ['karate'], kata: true, weightClassId: 'benjamin:F:-40', ruleset: 'jiyu' });
    // Tranche d'âge FFK différente : celle de la fiche reste (le serveur la garde), la catégorie de poids FFK d'une autre tranche est vidée.
    const minime: FfkStep = { ...existingStep(1, 'f1'), ffk: fighter({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' }) } as FfkStep;
    const v2 = stepView(at([minime]), ctx([fresh], { mode: 'organiser' }));
    if (v2.kind !== 'form') throw new Error('formulaire attendu');
    expect(v2.ffk.initial).toMatchObject({ ageBandCode: 'benjamin', weightClassId: null, combats: ['karate'] });
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

test('summaryText : singulier et pluriel, retraits et fiches supprimées à part', () => {
  const none = { withdrawn: 0, deleted: 0 };
  expect(summaryText({ notAdded: 0, added: 2, updated: 1, left: 0 }, none, 'karate')).toBe('Import FFK : 2 ajoutés · 1 mis à jour · 0 laissé tel quel.');
  expect(summaryText({ notAdded: 0, added: 1, updated: 0, left: 3 }, { withdrawn: 2, deleted: 0 }, 'kata')).toBe('Import FFK : 1 ajouté · 0 mis à jour · 3 laissés tels quels · Kata retiré de 2 fiches.');
  expect(summaryText({ notAdded: 0, added: 0, updated: 0, left: 0 }, { withdrawn: 0, deleted: 1 }, 'karate')).toBe('Import FFK : 0 ajouté · 0 mis à jour · 0 laissé tel quel · 1 fiche supprimée.');
  expect(summaryText({ added: 1, notAdded: 2, updated: 0, left: 1 }, none, 'karate')).toBe('Import FFK : 1 ajouté · 2 non ajoutés · 0 mis à jour · 1 laissé tel quel.');
  expect(summaryText({ added: 0, notAdded: 1, updated: 0, left: 0 }, none, 'karate')).toBe('Import FFK : 0 ajouté · 1 non ajouté · 0 mis à jour · 0 laissé tel quel.');
  expect(summaryText({ notAdded: 0, added: 0, updated: 0, left: 0 }, { withdrawn: 1, deleted: 2 }, 'karate')).toBe('Import FFK : 0 ajouté · 0 mis à jour · 0 laissé tel quel · Karaté retiré de 1 fiche · 2 fiches supprimées.');
});

test('sameSaved : un réenregistrement sans changement (clés dans un autre ordre) n’est pas une mise à jour', () => {
  const before = clubLine('f1', { prefs: { 'shido-boxing': 1, 'shido-mix': 2 } });
  const line = Object.fromEntries(Object.entries(before.line).reverse()) as ClubFormLine;
  const reordered = { ...before, version: 'v2', line: { ...line, prefs: { 'shido-mix': 2, 'shido-boxing': 1 } as ClubFormLine['prefs'] } };
  expect(sameSaved(before, reordered)).toBe(true);
  expect(sameSaved(before, { ...before, line: { ...before.line, weightClassId: 'benjamin:F:-45' } })).toBe(false);
  expect(sameSaved(before, { ...before, publicNameHidden: true })).toBe(false);
});
