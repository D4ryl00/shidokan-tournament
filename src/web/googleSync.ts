import { fieldDiffs, type CoachField, type FieldDiff, type GoogleContact, type SyncApply, type SyncClub, type SyncPreview } from '../domain/google-contacts.js';
import { plural } from '../domain/plural.js';

/**
 * Choix faits sur l'écran de synchronisation avec Google, et ce qu'ils envoient à « Appliquer ».
 * Une case décochée (valeur de l'annuaire gardée) vaut pour cette fois seulement : rien n'est retenu.
 */

/** Choix pour un contact : `null` pour un contact déjà lié (il ne peut qu'être lié aussi à un autre club). */
export type ContactMode = 'link' | 'create' | 'later' | null;
export interface ContactPlan {
  mode: ContactMode;
  /** Clubs choisis, une liste chacun (« + Lier aussi à un autre club » en ajoute une) ; null = rien de choisi dans cette liste. */
  clubs: (string | null)[];
  /** Nom du « Nouveau club ». */
  name: string;
  /** Champs décochés sous un club choisi (`diffKey`). */
  kept: string[];
}
export interface SyncChoices {
  /** Lignes décochées des « Différences avec l’annuaire » (`diffKey`). */
  keptDiffs: string[];
  plans: Record<string, ContactPlan>;
}

export const diffKey = (clubId: string, field: CoachField): string => `${clubId}:${field}`;

export function initialChoices(p: SyncPreview): SyncChoices {
  const plans: Record<string, ContactPlan> = {};
  const name = (c: GoogleContact) => c.organization?.trim() ?? '';
  for (const { contact, exact } of p.newContacts) {
    plans[contact.resourceName] = exact
      ? { mode: 'link', clubs: [exact.clubId], name: name(contact), kept: [] }
      : { mode: 'later', clubs: [null], name: name(contact), kept: [] };
  }
  // En attente : « Plus tard » de nouveau, le club de même mail ou téléphone prêt dans la liste.
  for (const { contact, exact } of p.pending) plans[contact.resourceName] = { mode: 'later', clubs: [exact?.clubId ?? null], name: name(contact), kept: [] };
  for (const { contact } of p.linked) plans[contact.resourceName] = { mode: null, clubs: [], name: '', kept: [] };
  return { keptDiffs: [], plans };
}

/** Sous un club choisi : les champs qui diffèrent (une case chacun) et ceux que Google remplit dans une fiche vide. */
export function linkFields(contact: GoogleContact, club: SyncClub): { boxes: FieldDiff[]; fills: FieldDiff[] } {
  const all = fieldDiffs(contact, club);
  return { boxes: all.filter((f) => f.directory !== null), fills: all.filter((f) => f.directory === null) };
}

/** Clubs à lier pour ce contact : listes remplies, sans doublon, sans ceux auxquels il est déjà lié. */
export function linkTargets(plan: ContactPlan, alreadyLinked: string[] = []): string[] {
  if (plan.mode !== 'link' && plan.mode !== null) return [];
  return [...new Set(plan.clubs.filter((c): c is string => c !== null))].filter((c) => !alreadyLinked.includes(c));
}

export interface ApplyPlan {
  apply: SyncApply;
  counts: { diffs: number; links: number; creates: number; kept: number };
  /** Un « Nouveau club » sans nom : le bouton reste bloqué. */
  missingName: boolean;
  /** Ni différence, ni lien, ni nouveau club. */
  nothing: boolean;
}

export function buildApply(p: SyncPreview, choices: SyncChoices): ApplyPlan {
  const apply: SyncApply = { updates: [], links: [], creates: [], later: [] };
  let diffs = 0;
  let kept = 0;
  let missingName = false;
  for (const d of p.diffs) {
    const set: SyncApply['updates'][number]['set'] = {};
    for (const f of d.fields) {
      if (choices.keptDiffs.includes(diffKey(d.clubId, f.field))) kept++;
      else {
        set[f.field] = f.google;
        diffs++;
      }
    }
    if (Object.keys(set).length) apply.updates.push({ clubId: d.clubId, version: d.version, set });
  }
  const clubs = new Map(p.clubs.map((c) => [c.id, c]));
  const newIds = new Set(p.newContacts.map((c) => c.contact.resourceName));
  const contacts = [...p.newContacts, ...p.pending, ...p.linked.map((l) => ({ contact: l.contact, clubIds: l.clubIds }))];
  for (const entry of contacts) {
    const { contact } = entry;
    const plan = choices.plans[contact.resourceName];
    if (!plan) continue;
    for (const clubId of linkTargets(plan, 'clubIds' in entry ? entry.clubIds : [])) {
      const club = clubs.get(clubId);
      if (!club) continue;
      const set: SyncApply['links'][number]['set'] = {};
      const { boxes, fills } = linkFields(contact, club);
      for (const f of fills) set[f.field] = f.google;
      for (const f of boxes) {
        if (plan.kept.includes(diffKey(clubId, f.field))) kept++;
        else set[f.field] = f.google;
      }
      apply.links.push({ clubId, version: club.version, contact: contact.resourceName, set });
    }
    if (plan.mode === 'create') {
      const name = plan.name.trim();
      if (!name) missingName = true;
      else apply.creates.push({ contact: contact.resourceName, name, coachName: filled(contact.name), coachPhone: filled(contact.phone), coachEmail: filled(contact.email) });
    }
    if (plan.mode === 'later' && newIds.has(contact.resourceName)) apply.later.push(contact.resourceName);
  }
  const creates = apply.creates.length + (missingName ? countUnnamed(choices) : 0);
  const counts = { diffs, links: apply.links.length, creates, kept };
  return { apply, counts, missingName, nothing: diffs + counts.links + creates === 0 };
}

const filled = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);
const countUnnamed = (c: SyncChoices): number => Object.values(c.plans).filter((p) => p.mode === 'create' && !p.name.trim()).length;

/** « Appliquer : 3 différences, 1 lien, 1 nouveau club, 1 gardée » ; les éléments à zéro sont omis. */
export function applyButtonLabel({ counts, nothing }: Pick<ApplyPlan, 'counts' | 'nothing'>): string {
  if (nothing) return 'Rien à appliquer';
  const parts = [
    counts.diffs ? plural(counts.diffs, 'différence') : null,
    counts.links ? plural(counts.links, 'lien') : null,
    counts.creates ? plural(counts.creates, 'nouveau club', 'nouveaux clubs') : null,
    counts.kept ? plural(counts.kept, 'gardée') : null,
  ].filter((x) => x !== null);
  return `Appliquer : ${parts.join(', ')}`;
}
