import { expect, test } from 'vitest';
import { setDirty, whenSaved } from '../../src/web/unsaved.js';

test('whenSaved : tout de suite sans saisie en cours ; sinon quand la dernière saisie est enregistrée ou abandonnée', () => {
  const calls: string[] = [];
  whenSaved(() => calls.push('immédiat'));
  expect(calls).toEqual(['immédiat']);
  setDirty('fiche', true);
  setDirty('grille', true);
  whenSaved(() => calls.push('après'));
  expect(calls).toEqual(['immédiat']);
  setDirty('fiche', false);
  expect(calls).toEqual(['immédiat']);
  setDirty('grille', false);
  expect(calls).toEqual(['immédiat', 'après']);
  setDirty('fiche', false);
  expect(calls).toEqual(['immédiat', 'après']);
});
