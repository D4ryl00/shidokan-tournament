import { expect, test } from '@playwright/test';

const SERVER = 'http://localhost:3101';

test('passage de main : jeton en ligne → PC relié → prise de main (lecture seule en ligne) → saisie sur le PC → rendre la main', async ({ browser, page }) => {
  const name = `Coupe synchronisée ${Date.now()}`;
  // Serveur en ligne : connexion, jeton, compétition.
  const online = await (await browser.newContext({ baseURL: SERVER })).newPage();
  await online.goto('/');
  await online.getByTestId('login-email').fill('orga@e2e.example');
  await online.getByTestId('login-password').fill('mot-de-passe-e2e');
  await online.getByTestId('login-submit').click();
  await online.getByTestId('nav-settings').click();
  await online.getByTestId('create-sync-token').click();
  const token = await online.getByTestId('sync-token-value').innerText();
  await online.goto('/');
  await online.getByTestId('new-competition').click();
  await online.getByTestId('competition-name').fill(name);
  await online.getByTestId('competition-submit').click();
  await online.getByTestId('competition-row').filter({ hasText: name }).getByRole('link', { name }).click();
  await expect(online.getByTestId('management-banner')).toHaveText('Gérée ici');
  const onlineUrl = online.url();

  // PC : relier au serveur, prendre la main.
  await page.goto('/parametres');
  await page.getByTestId('sync-url').fill(SERVER);
  await page.getByTestId('sync-token').fill(token);
  await page.getByTestId('sync-save').click();
  await expect(page.getByText('Serveur relié.')).toBeVisible();
  await page.goto('/');
  await page.getByTestId('server-competitions').click();
  await page.getByTestId('server-competition').filter({ hasText: name }).getByRole('button', { name: 'Prendre la main' }).click();
  await page.getByTestId('server-take-confirm').click();
  await expect(page).toHaveURL(/\/competitions\/[^/]+\/reglages$/);
  await expect(page.getByTestId('management-banner')).toContainText('Gérée ici');

  // En ligne : lecture seule.
  await online.goto(onlineUrl);
  await expect(online.getByTestId('management-banner')).toContainText(/Gérée par .+ depuis le .+ — lecture seule/);

  // Saisie sur le PC, puis rendre la main.
  await page.getByLabel('Lieu').fill('Gymnase du PC');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();
  await page.getByTestId('sync-return').click();
  await page.getByTestId('sync-return-confirm').click();
  await expect(page.getByText('La main est rendue au serveur.')).toBeVisible();
  await expect(page.getByTestId('management-banner')).toContainText('Copie du serveur');

  // En ligne : la main est revenue, avec la saisie du PC.
  await online.reload();
  await expect(online.getByTestId('management-banner')).toContainText('Gérée ici');
  await expect(online.getByText('Gymnase du PC')).toBeVisible();
});
