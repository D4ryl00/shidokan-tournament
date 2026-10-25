import { afterEach, expect, test, vi } from 'vitest';
import { categoriesOpen, rememberCategoriesOpen } from '../../src/web/combatsView.js';

afterEach(() => vi.unstubAllGlobals());

test('liste des catégories de Combats : choix retenu par compétition ; rien au départ ou sans stockage', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  expect(categoriesOpen('c1')).toBeNull();
  rememberCategoriesOpen('c1', true);
  rememberCategoriesOpen('c2', false);
  expect(categoriesOpen('c1')).toBe(true);
  expect(categoriesOpen('c2')).toBe(false);
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } });
  expect(() => rememberCategoriesOpen('c1', false)).not.toThrow();
  expect(categoriesOpen('c1')).toBeNull();
});
