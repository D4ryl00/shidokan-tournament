import type { CategoryKey } from './categories.js';
import { DISCIPLINES, RULESETS } from './disciplines.js';
import type { AgeBand, CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';

/** Case du tableau « Catégories ouvertes » : une tranche, un sexe, une discipline et son règlement (null pour le kata). */
export interface EntryCell {
  ageBandCode: string;
  sex: Sex;
  discipline: DisciplineId;
  ruleset: Ruleset | null;
}
type Column = { discipline: DisciplineId; ruleset: Ruleset | null };

/** Le tableau « Catégories ouvertes » d'une compétition, tel que l'API le donne. */
export interface ClosedCategoriesView {
  closed: EntryCell[];
  /** Par case (`entryKey`) : inscriptions non déplacées dont c'est la catégorie naturelle. */
  counts: Record<string, number>;
  /** Cases couvertes par une catégorie lancée, commencée ou terminée : elles ne se ferment plus. */
  locked: string[];
}

/** Colonnes du tableau, dans l'ordre affiché : chaque discipline de combat en jiyu puis shobu, puis le kata. */
export const ENTRY_COLUMNS: readonly Column[] = [
  ...(['karate', 'shido-boxing', 'shido-mix', 'triathlon'] as const).flatMap((discipline) =>
    (['jiyu', 'shobu'] as const).map((ruleset) => ({ discipline, ruleset })),
  ),
  { discipline: 'kata', ruleset: null },
];

const SEXES: Sex[] = ['F', 'M'];

export const entryKey = (c: EntryCell): string => `${c.ageBandCode}|${c.sex}|${c.discipline}|${c.ruleset ?? ''}`;

/** « Karaté jiyu », « Kata ». */
export const columnLabel = (col: Column): string =>
  col.ruleset ? `${DISCIPLINES[col.discipline].label} ${col.ruleset}` : DISCIPLINES[col.discipline].label;

/** Colonnes qui existent pour une tranche : pas de shobu chez les mineurs. */
const columnsFor = (band: AgeBand) => ENTRY_COLUMNS.filter((c) => !(c.ruleset && RULESETS[c.ruleset].adultsOnly && band.isMinor));

/** Toutes les cases valides de la grille : tranches dans l'ordre, F puis M, colonnes dans l'ordre. */
export function entryCells(grid: CategoryGrid): EntryCell[] {
  return grid.ageBands.flatMap((band) => SEXES.flatMap((sex) => columnsFor(band).map((col) => ({ ageBandCode: band.code, sex, ...col }))));
}

export const isEntryClosed = (closed: ReadonlySet<string>, c: EntryCell): boolean => closed.has(entryKey(c));

/** Une catégorie est fermée quand toutes ses parts (tranche × sexe, F et M pour une catégorie mixte) le sont. */
export function categoryKeyClosed(closed: ReadonlySet<string>, key: CategoryKey): boolean {
  const sexes: Sex[] = key.sex === 'X' ? SEXES : [key.sex];
  return key.ageBandCodes.length > 0 && key.ageBandCodes.every((ageBandCode) =>
    sexes.every((sex) => closed.has(entryKey({ ageBandCode, sex, discipline: key.discipline, ruleset: key.ruleset }))),
  );
}

/** Tranches proposées aux clubs : celles qui ont au moins une case ouverte. */
export function offeredAgeBands(grid: CategoryGrid, closed: ReadonlySet<string>): AgeBand[] {
  return grid.ageBands.filter((band) => SEXES.some((sex) => columnsFor(band).some((col) => !closed.has(entryKey({ ageBandCode: band.code, sex, ...col })))));
}

/** Ce qui n'est pas ouvert, en phrases (fiches club) : « Benjamins (F et M) : pas de Shido-mix-martial ». */
export function closedSummary(grid: CategoryGrid, closed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const band of grid.ageBands) {
    const cols = columnsFor(band);
    const isClosed = (sex: Sex, col: Column) => closed.has(entryKey({ ageBandCode: band.code, sex, ...col }));
    if (SEXES.every((sex) => cols.every((col) => isClosed(sex, col)))) {
      out.push(`${band.label} : aucune catégorie ouverte`);
      continue;
    }
    const lists = SEXES.map((sex) => {
      const labels: string[] = [];
      for (const discipline of [...new Set(cols.map((c) => c.discipline))]) {
        const own = cols.filter((c) => c.discipline === discipline);
        const shut = own.filter((c) => isClosed(sex, c));
        if (shut.length === own.length) labels.push(DISCIPLINES[discipline].label);
        else labels.push(...shut.map(columnLabel));
      }
      return labels.join(', ');
    });
    const [f, m] = lists as [string, string];
    if (f && f === m) out.push(`${band.label} (F et M) : pas de ${f}`);
    else {
      if (f) out.push(`${band.label} (F) : pas de ${f}`);
      if (m) out.push(`${band.label} (M) : pas de ${m}`);
    }
  }
  return out;
}
