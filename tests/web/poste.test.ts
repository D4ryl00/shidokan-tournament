import { expect, test } from 'vitest';
import { defaultTab, parsePoste, posteTabs, tabFor } from '../../src/web/poste.js';
import { COMPETITION_TABS } from '../../src/web/tabs.js';

test('onglets de chaque poste, dans l’ordre des onglets', () => {
  expect(posteTabs({ kind: 'organisation' })).toEqual(COMPETITION_TABS.map((t) => t.path));
  expect(posteTabs({ kind: 'table' })).toEqual(['inscriptions', 'clubs', 'pesee', 'reaffectation', 'tableaux', 'combats', 'podiums']);
  expect(posteTabs({ kind: 'zone', zoneId: 'z1' })).toEqual(['tableaux', 'combats']);
});

test('onglet par défaut et redirection d’un onglet masqué', () => {
  expect(defaultTab({ kind: 'zone', zoneId: 'z1' })).toBe('combats');
  expect(defaultTab({ kind: 'table' })).toBe('inscriptions');
  expect(tabFor({ kind: 'zone', zoneId: 'z1' }, 'reglages')).toBe('combats');
  expect(tabFor({ kind: 'zone', zoneId: 'z1' }, 'tableaux')).toBe('tableaux');
  expect(tabFor({ kind: 'organisation' }, 'grille')).toBe('grille');
});

test('lecture du poste enregistré : illisible ou absent → Organisation', () => {
  expect(parsePoste(null)).toEqual({ kind: 'organisation' });
  expect(parsePoste('pas du json')).toEqual({ kind: 'organisation' });
  expect(parsePoste(JSON.stringify({ kind: 'zone' }))).toEqual({ kind: 'organisation' });
  expect(parsePoste(JSON.stringify({ kind: 'zone', zoneId: 'z1' }))).toEqual({ kind: 'zone', zoneId: 'z1' });
  expect(parsePoste(JSON.stringify({ kind: 'table' }))).toEqual({ kind: 'table' });
});
