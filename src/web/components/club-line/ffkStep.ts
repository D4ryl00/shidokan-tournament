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
export function listFr(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** `locked` : fiche non modifiable, rien à choisir (la raison est dite à côté). */
export function ffkBanner(firstName: string, disciplines: string[], opts: { locked?: boolean } = {}): string {
  const base = `Fiche déjà créée. Une seule fiche par combattant : celle de ${firstName} est inscrite en ${listFr(disciplines)}.`;
  return opts.locked ? base : `${base} Ce que vous choisissez ici vaut pour toutes ses disciplines.`;
}

/** Une valeur ne peut être reprise que si la liste actuelle du champ la propose (sinon le formulaire afficherait un champ vide que le serveur refuse). `null` (champ vidé) est toujours permis. */
export function ffkValueAvailable(value: string | null, options: string[]): boolean {
  return value === null || options.includes(value);
}
