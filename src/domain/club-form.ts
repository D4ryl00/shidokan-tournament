import { columnLabel, isEntryClosed } from './closed-categories.js';
import { DISCIPLINES, disciplineFromLabel } from './disciplines.js';

export { disciplineFromLabel };
import { cleanEmails, splitEmails } from './emails.js';
import { normalizeName, parseSex, parseYesNo } from './names.js';
import { parsePreferences, validateRegistration, type RegistrationInput } from './registration.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';
import { pickWeightClass, resolveWeightCell, weightClassForWeight } from './weights.js';

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
/** En-tête du tableau des combattants, ligne 11 du tableur : une ligne par combattant (ordre de la fiche papier). */
export const CLUB_FORM_COLUMNS = [
  'Nom',
  'Prénom',
  'Sexe',
  "Catégorie d'âge",
  'Poids actuel (kg)',
  'Discipline de combat',
  'Kata (Oui/Non)',
  'Grade (si kata)',
  'Règlement',
  // Sous l'en-tête commun CLUB_FORM_RECLASS_HEADER (ligne au-dessus) : ordre 1 ou 2.
  'Karaté',
  'Boxing',
  'Mix',
  'Shobu : si reclassement, garder en priorité',
] as const;
export const CLUB_FORM_RECLASS_HEADER = 'Si reclassement : autres disciplines, numéroter 1, 2';
/** Valeurs de la dernière colonne (fiche papier : « 1. les règles shobu », « 2. la discipline »). */
export const SHOBU_KEEP_LABELS = { ruleset: 'Les règles shobu', discipline: 'La discipline' } as const;
/** Ancien format (une ligne par inscription, catégorie de poids) : les fiches déjà renvoyées restent lisibles. */
export const CLUB_FORM_LEGACY_COLUMNS = [
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
  coachEmails: string[];
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

export type CombatDiscipline = 'karate' | 'shido-boxing' | 'shido-mix' | 'triathlon';
export type PrefDiscipline = 'karate' | 'shido-boxing' | 'shido-mix';
/** Une ligne de fiche telle que remplie (papier, .ods ou saisie) : un combattant. */
export interface ClubFormLine {
  lastName: string;
  firstName: string;
  sex: Sex | null;
  ageBandCode: string | null;
  /** Catégorie de poids choisie (en ligne) ; null : déduite du poids actuel (fiche papier, tableur). */
  weightClassId: string | null;
  weightKg: number | null;
  combat: CombatDiscipline | null;
  kata: boolean;
  grade: string | null;
  ruleset: Ruleset | null;
  prefs: Partial<Record<PrefDiscipline, 1 | 2>>;
  shobuKeep: 'ruleset' | 'discipline' | null;
}
export type WeighInTolerance = { M: number; F: number };

const ABBREVIATIONS: Record<string, string> = {
  'mini-poussin': 'MP', poussin: 'P', pupille: 'Pu', benjamin: 'B', minime: 'Mi', cadet: 'C', junior: 'J', espoir: 'E', senior: 'S',
  v1: 'V1', v2: 'V2', v3: 'V3', v4: 'V4', v5: 'V5',
};
/** Abréviation d'une tranche d'âge sur la fiche papier ; à défaut, les deux premières lettres du libellé. */
export function ageBandAbbreviation(code: string, label: string): string {
  return ABBREVIATIONS[code] ?? label.slice(0, 2);
}

/** Abréviations d'une grille, sans doublon : à défaut, trois lettres, puis un numéro. */
export function ageBandAbbreviations(bands: { code: string; label: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const b of bands) {
    const base = ageBandAbbreviation(b.code, b.label);
    let abbr = base;
    if (used.has(abbr)) abbr = b.label.replace(/\s+/g, '').slice(0, 3);
    for (let n = 2; used.has(abbr); n++) abbr = `${base}${n}`;
    used.add(abbr);
    out.set(b.code, abbr);
  }
  return out;
}

/** Début de l'avertissement d'une ligne dans une catégorie fermée (résumé des aperçus d'import). */
export const CLOSED_WARNING_START = 'Catégorie non ouverte à cette compétition';

/** Avertissement d'une inscription dans une catégorie fermée (null si elle est ouverte). */
export function closedEntryWarning(input: Pick<RegistrationInput, 'ageBandCode' | 'sex' | 'discipline' | 'ruleset'>, closed: ReadonlySet<string>): string | null {
  const cell = { ageBandCode: input.ageBandCode, sex: input.sex, discipline: input.discipline, ruleset: input.ruleset };
  return isEntryClosed(closed, cell) ? `${CLOSED_WARNING_START} (${columnLabel(cell)}) : la ligne ira en Réaffectation.` : null;
}

/** Ajoute aux lignes valides l'avertissement des catégories fermées. */
function warnClosed(rows: ClubFormRow[], closed: ReadonlySet<string>): ClubFormRow[] {
  for (const r of rows) {
    const w = r.input ? closedEntryWarning(r.input, closed) : null;
    if (w) r.warnings.push(w);
  }
  return rows;
}

/** « 52,5 ». */
export const kgText = (kg: number): string => String(kg).replace('.', ',');

/**
 * Avertissement non bloquant (page du club) : le poids actuel n'est pas dans la catégorie de poids choisie
 * (bornes de la grille, sans tolérance). `weightClasses` : de la plus légère à l'ouverte.
 */
export function weightWarning(
  line: Pick<ClubFormLine, 'ageBandCode' | 'sex' | 'weightClassId' | 'weightKg' | 'combat'>,
  weightClasses: { id: string; ageBandCode: string; sex: Sex; label: string; maxKg: number | null }[],
): string | null {
  if (line.weightKg === null || !line.weightClassId || !line.combat) return null;
  const classes = weightClasses.filter((w) => w.ageBandCode === line.ageBandCode && w.sex === line.sex);
  const chosen = classes.find((w) => w.id === line.weightClassId);
  const fits = pickWeightClass(classes, line.weightKg, 0);
  if (!chosen || !fits || fits.id === chosen.id) return null;
  return `Le poids actuel (${kgText(line.weightKg)} kg) est en dehors de la catégorie ${chosen.label} kg : il correspond à ${fits.label} kg.`;
}

export const WEIGHT_MISSING = 'Poids actuel manquant (nécessaire pour la catégorie de poids).';

/** Une ligne → une ou deux lignes d'inscription (combat puis kata), avec le même numéro de ligne. */
export function lineToRows(line: ClubFormLine, lineNumber: number, grid: CategoryGrid, tolerance: WeighInTolerance, closed: ReadonlySet<string> = new Set()): ClubFormRow[] {
  const label = `${line.lastName.trim()} ${line.firstName.trim()}`.trim();
  const common: string[] = [];
  if (!line.sex) common.push('Sexe manquant.');
  if (!line.ageBandCode) common.push("Catégorie d'âge manquante.");
  if (!line.combat && !line.kata) common.push('Aucune discipline cochée.');
  if (common.length || !line.sex || !line.ageBandCode) return [{ line: lineNumber, label, input: null, errors: common, warnings: [] }];
  const base = {
    clubId: null, lastName: line.lastName.trim(), firstName: line.firstName.trim(), sex: line.sex, ageBandCode: line.ageBandCode,
    source: 'club_form' as const,
  };
  const rows: ClubFormRow[] = [];
  if (line.combat) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const combat = line.combat;
    if (!line.ruleset) errors.push('Règlement manquant (Jiyu ou Shobu).');
    // La catégorie choisie fait foi (validateRegistration vérifie l'âge et le sexe) ; à défaut, celle du poids actuel.
    let weightClassId: string | null = line.weightClassId;
    if (weightClassId === null && line.weightKg === null) errors.push(WEIGHT_MISSING);
    else if (weightClassId === null && line.weightKg !== null) {
      const wc = weightClassForWeight(grid, line.ageBandCode, line.sex, line.weightKg, tolerance[line.sex]);
      if (wc) weightClassId = wc.id;
      else errors.push("Pas de catégorie de poids pour cet âge et ce sexe dans la grille.");
    }
    const ordered = (Object.entries(line.prefs) as [PrefDiscipline, 1 | 2][]).sort((a, b) => a[1] - b[1]).map(([d]) => d as DisciplineId);
    let otherDisciplines: DisciplineId[] = [];
    if (ordered.length && !DISCIPLINES[combat].inPreferences) {
      warnings.push(`Pas de reclassement vers une autre discipline pour le ${DISCIPLINES[combat].label.toLowerCase()} : préférences ignorées.`);
    } else {
      if (ordered.includes(combat)) warnings.push('Reclassement vers sa propre discipline ignoré.');
      otherDisciplines = ordered.filter((d) => d !== combat);
    }
    let acceptsJiyuFirst: boolean | null = null;
    if (line.ruleset === 'shobu') acceptsJiyuFirst = line.shobuKeep === 'discipline' ? true : line.shobuKeep === 'ruleset' ? false : null;
    else if (line.shobuKeep) warnings.push('« Garder en priorité » ignoré : le combattant n\'est pas inscrit en shobu.');
    if (errors.length) rows.push({ line: lineNumber, label, input: null, errors, warnings });
    else {
      const input: RegistrationInput = { ...base, discipline: combat, ruleset: line.ruleset, weightClassId, approxWeightKg: line.weightKg, otherDisciplines, acceptsJiyuFirst };
      const invalid = validateRegistration(input, grid);
      rows.push(invalid.length ? { line: lineNumber, label, input: null, errors: invalid, warnings } : { line: lineNumber, label, input, errors: [], warnings });
    }
  }
  if (line.kata) {
    // Le grade ne vient que du kata : une ligne de combat seule ne l'efface pas (grade absent = conservé).
    const input: RegistrationInput = { ...base, grade: line.grade?.trim() || null, discipline: 'kata', ruleset: null, weightClassId: null, approxWeightKg: line.weightKg, otherDisciplines: [], acceptsJiyuFirst: null };
    const invalid = validateRegistration(input, grid);
    rows.push(invalid.length ? { line: lineNumber, label, input: null, errors: invalid, warnings: [] } : { line: lineNumber, label, input, errors: [], warnings: [] });
  }
  return warnClosed(rows, closed);
}

const COMBAT_LABELS = new Set<DisciplineId>(['karate', 'shido-boxing', 'shido-mix', 'triathlon']);
function cellsToLine(row: unknown[], grid: CategoryGrid): { line: ClubFormLine; warnings: string[]; errors: string[] } {
  const [lastName, firstName, sexCell, ageCell, weightCell, combatCell, kataCell, gradeCell, rulesetCell, prefK, prefB, prefM, keepCell] = row;
  const warnings: string[] = [];
  const errors: string[] = [];
  const sex = parseSex(sexCell);
  if (text(sexCell) && !sex) errors.push(`Sexe incompréhensible : « ${text(sexCell)} ».`);
  const ageBandCode = ageBandFromLabel(ageCell, grid);
  if (text(ageCell) && !ageBandCode) errors.push(`Catégorie d'âge incompréhensible : « ${text(ageCell)} ».`);
  const combatRaw = disciplineFromLabel(combatCell);
  const combat = combatRaw && COMBAT_LABELS.has(combatRaw) ? (combatRaw as CombatDiscipline) : null;
  // « Kata » écrit dans la colonne de combat : c'est une inscription en kata.
  const kataInCombat = combatRaw === 'kata';
  if (text(combatCell) && !combat && !kataInCombat) warnings.push(`Discipline de combat incompréhensible : « ${text(combatCell)} » (ignorée).`);
  const kataText = normalizeName(text(kataCell));
  const kataYes = kataText === 'KATA' || kataText === 'K' || kataText === '✓' ? true : parseYesNo(kataCell);
  if (kataText && kataYes === null) warnings.push(`Case Kata incomprise : « ${text(kataCell)} » (Oui ou Non) — pas d'inscription en kata.`);
  const weightText = text(weightCell).replace(',', '.').replace(/\s*kg$/i, '');
  const weightKg = weightText && Number(weightText) > 0 ? Number(weightText) : null;
  if (weightText && weightKg === null) errors.push(`Poids actuel incompréhensible : « ${text(weightCell)} ».`);
  const prefs: ClubFormLine['prefs'] = {};
  for (const [d, cell] of [['karate', prefK], ['shido-boxing', prefB], ['shido-mix', prefM]] as const) {
    const n = text(cell);
    if (n === '1' || n === '2') prefs[d] = Number(n) as 1 | 2;
    else if (n) warnings.push(`Ordre de reclassement « ${n} » ignoré (1 ou 2).`);
  }
  const keep = normalizeName(text(keepCell));
  const shobuKeep = !keep ? null : keep.includes('REGLE') || keep === '1' ? 'ruleset' : keep.includes('DISCIPLINE') || keep === '2' ? 'discipline' : null;
  if (keep && !shobuKeep) warnings.push(`Priorité shobu incompréhensible : « ${text(keepCell)} ».`);
  return {
    line: {
      lastName: text(lastName), firstName: text(firstName), sex, ageBandCode, weightClassId: null,
      weightKg, combat, kata: kataYes === true || kataInCombat, grade: textOrNull(gradeCell), ruleset: rulesetFromLabel(rulesetCell), prefs, shobuKeep,
    },
    warnings,
    errors,
  };
}

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
  // Titre en colonne A (ancien modèle) ou B (à côté du logo).
  const titleRow = cells.slice(0, 10).findIndex((r) => [0, 1, 2].some((i) => normalizeName(text(r?.[i])) === title));
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
    coachEmails: cleanEmails(splitEmails(textOrNull(value(3)))),
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
export function parseClubForm(cells: unknown[][], grid: CategoryGrid, tolerance: WeighInTolerance = { M: 0, F: 0 }, closed: ReadonlySet<string> = new Set()): ClubFormParse {
  const { headerRows, columnsRow } = locate(cells);
  const header = parseHeader(cells, headerRows);
  // Nouveau format reconnu à sa 5e colonne (« Poids actuel ») ; sinon, ancien format.
  const isNew = normalizeName(text(cells[columnsRow]?.[4])).startsWith('POIDS ACTUEL');
  const width = isNew ? CLUB_FORM_COLUMNS.length : CLUB_FORM_LEGACY_COLUMNS.length;
  const rows: ClubFormRow[] = [];
  const seen = new Map<string, number>();
  const combatByFighter = new Map<string, Set<DisciplineId>>();
  for (let r = columnsRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    if (row.slice(0, width).every((c) => text(c) === '')) continue;
    const parsedRows = isNew
      ? (() => {
          const { line, warnings, errors } = cellsToLine(row, grid);
          // Une valeur illisible prime sur « manquant » (même ligne, un seul message par case).
          if (errors.length) return [{ line: r + 1, label: `${line.lastName} ${line.firstName}`.trim(), input: null, errors, warnings }];
          const out = lineToRows(line, r + 1, grid, tolerance, closed);
          out[0]!.warnings.unshift(...warnings);
          return out;
        })()
      : warnClosed([parseRow(row, r + 1, grid)], closed);
    const who = normalizeName(`${text(row[0])} ${text(row[1])}`);
    if (/^VETERANS?$/.test(normalizeName(text(row[3])))) parsedRows[0]!.warnings.push('« Vétéran » sans numéro : placé en V1 (à corriger si besoin).');
    rows.push(...checkRows(parsedRows, who, r + 1, seen, combatByFighter));
  }
  return { header, rows };
}

/** Fiche saisie à l'écran (fiche papier) : mêmes inscriptions et mêmes contrôles qu'un import, ligne n = n-ième ligne saisie. */
export function parseClubFormLines(header: ClubFormHeader, lines: ClubFormLine[], grid: CategoryGrid, tolerance: WeighInTolerance, closed: ReadonlySet<string> = new Set()): ClubFormParse {
  const seen = new Map<string, number>();
  const combatByFighter = new Map<string, Set<DisciplineId>>();
  const rows = lines.flatMap((line, i) => {
    if (!line.lastName.trim() && !line.firstName.trim() && !line.combat && !line.kata) return [];
    const who = normalizeName(`${line.lastName} ${line.firstName}`);
    return checkRows(lineToRows(line, i + 1, grid, tolerance, closed), who, i + 1, seen, combatByFighter);
  });
  return { header, rows };
}

/** Doublons (même combattant, même discipline) et deux disciplines de combat, sur les lignes d'inscription produites. */
function checkRows(parsedRows: ClubFormRow[], who: string, line: number, seen: Map<string, number>, combatByFighter: Map<string, Set<DisciplineId>>): ClubFormRow[] {
  const out: ClubFormRow[] = [];
  for (const parsed of parsedRows) {
    if (parsed.input) {
      const key = `${who}|${parsed.input.discipline}`;
      const first = seen.get(key);
      if (first !== undefined) {
        out.push({ ...parsed, input: null, errors: [`Ligne en double (même combattant et même discipline que la ligne ${first}).`] });
        continue;
      }
      seen.set(key, line);
      if (parsed.input.discipline !== 'kata') {
        const set = combatByFighter.get(who) ?? new Set<DisciplineId>();
        if (set.size > 0 && !set.has(parsed.input.discipline)) {
          parsed.warnings.push("Ce combattant est inscrit dans deux disciplines de combat : vérifier que c'est autorisé pour cette compétition.");
        }
        set.add(parsed.input.discipline);
        combatByFighter.set(who, set);
      }
    }
    out.push(parsed);
  }
  return out;
}
