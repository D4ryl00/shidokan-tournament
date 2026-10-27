import { cleanEmails, isAcceptableEmail, missingEmails, sameEmail } from './emails.js';
import { normalizeName } from './names.js';
import { DIRECTORY_LIMITS } from './registration.js';

// Calcul pur de la synchronisation des coachs avec Google Contacts.
// Importé aussi par la page : aucune dépendance au serveur.

/** `emails` : toutes les adresses du contact (la principale en premier), telles que Google les donne, découpées aux virgules. */
export interface GoogleContact { resourceName: string; name: string | null; emails: string[]; phone: string | null; organization: string | null; groups: string[] }
export interface ContactLabel { resourceName: string; name: string }
export type TextField = 'coachName' | 'coachPhone';
export type CoachField = TextField | 'coachEmails';
export interface SyncClub { id: string; name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; googleContactId: string | null; version: number | null }
/**
 * Champ qui diffère entre Google et l'annuaire. Pour les e-mails, `google` liste les adresses Google absentes de la fiche, à
 * ajouter : rien n'est retiré de l'annuaire.
 */
export type FieldDiff =
  | { field: TextField; directory: string | null; google: string }
  | { field: 'coachEmails'; directory: string[]; google: string[] };
/** Ce qu'« Appliquer » change dans une fiche : `addEmails` s'ajoute aux adresses de la fiche. */
export interface CoachSet { coachName?: string; coachPhone?: string; addEmails?: string[] }
export interface ClubDiff { clubId: string; clubName: string; version: number | null; contact: GoogleContact; fields: FieldDiff[] }
export interface ContactChoice { contact: GoogleContact; exact: { clubId: string; reason: 'email' | 'phone' } | null; maybe: string[] }
export interface SyncPreview {
  diffs: ClubDiff[];
  newContacts: ContactChoice[];
  pending: ContactChoice[];
  linked: { contact: GoogleContact; clubIds: string[] }[];
  clubs: SyncClub[];
}

export const CONTACTS_NOT_GRANTED = 'Le droit de lire les contacts n’a pas été accordé à l’application. Reconnectez-vous avec Google et laissez la case « contacts » cochée.';
export const DIRECTORY_CHANGED = 'L’annuaire a changé entre-temps : la page a été rechargée, vérifiez puis appliquez de nouveau.';
export const RECONNECT_OTHER_ACCOUNT = 'Se reconnecter avec un autre compte Google efface les liens entre l’annuaire et les contacts Google.';

/** Garde les chiffres ; « 0033… » et « 33… » (11 chiffres) deviennent « 0… ». */
export function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.startsWith('0033') && d.length === 13) return '0' + d.slice(4);
  if (d.startsWith('33') && d.length === 11) return '0' + d.slice(2);
  return d;
}

const blank = (v: string | null | undefined): v is null | undefined => v === null || v === undefined || v.trim() === '';
const CONTACT_VALUE: Record<TextField, (c: GoogleContact) => string | null> = { coachName: (c) => c.name, coachPhone: (c) => c.phone };

/** Une valeur Google que la fiche de l'annuaire accepterait (mêmes limites que la saisie). */
export function isAcceptableCoachValue(field: TextField, value: string): boolean {
  const v = value.trim();
  return v !== '' && v.length <= DIRECTORY_LIMITS[field];
}

/** Adresses Google que la fiche accepterait, sans doublon. */
export const contactEmails = (contact: GoogleContact): string[] => cleanEmails(contact.emails.filter(isAcceptableEmail));

/** Valeurs Google que l'annuaire refuserait (adresse invalide, numéro trop long…) : jamais reprises, signalées à l'écran. */
export function rejectedValues(contact: GoogleContact): { field: CoachField; value: string }[] {
  const texts = (Object.keys(CONTACT_VALUE) as TextField[]).flatMap((field) => {
    const value = CONTACT_VALUE[field](contact);
    return blank(value) || isAcceptableCoachValue(field, value) ? [] : [{ field, value }];
  });
  const emails = contact.emails.filter((v) => !blank(v) && !isAcceptableEmail(v)).map((value) => ({ field: 'coachEmails' as const, value: value.trim() }));
  return [...texts, ...emails];
}

/** Différences à proposer : un champ Google vide, ou que l'annuaire refuserait, n'en est jamais une. */
export function fieldDiffs(contact: GoogleContact, club: Pick<SyncClub, CoachField>): FieldDiff[] {
  const out: FieldDiff[] = [];
  const check = (field: TextField, google: string | null, directory: string | null, same: (a: string, b: string) => boolean): void => {
    if (blank(google) || !isAcceptableCoachValue(field, google)) return;
    if (!blank(directory) && same(google, directory)) return;
    out.push({ field, directory: blank(directory) ? null : directory, google });
  };
  check('coachName', contact.name, club.coachName, (a, b) => normalizeName(a) === normalizeName(b));
  check('coachPhone', contact.phone, club.coachPhone, (a, b) => normalizePhone(a) === normalizePhone(b));
  const added = missingEmails(club.coachEmails, contactEmails(contact));
  if (added.length) out.push({ field: 'coachEmails', directory: club.coachEmails, google: added });
  return out;
}

/** Une différence est-elle un simple remplissage (champ vide dans l'annuaire) ? */
export const fillsEmpty = (f: FieldDiff): boolean => (f.field === 'coachEmails' ? f.directory.length === 0 : f.directory === null);

/** Reporte une différence acceptée dans ce qu'« Appliquer » envoie. */
export function applyDiff(set: CoachSet, f: FieldDiff): void {
  if (f.field === 'coachEmails') set.addEmails = f.google;
  else set[f.field] = f.google;
}

const byName = (a: { name: string }, b: { name: string }): number =>
  normalizeName(a.name).localeCompare(normalizeName(b.name), 'fr');

function contactLabel(c: GoogleContact): string {
  return c.name ?? c.organization ?? c.emails[0] ?? c.phone ?? '';
}

export function syncPreview(contacts: GoogleContact[], clubs: (SyncClub & { archived: boolean })[], pending: string[]): SyncPreview {
  const active: SyncClub[] = clubs.filter((c) => !c.archived).map(({ archived: _a, ...c }) => c).sort(byName);
  const pendingIds = new Set(pending);

  const linksByContact = new Map<string, SyncClub[]>();
  for (const club of active) {
    if (!club.googleContactId) continue;
    const list = linksByContact.get(club.googleContactId) ?? [];
    list.push(club);
    linksByContact.set(club.googleContactId, list);
  }

  const choice = (contact: GoogleContact): ContactChoice => {
    const emails = contactEmails(contact);
    const phone = blank(contact.phone) ? '' : normalizePhone(contact.phone);
    // Une adresse en commun suffit.
    const sharesEmail = (c: SyncClub): boolean => c.coachEmails.some((a) => emails.some((b) => sameEmail(a, b)));
    const samePhone = (c: SyncClub): boolean => !!phone && !blank(c.coachPhone) && normalizePhone(c.coachPhone) === phone;
    // Un club déjà lié à un autre contact n'est jamais proposé d'office : « Appliquer » remplacerait ce lien sans qu'on l'ait choisi.
    const free = (c: SyncClub): boolean => !c.googleContactId || c.googleContactId === contact.resourceName;
    let exact: ContactChoice['exact'] = null;
    const byEmail = active.find((c) => free(c) && sharesEmail(c));
    if (byEmail) exact = { clubId: byEmail.id, reason: 'email' };
    const byPhone = exact ? undefined : active.find((c) => free(c) && samePhone(c));
    if (byPhone) exact = { clubId: byPhone.id, reason: 'phone' };
    const person = blank(contact.name) ? '' : normalizeName(contact.name);
    const org = blank(contact.organization) ? '' : normalizeName(contact.organization);
    const maybe = active
      .filter((c) => c.id !== exact?.clubId)
      .filter((c) => (person && !blank(c.coachName) && normalizeName(c.coachName) === person) || (org && normalizeName(c.name) === org)
        || (!free(c) && (sharesEmail(c) || samePhone(c))))
      .map((c) => c.id);
    return { contact, exact, maybe };
  };

  const diffs: ClubDiff[] = [];
  const linked: SyncPreview['linked'] = [];
  const newContacts: ContactChoice[] = [];
  const pendingOut: ContactChoice[] = [];
  for (const contact of contacts) {
    const links = linksByContact.get(contact.resourceName);
    if (links) {
      linked.push({ contact, clubIds: links.map((c) => c.id) });
      for (const club of links) {
        const fields = fieldDiffs(contact, club);
        if (fields.length) diffs.push({ clubId: club.id, clubName: club.name, version: club.version, contact, fields });
      }
    } else if (pendingIds.has(contact.resourceName)) {
      pendingOut.push(choice(contact));
    } else {
      newContacts.push(choice(contact));
    }
  }
  const byLabel = (a: ContactChoice, b: ContactChoice): number =>
    normalizeName(contactLabel(a.contact)).localeCompare(normalizeName(contactLabel(b.contact)), 'fr');
  diffs.sort((a, b) => normalizeName(a.clubName).localeCompare(normalizeName(b.clubName), 'fr'));
  return { diffs, newContacts: newContacts.sort(byLabel), pending: pendingOut.sort(byLabel), linked, clubs: active };
}

/** Réponse de l'aperçu de la synchronisation. */
export type GoogleContactsView =
  | { state: 'no-scope'; account: string }
  | { state: 'ok'; account: string; labels: ContactLabel[]; label: string | null; total: number; preview: SyncPreview };

/** Ce que l'organisateur a choisi d'appliquer. */
export interface SyncApply {
  updates: { clubId: string; version: number | null; set: CoachSet }[];
  links: { clubId: string; version: number | null; contact: string; set: CoachSet }[];
  creates: { contact: string; name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[] }[];
  /** Contacts choisis « Plus tard » cette fois. */
  later: string[];
}
