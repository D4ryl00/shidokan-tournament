import type { CategoryKey, CategoryStatus } from '../categories.js';
import type { CompetitionSettings } from '../settings.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from '../types.js';
import type { Wave } from '../waves.js';

export type Presence = 'unknown' | 'present' | 'absent';
/** M = déplacement manuel décidé par l'organisateur (jamais proposé) ; W = « Ne combat pas » (catégorie fermée, journal seulement). */
export type ProposalType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'R' | 'M' | 'W';

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
    reason?: CaseKind | 'manual' | 'pulled';
  } | null;
  recasementType: ProposalType | null;
}

export interface CategoryState {
  id: string;
  key: CategoryKey;
  status: CategoryStatus;
  /** Clés naturelles absorbées par une fusion : leurs inscriptions continuent d'arriver ici. */
  aliasKeys: string[];
  /** Choix individuel de vague (`WAVE_NONE` = en attente), sinon les règles des vagues décident. */
  waveOverride: string | null;
  /** Catégorie d'une vague lancée : fermée au recasement (ni départ ni arrivée). */
  frozen?: boolean;
}

export interface State {
  grid: CategoryGrid;
  settings: CompetitionSettings;
  categories: CategoryState[];
  members: Member[];
  /** Vagues de la compétition (vide : une seule vague implicite, comme avant). */
  waves: Wave[];
  /** Identifiants de propositions refusées. */
  refused: string[];
  /** Cases fermées du tableau « Catégories ouvertes » (`entryKey`) : leurs inscrits sont des cas, et jamais des cibles. */
  closedEntries: string[];
}

export type CaseKind = 'closed' | 'alone' | 'weight_out' | 'weight_gap' | 'return';

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
  /** Vague de départ et d'arrivée quand elles diffèrent (`null` = en attente) : jamais pré-approuvée ni validée en masse. */
  waveChange: { from: string | null; to: string | null } | null;
  /** Autres combattants que le déplacement ferait changer de vague (leur catégorie change de vague) : même traitement. */
  waveShifts: { registrationId: string; label: string; from: string | null; to: string | null }[];
  preApproved: boolean;
  reason: string;
  rank: number;
  /**
   * « Split » : autres inscriptions déplacées avec `registrationId` vers la même cible (le combattant seul reçoit
   * les plus lourds de la catégorie du dessous). Elles n'étaient pas des cas : le déplacement reste manuel.
   */
  alsoMoved?: string[];
}
