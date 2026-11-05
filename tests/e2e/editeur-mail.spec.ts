import { expect, test } from '@playwright/test';
import { SERVER_SESSION } from './helpers.js';

test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

test('réglages : le message par défaut s’ouvre avec ses paragraphes ; un message non touché n’est pas réenregistré ; le gras est conservé après rechargement', async ({ page }) => {
  const patches: string[] = [];
  page.on('request', (r) => r.method() === 'PATCH' && r.url().includes('/api/app-settings') && patches.push(r.url()));

  await page.goto('/parametres');
  const editor = page.getByTestId('mail-editor').locator('.ProseMirror');
  await expect(editor.locator('p').first()).toContainText('Bonjour');
  expect(await editor.locator('p').count()).toBeGreaterThan(3);
  expect(patches).toEqual([]);

  // Sélectionne la dernière ligne du message (« Shidokan France ») et la met en gras.
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  for (let i = 0; i < 'Shidokan France'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Gras' }).click();
  await page.getByTestId('mail-editor').locator('xpath=ancestor::*[@id="clubs"]').getByRole('button', { name: /Enregistrer/ }).first().click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
  expect(patches.length).toBe(1);

  await page.reload();
  await expect(page.getByTestId('mail-editor').locator('.ProseMirror strong')).toContainText('Shidokan France');
});
