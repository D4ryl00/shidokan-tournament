import type { ClubFormLine } from '../../../domain/club-form.js';
import { DISCIPLINES } from '../../../domain/disciplines.js';
import { hasDiscipline, planFfkImport, prefillExisting, prefillNew, type FfkFighter, type FfkImportPlan, type FfkPdfRead, type FfkStep } from '../../../domain/ffk-pdf-plan.js';
import type { DisciplineId } from '../../../domain/types.js';
import type { ClubEntryView, ClubLine } from '../../api.js';
import { disciplineLabel } from '../../labels.js';
import { ffkBanner, listFr, type FfkFormStep } from '../club-line/ffkStep.js';

/** Ce qui a été fait à chaque étape (par index) : enregistrée, ou laissée. */
export type Done = Record<number, 'saved' | 'skipped'>;

/**
 * Parcours d'import : départ, une étape par combattant à revoir, fin. `fighters` garde la fiche enregistrée à chaque étape
 * (« ← Précédent » la rouvre telle quelle, même renommée) ; `round` change à chaque passage pour remonter la fenêtre.
 */
export type WizardState =
  | { stage: 'start' }
  | { stage: 'step'; plan: FfkImportPlan; index: number; done: Done; fighters: Record<number, string>; round: number }
  | { stage: 'end'; plan: FfkImportPlan; done: Done; fighters: Record<number, string>; remove: string[] };

export type WizardAction =
  | { type: 'start'; plan: FfkImportPlan }
  /** `created` : la fiche a été créée (une fiche existante supprimée entre-temps compte alors comme ajoutée). */
  | { type: 'saved'; fighterId?: string; created?: boolean }
  | { type: 'skipped' }
  | { type: 'previous' }
  /** La fiche a changé ailleurs (409…) : même étape, relue. */
  | { type: 'stale' }
  /** Homonymes : la fiche choisie, ou `null` pour « C’est un autre combattant ». */
  | { type: 'resolve'; fighterId: string | null }
  | { type: 'toggleAbsent'; fighterId: string };

type StepState = Extract<WizardState, { stage: 'step' }>;
type EndState = Extract<WizardState, { stage: 'end' }>;

function advance(s: StepState, done: Done, fighters: Record<number, string>, plan = s.plan): WizardState {
  if (s.index + 1 < plan.steps.length) return { ...s, plan, done, fighters, index: s.index + 1, round: s.round + 1 };
  return { stage: 'end', plan, done, fighters, remove: [] };
}

function replaceStep(plan: FfkImportPlan, index: number, step: FfkStep): FfkImportPlan {
  return { ...plan, steps: plan.steps.map((st, i) => (i === index ? step : st)) };
}

export function wizardReducer(s: WizardState, a: WizardAction): WizardState {
  if (a.type === 'start') {
    return a.plan.steps.length
      ? { stage: 'step', plan: a.plan, index: 0, done: {}, fighters: {}, round: 0 }
      : { stage: 'end', plan: a.plan, done: {}, fighters: {}, remove: [] };
  }
  if (s.stage === 'end') {
    if (a.type !== 'toggleAbsent') return s;
    return { ...s, remove: s.remove.includes(a.fighterId) ? s.remove.filter((id) => id !== a.fighterId) : [...s.remove, a.fighterId] };
  }
  if (s.stage !== 'step') return s;
  const step = s.plan.steps[s.index]!;
  switch (a.type) {
    case 'saved': {
      const fighters = a.fighterId ? { ...s.fighters, [s.index]: a.fighterId } : s.fighters;
      const plan = a.created && step.kind !== 'new' ? replaceStep(s.plan, s.index, { kind: 'new', ffk: step.ffk }) : s.plan;
      return advance(s, { ...s.done, [s.index]: 'saved' }, fighters, plan);
    }
    case 'skipped':
      // Revenue par « Précédent » puis laissée : ce qui a été enregistré l'est toujours.
      return advance(s, { ...s.done, [s.index]: s.done[s.index] === 'saved' ? 'saved' : 'skipped' }, s.fighters);
    case 'previous':
      return s.index > 0 ? { ...s, index: s.index - 1, round: s.round + 1 } : s;
    case 'stale':
      return { ...s, round: s.round + 1 };
    case 'resolve': {
      if (step.kind !== 'homonym') return s;
      // Les écarts sont recalculés à l'affichage, sur la fiche du moment (`stepView`).
      const next: FfkStep = a.fighterId
        ? { kind: 'existing', ffk: step.ffk, fighterId: a.fighterId, diffs: [], addsDiscipline: false, oneCombatBlocked: false, locked: false }
        : { kind: 'new', ffk: step.ffk };
      return { ...s, plan: replaceStep(s.plan, s.index, next), round: s.round + 1 };
    }
    default:
      return s;
  }
}

export function wizardSummary(s: EndState): { added: number; updated: number; left: number } {
  let added = 0;
  let updated = 0;
  s.plan.steps.forEach((step, i) => {
    if (s.done[i] !== 'saved') return;
    if (step.kind === 'new') added++;
    else updated++;
  });
  return { added, updated, left: s.plan.steps.length - added - updated };
}

/** « 1 ajouté », « 2 ajoutés », « 0 ajouté ». */
export const count = (n: number, one: string, many: string) => `${n} ${n <= 1 ? one : many}`;

export function summaryText(sum: ReturnType<typeof wizardSummary>, removed: number, discipline: DisciplineId): string {
  const parts = [count(sum.added, 'ajouté', 'ajoutés'), `${sum.updated} mis à jour`, count(sum.left, 'laissé tel quel', 'laissés tels quels')];
  if (removed) parts.push(`${disciplineLabel(discipline)} retiré de ${count(removed, 'fiche', 'fiches')}`);
  return `Import FFK : ${parts.join(' · ')}.`;
}

/** Disciplines d'une fiche, dans l'ordre habituel. */
export const disciplinesOf = (line: ClubFormLine): DisciplineId[] => (Object.keys(DISCIPLINES) as DisciplineId[]).filter((d) => hasDiscipline(line, d));

/** Une catégorie de poids qui n'est pas celle de la tranche d'âge et du sexe de la fiche (reprise de l'ancienne tranche) est vidée. */
export function fitWeightClass(line: ClubFormLine, weightClasses: ClubEntryView['weightClasses']): ClubFormLine {
  if (line.weightClassId === null) return line;
  const fits = weightClasses.some((w) => w.id === line.weightClassId && w.ageBandCode === line.ageBandCode && w.sex === line.sex);
  return fits ? line : { ...line, weightClassId: null };
}

/** Ce dont dépend l'affichage d'une étape. */
export interface StepContext {
  lines: ClubLine[];
  discipline: DisciplineId;
  multipleCombats: boolean;
  mode: 'coach' | 'organiser';
  weightClasses: ClubEntryView['weightClasses'];
}

/** Contenu de la fenêtre du combattant pour une étape (le composant y ajoute progression et boutons). */
export type FfkFormContent = Pick<FfkFormStep, 'initial' | 'marks' | 'diffs' | 'banner' | 'hints' | 'skipLabel'>;
export type StepView =
  | { kind: 'homonym'; ffk: FfkFighter; candidates: ClubLine[] }
  | { kind: 'form'; line: ClubLine | null; ffk: FfkFormContent };

const notTranslated = (raw: string) => `La FFK indique « ${raw} » : choisissez la catégorie.`;

function newView(ffk: FfkFighter, c: StepContext): StepView {
  const combat = DISCIPLINES[c.discipline].hasWeight;
  const marks: FfkFormContent['marks'] = ['name', 'sex'];
  if (ffk.ageBandCode) marks.push('ageBandCode');
  if (combat && ffk.weightClassId) marks.push('weightClassId');
  if (combat && ffk.rulesetGiven) marks.push('ruleset');
  marks.push('discipline');
  const hints: FfkFormContent['hints'] = {};
  if (ffk.fullName.trim().split(/\s+/).length > 2) hints.name = `La FFK écrit « ${ffk.fullName} » : corrigez la coupure nom / prénom si besoin.`;
  if (!ffk.ageBandCode) hints.ageBandCode = notTranslated(ffk.raw.age);
  if (combat && !ffk.weightClassId && ffk.raw.weight) hints.weightClassId = notTranslated(`${ffk.raw.weight} kg`);
  return {
    kind: 'form', line: null,
    ffk: { initial: fitWeightClass(prefillNew(ffk, c.discipline), c.weightClasses), marks, diffs: [], banner: null, hints, skipLabel: 'Ne pas l’ajouter' },
  };
}

/** La fiche existante comparée de nouveau au PDF, telle qu'elle est maintenant. */
function existingView(ffk: FfkFighter, fresh: ClubLine, c: StepContext): StepView {
  // Comparée sur ce seul combattant, sous le nom et le sexe du PDF (la fiche a pu être renommée) : seuls les autres champs comptent.
  const probe = { ...fresh, line: { ...fresh.line, lastName: ffk.lastName, firstName: ffk.firstName, sex: ffk.sex } };
  const found = planFfkImport([ffk], [probe], c.discipline, { multipleCombats: c.multipleCombats, mode: c.mode }).steps[0];
  const step = found?.kind === 'existing' ? found : null;
  const initial = fitWeightClass(step ? prefillExisting(fresh.line, step, c.discipline) : fresh.line, c.weightClasses);
  const current = disciplinesOf(fresh.line);
  const sentences: string[] = [];
  if (step?.oneCombatBlocked) {
    sentences.push(`Sa fiche est déjà inscrite en ${listFr(fresh.line.combats.map(disciplineLabel))} : une seule discipline de combat à cette compétition. Cochez ${disciplineLabel(c.discipline)} pour changer.`);
  }
  const kept = current.filter((d) => d !== c.discipline);
  if (kept.length) sentences.push(`Gardé, pas dans ce PDF : ${listFr(kept.map(disciplineLabel))}.`);
  return {
    kind: 'form', line: fresh,
    ffk: {
      initial,
      marks: step?.addsDiscipline && !step.oneCombatBlocked ? ['discipline'] : [],
      diffs: step?.diffs ?? [],
      banner: ffkBanner(fresh.line.firstName, current.map(disciplineLabel)),
      hints: sentences.length ? { discipline: sentences.join(' ') } : {},
      skipLabel: 'Laisser la fiche telle quelle',
    },
  };
}

/** Ce que montre l'étape en cours, d'après la liste des fiches du moment (rechargée après chaque écriture ou refus). */
export function stepView(s: StepState, c: StepContext): StepView {
  const step = s.plan.steps[s.index]!;
  const byId = (id: string | undefined) => (id ? c.lines.find((l) => l.fighterId === id) : undefined);
  const saved = s.done[s.index] === 'saved' ? byId(s.fighters[s.index]) : undefined;
  if (saved) {
    // Déjà enregistrée : une modification ordinaire, sans comparaison.
    return { kind: 'form', line: saved, ffk: { initial: saved.line, marks: [], diffs: [], banner: null, hints: {}, skipLabel: 'Laisser la fiche telle quelle' } };
  }
  if (step.kind === 'homonym') {
    const candidates = c.lines.filter((l) => step.candidates.includes(l.fighterId));
    return candidates.length ? { kind: 'homonym', ffk: step.ffk, candidates } : newView(step.ffk, c);
  }
  const fresh = step.kind === 'existing' ? byId(step.fighterId) : undefined;
  // Fiche supprimée entre-temps : le combattant redevient un nouveau.
  return fresh ? existingView(step.ffk, fresh, c) : newView(step.ffk, c);
}

/** Compteurs du départ, sur les fiches du moment. */
export function startCounts(read: FfkPdfRead, plan: FfkImportPlan): { fresh: number; review: number; upToDate: number; duplicates: number } {
  const fresh = plan.steps.filter((st) => st.kind === 'new').length;
  return { fresh, review: plan.steps.length - fresh, upToDate: plan.upToDate, duplicates: read.duplicates.length };
}

/** Absents du PDF encore inscrits dans la discipline ; une fiche verrouillée (ou dont cette discipline a commencé) ne se coche pas. */
export function absentRows(plan: FfkImportPlan, lines: ClubLine[], discipline: DisciplineId): { line: ClubLine; checkable: boolean; others: DisciplineId[] }[] {
  return plan.absents.flatMap((id) => {
    const l = lines.find((x) => x.fighterId === id);
    if (!l || !hasDiscipline(l.line, discipline)) return [];
    const checkable = l.editable || (l.partlyEditable && !l.startedDisciplines.includes(discipline));
    return [{ line: l, checkable, others: disciplinesOf(l.line).filter((d) => d !== discipline) }];
  });
}
