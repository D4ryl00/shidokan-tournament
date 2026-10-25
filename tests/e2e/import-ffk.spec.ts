import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { BLANK, buildFfkWorkbook } from '../helpers/ffk-fixture.js';
import { createCompetition } from './helpers.js';

const TANI = '0060893 TANI DOJO';
const ffk = buildFfkWorkbook({
  'Coupe Shidokan Karate': [
    ['MARTIN LEA', null, 'L1', TANI, 'Feminine', 'Karate', 'Cadet', -61, null],
    ['MARTIN LENA', null, 'L2', TANI, 'Feminine', 'Karate', 'Cadet', -54, null],
    BLANK,
    ['NOUVEAU PAUL', null, 'L3', '0060999 AUTRE CLUB', 'Masculin', 'Karate', 'Senior', -75, null],
    ['SANS AGE', null, 'L4', TANI, 'Masculin', 'Karate', null, -75, null],
    ['MOREAU LINA', null, 'L5', TANI, 'Feminine', 'Karate', 'Poussin', -20, null],
  ],
});

async function importClubForm(page: Page, id: string) {
  await page.goto(`/competitions/${id}/fiche-club`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('club-form-download').click()]);
  const template = fs.readFileSync((await download.path())!);
  const filled = fillClubForm(template, ['Tani Dojo', 'Coach', null, null, 'Non'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null],
    ['SHINSEN', 'Paul', 'Masculin', 'Seniors', '-75', 'Karaté', 'Jiyu', null, null, null],
  ]);
  await page.getByTestId('club-form-file').setInputFiles({ name: 'fiche.ods', mimeType: 'application/octet-stream', buffer: filled });
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText('2 inscriptions importées')).toBeVisible();
}

async function uploadFfk(page: Page, id: string) {
  await page.goto(`/competitions/${id}/import-ffk`);
  await page.getByTestId('ffk-file').setInputFiles({ name: 'export.xlsx', mimeType: 'application/octet-stream', buffer: ffk });
  await expect(page.getByTestId('ffk-summary')).toBeVisible();
  // Le champ est vidé aussitôt lu : choisir de nouveau le même fichier le relit.
  await expect(page.getByTestId('ffk-file')).toHaveValue('');
}

test('import FFK : rapprochement avec la fiche club, cas douteux, réimport', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe import FFK');
  await importClubForm(page, id);
  await uploadFfk(page, id);

  await expect(page.getByTestId('ffk-sheet')).toHaveCount(1);
  await expect(page.getByTestId('ffk-summary')).toContainText('2 créations · 1 mise à jour · 1 à trancher · 1 erreur');
  await expect(page.getByTestId('ffk-errors')).toContainText('SANS AGE');
  await expect(page.getByTestId('ffk-unconfirmed')).toContainText('SHINSEN');
  await expect(page.getByTestId('ffk-commit')).toBeDisabled();

  await page.getByTestId('ffk-doubtful').getByLabel('Nouveau combattant').check();
  await expect(page.getByTestId('ffk-summary')).toContainText('3 créations · 1 mise à jour · 0 à trancher');
  await page.getByTestId('ffk-commit').click();
  await page.getByTestId('ffk-commit-confirm').click();
  await expect(page.getByText('Import FFK : 3 créées, 1 mise à jour')).toBeVisible();

  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row')).toHaveCount(5);
  const martin = page.getByTestId('registration-row').filter({ hasText: 'Léa' });
  await expect(martin.getByTestId('registration-ffk-badge')).toBeVisible();
  await expect(martin).toContainText('-61');
  await page.getByTestId('registrations-filter-unconfirmed').check();
  await expect(page.getByTestId('registration-row')).toHaveCount(1);
  await expect(page.getByTestId('registration-row')).toContainText('SHINSEN');

  await uploadFfk(page, id);
  await expect(page.getByTestId('ffk-summary')).toContainText('0 création · 4 mises à jour · 0 à trancher');
});
