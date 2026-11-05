import { expect, test } from 'vitest';
import { checkedAddresses, noneChecked, sendTarget, toggleAddress } from '../../src/web/send-recipients.js';

const club = (coachEmails: string[]) => ({ clubId: 'c1', coachEmails });

test('par défaut, seule la première adresse du club est cochée', () => {
  expect(checkedAddresses(club(['a@x.fr', 'b@x.fr', 'c@x.fr']), {})).toEqual(['a@x.fr']);
  expect(checkedAddresses(club(['a@x.fr']), {})).toEqual(['a@x.fr']);
  expect(checkedAddresses(club([]), {})).toEqual([]);
});

test('cocher et décocher partent de ce défaut, et ne touchent pas les autres clubs', () => {
  const multi = club(['a@x.fr', 'b@x.fr', 'c@x.fr']);
  const added = toggleAddress(multi, { autre: ['z@x.fr'] }, 'c@x.fr', true);
  expect(added).toEqual({ autre: ['z@x.fr'], c1: ['a@x.fr', 'c@x.fr'] });
  expect(checkedAddresses(multi, toggleAddress(multi, added, 'a@x.fr', false))).toEqual(['c@x.fr']);
});

test('l’envoi part vers les adresses cochées, dans l’ordre du club', () => {
  const multi = club(['a@x.fr', 'b@x.fr', 'c@x.fr']);
  expect(sendTarget(multi, {})).toEqual({ clubId: 'c1', emails: ['a@x.fr'] });
  expect(sendTarget(multi, { c1: ['c@x.fr', 'a@x.fr'] })).toEqual({ clubId: 'c1', emails: ['a@x.fr', 'c@x.fr'] });
});

test('un club à une seule adresse ou sans adresse ne transmet aucun choix', () => {
  expect(sendTarget(club(['a@x.fr']), {})).toEqual({ clubId: 'c1' });
  expect(sendTarget(club([]), {})).toEqual({ clubId: 'c1' });
});

test('aucune case cochée : bloqué seulement pour un club qui a des adresses', () => {
  const multi = club(['a@x.fr', 'b@x.fr']);
  expect(noneChecked(multi, {})).toBe(false);
  expect(noneChecked(multi, { c1: [] })).toBe(true);
  expect(noneChecked(club([]), {})).toBe(false);
});
