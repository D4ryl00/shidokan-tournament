import { expect, test } from 'vitest';
import { notAcceptedBy } from '../../src/domain/disciplines.js';
import { finalsChangedText, pendingButtonLabel } from '../../src/web/components/WaveLaunchPanel.js';

test('« n’accueille pas le … » : la discipline en minuscules, avec « le »', () => {
  expect(notAcceptedBy('Tatami 3', 'kata')).toBe('Tatami 3 n’accueille pas le kata');
  expect(notAcceptedBy('Ring', 'shido-boxing')).toBe('Ring n’accueille pas le shido-boxing');
});

test('refigeage : les zones renumérotées sont nommées, et seulement elles', () => {
  expect(finalsChangedText(['Tatami 1', 'Tatami 3'])).toBe('Les finales ont changé : les zones concernées sont renumérotées (mélangés). Zones renumérotées : Tatami 1, Tatami 3.');
  expect(finalsChangedText(['Tatami 1'])).toBe('Les finales ont changé : les zones concernées sont renumérotées (mélangés). Zone renumérotée : Tatami 1.');
  // Aperçu pas encore reçu : la phrase seule.
  expect(finalsChangedText([])).toBe('Les finales ont changé : les zones concernées sont renumérotées (mélangés).');
});

test('catégories à numéroter : « Numéroter (mélangés)… » dès qu’une finale a changé', () => {
  expect(pendingButtonLabel(false)).toBe('Numéroter à la suite…');
  expect(pendingButtonLabel(true)).toBe('Numéroter (mélangés)…');
});
