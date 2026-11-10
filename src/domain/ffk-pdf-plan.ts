import { tidyReclass, ageBandFromLabel, rulesetFromLabel, type ClubFormLine, type CombatDiscipline } from './club-form.js';
import { DISCIPLINES } from './disciplines.js';
import type { FfkPdfEntry } from './ffk-pdf.js';
import { weightClassesFor } from './grid.js';
import { normalizeName, splitFullName, titleCaseName } from './names.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';
import { parseWeightLabel } from './weights.js';

/** Ce que la lecture du PDF renvoie : les combattants lus et les doublons ignorés (signalés au départ). */
export interface FfkPdfRead {
  fighters: FfkFighter[];
  duplicates: string[];
}

export interface FfkFighter {
  order: number;
  fullName: string;
  lastName: string;
  firstName: string;
  sex: Sex;
  ageBandCode: string | null;
  weightClassId: string | null;
  ruleset: Ruleset | null;
  /** Vrai si le titre FFK portait jiyu / shobu. */
  rulesetGiven: boolean;
  /** Textes FFK, pour les champs non traduits. */
  raw: { age: string; weight: string | null };
}

/** Traduit les lignes du PDF dans la grille ; une valeur inconnue reste `null` (rien n'est jamais créé dans la grille). */
export function translateFfkEntries(entries: FfkPdfEntry[], grid: CategoryGrid, discipline: DisciplineId): FfkFighter[] {
  const hasWeight = DISCIPLINES[discipline].hasWeight;
  return entries.map((e) => {
    const { lastName, firstName } = splitFullName(e.fullName);
    const { sex, ageLabel, weightLabel, rulesetLabel } = e.title;
    const ageBandCode = ageBandFromLabel(ageLabel, grid);
    let weightClassId: string | null = null;
    if (hasWeight && ageBandCode && weightLabel) {
      const parsed = parseWeightLabel(weightLabel);
      weightClassId = parsed ? weightClassesFor(grid, ageBandCode, sex).find((w) => w.label === parsed.label)?.id ?? null : null;
    }
    const given = hasWeight ? rulesetFromLabel(rulesetLabel) : null;
    return {
      order: e.order,
      fullName: e.fullName,
      lastName,
      firstName: titleCaseName(firstName),
      sex,
      ageBandCode,
      weightClassId,
      ruleset: hasWeight ? given ?? 'jiyu' : null,
      rulesetGiven: given !== null,
      raw: { age: ageLabel, weight: weightLabel },
    };
  });
}

export type FfkField = 'ageBandCode' | 'weightClassId' | 'ruleset';
export interface FfkDiff {
  field: FfkField;
  ffk: string;
  fiche: string | null;
}
export interface PlanLine {
  fighterId: string;
  line: ClubFormLine;
  editable: boolean;
  partlyEditable: boolean;
}
export type FfkStep =
  | { kind: 'new'; ffk: FfkFighter }
  | { kind: 'existing'; ffk: FfkFighter; fighterId: string; diffs: FfkDiff[]; addsDiscipline: boolean; oneCombatBlocked: boolean; locked: boolean }
  | { kind: 'homonym'; ffk: FfkFighter; candidates: string[] };
export interface FfkImportPlan {
  steps: FfkStep[];
  upToDate: number;
  /** Fiches inscrites dans la discipline de l'import et absentes du PDF. */
  absents: string[];
}

export function hasDiscipline(line: ClubFormLine, d: DisciplineId): boolean {
  return d === 'kata' ? line.kata : line.combats.includes(d);
}

const keyOf = (lastName: string, firstName: string, sex: Sex | null): string => `${sex ?? ''}|${normalizeName(`${lastName} ${firstName}`)}`;

function diffsFor(ffk: FfkFighter, line: ClubFormLine, discipline: DisciplineId): FfkDiff[] {
  const diffs: FfkDiff[] = [];
  if (ffk.ageBandCode && ffk.ageBandCode !== line.ageBandCode) diffs.push({ field: 'ageBandCode', ffk: ffk.ageBandCode, fiche: line.ageBandCode });
  if (DISCIPLINES[discipline].hasWeight) {
    if (ffk.weightClassId && ffk.weightClassId !== line.weightClassId) diffs.push({ field: 'weightClassId', ffk: ffk.weightClassId, fiche: line.weightClassId });
    if (ffk.rulesetGiven && ffk.ruleset && ffk.ruleset !== line.ruleset) diffs.push({ field: 'ruleset', ffk: ffk.ruleset, fiche: line.ruleset });
  }
  return diffs;
}

export function planFfkImport(
  fighters: FfkFighter[],
  lines: PlanLine[],
  discipline: DisciplineId,
  opts: { multipleCombats: boolean; mode: 'coach' | 'organiser' },
): FfkImportPlan {
  const byKey = new Map<string, PlanLine[]>();
  for (const l of lines) {
    const k = keyOf(l.line.lastName, l.line.firstName, l.line.sex);
    byKey.set(k, [...(byKey.get(k) ?? []), l]);
  }
  const steps: FfkStep[] = [];
  const matched = new Set<string>();
  let upToDate = 0;
  for (const ffk of [...fighters].sort((a, b) => a.order - b.order)) {
    const found = byKey.get(keyOf(ffk.lastName, ffk.firstName, ffk.sex)) ?? [];
    if (found.length === 0) {
      steps.push({ kind: 'new', ffk });
      continue;
    }
    for (const f of found) matched.add(f.fighterId);
    if (found.length > 1) {
      steps.push({ kind: 'homonym', ffk, candidates: found.map((f) => f.fighterId) });
      continue;
    }
    const fiche = found[0]!;
    const diffs = diffsFor(ffk, fiche.line, discipline);
    const addsDiscipline = !hasDiscipline(fiche.line, discipline);
    if (!diffs.length && !addsDiscipline) {
      upToDate++;
      continue;
    }
    const oneCombatBlocked = addsDiscipline && discipline !== 'kata' && opts.mode === 'coach' && !opts.multipleCombats && fiche.line.combats.length > 0;
    steps.push({
      kind: 'existing', ffk, fighterId: fiche.fighterId, diffs, addsDiscipline, oneCombatBlocked,
      locked: !fiche.editable && !fiche.partlyEditable,
    });
  }
  const absents = lines.filter((l) => hasDiscipline(l.line, discipline) && !matched.has(l.fighterId)).map((l) => l.fighterId);
  return { steps, upToDate, absents };
}

/** Fiche d'un combattant nouveau : seuls les champs lus dans le PDF sont remplis. */
export function prefillNew(ffk: FfkFighter, discipline: DisciplineId): ClubFormLine {
  const combat = DISCIPLINES[discipline].hasWeight;
  return {
    lastName: ffk.lastName,
    firstName: ffk.firstName,
    sex: ffk.sex,
    ageBandCode: ffk.ageBandCode,
    weightClassId: combat ? ffk.weightClassId : null,
    weightKg: null,
    combats: combat ? [discipline as CombatDiscipline] : [],
    kata: !combat,
    grade: null,
    ruleset: combat ? ffk.ruleset : null,
    prefs: {},
    shobuKeep: null,
  };
}

/** La fiche existante, avec les valeurs FFK des écarts et la discipline ajoutée si elle n'est pas bloquée. */
export function prefillExisting(fiche: ClubFormLine, step: Extract<FfkStep, { kind: 'existing' }>, discipline: DisciplineId): ClubFormLine {
  const out: ClubFormLine = { ...fiche, combats: [...fiche.combats], prefs: { ...fiche.prefs } };
  for (const d of step.diffs) {
    if (d.field === 'ruleset') out.ruleset = d.ffk as Ruleset;
    else out[d.field] = d.ffk;
  }
  if (step.addsDiscipline && !step.oneCombatBlocked) {
    if (discipline === 'kata') out.kata = true;
    else {
      out.combats.push(discipline as CombatDiscipline);
      out.ruleset = out.ruleset ?? step.ffk.ruleset;
    }
  }
  return tidyReclass(out);
}

/** Retire une discipline ; `null` quand la fiche n'en a plus aucune. */
export function withoutDiscipline(line: ClubFormLine, d: DisciplineId): ClubFormLine | null {
  const out: ClubFormLine = { ...line, combats: line.combats.filter((c) => c !== d), kata: d === 'kata' ? false : line.kata };
  if (!out.combats.length && !out.kata) return null;
  if (!out.combats.length) return { ...out, prefs: {}, ruleset: null, shobuKeep: null };
  return tidyReclass(out);
}
