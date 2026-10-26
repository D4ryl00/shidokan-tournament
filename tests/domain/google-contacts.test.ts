import { expect, test } from 'vitest';
import {
  fieldDiffs, normalizePhone, syncPreview,
  type GoogleContact, type SyncClub,
} from '../../src/domain/google-contacts.js';

const contact = (o: Partial<GoogleContact> & { resourceName: string }): GoogleContact => ({
  name: null, email: null, phone: null, organization: null, groups: [], ...o,
});
const club = (o: Partial<SyncClub & { archived: boolean }> & { id: string; name: string }): SyncClub & { archived: boolean } => ({
  coachName: null, coachPhone: null, coachEmail: null, googleContactId: null, version: 1, archived: false, ...o,
});

test('téléphones équivalents', () => {
  expect(normalizePhone('+33 6 12 34 56 78')).toBe(normalizePhone('06.12.34.56.78'));
  expect(normalizePhone('0033612345678')).toBe('0612345678');
});

test('différences : vide Google ignoré, vide annuaire comblé, écritures équivalentes ignorées', () => {
  const c = contact({ resourceName: 'people/c1', name: 'Julie Petit', email: 'JULIE@ex.fr', phone: '+33 6 11 22 33 44' });
  expect(fieldDiffs(c, { coachName: 'J. Petit', coachPhone: '06 11 22 33 44', coachEmail: null })).toEqual([
    { field: 'coachName', directory: 'J. Petit', google: 'Julie Petit' },
    { field: 'coachEmail', directory: null, google: 'JULIE@ex.fr' },
  ]);
  const vide = contact({ resourceName: 'people/c1' });
  expect(fieldDiffs(vide, { coachName: 'X', coachPhone: '0611223344', coachEmail: 'a@b.fr' })).toEqual([]);
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
    club({ id: 'k1', name: 'Dojo A', coachEmail: 'julie@ex.fr' }),
    club({ id: 'k2', name: 'Dojo B', coachPhone: '06 22 33 44 55' }),
    club({ id: 'k3', name: 'Dojo C', coachName: 'Paul Martin' }),
    club({ id: 'k4', name: 'DOJO des lilas' }),
  ];
  const all = syncPreview([
    contact({ resourceName: 'people/m', email: 'JULIE@ex.fr' }),
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
