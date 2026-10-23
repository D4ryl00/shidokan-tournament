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

test('secours : copie du serveur tenue à jour → « Prendre la main en secours » → saisie sur le PC → « Prévenir le serveur »', async ({ browser, page }) => {
  const name = `Coupe de secours ${Date.now()}`;
  const online = await (await browser.newContext({ baseURL: SERVER })).newPage();
  await online.goto('/');
  await online.getByTestId('login-email').fill('orga@e2e.example');
  await online.getByTestId('login-password').fill('mot-de-passe-e2e');
  await online.getByTestId('login-submit').click();
  await expect(online.getByTestId('nav-settings')).toBeVisible();
  const token = (await (await online.request.post('/api/sync/tokens', { data: { name: 'PC de secours' } })).json()).token as string;
  const id = (await (await online.request.post('/api/competitions', { data: { name, date: '2026-11-22', location: 'Nice' } })).json()).id as string;

  // PC relié, copie récupérée et tenue à jour.
  expect((await page.request.patch('/api/sync/settings', { data: { url: SERVER, token } })).ok()).toBe(true);
  expect((await page.request.post('/api/sync/pull', { data: { competitionId: id, take: false } })).ok()).toBe(true);
  await page.goto(`/competitions/${id}/reglages`);
  await expect(page.getByTestId('management-banner')).toContainText('Copie du serveur');
  await page.getByTestId('sync-follow').click();
  await expect(page.getByTestId('sync-follow')).toBeChecked();
  await expect(page.getByTestId('sync-follow-status')).toBeVisible();

  // Internet coupé : le PC prend la main en secours et saisit.
  await page.getByTestId('sync-rescue').click();
  await page.getByTestId('sync-rescue-confirm').click();
  await expect(page.getByTestId('management-banner')).toContainText('Gérée ici en secours depuis le');
  await page.getByLabel('Lieu').fill('Gymnase de secours');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();

  // Internet revenu : le serveur est prévenu, la main passe au PC.
  await page.getByTestId('sync-rescue-notify').click();
  await expect(page.getByText('Le serveur est prévenu : ce PC a la main.')).toBeVisible();
  await expect(page.getByTestId('management-banner')).toContainText('Gérée ici');
  await expect(page.getByTestId('management-banner')).not.toContainText('secours');
  await online.goto(`/competitions/${id}/reglages`);
  await expect(online.getByTestId('management-banner')).toContainText(/Gérée par .+ — lecture seule/);
  await expect(online.getByLabel('Lieu')).toHaveValue('Gymnase de secours');
});
