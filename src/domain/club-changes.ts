import { sameEmail } from './emails.js';
import { normalizePhone } from './google-contacts.js';

// Coordonnées d'un club comparées entre sa fiche d'annuaire et celle d'une compétition.

export const CLUB_FIELDS = ['name', 'coachName', 'coachPhone', 'coachEmails', 'affiliationNumber'] as const;
export type ClubField = (typeof CLUB_FIELDS)[number];

export interface ClubValues {
  name: string;
  coachName: string | null;
  coachPhone: string | null;
  coachEmails: string[];
  affiliationNumber: string | null;
}

export type Side = 'competition' | 'directory';

const text = (v: string | null) => (v ?? '').trim();

/** Mêmes adresses, casse, espaces et ordre ignorés. */
const sameEmails = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.some((y) => sameEmail(x, y))) && b.every((y) => a.some((x) => sameEmail(x, y)));

/** Téléphones égaux malgré espaces, points ou indicatif ; sans chiffre de part et d'autre, le texte tel quel décide. */
function samePhone(a: string | null, b: string | null): boolean {
  const x = normalizePhone(text(a));
  const y = normalizePhone(text(b));
  return x && y ? x === y : text(a) === text(b);
}

function same(field: ClubField, a: ClubValues, b: ClubValues): boolean {
  if (field === 'coachEmails') return sameEmails(a.coachEmails, b.coachEmails);
  if (field === 'coachPhone') return samePhone(a.coachPhone, b.coachPhone);
  return text(a[field]) === text(b[field]);
}

/** Champs dont la valeur diffère, dans l'ordre de CLUB_FIELDS. Vide et absent se valent. */
export const differingFields = (a: ClubValues, b: ClubValues): ClubField[] => CLUB_FIELDS.filter((f) => !same(f, a, b));

const isEmpty = (field: ClubField, v: ClubValues) => (field === 'coachEmails' ? v.coachEmails.length === 0 : text(v[field]) === '');

/**
 * Par défaut la valeur de la compétition si l'enregistrement qui a créé le changement a modifié ce champ, sauf si elle est vide
 * (l'annuaire n'est vidé que si l'organisateur le choisit). Un champ que cet enregistrement n'a pas modifié garde la fiche :
 * une ancienne différence ne revient pas dans la fiche.
 */
export const defaultChoice = (field: ClubField, competition: ClubValues, changedFields: readonly ClubField[]): Side =>
  changedFields.includes(field) && !isEmpty(field, competition) ? 'competition' : 'directory';

export interface EmailChoice {
  email: string;
  origin: 'both' | 'competition' | 'competition-only' | 'directory';
  checked: boolean;
}

/**
 * Adresses proposées : celles de la compétition d'abord (dans leur ordre), puis celles de l'annuaire seules.
 * Cochées par défaut : les adresses communes, celles que l'enregistrement a ajoutées (`competition`), et celles de l'annuaire quand la liste
 * de la compétition est vide ou que l'enregistrement n'a pas touché aux e-mails. Une adresse seulement dans la compétition mais non ajoutée
 * par l'enregistrement (`competition-only`) est décochée.
 */
export function emailChoices(directory: readonly string[], competition: readonly string[], changedFields: readonly ClubField[], addedEmails: readonly string[]): EmailChoice[] {
  const directoryKept = competition.length === 0;
  if (!changedFields.includes('coachEmails')) {
    // E-mails non touchés par l'enregistrement : la fiche garde ses adresses, dans son ordre, la première restant la principale.
    const kept = directory.map((email): EmailChoice => ({ email, origin: competition.some((c) => sameEmail(c, email)) ? 'both' : 'directory', checked: true }));
    const onlyCompetition = competition.filter((c) => !directory.some((d) => sameEmail(d, c))).map((email): EmailChoice => ({ email, origin: 'competition-only', checked: false }));
    return [...kept, ...onlyCompetition];
  }
  const fromCompetition = competition.map((email): EmailChoice => {
    if (directory.some((d) => sameEmail(d, email))) return { email, origin: 'both', checked: true };
    const added = addedEmails.some((a) => sameEmail(a, email));
    return { email, origin: added ? 'competition' : 'competition-only', checked: added };
  });
  const onlyDirectory = directory.filter((d) => !competition.some((c) => sameEmail(c, d))).map((email): EmailChoice => ({ email, origin: 'directory', checked: directoryKept }));
  return [...fromCompetition, ...onlyDirectory];
}

/** Valeurs retenues : pour chaque champ le côté choisi (par défaut `defaultChoice`), les adresses étant celles cochées. */
export function resolvedValues(directory: ClubValues, competition: ClubValues, choices: Partial<Record<ClubField, Side>>, emails: string[], changedFields: readonly ClubField[]): ClubValues {
  const pick = <F extends Exclude<ClubField, 'coachEmails'>>(f: F): ClubValues[F] => ((choices[f] ?? defaultChoice(f, competition, changedFields)) === 'competition' ? competition[f] : directory[f]);
  return { name: pick('name'), coachName: pick('coachName'), coachPhone: pick('coachPhone'), coachEmails: emails, affiliationNumber: pick('affiliationNumber') };
}

/** Un changement se reporte sur un autre club (`apply`) seulement s'il avait exactement la valeur d'avant ; sinon `conflict`. */
export const propagationKind = (field: ClubField, club: ClubValues, before: ClubValues): 'apply' | 'conflict' => (same(field, club, before) ? 'apply' : 'conflict');

/** Compétition à venir : sa date est celle du jour ou plus tard (dates `AAAA-MM-JJ`). */
export const isUpcoming = (competitionDate: string, today: string): boolean => competitionDate >= today;
