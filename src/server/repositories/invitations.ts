import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AppDb } from '../db/client.js';
import { clubChanges, clubDirectory, clubInvitations, clubs, competitions, fighters, mailLog } from '../db/schema.js';
import type { Club } from '../../domain/registration.js';
import { NotFoundError, toClub } from './registrations.js';

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
  coachEmails: string[];
  invited: boolean;
  /** Nombre de liens actifs du club. */
  links: number;
  invitedAt: string | null;
  /** Dernière visite, tous liens actifs confondus. */
  lastUsedAt: string | null;
  fighters: number;
  /** Dernier mail envoyé au club pour cette compétition. */
  lastMail: { sentAt: string; status: 'sent' | 'error'; error: string | null } | null;
}
/** Un lien actif d'un club, sans son jeton (seule son empreinte est gardée). */
export interface ClubAccess {
  id: string;
  createdAt: string;
  sentAt: string | null;
  sentVia: 'mail' | 'messagerie' | null;
  lastUsedAt: string | null;
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

function createLink(db: AppDb, competitionId: string, clubId: string, clubName: string): InvitationLink & { id: string } {
  const token = newToken();
  const id = crypto.randomUUID();
  db.insert(clubInvitations).values({ id, competitionId, clubId, tokenHash: hashToken(token) }).run();
  return { id, clubId, clubName, token };
}

/** Liens actifs d'un club, du plus récent au plus ancien. */
const activeLinks = (db: AppDb, competitionId: string, clubId: string) =>
  db.select().from(clubInvitations).where(active(competitionId, clubId)).orderBy(desc(clubInvitations.createdAt), sql`rowid desc`).all();
const latest = (dates: (string | null)[]) => dates.reduce<string | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** Tous les clubs de la compétition, avec l'état de leur lien personnel. */
export function listInvitations(db: AppDb, competitionId: string): ClubInvitationRow[] {
  return db
    .select()
    .from(clubs)
    .where(eq(clubs.competitionId, competitionId))
    .orderBy(clubs.nameKey)
    .all()
    .map((c) => {
      const links = activeLinks(db, competitionId, c.id);
      const n = db.select({ n: count() }).from(fighters).where(eq(fighters.clubId, c.id)).get()!.n;
      const mail = db.select().from(mailLog).where(eq(mailLog.clubId, c.id)).orderBy(desc(mailLog.sentAt)).get();
      return {
        clubId: c.id, clubName: c.name, directoryClubId: c.directoryClubId, coachEmails: c.coachEmails,
        // Un lien actif vaut invitation, même si la date manque (club revenu d'un paquet qui ne la portait pas).
        invited: c.invitedAt !== null || links.length > 0, links: links.length, invitedAt: c.invitedAt ?? links.at(-1)?.createdAt ?? null,
        lastUsedAt: latest(links.map((l) => l.lastUsedAt)), fighters: n,
        lastMail: mail ? { sentAt: mail.sentAt, status: mail.status, error: mail.error } : null,
      };
    });
}

/**
 * Club de compétition d'une fiche de l'annuaire : celui déjà relié à la fiche, sinon celui de même nom, sinon un nouveau, avec les
 * coordonnées de la fiche (celles qui manquent au club existant sont complétées).
 */
function clubForEntry(t: AppDb, competitionId: string, entry: typeof clubDirectory.$inferSelect): typeof clubs.$inferSelect {
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
  // Un club qui a un changement à examiner (le coach a saisi ou effacé ses valeurs) n'est pas rempli : sa saisie est respectée.
  const entered = !!club && !!t.select().from(clubChanges).where(eq(clubChanges.clubId, club.id)).get();
  if (club) {
    const fill = {
      directoryClubId: entry.id,
      ...(!club.ffkEntity && entry.ffkEntity ? { ffkEntity: entry.ffkEntity } : {}),
      ...(entered
        ? {}
        : {
            ...(!club.coachName && entry.coachName ? { coachName: entry.coachName } : {}),
            ...(!club.coachPhone && entry.coachPhone ? { coachPhone: entry.coachPhone } : {}),
            ...(!club.coachEmails.length && entry.coachEmails.length ? { coachEmails: entry.coachEmails } : {}),
          }),
    };
    t.update(clubs).set(fill).where(eq(clubs.id, club.id)).run();
    return t.select().from(clubs).where(eq(clubs.id, club.id)).get()!;
  }
  const id = crypto.randomUUID();
  t.insert(clubs)
    .values({
      id, competitionId, name: entry.name, nameKey: entry.nameKey, ffkEntity: entry.ffkEntity, coachName: entry.coachName,
      coachPhone: entry.coachPhone, coachEmails: entry.coachEmails, preApproval: false, directoryClubId: entry.id,
    })
    .run();
  return t.select().from(clubs).where(eq(clubs.id, id)).get()!;
}

const directoryEntry = (t: AppDb, entryId: string) => {
  const entry = t.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get();
  if (!entry) throw new NotFoundError('Club introuvable dans l’annuaire');
  return entry;
};

/** Invite des clubs de l'annuaire : chacun reçoit son club de compétition, sans lien ; le lien se crée à l'envoi ou par « Créer un lien ». */
export function inviteClubs(db: AppDb, competitionId: string, directoryIds: string[]): void {
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    for (const entryId of directoryIds) {
      const club = clubForEntry(t, competitionId, directoryEntry(t, entryId));
      if (!club.invitedAt) t.update(clubs).set({ invitedAt: NOW() }).where(eq(clubs.id, club.id)).run();
    }
  });
}

/** Club de compétition d'une fiche de l'annuaire, pour la saisie d'une inscription (sans lien d'inscription). */
export function clubFromDirectory(db: AppDb, competitionId: string, entryId: string): Club {
  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    return toClub(clubForEntry(t, competitionId, directoryEntry(t, entryId)));
  });
}

/** Fiches de l'annuaire (non archivées) qui n'ont pas encore de club dans la compétition, par ordre alphabétique. */
export function directoryChoices(db: AppDb, competitionId: string): { id: string; name: string }[] {
  const linked = new Set(db.select({ id: clubs.directoryClubId }).from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => c.id));
  return db.select({ id: clubDirectory.id, name: clubDirectory.name }).from(clubDirectory).where(eq(clubDirectory.archived, false)).all()
    .filter((e) => !linked.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

const NOW = () => new Date().toISOString();

/** Liens actifs d'un club (accès), du plus récent au plus ancien. */
export function listClubAccesses(db: AppDb, competitionId: string, clubId: string): ClubAccess[] {
  competitionClub(db, competitionId, clubId);
  return activeLinks(db, competitionId, clubId).map((l) => ({ id: l.id, createdAt: l.createdAt, sentAt: l.sentAt, sentVia: l.sentVia, lastUsedAt: l.lastUsedAt }));
}

/** Désactive tous les liens du club et retire son invitation (« Supprimer tous les accès », « Retirer l'invitation ») : il redevient « à inviter ». */
export function revokeInvitation(db: AppDb, competitionId: string, clubId: string): void {
  competitionClub(db, competitionId, clubId);
  db.update(clubInvitations).set({ revokedAt: NOW() }).where(active(competitionId, clubId)).run();
  db.update(clubs).set({ invitedAt: null }).where(eq(clubs.id, clubId)).run();
}

/** Désactive un lien actif du club ; 404 s'il n'est pas à lui. */
export function revokeClubAccess(db: AppDb, competitionId: string, clubId: string, linkId: string): void {
  competitionClub(db, competitionId, clubId);
  const done = db.update(clubInvitations).set({ revokedAt: NOW() }).where(and(active(competitionId, clubId), eq(clubInvitations.id, linkId))).run();
  if (done.changes === 0) throw new NotFoundError('Lien introuvable');
}

/** Nouveau lien pour le club, qui s'ajoute aux autres (« Créer un lien », envoi par mail ou par la messagerie) ; le club devient invité s'il ne l'était pas. */
export function addInvitationLink(db: AppDb, competitionId: string, clubId: string): InvitationLink & { id: string } {
  const club = competitionClub(db, competitionId, clubId);
  if (!club.invitedAt) db.update(clubs).set({ invitedAt: NOW() }).where(eq(clubs.id, clubId)).run();
  return createLink(db, competitionId, clubId, club.name);
}

/** Note l'envoi d'un lien : mail parti, ou préparé dans la messagerie de l'organisateur. */
export function markLinkSent(db: AppDb, token: string, via: 'mail' | 'messagerie'): void {
  db.update(clubInvitations).set({ sentAt: NOW(), sentVia: via }).where(eq(clubInvitations.tokenHash, hashToken(token))).run();
}

/** Désactive un lien (envoi raté : les liens d'avant restent ceux qui fonctionnent). */
export function revokeLink(db: AppDb, token: string): void {
  db.update(clubInvitations).set({ revokedAt: NOW() }).where(eq(clubInvitations.tokenHash, hashToken(token))).run();
}

/** Compétition et club d'un lien actif (sa dernière visite est notée), sinon null. */
export function resolveInvitation(db: AppDb, token: string): { competitionId: string; clubId: string } | null {
  const link = db.select().from(clubInvitations).where(and(eq(clubInvitations.tokenHash, hashToken(token)), isNull(clubInvitations.revokedAt))).get();
  if (!link) return null;
  db.update(clubInvitations).set({ lastUsedAt: NOW() }).where(eq(clubInvitations.id, link.id)).run();
  return { competitionId: link.competitionId, clubId: link.clubId };
}

/** État d'un jeton : actif, remplacé ou révoqué (l'empreinte est gardée), ou inconnu. */
export function invitationStatus(db: AppDb, token: string): 'active' | 'revoked' | 'unknown' {
  const link = db.select().from(clubInvitations).where(eq(clubInvitations.tokenHash, hashToken(token))).get();
  return !link ? 'unknown' : link.revokedAt ? 'revoked' : 'active';
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
