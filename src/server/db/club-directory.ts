import { asc, desc, eq, isNull } from 'drizzle-orm';
import type { AppDb } from './client.js';
import { clubAliases, clubDirectory, clubs, competitions } from './schema.js';

/** Numéro d'affiliation FFK : les chiffres en tête de l'entité (« 0060808 ISSA KYOKUSHIN SCHOOL » → « 0060808 »), sinon null. */
export function affiliationNumber(entity: string | null): string | null {
  return entity?.trim().match(/^(\d+)(\s|$)/)?.[1] ?? null;
}

type Entry = typeof clubDirectory.$inferSelect;

/** Entrée d'annuaire d'un club : même numéro d'affiliation, sinon même nom sans autre numéro, sinon aucune. */
function findEntry(db: AppDb, nameKey: string, number: string | null): Entry | undefined {
  if (number) {
    const byNumber = db.select().from(clubDirectory).where(eq(clubDirectory.affiliationNumber, number)).get();
    if (byNumber) return byNumber;
  }
  const byName = db.select().from(clubDirectory).where(eq(clubDirectory.nameKey, nameKey)).orderBy(asc(clubDirectory.createdAt), asc(clubDirectory.id)).all();
  const compatible = byName.filter((e) => !number || !e.affiliationNumber || e.affiliationNumber === number);
  return compatible.find((e) => number && e.affiliationNumber === number) ?? compatible[0];
}

/**
 * Relie le club de compétition à son entrée d'annuaire, en la créant au besoin ; complète les coordonnées vides de l'entrée
 * et lui donne l'entité FFK et le numéro d'affiliation du club si elle ne les a pas. Ne change jamais un lien existant. Renvoie l'id de l'entrée.
 */
export function linkClub(db: AppDb, clubId: string): string {
  const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
  if (!club) throw new Error(`Club introuvable : ${clubId}`);
  const entity = club.ffkEntity ?? db.select().from(clubAliases).where(eq(clubAliases.nameKey, club.nameKey)).get()?.clubEntity ?? null;
  const number = affiliationNumber(entity);
  const linked = club.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
  const entry = linked ?? findEntry(db, club.nameKey, number);
  if (!entry) {
    const id = crypto.randomUUID();
    db.insert(clubDirectory)
      .values({ id, name: club.name, nameKey: club.nameKey, affiliationNumber: number, ffkEntity: entity, coachName: club.coachName, coachPhone: club.coachPhone, coachEmail: club.coachEmail })
      .run();
    db.update(clubs).set({ directoryClubId: id }).where(eq(clubs.id, clubId)).run();
    return id;
  }
  const numberFree = number && !entry.affiliationNumber && !db.select().from(clubDirectory).where(eq(clubDirectory.affiliationNumber, number)).get();
  const fill = {
    ...(numberFree ? { affiliationNumber: number } : {}),
    ...(entity && !entry.ffkEntity ? { ffkEntity: entity } : {}),
    ...(club.coachName && !entry.coachName ? { coachName: club.coachName } : {}),
    ...(club.coachPhone && !entry.coachPhone ? { coachPhone: club.coachPhone } : {}),
    ...(club.coachEmail && !entry.coachEmail ? { coachEmail: club.coachEmail } : {}),
  };
  if (Object.keys(fill).length) db.update(clubDirectory).set(fill).where(eq(clubDirectory.id, entry.id)).run();
  if (!linked) db.update(clubs).set({ directoryClubId: entry.id }).where(eq(clubs.id, clubId)).run();
  return entry.id;
}

/**
 * Relie tous les clubs non reliés, de la compétition la plus récente à la plus ancienne (date, puis created_at) : les coordonnées
 * de l'annuaire viennent ainsi de la compétition la plus récente qui les renseigne. Renvoie le nombre de clubs reliés.
 * Ne fait rien si la table club_directory n'existe pas (base d'avant 0014, comme pour ensureRowVersions).
 */
export function linkAllClubs(db: AppDb): number {
  if (!db.$client.prepare("select 1 from sqlite_master where type = 'table' and name = 'club_directory'").get()) return 0;
  const pending = db
    .select({ id: clubs.id })
    .from(clubs)
    .innerJoin(competitions, eq(competitions.id, clubs.competitionId))
    .where(isNull(clubs.directoryClubId))
    .orderBy(desc(competitions.date), desc(competitions.createdAt), asc(clubs.id))
    .all();
  if (!pending.length) return 0;
  db.$client.transaction(() => {
    for (const { id } of pending) linkClub(db, id);
  })();
  return pending.length;
}
