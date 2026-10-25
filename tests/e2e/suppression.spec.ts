import { expect, test } from '@playwright/test';
import { createCompetition } from './helpers.js';

test('supprimer une compétition : nom à retaper, puis elle disparaît de la liste', async ({ page }) => {
  const name = `Coupe à supprimer ${Date.now()}`;
  await createCompetition(page, name);
  await page.goto('/');
  const row = page.getByTestId('competition-row').filter({ hasText: name });
  await row.getByTestId('competition-delete').click();
  const confirm = page.getByTestId('competition-delete-confirm');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('competition-delete-name').fill('Coupe');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('competition-delete-name').fill(name);
  await confirm.click();
  await expect(page.getByText('Compétition supprimée (une sauvegarde a été faite juste avant).')).toBeVisible();
  await expect(page.getByTestId('competition-row').filter({ hasText: name })).toHaveCount(0);
});
