import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { createCompetition } from './helpers.js';

const LINE = ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null];

/** Ouvre « Fiche club », télécharge le modèle et choisit une fiche remplie au nom de club donné. */
async function chooseFile(page: Page, id: string, club: string) {
  await page.goto(`/competitions/${id}/fiche-club`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('club-form-download').click()]);
  const filled = fillClubForm(fs.readFileSync((await download.path())!), [club, 'Jean Coach', '0600000000', 'jean@dojo.example', 'Non'], [LINE]);
  await page.getByTestId('club-form-file').setInputFiles({ name: 'fiche.ods', mimeType: 'application/octet-stream', buffer: filled });
}

const clubsOf = async (page: Page, id: string) => ((await (await page.request.get(`/api/competitions/${id}/clubs`)).json()) as { name: string }[]).map((c) => c.name);

test('import .ods d’un club au nom différent : choisir le club existant', async ({ page }) => {
  const id = await createCompetition(page, 'Import ods club existant');
  await page.request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Tani Dojo' } });
  await chooseFile(page, id, 'Dojo de Tani (autre graphie)');
  await expect(page.getByTestId('club-form-club-step')).toContainText('Club de la fiche : « Dojo de Tani (autre graphie) »');
  // L'aperçu attend le choix du club.
  await expect(page.getByTestId('club-form-preview-row')).toHaveCount(0);
  await expect(page.getByTestId('club-form-import')).toBeDisabled();
  await page.getByTestId('club-form-club-step').getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name: 'Tani Dojo', exact: true }).click();
  await expect(page.getByTestId('club-form-preview-row')).toHaveCount(1);
  await expect(page.getByTestId('club-form-preview-header')).toContainText('Club : Tani Dojo (nom dans le fichier : Dojo de Tani (autre graphie))');
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText('Tani Dojo : 1 inscription importée')).toBeVisible();
  expect(await clubsOf(page, id)).toEqual(['Tani Dojo']);
});

test('import .ods d’un club au nom différent : ajouter le club, fenêtre pré-remplie avec le nom et le coach du fichier', async ({ page }) => {
  const id = await createCompetition(page, 'Import ods club ajouté');
  const club = `Dojo neuf ${Date.now()}`;
  await chooseFile(page, id, club);
  await page.getByTestId('club-form-club-step').getByTestId('club-picker-new').click();
  await expect(page.getByTestId('directory-name')).toHaveValue(club);
  await expect(page.getByRole('dialog').getByLabel('Coach')).toHaveValue('Jean Coach');
  await expect(page.getByRole('dialog').getByLabel('Téléphone')).toHaveValue('0600000000');
  await page.getByTestId('directory-save').click();
  await expect(page.getByTestId('club-form-club-step').getByTestId('club-picker').getByLabel('Club')).toHaveValue(club);
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText(`${club} : 1 inscription importée`)).toBeVisible();
  expect(await clubsOf(page, id)).toEqual([club]);
});

test('fenêtre fermée sans import : le club de l’annuaire choisi n’entre pas dans la compétition', async ({ page }) => {
  const id = await createCompetition(page, 'Import ods annuaire seul');
  const club = `Dojo annuaire ${Date.now()}`;
  await page.request.post('/api/club-directory', { data: { name: club, affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null } });
  await chooseFile(page, id, 'Un autre nom');
  await page.getByTestId('club-form-club-step').getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name: club, exact: true }).click();
  await expect(page.getByTestId('club-form-preview-row')).toHaveCount(1);
  expect(await clubsOf(page, id)).toEqual([]);
  // Abandon : un autre fichier est choisi, rien n'a été écrit.
  await page.reload();
  expect(await clubsOf(page, id)).toEqual([]);
});
