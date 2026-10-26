import { normalizeName } from './names.js';

// Calcul pur de la synchronisation des coachs avec Google Contacts.
// Importé aussi par la page : aucune dépendance au serveur.

export interface GoogleContact { resourceName: string; name: string | null; email: string | null; phone: string | null; organization: string | null; groups: string[] }
export interface ContactLabel { resourceName: string; name: string }
export type CoachField = 'coachName' | 'coachPhone' | 'coachEmail';
export interface SyncClub { id: string; name: string; coachName: string | null; coachPhone: string | null; coachEmail: string | null; googleContactId: string | null; version: number | null }
export interface FieldDiff { field: CoachField; directory: string | null; google: string }
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
const normEmail = (v: string): string => v.trim().toLowerCase();

/** Différences à proposer : un champ Google vide n'en est jamais une. */
export function fieldDiffs(contact: GoogleContact, club: Pick<SyncClub, CoachField>): FieldDiff[] {
  const out: FieldDiff[] = [];
  const check = (field: CoachField, google: string | null, directory: string | null, same: (a: string, b: string) => boolean): void => {
    if (blank(google)) return;
    if (!blank(directory) && same(google, directory)) return;
    out.push({ field, directory: blank(directory) ? null : directory, google });
  };
  check('coachName', contact.name, club.coachName, (a, b) => normalizeName(a) === normalizeName(b));
  check('coachPhone', contact.phone, club.coachPhone, (a, b) => normalizePhone(a) === normalizePhone(b));
  check('coachEmail', contact.email, club.coachEmail, (a, b) => normEmail(a) === normEmail(b));
  return out;
}

const byName = (a: { name: string }, b: { name: string }): number =>
  normalizeName(a.name).localeCompare(normalizeName(b.name), 'fr');

function contactLabel(c: GoogleContact): string {
  return c.name ?? c.organization ?? c.email ?? c.phone ?? '';
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
    const email = blank(contact.email) ? null : normEmail(contact.email);
    const phone = blank(contact.phone) ? '' : normalizePhone(contact.phone);
    let exact: ContactChoice['exact'] = null;
    if (email) {
      const hit = active.find((c) => !blank(c.coachEmail) && normEmail(c.coachEmail) === email);
      if (hit) exact = { clubId: hit.id, reason: 'email' };
    }
    if (!exact && phone) {
      const hit = active.find((c) => !blank(c.coachPhone) && normalizePhone(c.coachPhone) === phone);
      if (hit) exact = { clubId: hit.id, reason: 'phone' };
    }
    const person = blank(contact.name) ? '' : normalizeName(contact.name);
    const org = blank(contact.organization) ? '' : normalizeName(contact.organization);
    const maybe = active
      .filter((c) => c.id !== exact?.clubId)
      .filter((c) => (person && !blank(c.coachName) && normalizeName(c.coachName) === person) || (org && normalizeName(c.name) === org))
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
  updates: { clubId: string; version: number | null; set: Partial<Record<CoachField, string>> }[];
  links: { clubId: string; version: number | null; contact: string; set: Partial<Record<CoachField, string>> }[];
  creates: { contact: string; name: string; coachName: string | null; coachPhone: string | null; coachEmail: string | null }[];
  /** Contacts choisis « Plus tard » cette fois. */
  later: string[];
}
