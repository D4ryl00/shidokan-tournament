import { expect, test } from '@playwright/test';
import { createCompetition, openTab } from './helpers.js';

test('tableaux libres dans l’onglet Catégories', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe placements libres');
  await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
  ] });

  // L'onglet s'appelle « Catégories » ; l'ancienne adresse y redirige.
  await openTab(page, 'Catégories');
  await expect(page).toHaveURL(/\/categories$/);
  await page.goto(`/competitions/${id}/grille`);
  await expect(page).toHaveURL(/\/categories$/);
  await expect(page.getByRole('group', { name: 'Catégories ouvertes', exact: true })).toBeVisible();
  const section = page.getByRole('group', { name: 'Tableaux libres', exact: true });
  await expect(section).toBeVisible();
  await expect(page.getByRole('group', { name: 'Catégories de poids', exact: true })).toBeVisible();
  // Ajouter
  await section.getByRole('button', { name: 'Ajouter un tableau libre' }).click();
  await page.getByLabel('Nom du tableau').fill('Gala 1');
  await page.getByLabel('Discipline', { exact: true }).selectOption({ label: 'Karaté' });
  await page.getByLabel('Règlement', { exact: true }).selectOption({ label: 'Jiyu ippon kumite' });
  const created = page.waitForResponse((r) => r.url().includes('/free-tableaux') && r.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await created).status()).toBe(201);
  const row = section.getByTestId('free-tableau').filter({ hasText: 'Gala 1' });
  await expect(row).toContainText('0 combattant');
  await expect(row.getByLabel('Session de Gala 1')).toHaveValue('none');

  // Session
  const patched = page.waitForResponse((r) => r.url().includes('/categories/') && r.request().method() === 'PATCH');
  await row.getByLabel('Session de Gala 1').selectOption({ label: 'Matin' });
  expect((await patched).ok()).toBeTruthy();
  await expect(row.getByLabel('Session de Gala 1').locator('option:checked')).toHaveText('Matin');

  // Modifier le nom
  await row.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Nom du tableau').fill('Gala A');
  const renamed = page.waitForResponse((r) => r.url().includes('/free-tableaux/') && r.request().method() === 'PATCH');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await renamed).ok()).toBeTruthy();
  const row2 = section.getByTestId('free-tableau').filter({ hasText: 'Gala A' });
  await expect(row2).toBeVisible();
  // Supprimer (vide)
  await row2.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('Aucun combattant à renvoyer')).toBeVisible();
  const deleted = page.waitForResponse((r) => r.url().includes('/free-tableaux/') && r.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Supprimer le tableau' }).click();
  expect((await deleted).ok()).toBeTruthy();
  await expect(section.getByTestId('free-tableau')).toHaveCount(0);
});
