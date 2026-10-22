import { DISCIPLINES, disciplineFromLabel } from './disciplines.js';

export { disciplineFromLabel };
import { normalizeName, parseSex, parseYesNo } from './names.js';
import { parsePreferences, validateRegistration, type RegistrationInput } from './registration.js';
import type { CategoryGrid, DisciplineId, Ruleset } from './types.js';
import { resolveWeightCell } from './weights.js';

export const CLUB_FORM_TITLE = 'FICHE DE PRÉ-INSCRIPTION CLUB';
/** Libellés en colonne A, valeurs en colonne B, lignes 4 à 8 du tableur. */
export const CLUB_FORM_HEADER_FIELDS = [
  'Club',
  'Coach (nom)',
  'Coach (téléphone)',
  'Coach (e-mail)',
  'Pré-accord du coach (Oui/Non)',
] as const;
export const CLUB_FORM_HEADER_FIRST_ROW = 4;
/** En-tête du tableau des combattants, ligne 11 du tableur. */
export const CLUB_FORM_COLUMNS = [
  'Nom',
  'Prénom',
  'Sexe',
  "Catégorie d'âge",
  'Catégorie de poids',
  'Discipline',
  'Règlement',
  'Autres disciplines (1 karaté, 2 shido-boxing, 3 shido-mix)',
  'Si shobu : jiyu en priorité (Oui/Non)',
  'Poids actuel approx. (kg)',
] as const;
export const CLUB_FORM_COLUMNS_ROW = 11;
export const CLUB_FORM_FIRST_ROW = 12;
export const CLUB_FORM_ROWS = 80;

export interface ClubFormHeader {
  club: string;
  coachName: string | null;
  coachPhone: string | null;
  coachEmail: string | null;
  preApproval: boolean;
}
export interface ClubFormRow {
  /** Numéro de ligne du tableur (1-based). */
  line: number;
  /** Nom et prénom tels que saisis (affichés même si la ligne est en erreur). */
  label: string;
  input: RegistrationInput | null;
  errors: string[];
  /** Remarques non bloquantes (préférences ignorées…). */
  warnings: string[];
}
export interface ClubFormParse {
  header: ClubFormHeader;
  rows: ClubFormRow[];
}

export class NotAClubFormError extends Error {}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const textOrNull = (v: unknown): string | null => text(v) || null;

export function rulesetFromLabel(v: unknown): Ruleset | null {
  const s = normalizeName(text(v)).replace(/ IPPON KUMITE$/, '');
  if (s === 'JIYU' || s === 'JI YU') return 'jiyu';
  if (s === 'SHOBU') return 'shobu';
  return null;
}

function stem(s: string): string {
  return normalizeName(s).replace(/S$/, '').replace(/ETTE$/, 'ET').replace(/INE$/, 'IN');
}

/** Libellé ou code de tranche d'âge (singulier/pluriel, féminin, casse et accents ignorés) ; « Vétéran » seul → v1. */
export function ageBandFromLabel(v: unknown, grid: CategoryGrid): string | null {
  const raw = normalizeName(text(v));
  if (!raw) return null;
  const vet = /^V(?:ETERANS?)?\s*([1-9])$/.exec(raw);
  if (vet) return grid.ageBands.find((b) => b.code === `v${vet[1]}`)?.code ?? null;
  if (/^VETERANS?$/.test(raw)) return grid.ageBands.find((b) => b.code === 'v1')?.code ?? null;
  const key = stem(raw);
  return grid.ageBands.find((b) => stem(b.code) === key || stem(b.label) === key)?.code ?? null;
}

/** Repère la fiche dans le tableur : titre, champs d'en-tête et ligne des colonnes, même si des lignes ont été ajoutées. */
function locate(cells: unknown[][]): { headerRows: Map<string, number>; columnsRow: number } {
  const title = normalizeName(CLUB_FORM_TITLE);
  const titleRow = cells.slice(0, 10).findIndex((r) => normalizeName(text(r?.[0])) === title);
  if (titleRow < 0) throw new NotAClubFormError("Ce fichier n'est pas une fiche club.");
  let columnsRow = -1;
  for (let r = titleRow + 1; r < Math.min(cells.length, titleRow + 40); r++) {
    if (normalizeName(text(cells[r]?.[0])) === 'NOM' && normalizeName(text(cells[r]?.[1])) === 'PRENOM') {
      columnsRow = r;
      break;
    }
  }
  if (columnsRow < 0) throw new NotAClubFormError("En-tête du tableau (« Nom, Prénom, Sexe… ») introuvable : la fiche a-t-elle été modifiée ?");
  const headerRows = new Map<string, number>();
  for (let r = titleRow + 1; r < columnsRow; r++) {
    const label = normalizeName(text(cells[r]?.[0]));
    const field = CLUB_FORM_HEADER_FIELDS.find((f) => normalizeName(f) === label);
    if (field && !headerRows.has(field)) headerRows.set(field, r);
  }
  return { headerRows, columnsRow };
}

function parseHeader(cells: unknown[][], headerRows: Map<string, number>): ClubFormHeader {
  const value = (i: number) => {
    const row = headerRows.get(CLUB_FORM_HEADER_FIELDS[i]!);
    return row === undefined ? null : cells[row]?.[1];
  };
  const club = text(value(0));
  if (!club) throw new NotAClubFormError('Le nom du club est obligatoire (case à droite de « Club » dans la fiche).');
  return {
    club,
    coachName: textOrNull(value(1)),
    coachPhone: textOrNull(value(2)),
    coachEmail: textOrNull(value(3)),
    preApproval: parseYesNo(value(4)) ?? false,
  };
}

function parseRow(row: unknown[], line: number, grid: CategoryGrid): ClubFormRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const [lastName, firstName, sexCell, ageCell, weightCell, disciplineCell, rulesetCell, prefsCell, jiyuCell, approxCell] = row;

  const sex = parseSex(sexCell);
  if (!sex) errors.push(`Sexe incompréhensible : « ${text(sexCell)} ».`);
  const ageBandCode = ageBandFromLabel(ageCell, grid);
  if (!ageBandCode) errors.push(`Catégorie d'âge incompréhensible : « ${text(ageCell)} ».`);
  const discipline = disciplineFromLabel(disciplineCell);
  if (!discipline) errors.push(`Discipline incompréhensible : « ${text(disciplineCell)} ».`);

  let ruleset: Ruleset | null = null;
  let weightClassId: string | null = null;
  if (discipline && DISCIPLINES[discipline].hasWeight) {
    ruleset = rulesetFromLabel(rulesetCell);
    if (!ruleset) errors.push(`Règlement incompréhensible : « ${text(rulesetCell)} » (Jiyu ou Shobu).`);
    if (sex && ageBandCode) {
      const res = resolveWeightCell(grid, ageBandCode, sex, weightCell);
      if (res.kind === 'ok') {
        weightClassId = res.weightClass.id;
        if (res.warning) warnings.push(res.warning);
      } else if (res.kind === 'unknown') {
        errors.push(`Catégorie de poids « ${res.label} » inconnue pour cette catégorie d'âge et ce sexe.`);
      } else errors.push(res.message);
    }
  }

  let otherDisciplines: DisciplineId[] = [];
  if (discipline) {
    const prefs = parsePreferences(prefsCell, discipline);
    otherDisciplines = prefs.value;
    warnings.push(...prefs.errors);
  }
  const jiyu = parseYesNo(jiyuCell);
  const acceptsJiyuFirst = ruleset === 'shobu' ? jiyu : null;
  if (ruleset !== 'shobu' && jiyu) warnings.push('« Jiyu en priorité » ignoré : le combattant n\'est pas inscrit en shobu.');
  const approx = text(approxCell) ? Number(text(approxCell).replace(',', '.')) : null;
  if (approx !== null && !(approx > 0)) warnings.push(`Poids approximatif ignoré : « ${text(approxCell)} ».`);

  const label = `${text(lastName)} ${text(firstName)}`.trim();
  if (errors.length || !sex || !ageBandCode || !discipline) return { line, label, input: null, errors, warnings };
  const input: RegistrationInput = {
    clubId: null,
    lastName: text(lastName),
    firstName: text(firstName),
    sex,
    ageBandCode,
    discipline,
    ruleset,
    weightClassId,
    approxWeightKg: approx !== null && approx > 0 ? approx : null,
    otherDisciplines,
    acceptsJiyuFirst,
    source: 'club_form',
  };
  const invalid = validateRegistration(input, grid);
  return invalid.length ? { line, label, input: null, errors: invalid, warnings } : { line, label, input, errors: [], warnings };
}

/** Lit une fiche club à partir des cellules du tableur (cells[ligne 0-based][colonne 0-based]). */
export function parseClubForm(cells: unknown[][], grid: CategoryGrid): ClubFormParse {
  const { headerRows, columnsRow } = locate(cells);
  const header = parseHeader(cells, headerRows);
  const rows: ClubFormRow[] = [];
  const seen = new Map<string, number>();
  const combatByFighter = new Map<string, Set<DisciplineId>>();
  for (let r = columnsRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    if (row.slice(0, CLUB_FORM_COLUMNS.length).every((c) => text(c) === '')) continue;
    const parsed = parseRow(row, r + 1, grid);
    const who = normalizeName(`${text(row[0])} ${text(row[1])}`);
    if (/^VETERANS?$/.test(normalizeName(text(row[3])))) parsed.warnings.push('« Vétéran » sans numéro : placé en V1 (à corriger si besoin).');
    if (parsed.input) {
      const key = `${who}|${parsed.input.discipline}`;
      const first = seen.get(key);
      if (first !== undefined) {
        rows.push({ ...parsed, input: null, errors: [`Ligne en double (même combattant et même discipline que la ligne ${first}).`] });
        continue;
      }
      seen.set(key, r + 1);
      if (parsed.input.discipline !== 'kata') {
        const set = combatByFighter.get(who) ?? new Set<DisciplineId>();
        if (set.size > 0 && !set.has(parsed.input.discipline)) {
          parsed.warnings.push("Ce combattant est inscrit dans deux disciplines de combat : vérifier que c'est autorisé pour cette compétition.");
        }
        set.add(parsed.input.discipline);
        combatByFighter.set(who, set);
      }
    }
    rows.push(parsed);
  }
  return { header, rows };
}
