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
    expect(text, id).not.toMatch(/(?<!\p{L})[A-H] :/u); // codes de réaffectation (« C : », « D : »)
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

const all = (id: keyof typeof HELP) => [HELP[id].short, ...HELP[id].details.flat()].join(' ');

test('relecture : sauvegardes — la restauration décrite est celle de l’écran', () => {
  expect(all('podiums.sauvegardes')).toContain('« Restaurer une sauvegarde… »');
  expect(all('podiums.sauvegardes')).toContain('« Télécharger »');
  expect(all('podiums.sauvegardes')).not.toMatch(/restaurez la plus récente|plus d’une journée/);
});
test('relecture : kata — enregistrer avec ✓ ou Entrée ; notes retirées à partir de 5 arbitres', () => {
  expect(HELP['combats.kata'].short).toContain('✓');
  expect(HELP['combats.kata'].short).not.toContain('« Enregistrer »');
  expect(all('combats.kata')).toMatch(/au moins 5 arbitres, la note basse retirée/);
});
test('relecture : écart de poids — au-delà du seuil, validation manuelle (⚖ Poids +)', () => {
  expect(all('reglages.recasement')).toContain('⚖ Poids +');
  expect(all('reglages.recasement')).not.toContain('jamais proposés ensemble');
  expect(all('reaffectation')).toContain('⚖ Poids +');
});
test('relecture : passages d’âge — tranche voisine, mineurs / adultes, pas d’ajout de tranche', () => {
  expect(all('grille.passages')).toContain('tranche voisine');
  expect(all('grille.passages')).toContain('mélange mineurs / adultes');
  expect(all('grille.passages')).not.toContain('ajoutez une tranche');
});
test('relecture : autres faits', () => {
  expect(all('fiche-club.envoyer')).toContain('règlement');
  expect(all('fiche-club.envoyer')).not.toMatch(/listes déroulantes \([^)]*poids/);
  expect(all('inscriptions')).toContain('pas encore confirmées par l’export FFK');
  expect(all('clubs')).toContain('import FFK');
  expect(all('import-ffk.clubs')).not.toContain('confirmez');
  expect(all('reglages.tableaux')).toContain('ignoré quand le repêchage est activé');
  expect(all('impression')).toContain('« Enregistrer au format PDF »');
});

test('tableaux : sens des couleurs des statuts', () => {
  const text = all('tableaux');
  for (const c of ['gris', 'bleu', 'orange', 'vert']) expect(text).toContain(c);
});

test('relecture : aide de la fiche club à jour', () => {
  expect(all('fiche-club')).toContain('poids actuel');
  expect(all('fiche-club')).not.toContain('poids approximatif');
  expect(all('fiche-club.importer')).toContain('ancien format');
  expect(all('fiche-club.saisir')).toContain('s’ajoute');
});

test('vocabulaire : « session » et « réaffectation », plus « vague » ni « recasement »', () => {
  for (const [id, h] of Object.entries(HELP)) {
    const text = [h.title, h.short, ...h.details.flat()].join(' ');
    expect(text, id).not.toMatch(/\bvagues?\b|\brecas/i);
  }
});

test("annuaire : aide présente, elle parle du numéro d'affiliation et de la fusion", () => {
  expect(all('annuaire')).toContain('affiliation');
  expect(all('annuaire')).toContain('Fusionner');
});

test("inscriptions en ligne : les liens ne s'affichent qu'une fois, figer met la page du club en lecture seule", () => {
  expect(all('fiche-club.en-ligne')).toContain('une seule fois');
  expect(all('fiche-club.en-ligne')).toContain('lecture seule');
});
