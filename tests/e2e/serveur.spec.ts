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

// Une seule connexion pour tout l'envoi par Google : le serveur e2e limite les connexions à 10 par adresse en 15 minutes.
test('serveur : envoi des mails — choix Google, bouton vers Google ; compte connecté puis « Déconnecter » ; retours de Google annoncés', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('orga@e2e.example');
  await page.getByTestId('login-password').fill('mot-de-passe-e2e');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('new-competition')).toBeVisible();

  // Le bouton mène chez Google, avec le seul droit d'envoyer.
  await page.goto('/parametres#mails');
  await page.getByText('Compte Google', { exact: true }).click();
  await expect(page.getByText('Google affichera « application non validée »', { exact: false })).toBeVisible();
  let googleUrl = '';
  // Une page factice plutôt qu'un abandon : la page d'erreur de Chrome arrivait parfois après coup et interrompait la navigation suivante.
  await page.route('https://accounts.google.com/**', (route) => {
    googleUrl = route.request().url();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Google (factice)</p>' });
  });
  await page.getByRole('button', { name: 'Se connecter avec Google' }).click();
  await page.waitForURL(/^https:\/\/accounts\.google\.com\//);
  await expect.poll(() => googleUrl).not.toBe('');
  expect(googleUrl).toContain('client_id=e2e-client');
  expect(googleUrl).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3101%2Fapi%2Fapp-settings%2Fgoogle%2Fcallback');
  expect(googleUrl).toContain('gmail.send');
  expect(googleUrl).not.toContain('mail.google.com');

  // Retours de Google : un message, puis l'adresse nettoyée.
  await page.goto('/parametres?google=annule#mails');
  await expect(page.getByText('Connexion à Google annulée.')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('google=');
  expect(page.url()).toContain('#mails');
  await page.goto('/parametres?google=session#mails');
  await expect(page.getByText('Votre session a expiré pendant la connexion à Google', { exact: false })).toBeVisible();

  // Pas de vrai Google ici : le serveur répond « connecté » tant que « Déconnecter » n'a pas été confirmé.
  let connected = true;
  await page.route('**/api/app-settings', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (route.request().method() === 'GET' && connected) {
      body.mailMode = 'google';
      body.google = { email: 'orga@gmail.com', fromName: 'Shidokan France', status: 'ok', lastRefreshAt: null };
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/app-settings/google/disconnect', async (route) => {
    connected = false;
    await route.fulfill({ json: { revoked: true } });
  });
  await page.reload(); // même adresse (#mails) : un goto ne rechargerait pas la page
  await expect(page.getByTestId('google-connected')).toContainText('orga@gmail.com');
  await page.getByRole('button', { name: 'Déconnecter' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Déconnecter' }).click();
  await expect(page.getByText('Compte Google déconnecté.')).toBeVisible();
  await expect(page.getByLabel('Serveur SMTP')).toBeVisible();
});
