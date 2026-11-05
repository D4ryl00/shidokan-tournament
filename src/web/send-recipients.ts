import { sameEmail } from '../domain/emails.js';

/** Adresses cochées par club, pour cet envoi seulement ; un club absent garde le choix par défaut. */
export type CheckedAddresses = Record<string, string[]>;
type ClubAddresses = { clubId: string; coachEmails: string[] };

/** Adresses cochées d'un club : par défaut, seulement la première. */
export const checkedAddresses = (club: ClubAddresses, checked: CheckedAddresses): string[] =>
  checked[club.clubId] ?? club.coachEmails.slice(0, 1);

/** Coche ou décoche une adresse d'un club, à partir de ce qui est coché pour lui. */
export function toggleAddress(club: ClubAddresses, checked: CheckedAddresses, email: string, on: boolean): CheckedAddresses {
  const current = checkedAddresses(club, checked);
  return { ...checked, [club.clubId]: on ? [...current, email] : current.filter((e) => e !== email) };
}

/** Un club qui a des adresses, mais aucune de cochée. */
export const noneChecked = (club: ClubAddresses, checked: CheckedAddresses): boolean =>
  club.coachEmails.length > 0 && checkedAddresses(club, checked).length === 0;

/** Destinataires d'un envoi : les adresses cochées, dans l'ordre du club ; rien à transmettre pour un club à une seule adresse. */
export function sendTarget(club: ClubAddresses, checked: CheckedAddresses): { clubId: string; emails?: string[] } {
  if (club.coachEmails.length <= 1) return { clubId: club.clubId };
  const on = checkedAddresses(club, checked);
  return { clubId: club.clubId, emails: club.coachEmails.filter((e) => on.some((x) => sameEmail(x, e))) };
}
