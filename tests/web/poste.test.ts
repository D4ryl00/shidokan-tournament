import { expect, test } from 'vitest';
import type { AuthMe } from '../../src/web/api.js';
import { accountPoste, defaultTab, parsePoste, posteTabs, tabFor } from '../../src/web/poste.js';
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

test('une adresse qui n’est pas un onglet (ancienne adresse redirigée ailleurs) n’est pas touchée', () => {
  expect(tabFor({ kind: 'organisation' }, 'vagues')).toBe('vagues');
  expect(tabFor({ kind: 'zone', zoneId: 'z1' }, 'recasement')).toBe('recasement');
});

test('poste imposé par le compte connecté (serveur) ; organisateur ou rôle local : aucun', () => {
  const me = (role: 'organisateur' | 'table' | 'zone', competitionId: string | null = null, zoneId: string | null = null): AuthMe =>
    ({ role: 'serveur', user: { email: 'x@example.org', role, competitionId, zoneId } });
  expect(accountPoste(me('table'), 'c1')).toEqual({ kind: 'table' });
  expect(accountPoste(me('zone', 'c1', 'z2'), 'c1')).toEqual({ kind: 'zone', zoneId: 'z2' });
  // Zone d'une autre compétition : poste Zone sans zone (rien de permis à l'écran, le serveur refuse aussi).
  expect(accountPoste(me('zone', 'c2', 'z9'), 'c1')).toEqual({ kind: 'zone', zoneId: '' });
  expect(accountPoste(me('organisateur'), 'c1')).toBeNull();
  expect(accountPoste({ role: 'local', user: null }, 'c1')).toBeNull();
  expect(accountPoste(undefined, 'c1')).toBeNull();
});
