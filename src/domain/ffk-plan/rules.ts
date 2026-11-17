import { CLOSED_WARNING_START, lineToRows, type ClubFormLine } from '../club-form.js';
import { columnLabel, entryKey, type EntryCell } from '../closed-categories.js';
import type { CategoryGrid } from '../types.js';

/**
 * Règles de la compétition qu’une inscription par un club respecte : réglage « plusieurs disciplines de combat le même jour »,
 * catégories ouvertes. L’organisateur peut y déroger (fenêtre combattant, carte validée de l’import FFK).
 */
export interface CompetitionRules {
  multipleCombats: boolean;
  /** Cases fermées du tableau « Catégories ouvertes » (`entryKey`). */
  closed: ReadonlySet<string>;
}

/** Début de la raison d’une carte qui déroge aux règles (« déroge aux règles : Une seule discipline de combat… »). */
export const RULES_BROKEN = 'déroge aux règles : ';

const NO_TOLERANCE = { M: 0, F: 0 };

/** Cases d’une ligne : une par discipline de combat (avec son règlement), le kata. */
function lineCells(line: ClubFormLine): EntryCell[] {
  const { ageBandCode, sex, ruleset } = line;
  if (!ageBandCode || !sex) return [];
  return [
    ...(ruleset ? line.combats.map((discipline): EntryCell => ({ ageBandCode, sex, discipline, ruleset })) : []),
    ...(line.kata ? [{ ageBandCode, sex, discipline: 'kata' as const, ruleset: null }] : []),
  ];
}

/**
 * Catégories non ouvertes où la ligne inscrirait le combattant, sauf celles où la fiche enregistrée (`saved`) l’était déjà :
 * « Catégorie non ouverte à cette compétition (Karaté jiyu). »
 */
export function closedBreaks(line: ClubFormLine, saved: ClubFormLine | null, closed: ReadonlySet<string>): string[] {
  const known = new Set(saved ? lineCells(saved).map(entryKey) : []);
  return lineCells(line)
    .filter((cell) => closed.has(entryKey(cell)) && !known.has(entryKey(cell)))
    .map((cell) => `${CLOSED_WARNING_START} (${columnLabel(cell)}).`);
}

const errorsOf = (line: ClubFormLine, grid: CategoryGrid, multipleCombats: boolean): string[] =>
  lineToRows(line, 1, grid, NO_TOLERANCE, new Set(), { multipleCombats }).flatMap((r) => r.errors);

/**
 * Règles de la compétition que la ligne enfreint (messages complets, « Une seule discipline de combat par combattant à cette
 * compétition. ») : ce qu’une inscription par un club refuserait et que l’organisateur peut faire quand même — erreurs de `lineToRows`
 * avec le vrai réglage absentes en mode organisateur, catégories non ouvertes.
 * Une exception que la fiche enregistrée (`saved`) avait déjà n’est pas redite : plusieurs combats tous déjà enregistrés (comme pour le
 * coach), une case fermée où elle était déjà inscrite.
 */
export function ruleBreaks(line: ClubFormLine, saved: ClubFormLine | null, grid: CategoryGrid, rules: CompetitionRules): string[] {
  const alreadyEntered = !!saved && line.combats.every((d) => saved.combats.includes(d));
  const organiser = new Set(errorsOf(line, grid, true));
  const refused = [...new Set(errorsOf(line, grid, rules.multipleCombats || alreadyEntered))].filter((e) => !organiser.has(e));
  return [...refused, ...closedBreaks(line, saved, rules.closed)];
}
