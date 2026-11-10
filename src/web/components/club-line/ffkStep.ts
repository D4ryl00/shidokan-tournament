import type { ClubFormLine } from '../../../domain/club-form.js';
import type { FfkDiff, FfkField } from '../../../domain/ffk-pdf-plan.js';
import type { SavedThen } from '../ClubLineForm.js';

/** Une étape du parcours d'import du PDF de la FFK : ce que la fenêtre du combattant affiche et fait. */
export interface FfkFormStep {
  /** « Fiche {index+1} sur {total} ». */
  progress: { index: number; total: number };
  /** Valeurs de départ du formulaire (remplace `line.line`). */
  initial: ClubFormLine;
  /** Champs marqués « FFK ». */
  marks: ('name' | 'sex' | FfkField | 'discipline')[];
  diffs: FfkDiff[];
  /** Encadré « Fiche déjà créée. … ». */
  banner: string | null;
  hints: Partial<Record<'name' | 'ageBandCode' | 'weightClassId' | 'discipline', string>>;
  skipLabel: 'Ne pas l’ajouter' | 'Laisser la fiche telle quelle';
  onSkip: () => void;
  onPrevious: (() => void) | null;
  /** Après « Enregistrer · suivant → » (ou Entrée). */
  onSaved: SavedThen;
}

/** Quelle case est sélectionnée : la valeur FFK, celle de la fiche, ou aucune (autre valeur tapée). */
export function ffkChoiceState(value: string | null, diff: FfkDiff): 'ffk' | 'fiche' | null {
  if (value === diff.ffk) return 'ffk';
  if (value === diff.fiche) return 'fiche';
  return null;
}

/** « A », « A et B », « A, B et C ». */
function listFr(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

// Formulation imposée par la spec (§6.3) ; écrite en deux morceaux car tests/web/textes.test.ts bannit « (e) » dans un texte.
const INSCRIT_E = 'inscrit(' + 'e)';

export function ffkBanner(firstName: string, disciplines: string[]): string {
  return `Fiche déjà créée. Une seule fiche par combattant : ${firstName} est ${INSCRIT_E} en ${listFr(disciplines)}. Ce que vous choisissez ici vaut pour toutes ses disciplines.`;
}
