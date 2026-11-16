import { PREF_DISCIPLINES, normalizeLicence, orderedPrefs, tidyReclass, type ClubFormLine, type ClubFormPrefs, type CombatDiscipline, type PrefDiscipline } from './club-form.js';
import type { ClubFormItem, ClubFormReadHeader } from './club-form-read.js';
import { cleanEmails, sameEmail } from './emails.js';
import type { PlanLine } from './ffk-pdf-plan.js';
import { normalizeName } from './names.js';
import type { DisciplineId, Ruleset } from './types.js';

export type ImportField = 'ageBandCode' | 'weightClassId' | 'weightKg' | 'disciplines' | 'ruleset' | 'grade' | 'prefs' | 'shobuKeep' | 'licence';
/** `ffk` : la valeur importée (nom gardé du PDF FFK) ; `fiche` : la valeur enregistrée. */
export interface ImportDiff {
  field: ImportField;
  ffk: string;
  fiche: string | null;
}

/** Valeur d'un champ sous forme de texte, pour comparer et pour les cases de choix ; `null` : vide. */
export function fieldValue(line: ClubFormLine, field: ImportField): string | null {
  switch (field) {
    case 'ageBandCode': return line.ageBandCode;
    case 'weightClassId': return line.weightClassId;
    case 'weightKg': return line.weightKg === null ? null : String(line.weightKg);
    case 'disciplines': {
      const list: string[] = [...PREF_DISCIPLINES.filter((d) => line.combats.includes(d)), ...(line.kata ? ['kata'] : [])];
      return list.length ? list.join(',') : null;
    }
    case 'ruleset': return line.ruleset;
    case 'grade': return line.grade?.trim() || null;
    case 'prefs': {
      const list = orderedPrefs(line.prefs);
      return list.length ? list.join(',') : null;
    }
    case 'shobuKeep': return line.shobuKeep;
    case 'licence': return normalizeLicence(line.licence);
  }
}

/** Ce que la valeur texte d'un champ change dans une ligne (l'inverse de `fieldValue`). */
export function fieldPatch(field: ImportField, value: string | null): Partial<ClubFormLine> {
  switch (field) {
    case 'ageBandCode': return { ageBandCode: value };
    case 'weightClassId': return { weightClassId: value };
    case 'weightKg': return { weightKg: value === null || value === '' ? null : Number(value) };
    case 'disciplines': {
      const parts = value ? value.split(',') : [];
      return { combats: parts.filter((p) => p !== 'kata') as CombatDiscipline[], kata: parts.includes('kata') };
    }
    case 'ruleset': return { ruleset: value as Ruleset | null };
    case 'grade': return { grade: value };
    case 'prefs': {
      const prefs: ClubFormPrefs = {};
      (value ? value.split(',') : []).forEach((d, i) => (prefs[d as PrefDiscipline] = (i + 1) as 1 | 2 | 3));
      return { prefs };
    }
    case 'shobuKeep': return { shobuKeep: value as ClubFormLine['shobuKeep'] };
    case 'licence': return { licence: value };
  }
}

const FIELDS: ImportField[] = ['ageBandCode', 'weightClassId', 'weightKg', 'disciplines', 'ruleset', 'grade', 'prefs', 'shobuKeep', 'licence'];

/** Champs où la fiche renvoyée a une valeur différente de l'enregistré ; une case vide ne crée aucune différence. */
export function clubFormDiffs(file: ClubFormLine, saved: ClubFormLine): ImportDiff[] {
  const hasCombat = file.combats.length > 0;
  const counts: Record<ImportField, boolean> = {
    ageBandCode: true, weightKg: true, disciplines: true, prefs: true,
    weightClassId: hasCombat, ruleset: hasCombat, grade: file.kata, shobuKeep: file.ruleset === 'shobu', licence: true,
  };
  const diffs: ImportDiff[] = [];
  for (const field of FIELDS) {
    if (!counts[field]) continue;
    const ffk = fieldValue(file, field);
    if (ffk === null) continue;
    const fiche = fieldValue(saved, field);
    // Licence : un côté vide ne fait pas d'écart (la licence existante est gardée ou complétée par la fiche).
    if (field === 'licence' && fiche === null) continue;
    if (ffk !== fiche) diffs.push({ field, ffk, fiche });
  }
  return diffs;
}

export type ClubFormStep =
  | { kind: 'new'; ffk: ClubFormItem }
  | { kind: 'existing'; ffk: ClubFormItem; fighterId: string; diffs: ImportDiff[] }
  | { kind: 'homonym'; ffk: ClubFormItem; candidates: string[] };
export interface ClubFormPlan {
  steps: ClubFormStep[];
  upToDate: number;
  /** Fiches du club qu'aucune ligne de la fiche renvoyée n'a rapprochées (toutes disciplines). */
  absents: string[];
}

const nameOf = (l: ClubFormLine): string => normalizeName(`${l.lastName} ${l.firstName}`);

export function planClubFormImport(items: ClubFormItem[], lines: PlanLine[]): ClubFormPlan {
  const byName = new Map<string, PlanLine[]>();
  for (const l of lines) {
    const k = nameOf(l.line);
    byName.set(k, [...(byName.get(k) ?? []), l]);
  }
  const steps: ClubFormStep[] = [];
  const matched = new Set<string>();
  let upToDate = 0;
  for (const ffk of [...items].sort((a, b) => a.order - b.order)) {
    const sameName = byName.get(nameOf(ffk.line)) ?? [];
    const found = ffk.line.sex === null ? sameName : sameName.filter((l) => l.line.sex === ffk.line.sex);
    if (found.length === 0) {
      steps.push({ kind: 'new', ffk });
      continue;
    }
    for (const f of found) matched.add(f.fighterId);
    if (found.length > 1) {
      steps.push({ kind: 'homonym', ffk, candidates: found.map((f) => f.fighterId) });
      continue;
    }
    const saved = found[0]!;
    const diffs = clubFormDiffs(ffk.line, saved.line);
    if (!diffs.length) {
      upToDate++;
      continue;
    }
    steps.push({ kind: 'existing', ffk, fighterId: saved.fighterId, diffs });
  }
  return { steps, upToDate, absents: lines.filter((l) => !matched.has(l.fighterId)).map((l) => l.fighterId) };
}

/** Fiche d'un combattant nouveau : la ligne lue, Jiyu pour un mineur qui combat sans règlement. */
export function prefillFromFile(file: ClubFormLine, minorBands: Set<string>): ClubFormLine {
  const out: ClubFormLine = { ...file, combats: [...file.combats], prefs: { ...file.prefs } };
  if (out.combats.length && out.ruleset === null && out.ageBandCode !== null && minorBands.has(out.ageBandCode)) out.ruleset = 'jiyu';
  return tidyReclass(out);
}

/** La fiche enregistrée avec les valeurs de la fiche renvoyée pour chaque différence ; une discipline commencée reste. Licence : celle d'ici, sinon celle de la fiche renvoyée. */
export function prefillExistingFromFile(saved: ClubFormLine, diffs: ImportDiff[], startedDisciplines: DisciplineId[], file?: ClubFormLine): ClubFormLine {
  let out: ClubFormLine = { ...saved, combats: [...saved.combats], prefs: { ...saved.prefs } };
  const licence = normalizeLicence(saved.licence) ?? normalizeLicence(file?.licence);
  if (licence !== null) out.licence = licence;
  for (const d of diffs) out = { ...out, ...fieldPatch(d.field, d.ffk) };
  for (const d of startedDisciplines) {
    if (d === 'kata') {
      if (saved.kata) out.kata = true;
    } else if (saved.combats.includes(d as CombatDiscipline) && !out.combats.includes(d as CombatDiscipline)) {
      out.combats = [...out.combats, d as CombatDiscipline];
    }
  }
  return tidyReclass(out);
}

export interface HeaderDiff {
  coachName: { fiche: string; saved: string | null } | null;
  coachPhone: { fiche: string; saved: string | null } | null;
  preApproval: { fiche: boolean; saved: boolean } | null;
  /** Adresses de la fiche absentes du club (casse ignorée), orthographe de la fiche. */
  newEmails: string[];
}

function textDiff(file: string | null, saved: string | null, same: (a: string, b: string) => boolean): { fiche: string; saved: string | null } | null {
  const f = file?.trim() ?? '';
  if (!f) return null;
  const s = saved?.trim() ?? '';
  return same(f, s) ? null : { fiche: f, saved };
}

const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);
/** Téléphones : mêmes chiffres, quelle que soit la mise en forme ; sans chiffre, le texte. */
const samePhone = (a: string, b: string) => {
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  return da || db ? da === db : a === b;
};

export function clubHeaderDiff(
  file: ClubFormReadHeader,
  club: { coachName: string | null; coachPhone: string | null; coachEmails: string[]; preApproval: boolean },
): HeaderDiff {
  return {
    coachName: textDiff(file.coachName, club.coachName, sameName),
    coachPhone: textDiff(file.coachPhone, club.coachPhone, samePhone),
    preApproval: file.preApproval === null || file.preApproval === club.preApproval ? null : { fiche: file.preApproval, saved: club.preApproval },
    newEmails: cleanEmails(file.coachEmails).filter((e) => !club.coachEmails.some((x) => sameEmail(x, e))),
  };
}

export const hasHeaderDiff = (d: HeaderDiff): boolean => !!(d.coachName || d.coachPhone || d.preApproval || d.newEmails.length);
