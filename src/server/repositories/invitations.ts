import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/client.js';
import { clubDirectory, clubInvitations, clubs, competitions, fighters } from '../db/schema.js';
import { NotFoundError } from './registrations.js';

export const newToken = (): string => randomBytes(24).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface InvitationLink {
  clubId: string;
  clubName: string;
  token: string;
}
export interface ClubInvitationRow {
  clubId: string;
  clubName: string;
  directoryClubId: string | null;
  coachEmail: string | null;
  invited: boolean;
  invitedAt: string | null;
  lastUsedAt: string | null;
  fighters: number;
}
export type ClubEntryStatus = 'closed' | 'open' | 'frozen';
export interface ClubEntrySettings {
  status: ClubEntryStatus;
  deadline: string | null;
  /** Faux quand une autre installation a la main sur la compétition. */
  managedHere: boolean;
}

export class InvitationConflictError extends Error {
  readonly statusCode = 409;
}

export class NotManagedHereError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Cette compétition est gérée par une autre installation : les inscriptions en ligne s’y règlent.');
  }
}

const active = (competitionId: string, clubId: string) =>
  and(eq(clubInvitations.competitionId, competitionId), eq(clubInvitations.clubId, clubId), isNull(clubInvitations.revokedAt));

function competitionClub(db: AppDb, competitionId: string, clubId: string) {
  const club = db.select().from(clubs).where(and(eq(clubs.id, clubId), eq(clubs.competitionId, competitionId))).get();
  if (!club) throw new NotFoundError('Club introuvable');
  return club;
}

function createLink(db: AppDb, competitionId: string, clubId: string, clubName: string): InvitationLink {
  const token = newToken();
  db.insert(clubInvitations).values({ id: crypto.randomUUID(), competitionId, clubId, tokenHash: hashToken(token) }).run();
  return { clubId, clubName, token };
}

/** Tous les clubs de la compétition, avec l'état de leur lien personnel. */
export function listInvitations(db: AppDb, competitionId: string): ClubInvitationRow[] {
  return db
    .select()
    .from(clubs)
    .where(eq(clubs.competitionId, competitionId))
    .orderBy(clubs.nameKey)
    .all()
    .map((c) => {
      const link = db.select().from(clubInvitations).where(active(competitionId, c.id)).get();
      const n = db.select({ n: count() }).from(fighters).where(eq(fighters.clubId, c.id)).get()!.n;
      return {
        clubId: c.id, clubName: c.name, directoryClubId: c.directoryClubId, coachEmail: c.coachEmail,
        invited: !!link, invitedAt: link?.createdAt ?? null, lastUsedAt: link?.lastUsedAt ?? null, fighters: n,
      };
    });
}

/**
 * Invite des clubs de l'annuaire : chacun reçoit un club de compétition (celui déjà relié à la fiche, sinon celui de même nom, sinon
 * un nouveau, avec les coordonnées de la fiche) et un lien personnel. Un club qui a déjà un lien actif n'en reçoit pas d'autre.
 */
export function inviteClubs(db: AppDb, competitionId: string, directoryIds: string[]): InvitationLink[] {
  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const links: InvitationLink[] = [];
    for (const entryId of directoryIds) {
      const entry = t.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get();
      if (!entry) throw new NotFoundError('Club introuvable dans l’annuaire');
      const inCompetition = (cond: ReturnType<typeof eq>) => t.select().from(clubs).where(and(eq(clubs.competitionId, competitionId), cond)).get();
      let club = inCompetition(eq(clubs.directoryClubId, entry.id));
      if (!club) {
        // Club de même nom : repris, sauf s'il est relié à une autre fiche qui porte un autre numéro d'affiliation (deux clubs distincts).
        const sameName = inCompetition(eq(clubs.nameKey, entry.nameKey));
        const other = sameName?.directoryClubId ? t.select().from(clubDirectory).where(eq(clubDirectory.id, sameName.directoryClubId)).get() : undefined;
        if (other && other.id !== entry.id && other.affiliationNumber && entry.affiliationNumber && other.affiliationNumber !== entry.affiliationNumber) {
          throw new InvitationConflictError(`« ${entry.name} » : un club du même nom, relié à une autre fiche de l’annuaire, est déjà dans cette compétition. Fusionnez les fiches ou renommez-en une.`);
        }
        club = sameName;
      }
      if (club) {
        const fill = {
          directoryClubId: entry.id,
          ...(!club.ffkEntity && entry.ffkEntity ? { ffkEntity: entry.ffkEntity } : {}),
          ...(!club.coachName && entry.coachName ? { coachName: entry.coachName } : {}),
          ...(!club.coachPhone && entry.coachPhone ? { coachPhone: entry.coachPhone } : {}),
          ...(!club.coachEmail && entry.coachEmail ? { coachEmail: entry.coachEmail } : {}),
        };
        t.update(clubs).set(fill).where(eq(clubs.id, club.id)).run();
      } else {
        const id = crypto.randomUUID();
        t.insert(clubs)
          .values({
            id, competitionId, name: entry.name, nameKey: entry.nameKey, ffkEntity: entry.ffkEntity, coachName: entry.coachName,
            coachPhone: entry.coachPhone, coachEmail: entry.coachEmail, preApproval: false, directoryClubId: entry.id,
          })
          .run();
        club = t.select().from(clubs).where(eq(clubs.id, id)).get()!;
      }
      if (!t.select().from(clubInvitations).where(active(competitionId, club.id)).get()) links.push(createLink(t, competitionId, club.id, club.name));
    }
    return links;
  });
}

const NOW = () => new Date().toISOString();

/** Nouveau lien pour le club ; l'ancien ne fonctionne plus. */
export function regenerateInvitation(db: AppDb, competitionId: string, clubId: string): InvitationLink {
  const club = competitionClub(db, competitionId, clubId);
  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    t.update(clubInvitations).set({ revokedAt: NOW() }).where(active(competitionId, clubId)).run();
    return createLink(t, competitionId, clubId, club.name);
  });
}

export function revokeInvitation(db: AppDb, competitionId: string, clubId: string): void {
  competitionClub(db, competitionId, clubId);
  db.update(clubInvitations).set({ revokedAt: NOW() }).where(active(competitionId, clubId)).run();
}

/** Compétition et club d'un lien actif (sa dernière visite est notée), sinon null. */
export function resolveInvitation(db: AppDb, token: string): { competitionId: string; clubId: string } | null {
  const link = db.select().from(clubInvitations).where(and(eq(clubInvitations.tokenHash, hashToken(token)), isNull(clubInvitations.revokedAt))).get();
  if (!link) return null;
  db.update(clubInvitations).set({ lastUsedAt: NOW() }).where(eq(clubInvitations.id, link.id)).run();
  return { competitionId: link.competitionId, clubId: link.clubId };
}

export function getClubEntrySettings(db: AppDb, competitionId: string): ClubEntrySettings {
  const c = db.select().from(competitions).where(eq(competitions.id, competitionId)).get();
  if (!c) throw new NotFoundError('Compétition introuvable');
  return { status: c.clubEntryStatus, deadline: c.clubEntryDeadline, managedHere: c.ownerInstanceId === null };
}

export function updateClubEntrySettings(db: AppDb, competitionId: string, patch: { status?: 'open' | 'frozen'; deadline?: string | null }): ClubEntrySettings {
  if (!getClubEntrySettings(db, competitionId).managedHere) throw new NotManagedHereError();
  const set = {
    ...(patch.status ? { clubEntryStatus: patch.status } : {}),
    ...(patch.deadline !== undefined ? { clubEntryDeadline: patch.deadline } : {}),
  };
  if (Object.keys(set).length) db.update(competitions).set(set).where(eq(competitions.id, competitionId)).run();
  return getClubEntrySettings(db, competitionId);
}
