import { eq } from 'drizzle-orm';
import { GOOGLE_CONNECT_FIRST, GOOGLE_RECONNECT, hasContactsScope } from '../../domain/app-settings.js';
import { missingEmails } from '../../domain/emails.js';
import { DIRECTORY_CHANGED, syncPreview, type CoachSet, type ContactLabel, type GoogleContact, type GoogleContactsView, type SyncApply } from '../../domain/google-contacts.js';
import type { AppDb } from '../db/client.js';
import { clubDirectory } from '../db/schema.js';
import { ContactsScopeMissingError, GoogleAccessRevokedError, type GoogleClient } from '../google/client.js';
import { getAppSettings, markGoogleRevoked, setGoogleContactsState } from './app-settings.js';
import { createDirectoryEntry, DirectoryConflictError } from './directory.js';

/**
 * Refus de la synchronisation, montré tel quel à l'écran : 409 (compte à connecter ou à reconnecter),
 * 502 pour une autre erreur Google (API People non activée, réseau…), dont le message reste affiché.
 */
export class GoogleContactsError extends Error {
  readonly expose = true;
  constructor(message: string, readonly statusCode = 409) {
    super(message);
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Lit les contacts Google (libellé choisi, sinon celui enregistré, sinon tous) et les compare à l'annuaire.
 * `label` : undefined = garder le libellé enregistré ; null = tous les contacts.
 */
export async function googleContactsPreview(db: AppDb, google: GoogleClient, label: string | null | undefined): Promise<GoogleContactsView> {
  const settings = getAppSettings(db);
  const sender = settings.google;
  if (!sender) throw new GoogleContactsError(GOOGLE_CONNECT_FIRST);
  if (!hasContactsScope(sender)) return { state: 'no-scope', account: sender.email };
  let labels: ContactLabel[];
  let contacts: GoogleContact[];
  try {
    [labels, contacts] = await Promise.all([google.listContactLabels(sender.refreshToken), google.listContacts(sender.refreshToken)]);
  } catch (e) {
    if (e instanceof ContactsScopeMissingError) return { state: 'no-scope', account: sender.email };
    if (e instanceof GoogleAccessRevokedError) {
      markGoogleRevoked(db, sender.refreshToken);
      throw new GoogleContactsError(GOOGLE_RECONNECT);
    }
    throw new GoogleContactsError(`Lecture des contacts Google impossible (${errorText(e)})`, 502);
  }
  if (label !== undefined) setGoogleContactsState(db, { label });
  const wanted = label !== undefined ? label : settings.googleContacts.label;
  const chosen = wanted && labels.some((l) => l.resourceName === wanted) ? wanted : null;
  const kept = chosen ? contacts.filter((c) => c.groups.includes(chosen)) : contacts;
  const rows = db.select().from(clubDirectory).all().map((r) => ({
    id: r.id, name: r.name, coachName: r.coachName, coachPhone: r.coachPhone, coachEmails: r.coachEmails,
    googleContactId: r.googleContactId, version: r.version, archived: r.archived,
  }));
  return { state: 'ok', account: sender.email, labels, label: chosen, total: kept.length, preview: syncPreview(kept, rows, getAppSettings(db).googleContacts.pending) };
}

/** Applique les choix en une seule transaction : une fiche modifiée ou archivée depuis l'aperçu annule tout. */
export function applyGoogleContacts(db: AppDb, input: SyncApply): { updated: number; linked: number; created: number } {
  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    for (const item of [...input.updates, ...input.links]) {
      const row = t.select().from(clubDirectory).where(eq(clubDirectory.id, item.clubId)).get();
      if (!row || row.archived || row.version !== item.version) throw new DirectoryConflictError(DIRECTORY_CHANGED);
    }
    // Les adresses Google s'ajoutent à celles de la fiche telle qu'elle est à ce moment (une mise à jour puis un lien peuvent viser la même).
    const columns = (clubId: string, { addEmails, ...set }: CoachSet) => {
      if (!addEmails?.length) return set;
      const current = t.select({ coachEmails: clubDirectory.coachEmails }).from(clubDirectory).where(eq(clubDirectory.id, clubId)).get()!.coachEmails;
      return { ...set, coachEmails: [...current, ...missingEmails(current, addEmails)] };
    };
    for (const u of input.updates) {
      const set = columns(u.clubId, u.set);
      if (Object.keys(set).length) t.update(clubDirectory).set(set).where(eq(clubDirectory.id, u.clubId)).run();
    }
    for (const l of input.links) t.update(clubDirectory).set({ ...columns(l.clubId, l.set), googleContactId: l.contact }).where(eq(clubDirectory.id, l.clubId)).run();
    for (const c of input.creates) {
      const entry = createDirectoryEntry(t, { name: c.name, affiliationNumber: null, coachName: c.coachName, coachPhone: c.coachPhone, coachEmails: c.coachEmails, notes: null });
      t.update(clubDirectory).set({ googleContactId: c.contact }).where(eq(clubDirectory.id, entry.id)).run();
    }
    const done = new Set([...input.links.map((l) => l.contact), ...input.creates.map((c) => c.contact)]);
    const pending = [...new Set([...getAppSettings(t).googleContacts.pending, ...input.later])].filter((c) => !done.has(c));
    setGoogleContactsState(t, { pending });
    return { updated: input.updates.length, linked: input.links.length, created: input.creates.length };
  });
}
