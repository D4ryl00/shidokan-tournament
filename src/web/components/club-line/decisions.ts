import { fieldValue } from '../../../domain/club-form-plan.js';
import type { FfkCardDiff, FfkCardValue, FfkField } from '../../../domain/ffk-plan/values.js';

/** Un écart (`FfkCardDiff`, ou celui de la fenêtre de l'import PDF / ODS, où la fiche peut être vide). */
type Diff = Omit<FfkCardDiff, 'fiche'> & { fiche: string | null };

/** Zone d'un champ de carte d'import : `decide` (écart encore vide, « À choisir »), `decided` (écart rempli, « Choisi »), `null` (pas d'écart). */
export type DecisionZone = 'decide' | 'decided' | null;

/** Valeur d'un champ de carte sous forme de texte (`fieldValue`, plus le club) ; `null` : vide. */
export function cardFieldValue(value: FfkCardValue, field: FfkField): string | null {
  return field === 'clubId' ? value.clubId : fieldValue(value.line, field);
}

/**
 * Zone du champ : un écart avec la fiche, ou une catégorie de poids illisible dans l'export (`weightIssue`). Le règlement
 * sans combat coché n'est ni affiché ni demandé : pas de zone.
 */
export function decisionZone(field: FfkField, diffs: Diff[], value: FfkCardValue, weightIssue?: string | null): DecisionZone {
  if (field === 'ruleset' && value.line.combats.length === 0) return null;
  const toDecide = diffs.some((d) => d.field === field) || (field === 'weightClassId' && !!weightIssue);
  if (!toDecide) return null;
  return cardFieldValue(value, field) === null ? 'decide' : 'decided';
}

/** Nombre de choix encore à faire : les champs en écart restés vides, plus la catégorie de poids illisible restée vide (comptée une fois). */
export function pendingDecisions(diffs: Diff[], value: FfkCardValue, weightIssue?: string | null): number {
  const fields = new Set<FfkField>(diffs.map((d) => d.field));
  if (weightIssue) fields.add('weightClassId');
  return [...fields].filter((f) => decisionZone(f, diffs, value, weightIssue) === 'decide').length;
}
