import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_SECOND_COMBAT_COLUMN,
  NotAClubFormError,
  cellsToLine,
  kgText,
  locate,
  parseHeader,
  tidyReclass,
  type ClubFormLine,
  type CombatDiscipline,
  type WeighInTolerance,
} from './club-form.js';
import { normalizeName, parseYesNo } from './names.js';
import type { CategoryGrid } from './types.js';
import { weightClassForWeight } from './weights.js';

export interface ClubFormReadHeader {
  club: string;
  coachName: string | null;
  coachPhone: string | null;
  coachEmails: string[];
  /** null : case vide (pas de réponse du club). */
  preApproval: boolean | null;
}
export interface ClubFormItem {
  /** Position du combattant dans la fiche (0-based, après fusion). */
  order: number;
  /** Numéros de ligne du tableur (1-based) fusionnés dans ce combattant. */
  rows: number[];
  line: ClubFormLine;
  /** Remarques sur la lecture : valeurs illisibles, avertissements. */
  notes: string[];
}
export interface ClubFormRead {
  header: ClubFormReadHeader;
  items: ClubFormItem[];
  /** Combattants écrits sur plusieurs lignes de la fiche, réunis en un seul. */
  merged: { label: string; rows: number[] }[];
}

export const LEGACY_FORM_REFUSED = 'Ancien modèle de fiche : demandez au club de remplir le nouveau.';

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Lit une fiche renvoyée (nouveau modèle) : l'en-tête et un combattant par ligne, sans rien rejeter. */
export function readClubFormLines(cells: unknown[][], grid: CategoryGrid, tolerance: WeighInTolerance): ClubFormRead {
  const { headerRows, columnsRow } = locate(cells);
  const base = parseHeader(cells, headerRows);
  const isNew = normalizeName(text(cells[columnsRow]?.[4])).startsWith('POIDS ACTUEL');
  if (!isNew) throw new NotAClubFormError(LEGACY_FORM_REFUSED);
  const preRow = headerRows.get(CLUB_FORM_HEADER_FIELDS[4]);
  const header: ClubFormReadHeader = {
    club: base.club,
    coachName: base.coachName,
    coachPhone: base.coachPhone,
    coachEmails: base.coachEmails,
    preApproval: preRow === undefined ? null : parseYesNo(cells[preRow]?.[1]),
  };

  const triathlonColumn = normalizeName(text(cells[columnsRow]?.[12])) === 'TRIATHLON';
  const secondCombatColumn = (cells[columnsRow] ?? []).findIndex((c) => normalizeName(text(c)) === normalizeName(CLUB_FORM_SECOND_COMBAT_COLUMN));
  const baseWidth = triathlonColumn ? CLUB_FORM_COLUMNS.length : CLUB_FORM_COLUMNS.length - 1;
  const width = Math.max(baseWidth, secondCombatColumn + 1);

  const groups = new Map<string, { rows: number[]; lines: ClubFormLine[]; notes: string[] }>();
  for (let r = columnsRow + 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    if (row.slice(0, width).every((c) => text(c) === '')) continue;
    const { line, warnings, errors } = cellsToLine(row, grid, triathlonColumn, secondCombatColumn);
    const notes = [...errors, ...warnings];
    if (/^VETERANS?$/.test(normalizeName(text(row[3])))) notes.push('« Vétéran » sans numéro : placé en V1 (à corriger si besoin).');
    // Une ligne sans nom n'est jamais fusionnée : chacune reste son propre combattant.
    const name = normalizeName(`${line.lastName} ${line.firstName}`);
    const key = name ? `${name}|${line.sex ?? ''}` : `#${r}`;
    const group = groups.get(key) ?? { rows: [], lines: [], notes: [] };
    group.rows.push(r + 1);
    group.lines.push(line);
    group.notes.push(...notes);
    groups.set(key, group);
  }

  const items: ClubFormItem[] = [];
  const merged: ClubFormRead['merged'] = [];
  for (const group of groups.values()) {
    const line = mergeLines(group.lines);
    const notes = group.notes;
    if (line.ageBandCode && line.sex && line.weightKg !== null && line.combats.length) {
      const wc = weightClassForWeight(grid, line.ageBandCode, line.sex, line.weightKg, tolerance[line.sex]);
      if (wc) line.weightClassId = wc.id;
      else notes.push(`Pas de catégorie de poids pour ${kgText(line.weightKg)} kg à cet âge et ce sexe dans la grille.`);
    }
    items.push({ order: items.length, rows: group.rows, line: tidyReclass(line), notes });
    if (group.rows.length > 1) merged.push({ label: `${group.lines[0]!.lastName} ${group.lines[0]!.firstName}`.trim(), rows: group.rows });
  }
  return { header, items, merged };
}

/** Même combattant sur plusieurs lignes : première valeur renseignée, combats réunis dans l'ordre, kata si une ligne le coche. */
function mergeLines(lines: ClubFormLine[]): ClubFormLine {
  const [first, ...rest] = lines as [ClubFormLine, ...ClubFormLine[]];
  const out: ClubFormLine = { ...first, combats: [...first.combats], prefs: { ...first.prefs } };
  for (const l of rest) {
    out.lastName ||= l.lastName;
    out.firstName ||= l.firstName;
    out.sex ??= l.sex;
    out.ageBandCode ??= l.ageBandCode;
    out.weightKg ??= l.weightKg;
    out.grade ??= l.grade;
    out.ruleset ??= l.ruleset;
    out.shobuKeep ??= l.shobuKeep;
    for (const c of l.combats) if (!out.combats.includes(c as CombatDiscipline)) out.combats.push(c);
    out.kata ||= l.kata;
    if (!Object.keys(out.prefs).length) out.prefs = { ...l.prefs };
  }
  return out;
}
