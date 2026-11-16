import type { ClubFormItem } from '../../../domain/club-form-read.js';
import { clubFormDiffs, prefillExistingFromFile, prefillFromFile } from '../../../domain/club-form-plan.js';
import type { ClubEntryView, ClubLine } from '../../api.js';
import { disciplineLabel } from '../../labels.js';
import { ffkBanner } from '../club-line/ffkStep.js';
import {
  count, disciplinesOf, fitWeightClass, lockedKept, routeStep, summaryParts,
  type FfkFormContent, type StepView, type WizardPlan, type WizardState, type wizardSummary,
} from '../ffk-import/wizard.js';

/** Ce dont dépend l'affichage d'une étape de la fiche renvoyée. */
export interface ClubFormStepContext {
  lines: ClubLine[];
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
}

const LABELS = { imported: 'Fiche renvoyée', saved: 'Enregistré' };

/** Encadré d'une fiche sans discipline (pas de liste vide « inscrite en . »). */
const NO_DISCIPLINE_BANNER = 'Fiche déjà créée. Une seule fiche par combattant : sous chaque différence, choisissez la valeur à garder.';
/** La même, verrouillée : rien à choisir. */
const LOCKED_NO_DISCIPLINE_BANNER = 'Fiche déjà créée. Une seule fiche par combattant.';

/** Les remarques de lecture de la ligne, s'il y en a. */
const notesOf = (item: ClubFormItem): Pick<FfkFormContent, 'notes'> =>
  item.notes.length ? { notes: { title: `Dans la fiche (ligne ${item.rows.join(', ')})`, lines: item.notes } } : {};

function newView(item: ClubFormItem, c: ClubFormStepContext): StepView<ClubFormItem> {
  const minorBands = new Set(c.ageBands.filter((b) => b.isMinor).map((b) => b.code));
  return {
    kind: 'form', line: null,
    ffk: { initial: fitWeightClass(prefillFromFile(item.line, minorBands), c.weightClasses), marks: [], diffs: [], banner: null, hints: {}, skipLabel: 'Ne pas l’ajouter', ...notesOf(item) },
  };
}

/** La fiche existante comparée de nouveau à la fiche renvoyée, telle qu'elle est maintenant (relue après un refus comprise). */
function existingView(item: ClubFormItem, fresh: ClubLine, c: ClubFormStepContext): StepView<ClubFormItem> {
  // Nom, prénom et sexe ne sont jamais comparés : la fiche a pu être renommée, seuls les autres champs comptent.
  const diffs = clubFormDiffs(item.line, fresh.line);
  const initial = fitWeightClass(lockedKept(fresh, prefillExistingFromFile(fresh.line, diffs, fresh.startedDisciplines, item.line)), c.weightClasses);
  const locked = !fresh.editable && !fresh.partlyEditable;
  const current = disciplinesOf(fresh.line);
  // Verrouillée : rien à choisir, l'encadré s'arrête aux disciplines.
  const base = current.length ? ffkBanner(fresh.line.firstName, current.map(disciplineLabel), { locked: true }) : null;
  // Seule nouveauté une licence (aucune différence) : l'encadré dit ce que la fiche apporte.
  const licenceOnly = diffs.length === 0 && !fresh.line.licence && item.line.licence ? ` La fiche renvoyée ajoute seulement son N° de licence (${item.line.licence}).` : null;
  const banner = base === null ? (locked ? LOCKED_NO_DISCIPLINE_BANNER : NO_DISCIPLINE_BANNER) : locked ? base : `${base}${licenceOnly ?? ' Sous chaque différence, choisissez la valeur à garder.'}`;
  // Combattant confirmé par l'export FFK : la case de droite dit ce qu'on remplace.
  const confirmed = (field: string) => fresh.ffkConfirmed === true && (field === 'ageBandCode' || field === 'weightClassId');
  return {
    kind: 'form', line: fresh,
    ffk: {
      initial, marks: [], banner, hints: {},
      diffs: diffs.map((d) => (confirmed(d.field) ? { ...d, savedLabel: 'Enregistré · confirmé FFK' } : d)),
      // Verrouillée : « Suivant → » seul (rien à enregistrer, un second bouton ferait la même chose).
      skipLabel: locked ? null : 'Laisser la fiche telle quelle',
      ...notesOf(item),
    },
  };
}

/** Ce que montre l'étape en cours : mêmes règles que le PDF FFK, cases « Fiche renvoyée » / « Enregistré ». */
export function clubFormStepView(s: WizardState<ClubFormItem> & { stage: 'step' }, c: ClubFormStepContext): StepView<ClubFormItem> {
  const v = routeStep(s, c.lines, { who: (item) => item.line, fresh: (item) => newView(item, c), existing: (item, fresh) => existingView(item, fresh, c) });
  // Les remarques de la fiche restent affichées sur une fiche déjà enregistrée (« ← Précédent »).
  return v.kind === 'form' ? { ...v, ffk: { ...notesOf(s.plan.steps[s.index]!.ffk), ...v.ffk, labels: LABELS } } : v;
}

/** Fiches du club absentes de la fiche renvoyée (toutes disciplines) ; seule une fiche modifiable se coche (suppression entière). */
export function clubFormAbsentRows(plan: WizardPlan<ClubFormItem>, lines: ClubLine[]): { line: ClubLine; checkable: boolean }[] {
  return plan.absents.flatMap((id) => {
    const line = lines.find((l) => l.fighterId === id);
    return line ? [{ line, checkable: line.editable }] : [];
  });
}

/** « Fiche renvoyée : 2 ajoutés · 1 mis à jour · 0 laissé tel quel · 1 fiche supprimée. » */
export function clubFormSummaryText(sum: ReturnType<typeof wizardSummary>, deleted: number): string {
  const parts = [...summaryParts(sum), ...(deleted ? [count(deleted, 'fiche supprimée', 'fiches supprimées')] : [])];
  return `Fiche renvoyée : ${parts.join(' · ')}.`;
}
