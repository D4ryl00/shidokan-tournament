import { eq } from 'drizzle-orm';
import { differingFields, type ClubValues } from '../../domain/club-changes.js';
import type { AppDb } from '../db/client.js';
import { clubChanges, clubDirectory, clubs } from '../db/schema.js';

type ClubRow = typeof clubs.$inferSelect;
type EntryRow = typeof clubDirectory.$inferSelect;

/**
 * Coordonnées du club de la compétition. Numéro : `''` (effacé par le club) vaut aucun numéro ;
 * sinon celui du club ; sinon celui de la fiche d'annuaire.
 */
export function clubValues(club: ClubRow, entry?: Pick<EntryRow, 'affiliationNumber'> | null): ClubValues {
  const affiliationNumber = club.affiliationNumber === '' ? null : (club.affiliationNumber ?? entry?.affiliationNumber ?? null);
  return { name: club.name, coachName: club.coachName, coachPhone: club.coachPhone, coachEmails: club.coachEmails, affiliationNumber };
}

/** Coordonnées de la fiche d'annuaire. */
export const directoryValues = (entry: EntryRow): ClubValues => ({
  name: entry.name, coachName: entry.coachName, coachPhone: entry.coachPhone, coachEmails: entry.coachEmails, affiliationNumber: entry.affiliationNumber,
});

/**
 * Compare le club à sa fiche d'annuaire après une modification de ses coordonnées, et tient à jour son changement à examiner :
 * sans fiche, rien ; sans différence, le changement disparaît ; un changement ignoré aux mêmes valeurs reste ignoré ;
 * sinon il est écrit (toutes les valeurs du club) et à examiner.
 */
export function recordClubChange(db: AppDb, clubId: string, origin: 'club' | 'competition'): void {
  const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
  if (!club?.directoryClubId) return;
  const entry = db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get();
  if (!entry) return;
  const values = clubValues(club, entry);
  const existing = db.select().from(clubChanges).where(eq(clubChanges.clubId, clubId)).get();
  if (!differingFields(values, directoryValues(entry)).length) {
    if (existing) db.delete(clubChanges).where(eq(clubChanges.clubId, clubId)).run();
    return;
  }
  if (existing?.ignored && existing.directoryId === entry.id && !differingFields(values, JSON.parse(existing.valuesJson) as ClubValues).length) return;
  const row = { competitionId: club.competitionId, directoryId: entry.id, origin, valuesJson: JSON.stringify(values), changedAt: new Date().toISOString(), ignored: false };
  db.insert(clubChanges).values({ clubId, ...row }).onConflictDoUpdate({ target: clubChanges.clubId, set: row }).run();
}
