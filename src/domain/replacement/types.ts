import type { CategoryKey, CategoryStatus } from '../categories.js';
import type { CompetitionSettings } from '../settings.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from '../types.js';

export type Presence = 'unknown' | 'present' | 'absent';
/** M = déplacement manuel décidé par l'organisateur (jamais proposé). */
export type ProposalType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'R' | 'M';

/** Une inscription, avec tout ce qu'il faut pour décider d'un recasement. */
export interface Member {
  registrationId: string;
  fighterId: string;
  clubId: string | null;
  clubPreApproval: boolean;
  label: string;
  sex: Sex;
  ageBandCode: string;
  discipline: DisciplineId;
  ruleset: Ruleset | null;
  weightClassId: string | null;
  weighInKg: number | null;
  approxWeightKg: number | null;
  presence: Presence;
  otherDisciplines: DisciplineId[];
  acceptsJiyuFirst: boolean | null;
  categoryId: string | null;
  placementLocked: boolean;
  /** Valeurs d'avant le premier recasement (pour le retour). */
  original: {
    discipline: DisciplineId;
    ruleset: Ruleset | null;
    weightClassId: string | null;
    /** Pourquoi il a été déplacé : seul un combattant déplacé parce qu'il était seul est candidat au retour. */
    reason?: CaseKind | 'manual';
  } | null;
  recasementType: ProposalType | null;
}

export interface CategoryState {
  id: string;
  key: CategoryKey;
  status: CategoryStatus;
  /** Clés naturelles absorbées par une fusion : leurs inscriptions continuent d'arriver ici. */
  aliasKeys: string[];
}

export interface State {
  grid: CategoryGrid;
  settings: CompetitionSettings;
  categories: CategoryState[];
  members: Member[];
  /** Identifiants de propositions refusées. */
  refused: string[];
}

export type CaseKind = 'alone' | 'weight_out' | 'weight_gap' | 'return';

export interface Case {
  /** `${kind}:${registrationId}` */
  id: string;
  kind: CaseKind;
  registrationId: string;
  categoryId: string | null;
  detail: string;
}

export interface Proposal {
  /** Déterministe : `${type}:${registrationId}>${cible}`. */
  id: string;
  caseId: string;
  type: ProposalType;
  registrationId: string;
  /** Catégorie existante (dont la clé s'élargit) ou nouvelle catégorie. */
  target: { categoryId: string } | { newKey: CategoryKey };
  /** `null` retire la valeur (passage au kata : ni règlement ni poids). */
  changes: { discipline?: DisciplineId; ruleset?: Ruleset | null; weightClassId?: string | null };
  checks: { weightGapKg: number; threshold: number; ageMove: 'same' | 'C' | 'D'; crossesMinorAdult: boolean; mixedSex: boolean };
  manual: boolean;
  preApproved: boolean;
  reason: string;
  rank: number;
}
