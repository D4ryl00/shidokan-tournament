import { expect, test } from '@playwright/test';
import { createCompetition } from './helpers.js';

test('créer une compétition avec accents', async ({ page }) => {
  await createCompetition(page, "Coupe Shidokan – Côte d'Azur");
  await expect(page.getByRole('heading', { name: "Coupe Shidokan – Côte d'Azur" })).toBeVisible();
});

test('modifier une catégorie de poids', async ({ page }) => {
  const id = await createCompetition(page, 'Grille modifiée');
  await page.goto(`/competitions/${id}/grille`);
  await page.getByTestId('grid-age-select').click();
  await page.getByRole('option', { name: 'Poussins', exact: true }).click();
  await page.getByTestId('grid-sex-select').getByText('Féminines').click();
  const first = page.getByTestId('weight-label-input').first();
  await expect(first).toHaveValue('-25');
  await first.fill('-20');
  await page.getByTestId('grid-save').click();
  await expect(page.getByText('Grille enregistrée')).toBeVisible();
  await page.reload();
  await page.getByTestId('grid-age-select').click();
  await page.getByRole('option', { name: 'Poussins', exact: true }).click();
  await page.getByTestId('grid-sex-select').getByText('Féminines').click();
  await expect(page.getByTestId('weight-label-input').first()).toHaveValue('-20');
});

test('thème sombre : logo sur disque blanc, choix mémorisé', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('theme-toggle').getByText('Sombre').click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(page.getByTestId('logo')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/theme-sombre.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
});

test('thème clair', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('theme-toggle').getByText('Clair').click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  await page.screenshot({ path: 'test-results/theme-clair.png', fullPage: true });
});

test('réglage invalide refusé avec message', async ({ page }) => {
  await createCompetition(page, 'Réglage invalide');
  const gap = page.getByTestId('gap-children');
  await gap.fill('-1');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('api-error')).toContainText('supérieur ou égal à 0');
  await page.reload();
  await expect(page.getByTestId('gap-children')).toHaveValue('5 kg');
});

test.describe('système en sombre, thème sur Auto', () => {
  test.use({ colorScheme: 'dark' });
  test('le logo est sur disque blanc dès le premier rendu', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('theme-toggle').getByText('Auto').click();
    // Mémorise le fond du logo à l'instant où il est inséré, avant tout effet React.
    await page.addInitScript(() => {
      new MutationObserver((_, obs) => {
        const el = document.querySelector('[data-testid="logo"]');
        if (el) {
          (window as unknown as { firstLogoBg: string }).firstLogoBg = getComputedStyle(el).backgroundColor;
          obs.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await page.getByTestId('logo').waitFor();
    expect(await page.evaluate(() => (window as unknown as { firstLogoBg: string }).firstLogoBg)).toBe('rgb(255, 255, 255)');
  });
});

test('éditeur de grille : la ligne ne bouge pas pendant la frappe ; icône d’onglet sur disque blanc', async ({ page }) => {
  const id = await createCompetition(page, 'Grille frappe');
  await page.goto(`/competitions/${id}/grille`);
  await page.getByTestId('grid-age-select').click();
  await page.getByRole('option', { name: 'Poussins', exact: true }).click();
  const first = page.getByTestId('weight-label-input').first();
  await first.fill('');
  await first.pressSequentially('-50');
  await expect(page.getByTestId('weight-label-input').first()).toHaveValue('-50');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.webp');
});
