import { ageBandFromLabel, closedEntryWarning, normalizeLicence, rulesetFromLabel } from './club-form.js';
import { DISCIPLINES, disciplineFromLabel } from './disciplines.js';
import { normalizeName, parseSex, splitFullName } from './names.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';
import { resolveWeightCell } from './weights.js';

export const FFK_FIELDS = ['lastName', 'firstName', 'licence', 'club', 'sex', 'discipline', 'ageBand', 'weight', 'ruleset'] as const;
export type FfkField = (typeof FFK_FIELDS)[number];

export const FFK_FIELD_LABELS: Record<FfkField, string> = {
  lastName: 'Nom',
  firstName: 'Prénom',
  licence: 'N° de licence',
  club: 'Club (entité)',
  sex: 'Sexe',
  discipline: 'Discipline',
  ageBand: "Catégorie d'âge",
  weight: 'Catégorie de poids',
  ruleset: 'Règlement',
};

/** Titres reconnus (après normalizeName). Dans l'export FFK, « Type » = discipline et « Discipline » = règlement. */
const ALIASES: Record<FfkField, string[]> = {
  lastName: ['NOM', 'NOM DE FAMILLE'],
  firstName: ['PRENOM'],
  licence: ['NUMERO', 'LICENCE', 'N LICENCE', 'NUMERO LICENCE', 'NUMERO DE LICENCE', 'NO LICENCE'],
  club: ['ENTITE RATTACHEMENT', 'CLUB', 'ENTITE', 'ENTITE DE RATTACHEMENT'],
  sex: ['GENRE', 'SEXE'],
  discipline: ['TYPE', 'EPREUVE'],
  ageBand: ['AGE', 'CATEGORIE D AGE', 'CATEGORIE AGE'],
  weight: ['CATEGORIE', 'POIDS', 'CATEGORIE DE POIDS', 'CATEGORIE POIDS'],
  ruleset: ['DISCIPLINE', 'REGLEMENT'],
};

export type ColumnMapping = Record<FfkField, number | null>;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export function guessColumnMapping(headers: unknown[]): ColumnMapping {
  const normalized = headers.map((h) => normalizeName(text(h)));
  const mapping = Object.fromEntries(FFK_FIELDS.map((f) => [f, null])) as ColumnMapping;
  for (const field of FFK_FIELDS) {
    const index = normalized.findIndex((h) => ALIASES[field].includes(h));
    mapping[field] = index >= 0 ? index : null;
  }
  return mapping;
}

const recognized = (row: unknown[]) => Object.values(guessColumnMapping(row)).filter((v) => v !== null).length;

/** Première ligne (parmi les 10 premières) qui ressemble à un en-tête (≥ 3 titres reconnus). */
export function findHeaderRow(cells: unknown[][]): number | null {
  for (let r = 0; r < Math.min(10, cells.length); r++) if (recognized(cells[r] ?? []) >= 3) return r;
  return null;
}

export function headerSignature(headers: unknown[]): string {
  return headers.map((h) => normalizeName(text(h))).join('|');
}

export function disciplineFromSheetName(name: string): DisciplineId | null {
  const s = normalizeName(name);
  if (s.includes('KATA')) return 'kata';
  if (s.includes('TRIATHLON')) return 'triathlon';
  if (s.includes('MIX')) return 'shido-mix';
  if (s.includes('BOX')) return 'shido-boxing';
  if (s.includes('KARATE')) return 'karate';
  return null;
}

/** « Séniors jiyu ippon kumite » → âge « Séniors » + règlement jiyu ; sinon la case telle quelle. */
export function splitAgeCell(v: unknown): { age: unknown; ruleset: Ruleset | null } {
  const m = /^(.*?)\s+((?:JIYU|JI YU|SHOBU)(?: IPPON KUMITE)?)$/.exec(normalizeName(text(v)));
  const ruleset = m ? rulesetFromLabel(m[2]) : null;
  return m && m[1] && ruleset ? { age: m[1], ruleset } : { age: v, ruleset: null };
}

export interface FfkRow {
  /** `${sheet}#${line}` : clé stable pour les décisions de l'organisateur. */
  key: string;
  sheet: string;
  /** Ligne du tableur (1-based). */
  line: number;
  licence: string | null;
  lastName: string;
  firstName: string;
  clubEntity: string | null;
  clubName: string | null;
  sex: Sex | null;
  ageBandCode: string | null;
  discipline: DisciplineId | null;
  ruleset: Ruleset | null;
  /** Libellé normalisé (« -35 », « +84 ») ; null pour le kata. */
  weightLabel: string | null;
  /** Poids illisible (non bloquant : la carte le signale) ; `weightLabel` reste alors null. */
  weightIssue?: string | null;
  errors: string[];
  warnings: string[];
}

export function parseFfkRows(
  cells: unknown[][],
  headerRow: number,
  mapping: ColumnMapping,
  sheetName: string,
  grid: CategoryGrid,
  closed: ReadonlySet<string> = new Set(),
): FfkRow[] {
  const sheetDiscipline = disciplineFromSheetName(sheetName);
  const get = (row: unknown[], f: FfkField) => (mapping[f] === null ? null : (row[mapping[f]!] ?? null));
  const rows: FfkRow[] = [];
  for (let r = headerRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    const used = FFK_FIELDS.map((f) => text(get(row, f)));
    if (used.every((v) => v === '')) continue;
    const errors: string[] = [];
    const warnings: string[] = [];

    const { lastName, firstName } = splitFullName(text(get(row, 'lastName')), text(get(row, 'firstName')) || null);
    if (!lastName) errors.push('Nom manquant.');
    // Même forme que les licences saisies dans l'appli : sans espaces, en majuscules.
    const licence = normalizeLicence(text(get(row, 'licence')));
    if (!licence) warnings.push('Pas de numéro de licence.');
    const clubEntity = text(get(row, 'club')) || null;
    const clubName = clubEntity ? clubEntity.replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim() || clubEntity : null;
    if (!clubEntity) warnings.push('Pas de club.');

    const sexCell = get(row, 'sex');
    const sex = parseSex(sexCell);
    if (!sex) errors.push(`Sexe incompréhensible : « ${text(sexCell)} ».`);

    // Export FFK 2026-2027 : le règlement des seniors est écrit dans l'âge (« Séniors shobu ippon kumité »).
    const { age: ageCell, ruleset: ageRuleset } = splitAgeCell(get(row, 'ageBand'));
    const ageBandCode = ageBandFromLabel(ageCell, grid);
    if (!ageBandCode) errors.push(`Catégorie d'âge manquante ou incompréhensible : « ${text(ageCell)} ».`);
    else if (/^VETERANS?$/.test(normalizeName(text(ageCell)))) {
      warnings.push('« Vétéran » sans numéro : placé en V1 (à corriger si besoin).');
    }

    const disciplineCell = get(row, 'discipline');
    const discipline = disciplineFromLabel(disciplineCell) ?? (text(disciplineCell) ? null : sheetDiscipline);
    if (!discipline) errors.push(`Discipline incompréhensible : « ${text(disciplineCell) || sheetName} ».`);

    const rulesetCell = get(row, 'ruleset');
    const columnRuleset = rulesetFromLabel(rulesetCell);
    if (text(rulesetCell) && !columnRuleset) warnings.push(`Règlement ignoré : « ${text(rulesetCell)} ».`);
    if (columnRuleset && ageRuleset && columnRuleset !== ageRuleset) {
      warnings.push(`Règlement « ${text(rulesetCell)} » différent de celui de l’âge (« ${text(get(row, 'ageBand'))} ») : « ${text(rulesetCell)} » retenu.`);
    }
    const ruleset = columnRuleset ?? ageRuleset;

    let weightLabel: string | null = null;
    let weightIssue: string | null = null;
    if (discipline && DISCIPLINES[discipline].hasWeight && sex && ageBandCode) {
      const res = resolveWeightCell(grid, ageBandCode, sex, get(row, 'weight'));
      if (res.kind === 'ok') {
        weightLabel = res.weightClass.label;
        if (res.warning) warnings.push(res.warning);
      } else if (res.kind === 'unknown') {
        if (res.maxKg === null) weightIssue = `Catégorie ouverte « ${res.label} » inconnue dans la grille pour cette catégorie d'âge.`;
        else {
          weightLabel = res.label;
          warnings.push(`Catégorie de poids « ${res.label} » absente de la grille : elle sera créée.`);
        }
      } else weightIssue = res.message;
    }

    // Règlement absent : jiyu à l'import (comme le fait l'import lui-même).
    if (sex && ageBandCode && discipline) {
      const w = closedEntryWarning({ ageBandCode, sex, discipline, ruleset: discipline === 'kata' ? null : (ruleset ?? 'jiyu') }, closed);
      if (w) warnings.push(w);
    }
    rows.push({
      key: `${sheetName}#${r + 1}`,
      sheet: sheetName,
      line: r + 1,
      licence,
      lastName,
      firstName,
      clubEntity,
      clubName,
      sex,
      ageBandCode,
      discipline,
      ruleset,
      weightLabel,
      weightIssue,
      errors,
      warnings,
    });
  }
  return rows;
}
