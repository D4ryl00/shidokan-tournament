import { afterEach, expect, test, vi } from 'vitest';
import type { AuthMe } from '../../src/web/api.js';
import { accountPoste, defaultTab, parsePoste, posteHeader, posteTabs, tabFor, zoneLinkPoste } from '../../src/web/poste.js';
import { COMPETITION_TABS } from '../../src/web/tabs.js';

afterEach(() => vi.unstubAllGlobals());

test('onglets de chaque poste, dans l’ordre des onglets', () => {
  expect(posteTabs({ kind: 'organisation' })).toEqual(COMPETITION_TABS.map((t) => t.path));
  expect(posteTabs({ kind: 'table' })).toEqual(['inscriptions', 'clubs', 'pesee', 'reaffectation', 'tableaux', 'combats', 'podiums', 'categories']);
  expect(posteTabs({ kind: 'zone', zoneId: 'z1' })).toEqual(['tableaux', 'combats']);
});

test('onglet « Finales » : poste Organisation seulement', () => {
  expect(posteTabs({ kind: 'organisation' })).toContain('finales');
  expect(posteTabs({ kind: 'table' })).not.toContain('finales');
  expect(posteTabs({ kind: 'zone', zoneId: 'z1' })).not.toContain('finales');
  expect(tabFor({ kind: 'table' }, 'finales')).toBe('inscriptions');
  expect(tabFor({ kind: 'zone', zoneId: 'z1' }, 'finales')).toBe('combats');
});

test('onglet par défaut et redirection d’un onglet masqué', () => {
  expect(defaultTab({ kind: 'zone', zoneId: 'z1' })).toBe('combats');
  expect(defaultTab({ kind: 'table' })).toBe('inscriptions');
  expect(defaultTab({ kind: 'organisation' })).toBe('inscriptions');
  expect(tabFor({ kind: 'zone', zoneId: 'z1' }, 'reglages')).toBe('combats');
  expect(tabFor({ kind: 'zone', zoneId: 'z1' }, 'tableaux')).toBe('tableaux');
  expect(tabFor({ kind: 'organisation' }, 'categories')).toBe('categories');
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

test('portable en zone autonome : sa zone est imposée sur la compétition qu’il suit, et seulement en zone autonome', () => {
  const link = { mainUrl: 'http://pc', competitionId: 'c1', zoneId: 'z2', autonomous: { since: '2026-11-22T13:32:00Z', finals: false } };
  expect(zoneLinkPoste(link, 'c1')).toEqual({ kind: 'zone', zoneId: 'z2' });
  expect(zoneLinkPoste(link, 'c2')).toBeNull();
  expect(zoneLinkPoste({ ...link, autonomous: null }, 'c1')).toBeNull();
  expect(zoneLinkPoste(null, 'c1')).toBeNull();
});

/** Stockage du navigateur simulé (les tests tournent sous Node). */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  return store;
}

test('posteHeader : poste de la compétition de l’adresse', () => {
  stubStorage();
  localStorage.setItem('poste:c1', JSON.stringify({ kind: 'zone', zoneId: 'z2' }));
  expect(posteHeader('/api/competitions/c1/registrations')).toBe('zone:z2');
  expect(posteHeader('/api/competitions')).toBeNull();
});

test('posteHeader : Table, Organisation par défaut, adresse de la compétition elle-même, autre compétition, stockage bloqué', () => {
  stubStorage();
  localStorage.setItem('poste:c1', JSON.stringify({ kind: 'table' }));
  expect(posteHeader('/api/competitions/c1/weigh-in/f1')).toBe('table');
  expect(posteHeader('/api/competitions/c1')).toBe('table');
  expect(posteHeader('/api/competitions/c1?x=1')).toBe('table');
  expect(posteHeader('/api/competitions/c2/registrations')).toBe('organisation');
  expect(posteHeader('/api/inscription/jeton/lines')).toBeNull();
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqué'); } });
  expect(posteHeader('/api/competitions/c1/registrations')).toBe('organisation');
});

test('le Journal n’est ouvert qu’au poste Organisation', () => {
  expect(posteTabs({ kind: 'organisation' })).toContain('journal');
  expect(posteTabs({ kind: 'table' })).not.toContain('journal');
  expect(posteTabs({ kind: 'zone', zoneId: 'z1' })).not.toContain('journal');
  expect(tabFor({ kind: 'table' }, 'journal')).toBe('inscriptions');
});
