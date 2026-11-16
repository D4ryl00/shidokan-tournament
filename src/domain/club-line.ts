import { DISCIPLINES } from './disciplines.js';
import { PREF_DISCIPLINES, type ClubFormLine, type CombatDiscipline, type PrefDiscipline, type PrefRank } from './club-form.js';
import type { DisciplineId, Ruleset, Sex } from './types.js';

/** Inscription d'un combattant, vue par la page du club. */
export interface LineRegistration {
  discipline: DisciplineId;
  ruleset: Ruleset | null;
  weightClassId: string | null;
  approxWeightKg: number | null;
  otherDisciplines: DisciplineId[];
  acceptsJiyuFirst: boolean | null;
  /** Valeurs d'avant une réaffectation (discipline, règlement, catégorie de poids), celles du coach. */
  originalJson: string | null;
}
export interface LineFighter {
  lastName: string;
  firstName: string;
  sex: Sex;
  ageBandCode: string;
  grade: string | null;
  licence: string | null;
}

type Entered = { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null };
/** Discipline, règlement et catégorie de poids saisis par le coach (ceux d'avant une réaffectation). */
export function enteredValues(r: LineRegistration): Entered {
  const { discipline, ruleset, weightClassId } = r.originalJson ? (JSON.parse(r.originalJson) as Entered) : r;
  return { discipline, ruleset, weightClassId: weightClassId ?? null };
}

/**
 * Ligne de fiche d'un combattant : l'inverse de `lineToRows`. Une ligne porte une seule inscription par discipline, un règlement
 * et une catégorie de poids pour tous ses combats : des inscriptions d'avant (saisie manuelle, import FFK) qui n'y tiennent pas
 * donnent un avertissement (`warnings`), car l'enregistrement de la ligne les ramène à elle.
 */
export function registrationsToLine(fighter: LineFighter, regs: LineRegistration[]): { line: ClubFormLine; editable: boolean; reason: string | null; warnings: string[] } {
  const combatRegs = regs.filter((r) => enteredValues(r).discipline !== 'kata');
  const kata = regs.find((r) => enteredValues(r).discipline === 'kata');
  const combat = combatRegs[0];
  const entered = combat ? enteredValues(combat) : null;
  const prefs: ClubFormLine['prefs'] = {};
  combat?.otherDisciplines.filter((d) => (PREF_DISCIPLINES as readonly DisciplineId[]).includes(d)).forEach((d, i) => (prefs[d as PrefDiscipline] = (i + 1) as PrefRank));
  const shobuKeep = entered?.ruleset === 'shobu' && combat!.acceptsJiyuFirst !== null ? (combat!.acceptsJiyuFirst ? 'discipline' : 'ruleset') : null;
  const line: ClubFormLine = {
    lastName: fighter.lastName,
    firstName: fighter.firstName,
    sex: fighter.sex,
    ageBandCode: fighter.ageBandCode,
    weightClassId: entered?.weightClassId ?? null,
    weightKg: combat?.approxWeightKg ?? kata?.approxWeightKg ?? null,
    combats: [...new Set(combatRegs.map((r) => enteredValues(r).discipline as CombatDiscipline))],
    kata: !!kata,
    grade: kata ? fighter.grade : null,
    ruleset: entered?.ruleset ?? null,
    prefs,
    shobuKeep,
    licence: fighter.licence,
  };
  return { line, editable: true, reason: null, warnings: lineWarnings(regs) };
}

const RULESET_NAMES: Record<Ruleset, string> = { jiyu: 'jiyu', shobu: 'shobu' };
function lineWarnings(regs: LineRegistration[]): string[] {
  const entered = regs.map(enteredValues);
  const warnings: string[] = [];
  const byDiscipline = new Map<DisciplineId, Entered[]>();
  for (const e of entered) byDiscipline.set(e.discipline, [...(byDiscipline.get(e.discipline) ?? []), e]);
  for (const [d, list] of byDiscipline) {
    if (list.length < 2) continue;
    const rulesets = [...new Set(list.map((e) => e.ruleset).filter((r): r is Ruleset => r !== null))].map((r) => RULESET_NAMES[r]);
    const label = DISCIPLINES[d].label.toLowerCase();
    warnings.push(`${list.length} inscriptions en ${label}${rulesets.length > 1 ? ` (${rulesets.join(' et ')})` : ''} : une seule sera gardée à l’enregistrement de ce combattant.`);
  }
  // Une inscription par discipline (le doublon a déjà son avertissement).
  const combats = [...byDiscipline].filter(([d]) => d !== 'kata').map(([, list]) => list[0]!);
  const rulesets = new Set(combats.map((e) => e.ruleset));
  if (rulesets.size > 1) warnings.push('Règlements différents selon les combats : à l’enregistrement, tous ses combats prennent le règlement choisi ici.');
  if (new Set(combats.map((e) => e.weightClassId)).size > 1) warnings.push('Catégories de poids différentes selon les combats : à l’enregistrement, tous ses combats prennent celle choisie ici.');
  return warnings;
}

/** Disciplines commencées absentes de la ligne soumise : elles ne se retirent pas (« Karaté : commencé, ne se retire pas. »). */
export function startedRemovedError(started: DisciplineId[], submitted: ClubFormLine): string | null {
  const removed = started.filter((d) => (d === 'kata' ? !submitted.kata : !submitted.combats.includes(d as CombatDiscipline)));
  return removed.length ? `${removed.map((d) => DISCIPLINES[d].label).join(', ')} : commencé, ne se retire pas.` : null;
}

/**
 * Ligne d'un combattant dont des disciplines ont commencé, telle que l'organisateur peut l'écrire : sexe et âge gardés ; poids,
 * règlement et reclassement gardés dès qu'un combat a commencé (le retrait d'une discipline commencée se vérifie à part).
 */
export function startedLine(saved: ClubFormLine, started: DisciplineId[], submitted: ClubFormLine): ClubFormLine {
  const combatStarted = started.some((d) => d !== 'kata');
  return {
    ...submitted,
    sex: saved.sex,
    ageBandCode: saved.ageBandCode,
    ...(combatStarted ? { weightClassId: saved.weightClassId, weightKg: saved.weightKg, ruleset: saved.ruleset, prefs: saved.prefs, shobuKeep: saved.shobuKeep } : {}),
  };
}
