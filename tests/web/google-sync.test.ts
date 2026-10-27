import { expect, test } from 'vitest';
import type { GoogleContact, SyncClub, SyncPreview } from '../../src/domain/google-contacts.js';
import { applyButtonLabel, buildApply, diffKey, initialChoices, type SyncChoices } from '../../src/web/googleSync.js';

const contact = (id: string, extra: Partial<GoogleContact> = {}): GoogleContact =>
  ({ resourceName: `people/${id}`, name: null, emails: [], phone: null, organization: null, affiliationNumber: null, groups: [], ...extra });
const club = (id: string, extra: Partial<SyncClub> = {}): SyncClub =>
  ({ id, name: id, coachName: null, coachPhone: null, coachEmails: [], affiliationNumber: null, googleContactId: null, version: 1, ...extra });

const marc = contact('marc', { name: 'Marc', phone: '06 55 66 77 88', emails: ['marc@exemple.fr'] });
const paul = contact('paul', { name: 'Paul', emails: ['paul@exemple.fr', 'paul.perso@exemple.fr'], phone: '07 00 00 00 00' });
const sophie = contact('sophie', { name: 'Sophie', organization: 'Dojo Sud' });
const ali = contact('ali', { name: 'Ali' });
const preview: SyncPreview = {
  diffs: [{ clubId: 'lilas', clubName: 'Lilas', version: 3, contact: marc, fields: [
    { field: 'coachPhone', directory: '06 11 22 33 44', google: '06 55 66 77 88' },
    { field: 'coachEmails', directory: [], google: ['marc@exemple.fr'] },
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
    club('est', { coachName: 'P. Martin', coachEmails: ['paul@exemple.fr'], version: 5 }),
    club('nord', { version: 7 }),
  ],
  numbers: {},
};

test('au départ : différences cochées, lien sur la concordance exacte, sinon « Plus tard » ; en attente : « Plus tard »', () => {
  const c = initialChoices(preview);
  expect(c.keptDiffs).toEqual([]);
  expect(c.plans['people/paul']).toMatchObject({ mode: 'link', clubs: ['est'] });
  expect(c.plans['people/sophie']).toMatchObject({ mode: 'later', clubs: [null], name: 'Dojo Sud' });
  expect(c.plans['people/ali']).toMatchObject({ mode: 'later', clubs: ['nord'] });
  expect(c.plans['people/marc']).toMatchObject({ mode: null, clubs: [] });
  const r = buildApply(preview, c);
  expect(r.counts).toEqual({ diffs: 2, links: 1, creates: 0, later: 1, kept: 0 });
  expect(r.apply).toEqual({
    updates: [{ clubId: 'lilas', version: 3, set: { coachPhone: '06 55 66 77 88', addEmails: ['marc@exemple.fr'] } }],
    links: [{ clubId: 'est', version: 5, contact: 'people/paul', set: { coachName: 'Paul', coachPhone: '07 00 00 00 00', addEmails: ['paul.perso@exemple.fr'] } }],
    creates: [],
    later: ['people/sophie'],
  });
  expect(applyButtonLabel(r)).toBe('Appliquer : 2 différences, 1 lien, 1 contact en attente');
});

test('cases décochées : valeur de l’annuaire gardée, comptée « gardée » ; un champ vide de la fiche est rempli sans case', () => {
  const c: SyncChoices = { ...initialChoices(preview), keptDiffs: [diffKey('lilas', 'coachPhone'), diffKey('lilas', 'coachEmails')] };
  c.plans['people/paul'] = { ...c.plans['people/paul']!, kept: [diffKey('est', 'coachName'), diffKey('est', 'coachEmails')] };
  const r = buildApply(preview, c);
  expect(r.apply.updates).toEqual([]);
  expect(r.apply.links).toEqual([{ clubId: 'est', version: 5, contact: 'people/paul', set: { coachPhone: '07 00 00 00 00' } }]);
  expect(r.counts).toEqual({ diffs: 0, links: 1, creates: 0, later: 1, kept: 4 });
  expect(applyButtonLabel(r)).toBe('Appliquer : 1 lien, 1 contact en attente, 4 gardées');
});

test('nouveau club : sans nom, le bouton est bloqué ; avec un nom, la fiche reçoit les coordonnées du contact', () => {
  const c = initialChoices(preview);
  c.plans['people/sophie'] = { ...c.plans['people/sophie']!, mode: 'create', name: '  ' };
  expect(buildApply(preview, c).missingName).toBe(true);
  c.plans['people/sophie'] = { ...c.plans['people/sophie']!, name: ' Dojo Sud ' };
  const r = buildApply(preview, c);
  expect(r.missingName).toBe(false);
  expect(r.apply.creates).toEqual([{ contact: 'people/sophie', name: 'Dojo Sud', coachName: 'Sophie', coachPhone: null, coachEmails: [], affiliationNumber: null }]);
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

test('« Plus tard » seul : rangé en attente à l’application, le bouton le dit', () => {
  const only: SyncPreview = { ...preview, diffs: [], linked: [], pending: [], newContacts: [preview.newContacts[1]!, { contact: ali, exact: null, maybe: [] }] };
  const r = buildApply(only, initialChoices(only));
  expect(r.nothing).toBe(false);
  expect(r.apply).toEqual({ updates: [], links: [], creates: [], later: ['people/sophie', 'people/ali'] });
  expect(applyButtonLabel(r)).toBe('Appliquer : 2 contacts en attente');
});

test('valeur Google que l’annuaire refuserait : ni envoyée au lien, ni au nouveau club ; le reste part', () => {
  const bad = contact('bad', { name: 'Zoé Mail', emails: ['"Zoé" <z@x.fr>', 'pas une adresse'], phone: '0'.repeat(41), organization: 'O'.repeat(121) });
  const p: SyncPreview = { ...preview, diffs: [], linked: [], pending: [], newContacts: [{ contact: bad, exact: null, maybe: [] }] };
  const c = initialChoices(p);
  // Nom d'entreprise trop long : pas repris comme nom du club.
  expect(c.plans['people/bad']).toMatchObject({ mode: 'later', name: '' });
  c.plans['people/bad'] = { ...c.plans['people/bad']!, mode: 'link', clubs: ['nord'] };
  expect(buildApply(p, c).apply.links).toEqual([{ clubId: 'nord', version: 7, contact: 'people/bad', set: { coachName: 'Zoé Mail' } }]);
  c.plans['people/bad'] = { ...c.plans['people/bad']!, mode: 'create', name: 'Dojo Zoé' };
  expect(buildApply(p, c).apply.creates).toEqual([{ contact: 'people/bad', name: 'Dojo Zoé', coachName: 'Zoé Mail', coachPhone: null, coachEmails: [], affiliationNumber: null }]);
});

test('nouveau club : toutes les adresses valides du contact, sans doublon', () => {
  const multi = contact('multi', { name: 'Léa', emails: ['lea@dojo.fr', 'LEA@dojo.fr', 'club@dojo.fr', 'invalide'] });
  const p: SyncPreview = { ...preview, diffs: [], linked: [], pending: [], newContacts: [{ contact: multi, exact: null, maybe: [] }] };
  const c = initialChoices(p);
  c.plans['people/multi'] = { ...c.plans['people/multi']!, mode: 'create', name: 'Dojo Léa' };
  expect(buildApply(p, c).apply.creates).toEqual([{ contact: 'people/multi', name: 'Dojo Léa', coachName: 'Léa', coachPhone: null, coachEmails: ['lea@dojo.fr', 'club@dojo.fr'], affiliationNumber: null }]);
});

test('numéro d’affiliation : rempli au lien et à la création ; celui d’une autre fiche n’est jamais envoyé', () => {
  const sakura = contact('sakura', { name: 'Sakura', affiliationNumber: '0060918' });
  const issa = contact('issa', { name: 'Issa', affiliationNumber: '0060808' });
  const p: SyncPreview = {
    ...preview, diffs: [], linked: [], pending: [],
    newContacts: [{ contact: sakura, exact: null, maybe: [] }, { contact: issa, exact: null, maybe: [] }],
    clubs: [...preview.clubs, club('issa-club', { affiliationNumber: '0060808' })],
    numbers: { '0060808': { clubId: 'issa-club', name: 'issa-club' } },
  };
  const c = initialChoices(p);
  c.plans['people/sakura'] = { ...c.plans['people/sakura']!, mode: 'link', clubs: ['nord'] };
  c.plans['people/issa'] = { ...c.plans['people/issa']!, mode: 'link', clubs: ['est'] };
  expect(buildApply(p, c).apply.links).toEqual([
    { clubId: 'nord', version: 7, contact: 'people/sakura', set: { coachName: 'Sakura', affiliationNumber: '0060918' } },
    { clubId: 'est', version: 5, contact: 'people/issa', set: { coachName: 'Issa' } },
  ]);
  c.plans['people/sakura'] = { ...c.plans['people/sakura']!, mode: 'create', name: 'Sakura Dojo' };
  c.plans['people/issa'] = { ...c.plans['people/issa']!, mode: 'create', name: 'Issa bis' };
  expect(buildApply(p, c).apply.creates.map((x) => x.affiliationNumber)).toEqual(['0060918', null]);
});
