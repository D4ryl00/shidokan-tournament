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
  // D'autres comptes peuvent exister (rôles créés par un autre parcours sur ce serveur).
  await expect(page.getByTestId('account-row').filter({ hasText: 'orga@e2e.example' })).toContainText('orga@e2e.example (vous)');
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await page.goto('/inscription/inconnu');
  await expect(page.getByTestId('club-entry-error')).toHaveText('Lien inconnu ou expiré.');
});

test('serveur : session perdue pendant une saisie → reconnexion par-dessus l’écran, la saisie est gardée', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('orga@e2e.example');
  await page.getByTestId('login-password').fill('mot-de-passe-e2e');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('new-competition').click();
  await page.getByTestId('competition-name').fill('Coupe après reconnexion');
  // La session disparaît (cookie volé puis mot de passe changé, expiration…).
  await page.request.post('/api/auth/logout');
  await page.getByTestId('competition-submit').click();
  const relogin = page.getByRole('dialog', { name: 'Session expirée : reconnectez-vous' });
  await expect(relogin).toBeVisible();
  await relogin.getByTestId('login-email').fill('orga@e2e.example');
  await relogin.getByTestId('login-password').fill('mot-de-passe-e2e');
  await relogin.getByTestId('login-submit').click();
  await expect(relogin).toHaveCount(0);
  await expect(page.getByTestId('competition-name')).toHaveValue('Coupe après reconnexion');
  await page.getByTestId('competition-submit').click();
  await expect(page.getByTestId('competition-row').filter({ hasText: 'Coupe après reconnexion' })).toBeVisible();
});

test('serveur : envoi des mails — choix Google, le bouton mène chez Google avec les bonnes autorisations', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('orga@e2e.example');
  await page.getByTestId('login-password').fill('mot-de-passe-e2e');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('new-competition')).toBeVisible();
  await page.goto('/parametres#mails');
  await page.getByText('Compte Google', { exact: true }).click();
  await expect(page.getByText('Google affichera « application non validée »', { exact: false })).toBeVisible();
  let googleUrl = '';
  await page.route('https://accounts.google.com/**', (route) => {
    googleUrl = route.request().url();
    return route.abort();
  });
  await page.getByRole('button', { name: 'Se connecter avec Google' }).click();
  await expect.poll(() => googleUrl).not.toBe('');
  expect(googleUrl).toContain('client_id=e2e-client');
  expect(googleUrl).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3101%2Fapi%2Fapp-settings%2Fgoogle%2Fcallback');
  expect(googleUrl).toContain('gmail.send');
  expect(googleUrl).not.toContain('mail.google.com');
  await page.goto('/parametres?google=annule#mails');
  await expect(page.getByText('Connexion à Google annulée.')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('google=');
  expect(page.url()).toContain('#mails');
});
