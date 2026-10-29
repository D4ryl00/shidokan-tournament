import { cleanEmails, isAcceptableEmail, missingEmails, sameEmail } from './emails.js';
import { normalizeName } from './names.js';
import { DIRECTORY_LIMITS } from './registration.js';

// Calcul pur de la synchronisation des coachs avec Google Contacts.
// Importé aussi par la page : aucune dépendance au serveur.

/**
 * `emails` : toutes les adresses du contact (la principale en premier), telles que Google les donne, découpées aux virgules.
 * `affiliationNumber` : le champ personnalisé « Num affiliation FFK » (voir `affiliationFromCustomFields`).
 */
export interface GoogleContact { resourceName: string; name: string | null; emails: string[]; phone: string | null; organization: string | null; affiliationNumber: string | null; groups: string[] }
export interface ContactLabel { resourceName: string; name: string }
export type TextField = 'coachName' | 'coachPhone' | 'affiliationNumber';
export type CoachField = TextField | 'coachEmails';
export interface SyncClub { id: string; name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; affiliationNumber: string | null; googleContactId: string | null; version: number | null }
/** Numéros d'affiliation de l'annuaire, fiches archivées comprises (un numéro est unique) : numéro → fiche qui le porte. */
export type NumberHolders = Record<string, { clubId: string; name: string }>;
/**
 * Champ qui diffère entre Google et l'annuaire. Pour les e-mails, `add` liste les adresses Google absentes de la fiche, à
 * ajouter, et `remove` les adresses de la fiche que Google n'a pas, à retirer.
 */
export type FieldDiff =
  | { field: TextField; directory: string | null; google: string }
  | { field: 'coachEmails'; directory: string[]; add: string[]; remove: string[] };
/** Ce qu'« Appliquer » change dans une fiche : `removeEmails` sont retirées des adresses de la fiche, puis `addEmails` s'y ajoutent. */
export interface CoachSet { coachName?: string; coachPhone?: string; affiliationNumber?: string; addEmails?: string[]; removeEmails?: string[] }
export interface ClubDiff { clubId: string; clubName: string; version: number | null; contact: GoogleContact; fields: FieldDiff[] }
export interface ContactChoice { contact: GoogleContact; exact: { clubId: string; reason: 'number' | 'email' | 'phone' } | null; maybe: string[] }
export interface SyncPreview {
  diffs: ClubDiff[];
  newContacts: ContactChoice[];
  pending: ContactChoice[];
  linked: { contact: GoogleContact; clubIds: string[] }[];
  clubs: SyncClub[];
  numbers: NumberHolders;
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

/** Libellé du champ personnalisé des contacts Google qui porte le numéro d'affiliation FFK (sans « ° », difficile à taper). */
export const AFFILIATION_FIELD = 'Num affiliation FFK';
/** Même règle que la fiche de l'annuaire. */
export const AFFILIATION_PATTERN = /^\d{7}$/;

/**
 * Numéro d'affiliation d'un contact : la valeur du premier champ personnalisé dont le libellé contient « affiliation »
 * (« Num affiliation FFK », « N° d’affiliation »…), sans ses espaces ; null s'il n'y en a pas. Une valeur qui n'est pas un
 * numéro reste telle quelle : `rejectedValues` la signale.
 */
export function affiliationFromCustomFields(fields: { key?: string; value?: string }[] | undefined): string | null {
  const field = (fields ?? []).find((f) => normalizeName(f.key ?? '').includes('AFFILIATION') && f.value?.trim());
  return field ? field.value!.replace(/\s+/g, '') : null;
}

const blank = (v: string | null | undefined): v is null | undefined => v === null || v === undefined || v.trim() === '';
const CONTACT_VALUE: Record<TextField, (c: GoogleContact) => string | null> = {
  coachName: (c) => c.name, coachPhone: (c) => c.phone, affiliationNumber: (c) => c.affiliationNumber,
};

/** Une valeur Google que la fiche de l'annuaire accepterait (mêmes limites que la saisie). */
export function isAcceptableCoachValue(field: TextField, value: string): boolean {
  const v = value.trim();
  if (field === 'affiliationNumber') return AFFILIATION_PATTERN.test(v);
  return v !== '' && v.length <= DIRECTORY_LIMITS[field];
}

/** Numéro Google acceptable, ou null. */
const contactNumber = (c: GoogleContact): string | null =>
  !blank(c.affiliationNumber) && isAcceptableCoachValue('affiliationNumber', c.affiliationNumber) ? c.affiliationNumber.trim() : null;

/**
 * Fiche qui porte déjà le numéro Google, si ce n'est pas `clubId` (null : un nouveau club) : ce numéro ne peut pas être repris.
 * Renvoie son nom, sinon null.
 */
export function numberConflict(contact: GoogleContact, clubId: string | null, numbers: NumberHolders): string | null {
  const number = contactNumber(contact);
  const holder = number ? numbers[number] : undefined;
  return holder && holder.clubId !== clubId ? holder.name : null;
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

/**
 * Différences à proposer : un champ Google vide, ou que l'annuaire refuserait, n'en est jamais une ; ni un numéro d'affiliation
 * qu'une autre fiche porte déjà (`numberConflict`). Un contact sans adresse acceptable ne retire donc aucune adresse de la fiche.
 */
export function fieldDiffs(contact: GoogleContact, club: Pick<SyncClub, 'id' | CoachField>, numbers: NumberHolders = {}): FieldDiff[] {
  const out: FieldDiff[] = [];
  const check = (field: TextField, google: string | null, directory: string | null, same: (a: string, b: string) => boolean): void => {
    if (blank(google) || !isAcceptableCoachValue(field, google)) return;
    if (!blank(directory) && same(google, directory)) return;
    out.push({ field, directory: blank(directory) ? null : directory, google });
  };
  check('coachName', contact.name, club.coachName, (a, b) => normalizeName(a) === normalizeName(b));
  check('coachPhone', contact.phone, club.coachPhone, (a, b) => normalizePhone(a) === normalizePhone(b));
  if (!numberConflict(contact, club.id, numbers)) check('affiliationNumber', contact.affiliationNumber, club.affiliationNumber, (a, b) => a.trim() === b.trim());
  const google = contactEmails(contact);
  if (google.length) {
    const remove = club.coachEmails.filter((e) => !google.some((g) => sameEmail(g, e)));
    const add = missingEmails(club.coachEmails.filter((e) => !remove.includes(e)), google);
    if (add.length || remove.length) out.push({ field: 'coachEmails', directory: club.coachEmails, add, remove });
  }
  return out;
}

/** Une différence est-elle un simple remplissage (champ vide dans l'annuaire) ? */
export const fillsEmpty = (f: FieldDiff): boolean => (f.field === 'coachEmails' ? f.directory.length === 0 : f.directory === null);

/** Reporte une différence acceptée dans ce qu'« Appliquer » envoie. */
export function applyDiff(set: CoachSet, f: FieldDiff): void {
  if (f.field !== 'coachEmails') set[f.field] = f.google;
  else {
    if (f.add.length) set.addEmails = f.add;
    if (f.remove.length) set.removeEmails = f.remove;
  }
}

const byName = (a: { name: string }, b: { name: string }): number =>
  normalizeName(a.name).localeCompare(normalizeName(b.name), 'fr');

function contactLabel(c: GoogleContact): string {
  return c.name ?? c.organization ?? c.emails[0] ?? c.phone ?? '';
}

export function syncPreview(contacts: GoogleContact[], clubs: (SyncClub & { archived: boolean })[], pending: string[]): SyncPreview {
  const active: SyncClub[] = clubs.filter((c) => !c.archived).map(({ archived: _a, ...c }) => c).sort(byName);
  const pendingIds = new Set(pending);
  const numbers: NumberHolders = {};
  for (const c of clubs) if (c.affiliationNumber) numbers[c.affiliationNumber] = { clubId: c.id, name: c.name };

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
    const number = contactNumber(contact);
    const sameNumber = (c: SyncClub): boolean => !!number && c.affiliationNumber === number;
    // Un club déjà lié à un autre contact n'est jamais proposé d'office : « Appliquer » remplacerait ce lien sans qu'on l'ait choisi.
    const free = (c: SyncClub): boolean => !c.googleContactId || c.googleContactId === contact.resourceName;
    // Le numéro d'affiliation reconnaît un club à coup sûr ; puis une adresse, puis le téléphone.
    let exact: ContactChoice['exact'] = null;
    const byNumber = active.find((c) => free(c) && sameNumber(c));
    if (byNumber) exact = { clubId: byNumber.id, reason: 'number' };
    const byEmail = exact ? undefined : active.find((c) => free(c) && sharesEmail(c));
    if (byEmail) exact = { clubId: byEmail.id, reason: 'email' };
    const byPhone = exact ? undefined : active.find((c) => free(c) && samePhone(c));
    if (byPhone) exact = { clubId: byPhone.id, reason: 'phone' };
    const person = blank(contact.name) ? '' : normalizeName(contact.name);
    const org = blank(contact.organization) ? '' : normalizeName(contact.organization);
    const maybe = active
      .filter((c) => c.id !== exact?.clubId)
      .filter((c) => (person && !blank(c.coachName) && normalizeName(c.coachName) === person) || (org && normalizeName(c.name) === org)
        || (!free(c) && (sharesEmail(c) || samePhone(c) || sameNumber(c))))
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
        const fields = fieldDiffs(contact, club, numbers);
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
  return { diffs, newContacts: newContacts.sort(byLabel), pending: pendingOut.sort(byLabel), linked, clubs: active, numbers };
}

/** Réponse de l'aperçu de la synchronisation. */
export type GoogleContactsView =
  | { state: 'no-scope'; account: string }
  | { state: 'ok'; account: string; labels: ContactLabel[]; label: string | null; total: number; preview: SyncPreview };

/** Ce que l'organisateur a choisi d'appliquer. */
export interface SyncApply {
  updates: { clubId: string; version: number | null; set: CoachSet }[];
  links: { clubId: string; version: number | null; contact: string; set: CoachSet }[];
  creates: { contact: string; name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; affiliationNumber: string | null }[];
  /** Contacts choisis « Plus tard » cette fois. */
  later: string[];
}
