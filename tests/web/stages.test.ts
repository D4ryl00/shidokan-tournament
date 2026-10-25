import { afterEach, expect, test, vi } from 'vitest';
import { lastTab, rememberTab, showsTabBar, stageOf, stageTarget, STAGES, visibleStages } from '../../src/web/stages.js';
import { COMPETITION_TABS } from '../../src/web/tabs.js';

afterEach(() => vi.unstubAllGlobals());

test('chaque onglet a une étape, dans l’ordre des étapes', () => {
  expect(STAGES.map((s) => [s.id, s.label])).toEqual([['preparer', 'Préparer'], ['jour-j', 'Jour J'], ['apres', 'Après']]);
  expect(STAGES.flatMap((s) => s.tabs).sort()).toEqual(COMPETITION_TABS.map((t) => t.path).sort());
  expect(STAGES[0]!.tabs).toEqual(['inscriptions', 'clubs', 'fiche-club', 'import-ffk', 'sessions', 'grille', 'reglages']);
  expect(STAGES[1]!.tabs).toEqual(['pesee', 'reaffectation', 'tableaux', 'combats']);
  expect(STAGES[2]!.tabs).toEqual(['podiums']);
  expect(stageOf('combats')).toBe('jour-j');
  expect(stageOf('reglages')).toBe('preparer');
  expect(stageOf('podiums')).toBe('apres');
});

test('postes : seulement les étapes et onglets permis', () => {
  expect(visibleStages({ kind: 'zone', zoneId: 'z1' })).toEqual([{ id: 'jour-j', label: 'Jour J', tabs: ['tableaux', 'combats'] }]);
  expect(visibleStages({ kind: 'table' }).map((s) => [s.id, s.tabs])).toEqual([
    ['preparer', ['inscriptions', 'clubs']], ['jour-j', ['pesee', 'reaffectation', 'tableaux', 'combats']], ['apres', ['podiums']],
  ]);
  expect(visibleStages({ kind: 'organisation' })).toEqual(STAGES);
});

test('dernier onglet d’une étape : retenu par compétition ; stockage indisponible → rien, sans erreur', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  expect(lastTab('c1', 'jour-j')).toBeNull();
  rememberTab('c1', 'tableaux');
  rememberTab('c1', 'inscriptions');
  expect(lastTab('c1', 'jour-j')).toBe('tableaux');
  expect(lastTab('c1', 'preparer')).toBe('inscriptions');
  expect(lastTab('c2', 'jour-j')).toBeNull();
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } });
  expect(() => rememberTab('c1', 'combats')).not.toThrow();
  expect(lastTab('c1', 'jour-j')).toBeNull();
});

test('cliquer une étape : rien si l’onglet ouvert en fait partie ; sinon son dernier onglet permis, ou le premier', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  const [preparer, jourJ] = STAGES;
  expect(stageTarget('c1', jourJ!, 'combats')).toBeNull();
  expect(stageTarget('c1', jourJ!, 'inscriptions')).toBe('pesee');
  rememberTab('c1', 'tableaux');
  expect(stageTarget('c1', jourJ!, 'inscriptions')).toBe('tableaux');
  // Dernier onglet retenu mais plus permis à ce poste : le premier onglet permis.
  expect(stageTarget('c1', { ...jourJ!, tabs: ['combats'] }, 'inscriptions')).toBe('combats');
  expect(stageTarget('c1', preparer!, 'combats')).toBe('inscriptions');
});

test('une étape à un seul onglet n’affiche pas de barre d’onglets', () => {
  expect(showsTabBar(STAGES[2]!)).toBe(false);
  expect(showsTabBar(STAGES[1]!)).toBe(true);
  expect(showsTabBar(visibleStages({ kind: 'zone', zoneId: 'z1' })[0]!)).toBe(true);
});
