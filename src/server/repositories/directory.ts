import { count, eq } from 'drizzle-orm';
import { missingEmails } from '../../domain/emails.js';
import type { DirectoryEntry, DirectoryInput } from '../../domain/registration.js';
import { normalizeName } from '../../domain/names.js';
import type { AppDb } from '../db/client.js';
import { clubDirectory, clubs } from '../db/schema.js';
import { NotFoundError } from './registrations.js';

export class DirectoryConflictError extends Error {
  readonly statusCode = 409;
}

type Row = typeof clubDirectory.$inferSelect;

function toEntry(db: AppDb, row: Row): DirectoryEntry {
  const competitions = db.select({ n: count() }).from(clubs).where(eq(clubs.directoryClubId, row.id)).get()!.n;
  return {
    id: row.id, name: row.name, affiliationNumber: row.affiliationNumber, ffkEntity: row.ffkEntity, coachName: row.coachName,
    coachPhone: row.coachPhone, coachEmails: row.coachEmails, notes: row.notes, archived: row.archived, googleContactId: row.googleContactId, createdAt: row.createdAt, competitions,
  };
}

function getRow(db: AppDb, id: string): Row {
  const row = db.select().from(clubDirectory).where(eq(clubDirectory.id, id)).get();
  if (!row) throw new NotFoundError('Club introuvable dans l’annuaire');
  return row;
}

/** Refuse un numéro d'affiliation déjà porté par une autre fiche. */
function checkNumber(db: AppDb, number: string | null | undefined, selfId: string | null): void {
  if (!number) return;
  const holder = db.select().from(clubDirectory).where(eq(clubDirectory.affiliationNumber, number)).get();
  if (holder && holder.id !== selfId) throw new DirectoryConflictError(`Ce numéro d’affiliation est déjà celui de « ${holder.name} ».`);
}

export function listDirectory(db: AppDb): DirectoryEntry[] {
  return db.select().from(clubDirectory).orderBy(clubDirectory.nameKey).all().map((r) => toEntry(db, r));
}

export function createDirectoryEntry(db: AppDb, input: DirectoryInput): DirectoryEntry {
  checkNumber(db, input.affiliationNumber, null);
  const id = crypto.randomUUID();
  db.insert(clubDirectory).values({ id, ...input, name: input.name.trim(), nameKey: normalizeName(input.name) }).run();
  return toEntry(db, getRow(db, id));
}

export function updateDirectoryEntry(db: AppDb, id: string, patch: Partial<DirectoryInput> & { archived?: boolean; googleContactId?: null }): DirectoryEntry {
  getRow(db, id);
  checkNumber(db, patch.affiliationNumber, id);
  const set = { ...patch, ...(patch.archived ? { googleContactId: null } : {}), ...(patch.name ? { name: patch.name.trim(), nameKey: normalizeName(patch.name) } : {}) };
  if (Object.keys(set).length) db.update(clubDirectory).set(set).where(eq(clubDirectory.id, id)).run();
  return toEntry(db, getRow(db, id));
}

/**
 * Fusionne deux fiches : les clubs de compétition de `mergeId` passent à `keepId`, dont les champs vides sont complétés et qui reçoit
 * aussi les adresses e-mail qu'elle n'a pas ; `mergeId` est supprimée.
 */
export function mergeDirectoryEntries(db: AppDb, keepId: string, mergeId: string): DirectoryEntry {
  const keep = getRow(db, keepId);
  const merged = getRow(db, mergeId);
  if (keepId === mergeId) return toEntry(db, keep);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    t.update(clubs).set({ directoryClubId: keepId }).where(eq(clubs.directoryClubId, mergeId)).run();
    t.delete(clubDirectory).where(eq(clubDirectory.id, mergeId)).run(); // avant de reprendre son numéro (unique)
    const fields = ['affiliationNumber', 'ffkEntity', 'coachName', 'coachPhone', 'notes'] as const;
    const fill = Object.fromEntries(fields.filter((f) => !keep[f] && merged[f]).map((f) => [f, merged[f]]));
    const emails = missingEmails(keep.coachEmails, merged.coachEmails);
    if (emails.length) Object.assign(fill, { coachEmails: [...keep.coachEmails, ...emails] });
    if (!keep.googleContactId && merged.googleContactId) Object.assign(fill, { googleContactId: merged.googleContactId });
    if (Object.keys(fill).length) t.update(clubDirectory).set(fill).where(eq(clubDirectory.id, keepId)).run();
  });
  return toEntry(db, getRow(db, keepId));
}
