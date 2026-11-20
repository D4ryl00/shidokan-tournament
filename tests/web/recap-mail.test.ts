import { expect, test } from 'vitest';
import { recapBlocked } from '../../src/web/components/RecapMail.js';
import { HELP } from '../../src/web/help.js';

test('recapBlocked : raison de l’enveloppe grisée', () => {
  expect(recapBlocked({ coachEmails: ['a@x.fr'] }, 0)).toBe('Aucune inscription');
  expect(recapBlocked({ coachEmails: [] }, 3)).toBe('Pas d’e-mail pour ce club');
  expect(recapBlocked({ coachEmails: ['a@x.fr'] }, 3)).toBeNull();
});

test('aide du récapitulatif', () => {
  expect(HELP['clubs.recap']).toBeDefined();
});
