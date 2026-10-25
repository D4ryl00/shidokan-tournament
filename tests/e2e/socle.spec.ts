import { expect, test } from '@playwright/test';
import { chooseTheme, createCompetition } from './helpers.js';

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
  await chooseTheme(page, 'Sombre');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(page.getByTestId('logo')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/theme-sombre.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
});

test('thème clair', async ({ page }) => {
  await page.goto('/');
  await chooseTheme(page, 'Clair');
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
    await chooseTheme(page, 'Auto');
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

test('zones de combat : renommer, ajouter, réordonner', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe zones');
  await page.goto(`/competitions/${id}/reglages`);
  const names = page.getByTestId('zone-name');
  await expect(names).toHaveCount(2);
  await names.nth(1).fill('Ring');
  await page.getByTestId('zone-add').click();
  await names.nth(2).fill('Tatami 3');
  await page.getByTestId('zone-row').nth(2).getByRole('button', { name: 'Monter' }).click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();
  await page.reload();
  const reloaded = page.getByTestId('zone-name');
  await expect(reloaded).toHaveCount(3);
  for (const [i, v] of ['Tatami 1', 'Tatami 3', 'Ring'].entries()) await expect(reloaded.nth(i)).toHaveValue(v);
});

test('zones de combat : nom en double, message en français', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe zones doublon');
  await page.goto(`/competitions/${id}/reglages`);
  await page.getByTestId('zone-name').nth(1).fill('tatami 1');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Deux zones portent le même nom : « Tatami 1 ».')).toBeVisible();
});

test('zones (relecture) : suppression confirmée, protégée si catégorie lancée, noms accessibles, nom proposé libre', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe zones relecture');
  const reg = (lastName: string, weightClassId: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
  for (let i = 0; i < 2; i++) await reg(`A${i}`, 'cadet:F:-54');
  for (let i = 0; i < 2; i++) await reg(`B${i}`, 'cadet:F:-61');
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  await request.patch(`/api/competitions/${id}/categories/${cats[0]!.id}`, { data: { zoneId: zones[0]!.id } });
  await request.patch(`/api/competitions/${id}/categories/${cats[1]!.id}`, { data: { zoneId: zones[1]!.id, status: 'started' } });
  await page.goto(`/competitions/${id}/reglages`);
  // Noms accessibles ; zone d'une catégorie lancée non supprimable
  await expect(page.getByRole('button', { name: 'Supprimer la zone « Tatami 2 »' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Monter la zone « Tatami 2 »' })).toBeEnabled();
  // Suppression confirmée, avec le nombre de catégories touchées
  await page.getByRole('button', { name: 'Supprimer la zone « Tatami 1 »' }).click();
  await expect(page.getByTestId('zone-delete-confirm')).toContainText('1 catégorie de cette zone sera répartie automatiquement sur les autres zones');
  await page.getByTestId('zone-delete-go').click();
  await expect(page.getByTestId('zone-name')).toHaveCount(1);
  // Nom proposé : le premier libre
  await page.getByTestId('zone-add').click();
  await expect(page.getByTestId('zone-name').nth(1)).toHaveValue('Tatami 1');
});

test('zones (relecture) : nom en double → rien n’est enregistré ; liste périmée → message', async ({ page, browser }) => {
  const id = await createCompetition(page, 'Coupe zones doublon 2');
  await page.goto(`/competitions/${id}/reglages`);
  await page.getByLabel('Nom', { exact: true }).fill('Nom changé');
  await page.getByTestId('zone-name').nth(1).fill('Tatami 1');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Deux zones portent le même nom : « Tatami 1 ».')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Coupe zones doublon 2');
  // Un deuxième onglet ajoute une zone ; le premier, périmé, ne peut pas l'effacer
  const other = await browser.newPage();
  await other.goto(page.url());
  await other.getByTestId('zone-add').click();
  await other.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(other.getByText('Réglages enregistrés')).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer la zone « Tatami 2 »' }).click(); // sans catégorie : pas de confirmation
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Les zones ont été modifiées ailleurs')).toBeVisible();
  await other.close();
});
