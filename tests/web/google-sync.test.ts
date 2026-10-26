import { expect, test } from 'vitest';
import type { GoogleContact, SyncClub, SyncPreview } from '../../src/domain/google-contacts.js';
import { applyButtonLabel, buildApply, diffKey, initialChoices, type SyncChoices } from '../../src/web/googleSync.js';

const contact = (id: string, extra: Partial<GoogleContact> = {}): GoogleContact =>
  ({ resourceName: `people/${id}`, name: null, email: null, phone: null, organization: null, groups: [], ...extra });
const club = (id: string, extra: Partial<SyncClub> = {}): SyncClub =>
  ({ id, name: id, coachName: null, coachPhone: null, coachEmail: null, googleContactId: null, version: 1, ...extra });

const marc = contact('marc', { name: 'Marc', phone: '06 55 66 77 88', email: 'marc@exemple.fr' });
const paul = contact('paul', { name: 'Paul', email: 'paul@exemple.fr', phone: '07 00 00 00 00' });
const sophie = contact('sophie', { name: 'Sophie', organization: 'Dojo Sud' });
const ali = contact('ali', { name: 'Ali' });
const preview: SyncPreview = {
  diffs: [{ clubId: 'lilas', clubName: 'Lilas', version: 3, contact: marc, fields: [
    { field: 'coachPhone', directory: '06 11 22 33 44', google: '06 55 66 77 88' },
    { field: 'coachEmail', directory: null, google: 'marc@exemple.fr' },
  ] }],
  newContacts: [
    { contact: paul, exact: { clubId: 'est', reason: 'email' }, maybe: [] },
    { contact: sophie, exact: null, maybe: ['nord'] },
  ],
  pending: [{ contact: ali, exact: { clubId: 'nord', reason: 'phone' }, maybe: [] }],
  linked: [{ contact: marc, clubIds: ['lilas'] }],
  clubs: [
    club('lilas', { coachPhone: '06 11 22 33 44', googleContactId: 'people/marc', version: 3 }),
    // Coach différent (nom), téléphone vide : le nom se coche, le téléphone se remplit.
    club('est', { coachName: 'P. Martin', coachEmail: 'paul@exemple.fr', version: 5 }),
    club('nord', { version: 7 }),
  ],
};

test('au départ : différences cochées, lien sur la concordance exacte, sinon « Plus tard » ; en attente : « Plus tard »', () => {
  const c = initialChoices(preview);
  expect(c.keptDiffs).toEqual([]);
  expect(c.plans['people/paul']).toMatchObject({ mode: 'link', clubs: ['est'] });
  expect(c.plans['people/sophie']).toMatchObject({ mode: 'later', clubs: [null], name: 'Dojo Sud' });
  expect(c.plans['people/ali']).toMatchObject({ mode: 'later', clubs: ['nord'] });
  expect(c.plans['people/marc']).toMatchObject({ mode: null, clubs: [] });
  const r = buildApply(preview, c);
  expect(r.counts).toEqual({ diffs: 2, links: 1, creates: 0, kept: 0 });
  expect(r.apply).toEqual({
    updates: [{ clubId: 'lilas', version: 3, set: { coachPhone: '06 55 66 77 88', coachEmail: 'marc@exemple.fr' } }],
    links: [{ clubId: 'est', version: 5, contact: 'people/paul', set: { coachName: 'Paul', coachPhone: '07 00 00 00 00' } }],
    creates: [],
    later: ['people/sophie'],
  });
  expect(applyButtonLabel(r)).toBe('Appliquer : 2 différences, 1 lien');
});

test('cases décochées : valeur de l’annuaire gardée, comptée « gardée » ; un champ vide de la fiche est rempli sans case', () => {
  const c: SyncChoices = { ...initialChoices(preview), keptDiffs: [diffKey('lilas', 'coachPhone'), diffKey('lilas', 'coachEmail')] };
  c.plans['people/paul'] = { ...c.plans['people/paul']!, kept: [diffKey('est', 'coachName')] };
  const r = buildApply(preview, c);
  expect(r.apply.updates).toEqual([]);
  expect(r.apply.links).toEqual([{ clubId: 'est', version: 5, contact: 'people/paul', set: { coachPhone: '07 00 00 00 00' } }]);
  expect(r.counts).toEqual({ diffs: 0, links: 1, creates: 0, kept: 3 });
  expect(applyButtonLabel(r)).toBe('Appliquer : 1 lien, 3 gardées');
});

test('nouveau club : sans nom, le bouton est bloqué ; avec un nom, la fiche reçoit les coordonnées du contact', () => {
  const c = initialChoices(preview);
  c.plans['people/sophie'] = { ...c.plans['people/sophie']!, mode: 'create', name: '  ' };
  expect(buildApply(preview, c).missingName).toBe(true);
  c.plans['people/sophie'] = { ...c.plans['people/sophie']!, name: ' Dojo Sud ' };
  const r = buildApply(preview, c);
  expect(r.missingName).toBe(false);
  expect(r.apply.creates).toEqual([{ contact: 'people/sophie', name: 'Dojo Sud', coachName: 'Sophie', coachPhone: null, coachEmail: null }]);
  expect(r.apply.later).toEqual([]);
  expect(applyButtonLabel(r)).toBe('Appliquer : 2 différences, 1 lien, 1 nouveau club');
});

test('plusieurs clubs pour un contact, contact déjà lié lié à un second club ; listes vides et doublons ignorés', () => {
  const c = initialChoices(preview);
  c.plans['people/paul'] = { ...c.plans['people/paul']!, clubs: ['est', 'nord', null, 'nord'] };
  c.plans['people/marc'] = { ...c.plans['people/marc']!, clubs: ['nord', 'lilas'] };
  const r = buildApply(preview, c);
  expect(r.apply.links.map((l) => [l.contact, l.clubId])).toEqual([['people/paul', 'est'], ['people/paul', 'nord'], ['people/marc', 'nord']]);
  expect(r.counts.links).toBe(3);
});

test('les contacts en attente laissés « Plus tard » ne sont pas renvoyés ; rien à appliquer', () => {
  const empty: SyncPreview = { ...preview, diffs: [], newContacts: [], linked: [] };
  const r = buildApply(empty, initialChoices(empty));
  expect(r.apply).toEqual({ updates: [], links: [], creates: [], later: [] });
  expect(applyButtonLabel(r)).toBe('Rien à appliquer');
  expect(r.nothing).toBe(true);
});
