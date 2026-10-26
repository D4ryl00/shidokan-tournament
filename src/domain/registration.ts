import { DISCIPLINES, RULESETS, disciplineFromLabel } from './disciplines.js';
import type { ProposalType } from './replacement/types.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';

export type RegistrationSource = 'club_form' | 'ffk' | 'manual' | 'onsite' | 'online';

export const SOURCE_LABELS: Record<RegistrationSource, string> = {
  club_form: 'Fiche club',
  ffk: 'FFK',
  manual: 'Manuelle',
  onsite: 'Sur place',
  online: 'En ligne',
};

export interface Club {
  id: string;
  competitionId: string;
  name: string;
  ffkEntity: string | null;
  coachName: string | null;
  coachPhone: string | null;
  coachEmail: string | null;
  preApproval: boolean;
}

export interface Fighter {
  id: string;
  competitionId: string;
  clubId: string | null;
  lastName: string;
  firstName: string;
  sex: Sex;
  ageBandCode: string;
  licence: string | null;
  /** Grade (kata), pour informer les arbitres. */
  grade: string | null;
}

export interface Registration {
  id: string;
  competitionId: string;
  fighterId: string;
  discipline: DisciplineId;
  /** null pour le kata. */
  ruleset: Ruleset | null;
  /** null pour le kata ; identifiant stable de la catégorie de poids. */
  weightClassId: string | null;
  approxWeightKg: number | null;
  /** Préférences ordonnées (combat uniquement). */
  otherDisciplines: DisciplineId[];
  /** Seulement si shobu. */
  acceptsJiyuFirst: boolean | null;
  source: RegistrationSource;
  /** Retrouvée dans le dernier export FFK importé. */
  ffkConfirmed: boolean;
  /** Type du recasement validé (badge), null sinon. */
  recasementType?: ProposalType | null;
  /** « Ne combat pas » (catégorie non ouverte), décidé en Réaffectation. */
  withdrawn: boolean;
  createdAt: string;
}

export interface RegistrationInput {
  clubId: string | null;
  lastName: string;
  firstName: string;
  sex: Sex;
  ageBandCode: string;
  licence?: string | null;
  /** Grade du combattant (kata) ; absent = conservé. */
  grade?: string | null;
  discipline: DisciplineId;
  ruleset: Ruleset | null;
  weightClassId: string | null;
  approxWeightKg?: number | null;
  otherDisciplines?: DisciplineId[];
  acceptsJiyuFirst?: boolean | null;
  source: RegistrationSource;
}

export interface RegistrationRow extends Registration {
  fighter: Fighter;
  club: Club | null;
  /** Révision (inscription et combattant) : protection contre les écrasements entre postes. */
  rev: string;
}

const BY_CODE = new Map(
  Object.entries(DISCIPLINES)
    .filter(([, d]) => d.clubFormCode !== null)
    .map(([id, d]) => [d.clubFormCode!, id as DisciplineId]),
);

/**
 * « 32 », « 3,2 », 32, « boxe, mix », « Shido-mix-martial > Shido-boxing » → préférences ordonnées
 * (codes 1 karaté, 2 shido-boxing, 3 shido-mix).
 */
export function parsePreferences(raw: unknown, main: DisciplineId): { value: DisciplineId[]; errors: string[] } {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!text) return { value: [], errors: [] };
  if (!DISCIPLINES[main].inPreferences) {
    return { value: [], errors: [`Il n'y a pas de préférences pour le ${DISCIPLINES[main].label.toLowerCase()}.`] };
  }
  const value: DisciplineId[] = [];
  const errors: string[] = [];
  const add = (d: DisciplineId, shown: string) => {
    if (d === main) errors.push(`Préférence « ${shown} » ignorée : c'est la discipline principale.`);
    else if (!DISCIPLINES[d].inPreferences) errors.push(`Préférence « ${shown} » ignorée : le ${DISCIPLINES[d].label.toLowerCase()} ne peut pas être une préférence.`);
    else if (!value.includes(d)) value.push(d);
  };
  for (const token of text.split(/[,;/>›+]+/).map((t) => t.trim()).filter(Boolean)) {
    if (/^[\d\s.-]+$/.test(token)) {
      for (const ch of token.replace(/\D/g, '')) {
        const d = BY_CODE.get(Number(ch) as 1 | 2 | 3);
        if (d) add(d, ch);
        else errors.push(`Préférence « ${ch} » : code inconnu (1 karaté, 2 shido-boxing, 3 shido-mix-martial).`);
      }
    } else {
      const d = disciplineFromLabel(token);
      if (d) add(d, token);
      else errors.push(`Préférence « ${token} » non reconnue (1 karaté, 2 shido-boxing, 3 shido-mix-martial).`);
    }
  }
  return { value, errors };
}

/** Erreurs bloquantes, en français ; vide si l'inscription est valide. */
export function validateRegistration(input: RegistrationInput, grid: CategoryGrid): string[] {
  const errors: string[] = [];
  const discipline = DISCIPLINES[input.discipline];
  if (!input.lastName.trim()) errors.push('Le nom est obligatoire.');
  const band = grid.ageBands.find((b) => b.code === input.ageBandCode);
  if (!band) errors.push(`Catégorie d'âge inconnue : « ${input.ageBandCode} ».`);

  if (!discipline.hasWeight) {
    if (input.ruleset !== null) errors.push(`Pas de règlement pour le ${discipline.label.toLowerCase()}.`);
    if (input.weightClassId !== null) errors.push(`Pas de catégorie de poids pour le ${discipline.label.toLowerCase()}.`);
  } else {
    if (input.ruleset === null) errors.push('Le règlement (jiyu ou shobu) est obligatoire.');
    if (input.ruleset && band && RULESETS[input.ruleset].adultsOnly && band.isMinor) {
      errors.push(`Le ${RULESETS[input.ruleset].label} est réservé aux adultes (${band.label}).`);
    }
    if (input.weightClassId === null) errors.push('La catégorie de poids est obligatoire.');
    else {
      const wc = grid.weightClasses.find((w) => w.id === input.weightClassId);
      if (!wc) errors.push('Catégorie de poids inconnue.');
      else if (wc.ageBandCode !== input.ageBandCode || wc.sex !== input.sex) {
        errors.push(`La catégorie de poids « ${wc.label} » ne correspond pas à l'âge et au sexe du combattant.`);
      }
    }
  }
  if (input.acceptsJiyuFirst && input.ruleset !== 'shobu') {
    errors.push('« Jiyu en priorité » ne concerne que les combattants inscrits en shobu.');
  }
  for (const d of input.otherDisciplines ?? []) {
    if (d === input.discipline) errors.push('Les préférences ne peuvent pas contenir la discipline principale.');
    else if (!DISCIPLINES[d].inPreferences) errors.push(`Le ${DISCIPLINES[d].label.toLowerCase()} ne peut pas figurer dans les préférences.`);
  }
  if ((input.otherDisciplines?.length ?? 0) > 0 && !discipline.inPreferences) {
    errors.push(`Il n'y a pas de préférences pour le ${discipline.label.toLowerCase()}.`);
  }
  return errors;
}

const isCombat = (d: DisciplineId) => d !== 'kata';

/** Avertissement (non bloquant) si le combattant a déjà une autre discipline de combat. */
export function combatConflictWarning(
  existing: Pick<Registration, 'discipline'>[],
  input: Pick<RegistrationInput, 'discipline'>,
  allowMultiple: boolean,
): string | null {
  if (allowMultiple || !isCombat(input.discipline)) return null;
  const other = existing.find((r) => isCombat(r.discipline) && r.discipline !== input.discipline);
  return other
    ? `Ce combattant est déjà inscrit en ${DISCIPLINES[other.discipline].label} : une seule discipline de combat par jour est prévue.`
    : null;
}

/** Fiche de l'annuaire des clubs (indépendante des compétitions). */
export interface DirectoryInput {
  name: string;
  affiliationNumber: string | null;
  coachName: string | null;
  coachPhone: string | null;
  coachEmail: string | null;
  notes: string | null;
}
export interface DirectoryEntry extends DirectoryInput {
  id: string;
  ffkEntity: string | null;
  archived: boolean;
  /** Contact Google relié à cette fiche, ou null. */
  googleContactId: string | null;
  createdAt: string;
  /** Nombre de clubs de compétition reliés à cette fiche. */
  competitions: number;
}
