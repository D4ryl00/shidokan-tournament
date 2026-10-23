import { expect, test } from 'vitest';
import { zoneCardsVisible } from '../../src/web/components/ZoneCards.js';

test('« À trancher » : seulement sur un PC (rôle local) qui gère la compétition', () => {
  expect(zoneCardsVisible('local', true)).toBe(true);
  expect(zoneCardsVisible('local', false)).toBe(false); // copie en lecture seule (portable de zone)
  expect(zoneCardsVisible('serveur', true)).toBe(false); // serveur en ligne : pas de journaux de zone
  expect(zoneCardsVisible(undefined, undefined)).toBe(false);
});
