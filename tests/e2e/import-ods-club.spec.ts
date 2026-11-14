import { expect, test, type Page } from '@playwright/test';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { clubsOf, filledForm, HEADER, LEA, LUCA, NOAH, openStart, registrationsOf, type Cells } from './club-form-wizard.js';
import { createCompetition } from './helpers.js';

const TANI = { name: 'Tani Dojo', coachName: 'DUPONT Marc', coachPhone: '0600000001', coachEmails: ['coach@tani.example'], preApproval: false };

async function pick(page: Page, testId: string, option: string) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Parcourt tout l'import d'une fiche dont l'en-tête est déjà celui du club : « Commencer », une fiche enregistrée à chaque étape, « Terminer ». */
async function importAll(page: Page, steps: number) {
  await page.getByTestId('club-form-begin').click();
  for (let i = 1; i <= steps; i++) {
    await expect(page.getByTestId('ffk-progress')).toContainText(`Fiche ${i} sur ${steps}`);
    await page.getByTestId('line-save').click();
  }
  await page.getByTestId('club-form-finish').click();
}

test('fiche renvoyée sur un club existant : réimport, conflit, coordonnées, absents', async ({ page }) => {
  const id = await createCompetition(page, 'Fiche renvoyée réimport');
  const club = await (await page.request.post(`/api/competitions/${id}/clubs`, { data: TANI })).json() as { id: string };

  // Première fiche : trois combattants, Léa avec son kata. Coordonnées identiques au club : pas d'étape « coordonnées ».
  await openStart(page, id, 'Tani Dojo', await filledForm(page, id, HEADER, [LEA, LUCA, NOAH]));
  await expect(page.getByTestId('club-form-counts')).toHaveText('3 nouveaux · 0 fiche existante à revoir · 0 déjà à jour');
  await importAll(page, 3);
  await expect(page.getByTestId('club-form-end')).toHaveCount(0);
  expect((await registrationsOf(page, id)).map((r) => r.discipline).sort()).toEqual(['kata', 'karate', 'karate', 'karate'].sort());

  // Fiche renvoyée : Léa plus lourde et sans kata, nouveau téléphone, adresse nouvelle ; Luca et Noah absents.
  const header = [...HEADER];
  header[2] = '0700000000';
  header[3] = 'coach@tani.example; nouveau@tani.example';
  await openStart(page, id, 'Tani Dojo', await filledForm(page, id, header, [[...LEA.slice(0, 4), 56, 'Karaté', 'Non', null, 'Jiyu']]));
  await expect(page.getByTestId('club-form-counts')).toHaveText('0 nouveau · 1 fiche existante à revoir · 0 déjà à jour');
  await page.getByTestId('club-form-begin').click();

  // Coordonnées d'abord, comptées comme la première fiche.
  await expect(page.getByTestId('club-header-step')).toContainText('Fiche 1 sur 2');
  await expect(page.getByTestId('club-header-phone')).toHaveValue('0700000000');
  await expect(page.getByTestId('club-header-email')).toBeChecked();
  await page.getByTestId('club-header-save').click();
  const [saved] = await clubsOf(page, id);
  expect(saved!.id).toBe(club.id);
  expect(saved!.coachPhone).toBe('0700000000');
  expect(saved!.coachEmails).toEqual(['coach@tani.example', 'nouveau@tani.example']);
  const directory = (await (await page.request.get('/api/club-directory')).json()) as { name: string; coachPhone: string | null }[];
  expect(directory.find((c) => c.name === 'Tani Dojo')?.coachPhone).toBe('0700000000');

  // Léa : poids et disciplines en conflit ; « Enregistré » garde le kata, le poids de la fiche renvoyée est pris.
  await expect(page.getByTestId('ffk-progress')).toContainText('Fiche 2 sur 2');
  await expect(page.getByTestId('club-line-form')).toContainText('Fiche renvoyée');
  await page.getByRole('group', { name: /Disciplines/ }).getByTestId('ffk-choice-fiche').click();
  await page.getByTestId('line-save').click();

  // Fin : Luca et Noah ne sont pas dans la fiche ; Luca est coché (supprimé), Noah gardé.
  await expect(page.getByTestId('club-form-absent')).toHaveCount(2);
  await page.getByRole('checkbox', { name: /ROSSI/ }).check();
  await page.getByTestId('club-form-finish').click();
  await expect(page.getByText(/1 fiche supprimée/)).toBeVisible();

  const regs = await registrationsOf(page, id);
  expect(regs.map((r) => r.fighter.lastName).sort()).toEqual(['MARTIN', 'MARTIN', 'PETIT']);
  expect(regs.find((r) => r.fighter.lastName === 'MARTIN' && r.discipline === 'kata')).toBeTruthy();
  expect(regs.find((r) => r.fighter.lastName === 'MARTIN' && r.discipline === 'karate')?.approxWeightKg).toBe(56);
});

test('fiche renvoyée : « Laisser tel quel » aux coordonnées n’écrit rien', async ({ page }) => {
  const id = await createCompetition(page, 'Fiche renvoyée laisser tel quel');
  await page.request.post(`/api/competitions/${id}/clubs`, { data: TANI });
  const directoryOf = async () => ((await (await page.request.get('/api/club-directory')).json()) as { name: string; coachPhone: string | null; coachEmails: string[] }[]).find((c) => c.name === 'Tani Dojo');
  const before = await directoryOf();
  const header = [...HEADER];
  header[2] = '0700000000';
  header[3] = 'coach@tani.example; nouveau@tani.example';
  await openStart(page, id, 'Tani Dojo', await filledForm(page, id, header, [LEA]));
  await page.getByTestId('club-form-begin').click();
  await expect(page.getByTestId('club-header-step')).toBeVisible();
  await page.getByTestId('club-header-skip').click();
  await expect(page.getByTestId('club-header-step')).toHaveCount(0);
  const [club] = await clubsOf(page, id);
  expect(club).toMatchObject({ coachName: TANI.coachName, coachPhone: TANI.coachPhone, coachEmails: TANI.coachEmails });
  expect(await directoryOf()).toEqual(before);
});

test('fiche renvoyée sur un club vide : nouveaux enregistrés, un mineur sans règlement en Jiyu', async ({ page }) => {
  const id = await createCompetition(page, 'Fiche renvoyée club vide');
  await page.request.post(`/api/competitions/${id}/clubs`, { data: TANI });
  const minor: Cells = ['DURAND', 'Zoé', 'Féminin', 'Minimes', 40, 'Karaté', 'Non', null, null];
  const start = await openStart(page, id, 'Tani Dojo', await filledForm(page, id, HEADER, [minor, LUCA]));
  await expect(start).toContainText('La fiche indique le club « TANI DOJO ».');
  await expect(page.getByTestId('club-form-counts')).toHaveText('2 nouveaux · 0 fiche existante à revoir · 0 déjà à jour');
  await importAll(page, 2);

  const regs = await registrationsOf(page, id);
  expect(regs).toHaveLength(2);
  expect(new Set(regs.map((r) => r.source))).toEqual(new Set(['club_form']));
  expect(regs.find((r) => r.fighter.lastName === 'DURAND')?.ruleset).toBe('jiyu');
  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row')).toHaveCount(2);
});

test('ligne à compléter : âge illisible, encadré avec la ligne de la fiche, champ vide', async ({ page }) => {
  const id = await createCompetition(page, 'Fiche renvoyée ligne à compléter');
  await page.request.post(`/api/competitions/${id}/clubs`, { data: TANI });
  await openStart(page, id, 'Tani Dojo', await filledForm(page, id, HEADER, [['MARTIN', 'Léa', 'Féminin', 'Cadetz', null, 'Karaté', 'Non', null, 'Jiyu']]));
  await page.getByTestId('club-form-begin').click();

  await expect(page.getByTestId('import-notes')).toContainText('Dans la fiche (ligne 14)');
  await expect(page.getByTestId('import-notes')).toContainText('Cadetz');
  await expect(page.getByTestId('line-age')).toHaveValue('');
  await pick(page, 'line-age', 'Cadets (14 à 15 ans)');
  await pick(page, 'line-weight-class', '-54 kg');
  await page.getByTestId('line-save').click();
  await page.getByTestId('club-form-finish').click();
  expect(await registrationsOf(page, id)).toHaveLength(1);
});

test('club de l’annuaire choisi, fenêtre fermée avant « Commencer » : rien dans la compétition', async ({ page }) => {
  const id = await createCompetition(page, 'Fiche renvoyée annuaire');
  const club = `Dojo annuaire ${Date.now()}`;
  await page.request.post('/api/club-directory', { data: { name: club, affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null } });
  const start = await openStart(page, id, null, await filledForm(page, id, HEADER, [LUCA]));
  // Le club n'est pas choisi : ni le décompte ni « Commencer ».
  await expect(start).toContainText('La fiche indique le club');
  await expect(page.getByTestId('club-form-counts')).toHaveCount(0);
  await expect(page.getByTestId('club-form-begin')).toBeDisabled();
  await start.getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name: club, exact: true }).click();
  await expect(page.getByTestId('club-form-counts')).toHaveText('1 nouveau · 0 fiche existante à revoir · 0 déjà à jour');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByTestId('club-form-start')).toHaveCount(0);
  expect(await clubsOf(page, id)).toEqual([]);
});

test('ancien modèle de fiche : refusé avec son message', async ({ page }) => {
  const id = await createCompetition(page, 'Fiche renvoyée ancien modèle');
  const template = Buffer.from(await (await page.request.get(`/api/competitions/${id}/club-form.ods`)).body());
  const legacy = fillClubForm(template, HEADER, [['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null]]);
  const start = await openStart(page, id, null, legacy);
  await expect(start).toContainText('Ancien modèle de fiche : demandez au club de remplir le nouveau.');
  await expect(page.getByTestId('club-form-counts')).toHaveCount(0);
});
