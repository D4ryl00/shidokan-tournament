import { expect, test } from 'vitest';
import { HELP } from '../../src/web/help.js';
import { COMPETITION_TABS } from '../../src/web/tabs.js';

test('chaque onglet a son aide', () => {
  for (const t of COMPETITION_TABS) expect(HELP[t.path as keyof typeof HELP], t.path).toBeDefined();
});

test('aides courtes : une phrase de 160 caractères au plus, terminée par un point', () => {
  for (const [id, h] of Object.entries(HELP)) {
    expect(h.short.length, id).toBeLessThanOrEqual(160);
    expect(h.short.trim().endsWith('.'), id).toBe(true);
    expect(h.details.length, id).toBeGreaterThan(0);
  }
});

test('pas de jargon ni de codes internes', () => {
  for (const [id, h] of Object.entries(HELP)) {
    const text = [h.title, h.short, ...h.details.flat()].join(' ');
    expect(text, id).not.toMatch(/(?<!\p{L})[A-H] :/u); // codes de recasement (« C : », « D : »)
    expect(text, id).not.toMatch(/\b(registration|bracket|seed|null|undefined|API|weight_out)\b/i);
  }
});

test('pesée : phrase de la spec', () => {
  expect(HELP.pesee.short).toBe('Tapez le poids lu sur la balance puis Entrée : le combattant est marqué présent.');
});

test('passages d’âge : libellés en clair', () => {
  const text = HELP['grille.passages'].details.flat().join(' ');
  expect(text).toContain('Toujours permis');
  expect(text).toContain('Seulement si le mélange seniors / vétérans est activé');
});

test('sauvegardes : le nombre gardé est celui du serveur', () => {
  expect(HELP['podiums.sauvegardes'].details.flat().join(' ')).toContain('200');
});
