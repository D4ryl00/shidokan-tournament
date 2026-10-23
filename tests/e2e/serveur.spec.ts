import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3101' });

test('serveur : connexion obligatoire, puis les écrans habituels ; déconnexion ; la page d’un club s’ouvre sans connexion', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await page.getByTestId('login-email').fill('orga@e2e.example');
  await page.getByTestId('login-password').fill('mauvais-mot-de-passe');
  await page.getByTestId('login-submit').click();
  await expect(page.getByText('E-mail ou mot de passe incorrect.')).toBeVisible();
  await page.getByTestId('login-password').fill('mot-de-passe-e2e');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('new-competition')).toBeVisible();
  await expect(page.getByTestId('nav-accounts')).toBeVisible();
  await page.getByTestId('nav-accounts').click();
  await expect(page.getByTestId('account-row')).toHaveText(/orga@e2e\.example \(vous\)/);
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await page.goto('/inscription/inconnu');
  await expect(page.getByTestId('club-entry-error')).toHaveText('Lien inconnu ou expiré.');
});
