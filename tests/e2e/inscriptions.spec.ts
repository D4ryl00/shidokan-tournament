import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { createCompetition } from './helpers.js';

async function downloadTemplate(page: Page, id: string): Promise<Buffer> {
  await page.goto(`/competitions/${id}/fiche-club`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('club-form-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^fiche-club-.*\.ods$/);
  return fs.readFileSync((await download.path())!);
}

async function uploadForm(page: Page, buffer: Buffer) {
  await page.getByTestId('club-form-file').setInputFiles({
    name: 'fiche.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer,
  });
}

const HEADER = ['Tani Dojo', 'Jean Coach', '0600000000', null, 'Oui'];

test('fiche club : modèle, aperçu avec erreur, import, réimport corrigé', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe fiche club');
  const template = await downloadTemplate(page, id);

  await uploadForm(page, fillClubForm(template, HEADER, [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
    ['PETIT', 'Noé', 'Masculin', 'Minimes', '-45', 'Karaté', 'Shobu', null, null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Shido-boxing', 'Shobu', null, 'Oui', 74],
  ]));
  await expect(page.getByTestId('club-form-preview-row')).toHaveCount(3);
  await expect(page.getByTestId('club-form-row-error')).toContainText('réservé aux adultes');
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText('2 inscription(s) importée(s)')).toBeVisible();
  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row')).toHaveCount(2);

  await page.goto(`/competitions/${id}/fiche-club`);
  await uploadForm(page, fillClubForm(template, HEADER, [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
    ['PETIT', 'Noé', 'Masculin', 'Minimes', '-45', 'Karaté', 'Jiyu', null, null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Shido-boxing', 'Shobu', null, 'Oui', 74],
  ]));
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText('3 inscription(s) importée(s), 2 remplacée(s)')).toBeVisible();
  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row')).toHaveCount(3);
});

async function pick(page: Page, testId: string, option: string) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('saisie rapide au clavier, sur place, avertissement, kata', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe saisie');
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();

  await page.getByTestId('reg-club').fill('Shinsengumi');
  await page.getByTestId('reg-lastname').fill('ALPHA');
  await page.getByTestId('reg-firstname').fill('Anna');
  await pick(page, 'reg-age', 'Cadets');
  await pick(page, 'reg-weight', '-54');
  await page.getByTestId('reg-prefs').fill('32');
  await page.getByTestId('reg-firstname').press('Enter');
  await expect(page.getByText('ALPHA Anna enregistré(e).')).toBeVisible();

  // Deuxième saisie : club, âge, sexe et discipline sont conservés.
  await expect(page.getByTestId('reg-club')).toHaveValue('Shinsengumi');
  await expect(page.getByTestId('reg-lastname')).toHaveValue('');
  await page.getByTestId('reg-lastname').fill('BRAVO');
  await page.getByTestId('reg-firstname').fill('Bea');
  await pick(page, 'reg-weight', '-61');
  await page.getByTestId('reg-onsite').check();
  await page.getByTestId('reg-firstname').press('Enter');
  await expect(page.getByText('BRAVO Bea enregistré(e).')).toBeVisible();

  // Même combattante dans une 2e discipline de combat : avertissement.
  await page.getByTestId('reg-lastname').fill('ALPHA');
  await page.getByTestId('reg-firstname').fill('Anna');
  await page.getByTestId('reg-onsite').uncheck();
  await pick(page, 'reg-discipline', 'Shido-boxing');
  await pick(page, 'reg-weight', '-54');
  await page.getByTestId('reg-firstname').press('Enter');
  await expect(page.getByTestId('registration-warning')).toContainText('une seule discipline de combat');

  // Kata : ni règlement ni poids.
  await pick(page, 'reg-discipline', 'Kata');
  await expect(page.getByTestId('reg-ruleset')).toHaveCount(0);
  await expect(page.getByTestId('reg-weight')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('registration-row')).toHaveCount(3);
  await expect(page.getByTestId('registration-row').filter({ hasText: 'BRAVO' })).toContainText('Sur place');
  await page.goto(`/competitions/${id}/clubs`);
  await expect(page.getByTestId('club-row')).toHaveCount(1);
});

test('fiche papier : le bouton télécharge le PDF (une page)', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe fiche papier');
  await page.goto(`/competitions/${id}/fiche-club`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('paper-form-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^fiche-club-.*\.pdf$/);
  const pdf = fs.readFileSync((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});



test('saisie d’une fiche papier', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe saisie papier');
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('paper-entry-club').fill('Tani Dojo');
  const row = page.getByTestId('paper-entry-row').first();
  await row.getByLabel('Nom', { exact: true }).fill('MARTIN');
  await row.getByLabel('Prénom').fill('Léa');
  await row.getByText('F', { exact: true }).click();
  await row.getByText('C', { exact: true }).click();
  await row.getByLabel('Poids actuel').fill('53,5');
  await row.getByText('Karaté', { exact: true }).click();
  await row.getByText('Kata', { exact: true }).click();
  await row.getByLabel('Grade').fill('1er kyu');
  await row.getByText('Jiyu', { exact: true }).click();
  await row.getByLabel('Reclassement Mix').selectOption('1');
  await page.getByTestId('paper-entry-check').click();
  await expect(page.getByTestId('paper-entry-preview').getByTestId('club-form-preview-row')).toHaveCount(2);
  await page.getByTestId('paper-entry-save').click();
  await expect(page.getByText('Tani Dojo : 2 inscription(s)')).toBeVisible();
  const regs = (await (await request.get(`/api/competitions/${id}/registrations`)).json()) as { discipline: string; weightClassId: string | null }[];
  expect(regs.map((r) => r.discipline).sort()).toEqual(['karate', 'kata']);
  expect(regs.find((r) => r.discipline === 'karate')!.weightClassId).toBe('cadet:F:-54');
  // Une saisie commencée puis abandonnée n'écrit rien
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('paper-entry-club').fill('Autre club');
  await page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true }).fill('DURAND');
  await page.goto(`/competitions/${id}/inscriptions`);
  expect(((await (await request.get(`/api/competitions/${id}/registrations`)).json()) as unknown[]).length).toBe(2);
});


test('relecture (mineurs) : saisie papier — confirmation avant de quitter, noms accessibles', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe saisie confirmation');
  await page.goto(`/competitions/${id}/fiche-club`);
  await expect(page.getByRole('group', { name: 'Ligne 1 — Sexe' })).toBeVisible();
  await page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true }).fill('MARTIN');
  await page.getByRole('tab', { name: 'Inscriptions' }).click();
  await expect(page.getByTestId('leave-confirm')).toBeVisible();
  await page.getByTestId('leave-stay').click();
  await expect(page).toHaveURL(/\/fiche-club$/);
  await expect(page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true })).toHaveValue('MARTIN');
  await page.getByRole('tab', { name: 'Inscriptions' }).click();
  await page.getByTestId('leave-go').click();
  await expect(page).toHaveURL(/\/inscriptions$/);
});
