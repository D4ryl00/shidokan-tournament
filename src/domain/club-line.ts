import type { ClubFormLine, CombatDiscipline, PrefDiscipline } from './club-form.js';
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
}

export const TWO_COMBATS_REASON = 'Inscrit dans deux disciplines de combat : contactez l’organisateur pour le modifier.';

const PREF_DISCIPLINES = new Set<DisciplineId>(['karate', 'shido-boxing', 'shido-mix']);

type Entered = { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null };
/** Discipline, règlement et catégorie de poids saisis par le coach (ceux d'avant une réaffectation). */
export function enteredValues(r: LineRegistration): Entered {
  const { discipline, ruleset, weightClassId } = r.originalJson ? (JSON.parse(r.originalJson) as Entered) : r;
  return { discipline, ruleset, weightClassId: weightClassId ?? null };
}

/** Ligne de fiche d'un combattant : l'inverse de `lineToRows`. */
export function registrationsToLine(fighter: LineFighter, regs: LineRegistration[]): { line: ClubFormLine; editable: boolean; reason: string | null } {
  const combats = regs.filter((r) => enteredValues(r).discipline !== 'kata');
  const kata = regs.find((r) => enteredValues(r).discipline === 'kata');
  const combat = combats[0];
  const entered = combat ? enteredValues(combat) : null;
  const prefs: ClubFormLine['prefs'] = {};
  combat?.otherDisciplines.filter((d) => PREF_DISCIPLINES.has(d)).forEach((d, i) => (prefs[d as PrefDiscipline] = (i + 1) as 1 | 2));
  const shobuKeep = entered?.ruleset === 'shobu' && combat!.acceptsJiyuFirst !== null ? (combat!.acceptsJiyuFirst ? 'discipline' : 'ruleset') : null;
  const line: ClubFormLine = {
    lastName: fighter.lastName,
    firstName: fighter.firstName,
    sex: fighter.sex,
    ageBandCode: fighter.ageBandCode,
    weightClassId: entered?.weightClassId ?? null,
    weightKg: combat?.approxWeightKg ?? kata?.approxWeightKg ?? null,
    combat: (entered?.discipline as CombatDiscipline | undefined) ?? null,
    kata: !!kata,
    grade: kata ? fighter.grade : null,
    ruleset: entered?.ruleset ?? null,
    prefs,
    shobuKeep,
  };
  return combats.length > 1 ? { line, editable: false, reason: TWO_COMBATS_REASON } : { line, editable: true, reason: null };
}
