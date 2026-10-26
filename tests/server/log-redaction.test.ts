import { expect, test } from 'vitest';
import { redactTokens } from '../../src/server/log.js';

test('journal du serveur : les liens personnels des clubs sont masqués', () => {
  expect(redactTokens('/api/inscription/pP4e7OCLnbaG_1rDvBsgcNyo_NFlN2tv/lines/abc?version=1')).toBe('/api/inscription/***/lines/abc?version=1');
  expect(redactTokens('/inscription/pP4e7OCLnbaG_1rDvBsgcNyo_NFlN2tv')).toBe('/inscription/***');
  expect(redactTokens('/api/competitions/123/registrations')).toBe('/api/competitions/123/registrations');
});

test('journal du serveur : le retour de Google (code d’autorisation, state) est masqué', () => {
  expect(redactTokens('/api/app-settings/google/callback?code=4/0AbC&state=xyz')).toBe('/api/app-settings/google/callback?***');
  expect(redactTokens('/api/app-settings/google/callback')).toBe('/api/app-settings/google/callback');
});
