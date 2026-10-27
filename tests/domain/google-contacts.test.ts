import { expect, test } from 'vitest';
import {
  applyDiff, contactEmails, fieldDiffs, fillsEmpty, isAcceptableCoachValue, normalizePhone, rejectedValues, syncPreview,
  type CoachSet, type GoogleContact, type SyncClub,
} from '../../src/domain/google-contacts.js';
import { DIRECTORY_LIMITS } from '../../src/domain/registration.js';

const contact = (o: Partial<GoogleContact> & { resourceName: string }): GoogleContact => ({
  name: null, emails: [], phone: null, organization: null, groups: [], ...o,
});
const club = (o: Partial<SyncClub & { archived: boolean }> & { id: string; name: string }): SyncClub & { archived: boolean } => ({
  coachName: null, coachPhone: null, coachEmails: [], googleContactId: null, version: 1, archived: false, ...o,
});

test('téléphones équivalents', () => {
  expect(normalizePhone('+33 6 12 34 56 78')).toBe(normalizePhone('06.12.34.56.78'));
  expect(normalizePhone('0033612345678')).toBe('0612345678');
});

test('différences : vide Google ignoré, vide annuaire comblé, écritures équivalentes ignorées', () => {
  const c = contact({ resourceName: 'people/c1', name: 'Julie Petit', emails: ['JULIE@ex.fr'], phone: '+33 6 11 22 33 44' });
  expect(fieldDiffs(c, { coachName: 'J. Petit', coachPhone: '06 11 22 33 44', coachEmails: [] })).toEqual([
    { field: 'coachName', directory: 'J. Petit', google: 'Julie Petit' },
    { field: 'coachEmails', directory: [], google: ['JULIE@ex.fr'] },
  ]);
  const vide = contact({ resourceName: 'people/c1' });
  expect(fieldDiffs(vide, { coachName: 'X', coachPhone: '0611223344', coachEmails: ['a@b.fr'] })).toEqual([]);
});

test('aperçu : club lié → différences ; club archivé ignoré', () => {
  const c = contact({ resourceName: 'people/c1', name: 'Julie Petit', phone: '0699999999' });
  const lie = club({ id: 'k1', name: 'Dojo A', coachName: 'Julie Petit', coachPhone: '0611223344', googleContactId: 'people/c1' });
  const p = syncPreview([c], [lie], []);
  expect(p.diffs).toHaveLength(1);
  expect(p.diffs[0]!.clubId).toBe('k1');
  expect(p.diffs[0]!.fields).toEqual([{ field: 'coachPhone', directory: '0611223344', google: '0699999999' }]);
  const q = syncPreview([c], [{ ...lie, archived: true }], []);
  expect(q.diffs).toEqual([]);
  expect(q.clubs).toEqual([]);
  expect(q.newContacts.map((n) => n.contact.resourceName)).toEqual(['people/c1']);
});

test('suggestion exacte par mail puis téléphone, ressemblance seulement proposée', () => {
  const clubs = [
    club({ id: 'k1', name: 'Dojo A', coachEmails: ['julie@ex.fr'] }),
    club({ id: 'k2', name: 'Dojo B', coachPhone: '06 22 33 44 55' }),
    club({ id: 'k3', name: 'Dojo C', coachName: 'Paul Martin' }),
    club({ id: 'k4', name: 'DOJO des lilas' }),
  ];
  const all = syncPreview([
    contact({ resourceName: 'people/m', emails: ['JULIE@ex.fr'] }),
    contact({ resourceName: 'people/t', phone: '+33 6 22 33 44 55' }),
    contact({ resourceName: 'people/n', name: 'paul  MARTIN' }),
    contact({ resourceName: 'people/o', organization: 'Dojo des Lilas' }),
  ], clubs, []).newContacts;
  const by = (r: string) => all.find((x) => x.contact.resourceName === `people/${r}`);
  const m = by('m'), t = by('t'), n = by('n'), o = by('o');
  expect(m!.exact).toEqual({ clubId: 'k1', reason: 'email' });
  expect(n!.exact).toBeNull();
  expect(n!.maybe).toEqual(['k3']);
  expect(o!.exact).toBeNull();
  expect(o!.maybe).toEqual(['k4']);
  expect(t!.exact).toEqual({ clubId: 'k2', reason: 'phone' });
});

test('en attente : séparé des nouveaux, même retiré puis remis', () => {
  const c2 = contact({ resourceName: 'people/c2', name: 'Zoé' });
  const c4 = contact({ resourceName: 'people/c4', name: 'Alex' });
  const p = syncPreview([c2, c4], [], ['people/c2']);
  expect(p.pending.map((x) => x.contact.resourceName)).toEqual(['people/c2']);
  expect(p.newContacts.map((x) => x.contact.resourceName)).toEqual(['people/c4']);
  const absent = syncPreview([c4], [], ['people/c2']);
  expect(absent.pending).toEqual([]);
  expect(absent.newContacts.map((x) => x.contact.resourceName)).toEqual(['people/c4']);
});

test('contact lié à deux clubs', () => {
  const c3 = contact({ resourceName: 'people/c3', name: 'Nouveau Nom' });
  const clubs = [
    club({ id: 'kb', name: 'Dojo B', coachName: 'Ancien', googleContactId: 'people/c3' }),
    club({ id: 'ka', name: 'Dojo A', coachName: 'Autre', googleContactId: 'people/c3' }),
  ];
  const p = syncPreview([c3], clubs, []);
  expect(p.linked).toEqual([{ contact: c3, clubIds: ['ka', 'kb'] }]);
  expect(p.diffs.map((d) => d.clubId)).toEqual(['ka', 'kb']);
  expect(p.newContacts).toEqual([]);
});

test('contact incomplet', () => {
  const c = contact({ resourceName: 'people/c5', phone: '0612345678' });
  const avec = syncPreview([c], [club({ id: 'k1', name: 'Dojo A', coachPhone: '06 12 34 56 78' })], []);
  expect(avec.newContacts[0]!.exact).toEqual({ clubId: 'k1', reason: 'phone' });
  const sans = syncPreview([c], [club({ id: 'k1', name: 'Dojo A' })], []);
  expect(sans.newContacts[0]!.exact).toBeNull();
  expect(sans.newContacts[0]!.maybe).toEqual([]);
});

test('suggestion exacte : un club déjà lié à un autre contact n’est que « peut-être » (pas de lien remplacé par défaut)', () => {
  const clubs = [
    club({ id: 'k1', name: 'Dojo A', coachEmails: ['julie@ex.fr'], googleContactId: 'people/ancien' }),
    club({ id: 'k2', name: 'Dojo B', coachPhone: '06 22 33 44 55', googleContactId: 'people/ancien2' }),
  ];
  const p = syncPreview([
    // Deux contacts au même mail : l'un est lié au club, l'autre est nouveau.
    contact({ resourceName: 'people/ancien', emails: ['julie@ex.fr'] }),
    contact({ resourceName: 'people/m', emails: ['JULIE@ex.fr'] }),
    contact({ resourceName: 'people/t', phone: '+33 6 22 33 44 55' }),
  ], clubs, ['people/t']);
  expect(p.linked.map((l) => l.contact.resourceName)).toEqual(['people/ancien']);
  const m = p.newContacts.find((x) => x.contact.resourceName === 'people/m')!;
  expect(m.exact).toBeNull();
  expect(m.maybe).toEqual(['k1']);
  const t = p.pending.find((x) => x.contact.resourceName === 'people/t')!;
  expect(t.exact).toBeNull();
  expect(t.maybe).toEqual(['k2']);
  // Deux nouveaux contacts au même mail, club libre : la même suggestion exacte pour les deux.
  const libre = syncPreview([contact({ resourceName: 'people/x', emails: ['a@b.fr'] }), contact({ resourceName: 'people/y', emails: ['a@b.fr'] })],
    [club({ id: 'k3', name: 'Dojo C', coachEmails: ['a@b.fr'] })], []);
  expect(libre.newContacts.map((x) => x.exact)).toEqual([{ clubId: 'k3', reason: 'email' }, { clubId: 'k3', reason: 'email' }]);
});

test('valeur Google que l’annuaire refuserait : ni différence, ni remplissage, mais signalée', () => {
  expect(isAcceptableCoachValue('coachPhone', '0'.repeat(DIRECTORY_LIMITS.coachPhone))).toBe(true);
  expect(isAcceptableCoachValue('coachPhone', '0'.repeat(DIRECTORY_LIMITS.coachPhone + 1))).toBe(false);
  expect(isAcceptableCoachValue('coachName', 'x'.repeat(DIRECTORY_LIMITS.coachName + 1))).toBe(false);
  expect(isAcceptableCoachValue('coachName', '  ')).toBe(false);

  const c = contact({ resourceName: 'people/c1', name: 'x'.repeat(121), emails: ['"Paul" <p@x.fr>'], phone: '06 11 22 33 44' });
  expect(fieldDiffs(c, { coachName: 'Paul', coachPhone: '01 00 00 00 00', coachEmails: [] })).toEqual([
    { field: 'coachPhone', directory: '01 00 00 00 00', google: '06 11 22 33 44' },
  ]);
  expect(rejectedValues(c)).toEqual([
    { field: 'coachName', value: 'x'.repeat(121) },
    { field: 'coachEmails', value: '"Paul" <p@x.fr>' },
  ]);
  expect(rejectedValues(contact({ resourceName: 'people/c2', name: 'Paul', emails: ['p@x.fr'] }))).toEqual([]);

  const lie = club({ id: 'k1', name: 'Dojo A', coachEmails: ['a@x.fr'], googleContactId: 'people/c1' });
  expect(syncPreview([c], [lie], []).diffs[0]!.fields.map((f) => f.field)).toEqual(['coachPhone']);
});

test('plusieurs adresses : une en commun suffit au rapprochement ; seules celles qui manquent sont proposées, en ajout', () => {
  const c = contact({ resourceName: 'people/c1', emails: ['pres@lilas.fr', 'COACH@lilas.fr', 'pres@lilas.fr', 'invalide'] });
  const k = club({ id: 'k1', name: 'Dojo des Lilas', coachEmails: ['coach@lilas.fr', 'club@lilas.fr'] });
  expect(syncPreview([c], [k], []).newContacts[0]!.exact).toEqual({ clubId: 'k1', reason: 'email' });
  const [diff] = fieldDiffs(c, k);
  expect(diff).toEqual({ field: 'coachEmails', directory: ['coach@lilas.fr', 'club@lilas.fr'], google: ['pres@lilas.fr'] });
  expect(fillsEmpty(diff!)).toBe(false);
  const set: CoachSet = {};
  applyDiff(set, diff!);
  expect(set).toEqual({ addEmails: ['pres@lilas.fr'] });
  expect(fieldDiffs(contact({ resourceName: 'people/c2', emails: ['coach@lilas.fr'] }), k)).toEqual([]);
  expect(fillsEmpty(fieldDiffs(c, { ...k, coachEmails: [] })[0]!)).toBe(true);
  expect(contactEmails(c)).toEqual(['pres@lilas.fr', 'COACH@lilas.fr']);
});
