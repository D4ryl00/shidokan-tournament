import { expect, test, type Browser, type Page } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3101' });
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'mot-de-passe-e2e';
const COMPETITION = 'Coupe des rôles';

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}
/** Nouveau navigateur connecté avec ce compte ; les réponses 403 reçues sont notées. */
async function sessionOf(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: 'http://localhost:3101' })).newPage();
  const forbidden: string[] = [];
  page.on('response', (r) => r.status() === 403 && forbidden.push(`${r.request().method()} ${r.url()}`));
  await login(page, email);
  return { page, forbidden };
}
const choose = async (page: Page, testId: string, option: string) => {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

let id = '';
let label61 = '';

test('l’organisateur crée la compétition, un compte Table centrale et un compte Zone (Tatami 2)', async ({ page }) => {
  await login(page, 'orga@e2e.example');
  await expect(page.getByTestId('new-competition')).toBeVisible();
  const api = page.request;
  id = (await (await api.post('/api/competitions', { data: { name: COMPETITION, date: '2026-11-22' } })).json()).id;
  const zones = (await (await api.get(`/api/competitions/${id}/zones`)).json()) as { id: string; name: string }[];
  for (const [weight, n] of [['-54', 4], ['-61', 4]] as const) {
    for (let k = 0; k < n; k++) {
      await api.post(`/api/competitions/${id}/registrations`, {
        data: { clubId: null, lastName: `ROLE${weight}${k}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: `cadet:F:${weight}`, source: 'manual' },
      });
    }
  }
  const cats = (await (await api.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  for (const c of cats) await api.patch(`/api/competitions/${id}/categories/${c.id}`, { data: { zoneId: c.label.includes('-61') ? zones[1]!.id : zones[0]!.id } });
  label61 = cats.find((c) => c.label.includes('-61'))!.label;

  await page.getByTestId('nav-accounts').click();
  // Formulaire aligné : libellés sur une même ligne, cases sur une autre (l'aide « 10 caractères » ne décale rien).
  const top = async (label: string) => (await page.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).boundingBox())!.y;
  const inputTop = async (label: string) => (await page.getByLabel(label, { exact: true }).boundingBox())!.y;
  // À l'arrondi près (champ texte et champ mot de passe) ; décalés, ils l'étaient de 20 px.
  const aligned = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  aligned(await top('E-mail'), await top('Mot de passe'));
  aligned(await inputTop('E-mail'), await inputTop('Mot de passe'));
  aligned(await top('Mot de passe actuel'), await top('Nouveau mot de passe'));
  const add =async (email: string, role: string, zone?: string) => {
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await choose(page, 'account-role', role);
    if (zone) {
      await choose(page, 'account-competition', COMPETITION);
      await choose(page, 'account-zone', zone);
    }
    await page.getByTestId('account-create').click();
    await expect(page.getByTestId('account-row').filter({ hasText: email })).toBeVisible();
  };
  await add('table@e2e.example', 'Table centrale');
  await add('tatami2@e2e.example', 'Zone', 'Tatami 2');
  await expect(page.getByTestId('account-row').filter({ hasText: 'tatami2@e2e.example' }).getByTestId('account-row-role')).toHaveText(`Zone Tatami 2 — ${COMPETITION}`);
  await expect(page.getByTestId('account-row').filter({ hasText: 'table@e2e.example' }).getByTestId('account-row-role')).toHaveText('Table centrale');
});

test('compte Table centrale : poste imposé, aucun menu de l’organisateur, chaque onglet s’ouvre sans refus', async ({ browser }) => {
  const { page, forbidden } = await sessionOf(browser, 'table@e2e.example');
  await expect(page.getByTestId('competition-row').filter({ hasText: COMPETITION })).toBeVisible();
  for (const nav of ['new-competition', 'nav-directory', 'nav-settings', 'nav-accounts']) await expect(page.getByTestId(nav)).toHaveCount(0);
  await page.getByRole('link', { name: COMPETITION }).click();
  await expect(page.getByTestId('poste-account')).toHaveText('Poste : Table centrale');
  await expect(page.getByTestId('poste-select')).toHaveCount(0);
  // Ses onglets, rangés par étape : Préparer (inscriptions, clubs), Jour J, Après.
  const stages: [string, string[]][] = [
    ['preparer', ['Inscriptions', 'Clubs']], ['jour-j', ['Pesée', 'Réaffectation', 'Tableaux', 'Combats']], ['apres', ['Podiums']],
  ];
  for (const [stage, tabs] of stages) {
    await page.getByTestId(`stage-${stage}`).click();
    // Étape à un seul onglet : pas de barre d'onglets, l'onglet est ouvert directement.
    if (tabs.length === 1) {
      await expect(page.getByRole('tab')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/${tabs[0]!.toLowerCase()}$`));
      continue;
    }
    await expect(page.getByRole('tab')).toHaveText(tabs);
    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.waitForLoadState('networkidle');
    }
  }
  // Son mot de passe : un écran à lui, sans la liste des comptes.
  await page.getByTestId('user-menu').click();
  await page.getByTestId('nav-password').click();
  await expect(page.getByTestId('account-row')).toHaveCount(0);
  await page.getByLabel('Mot de passe actuel').fill(PASSWORD);
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe');
  await page.getByRole('button', { name: 'Changer' }).click();
  await expect(page.getByText('Mot de passe changé.')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(forbidden).toEqual([]);
});

test('compte Zone : directement sur les combats de sa zone ; il saisit un résultat de sa zone', async ({ browser }) => {
  const { page, forbidden } = await sessionOf(browser, 'tatami2@e2e.example');
  await expect(page).toHaveURL(new RegExp(`/competitions/${id}/combats`));
  await expect(page.getByTestId('poste-account')).toHaveText('Poste : Zone : Tatami 2');
  await expect(page.getByRole('tab')).toHaveText(['Tableaux', 'Combats']);
  await expect(page.getByTestId('zone-card')).toHaveCount(1);
  await expect(page.getByTestId('zone-card')).toContainText('Tatami 2');
  await page.getByTestId('schedule-category').filter({ hasText: label61 }).getByRole('button').first().click();
  await page.locator('[data-testid="bracket-match"][data-match="w1-0"]').click();
  await page.getByTestId('result-winner-a').click();
  await page.getByTestId('result-save').click();
  await expect(page.getByTestId('result-save')).toHaveCount(0);
  await expect(page.getByTestId('zone-card').getByTestId('next-match')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Tableaux', exact: true }).click();
  await page.waitForLoadState('networkidle');
  expect(forbidden).toEqual([]);
});
