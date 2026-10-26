import { expect, test } from '@playwright/test';
import { CONTACTS_NOT_GRANTED, DIRECTORY_CHANGED } from '../../src/domain/google-contacts.js';
import { GOOGLE_PREVIEW, mockGoogleContacts } from './helpers.js';

// Google n'est pas joignable ici : les réglages (compte connecté) et l'aperçu sont simulés sur le serveur local habituel.

test('annuaire : synchroniser avec Google — différences, lien suggéré, nouveau club, plus tard', async ({ page }) => {
  const { applied, previews } = await mockGoogleContacts(page);
  await page.goto('/annuaire');
  await page.getByRole('link', { name: 'Synchroniser avec Google' }).click();
  await expect(page).toHaveURL(/\/annuaire\/google$/);
  await expect(page.getByRole('heading', { name: 'Synchroniser les coachs avec Google' })).toBeVisible();
  await expect(page.getByText('orga@gmail.com · 4 contacts')).toBeVisible();

  const apply = page.getByTestId('google-apply');
  // Sophie (sans correspondance) attend « Plus tard » : elle sera rangée en attente.
  await expect(apply).toHaveText('Appliquer : 1 différence, 1 lien, 1 contact en attente');

  // Décocher la différence : la valeur de l'annuaire est gardée.
  await page.getByRole('checkbox', { name: 'Prendre Google : Dojo des Lilas, Téléphone' }).uncheck();
  await expect(apply).toHaveText('Appliquer : 1 lien, 1 contact en attente, 1 gardée');

  // Le contact proposé est lié au club de même mail ; celui sans correspondance attend « Plus tard ».
  const paul = page.getByTestId('contact-card').filter({ hasText: 'Paul Martin' });
  await expect(paul.getByText('même mail')).toBeVisible();
  await expect(paul.getByRole('radio', { name: 'Lier à un club' })).toBeChecked();
  const sophie = page.getByTestId('contact-card').filter({ hasText: 'Sophie Leroy' });
  await expect(sophie.getByRole('radio', { name: 'Plus tard' })).toBeChecked();

  // Nouveau club : sans nom, rien ne part.
  await sophie.getByRole('radio', { name: 'Nouveau club' }).check();
  await expect(apply).toBeDisabled();
  await sophie.getByRole('textbox', { name: 'Nom du club' }).fill('Kyokushin Sud');
  await expect(apply).toBeEnabled();
  await expect(apply).toHaveText('Appliquer : 1 lien, 1 nouveau club, 1 gardée');

  // En attente : replié, avec « Plus tard » par défaut.
  await expect(page.getByText('En attente d’un rattachement (1)')).toBeVisible();
  await expect(page.getByText('Contacts déjà liés (1)')).toBeVisible();

  await apply.click();
  await expect(page.getByText('Annuaire mis à jour.')).toBeVisible();
  expect(applied).toEqual([{
    updates: [],
    links: [{ clubId: 'c-est', version: 5, contact: 'people/paul', set: {} }],
    creates: [{ contact: 'people/sophie', name: 'Kyokushin Sud', coachName: 'Sophie Leroy', coachPhone: '07 12 34 56 78', coachEmail: null }],
    later: [],
  }]);
  // Nouvel aperçu après l'application.
  await expect.poll(() => previews.length).toBeGreaterThanOrEqual(2);
});

test('annuaire : changer de libellé relit Google, à chaque fois, et revenir sur la page aussi', async ({ page }) => {
  const labels = [{ resourceName: 'contactGroups/coachs', name: 'Coachs' }, { resourceName: 'contactGroups/arbitres', name: 'Arbitres' }];
  const { previews } = await mockGoogleContacts(page, { ...GOOGLE_PREVIEW, labels });
  await page.goto('/annuaire/google');
  await expect(page.getByTestId('google-apply')).toBeVisible();
  expect(previews).toEqual([{}]);
  const choose = async (name: string) => {
    await page.getByTestId('google-label').click();
    await page.getByRole('option', { name }).click();
  };
  // A → B → A : Google est relu à chaque changement, même pour un libellé déjà vu.
  await choose('Coachs');
  await expect.poll(() => previews.length).toBe(2);
  await choose('Arbitres');
  await expect.poll(() => previews.length).toBe(3);
  await choose('Coachs');
  await expect.poll(() => previews.length).toBe(4);
  expect(previews).toEqual([{}, { label: 'contactGroups/coachs' }, { label: 'contactGroups/arbitres' }, { label: 'contactGroups/coachs' }]);
  await choose('Tous les contacts');
  await expect.poll(() => previews.at(-1)).toEqual({ label: null });
  // Revenir sur la page relit Google (le dernier libellé retenu par le serveur).
  const before = previews.length;
  await page.getByRole('link', { name: 'Retour à l’annuaire' }).click();
  await page.getByRole('link', { name: 'Synchroniser avec Google' }).click();
  await expect.poll(() => previews.length).toBe(before + 1);
  expect(previews.at(-1)).toEqual({});
});

test('annuaire : seulement des contacts laissés « Plus tard », ils sont rangés en attente', async ({ page }) => {
  const only = { ...GOOGLE_PREVIEW, preview: { ...GOOGLE_PREVIEW.preview, diffs: [], linked: [], pending: [], newContacts: [GOOGLE_PREVIEW.preview.newContacts[1]] } };
  const { applied } = await mockGoogleContacts(page, only);
  await page.goto('/annuaire/google');
  const apply = page.getByTestId('google-apply');
  await expect(apply).toHaveText('Appliquer : 1 contact en attente');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByText('Annuaire mis à jour.')).toBeVisible();
  expect(applied).toEqual([{ updates: [], links: [], creates: [], later: ['people/sophie'] }]);
});

test('annuaire : l’annuaire a changé entre-temps, l’aperçu est relu et le message reste', async ({ page }) => {
  const { previews } = await mockGoogleContacts(page);
  await page.route('**/api/club-directory/google/apply', (route) => route.fulfill({ status: 409, json: { error: DIRECTORY_CHANGED } }));
  await page.goto('/annuaire/google');
  await page.getByTestId('google-apply').click();
  await expect(page.getByText(DIRECTORY_CHANGED)).toBeVisible();
  await expect.poll(() => previews.length).toBe(2);
  await expect(page.getByText(DIRECTORY_CHANGED)).toBeVisible();
});

test('annuaire : sans droit sur les contacts', async ({ page }) => {
  await mockGoogleContacts(page, { state: 'no-scope', account: 'orga@gmail.com' });
  await page.goto('/annuaire/google');
  await expect(page.getByText(CONTACTS_NOT_GRANTED)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Réglages de l’application' })).toHaveAttribute('href', '/parametres#mails');
  await expect(page.getByTestId('google-apply')).toHaveCount(0);
});

test('annuaire : sans compte Google, pas de bouton', async ({ page }) => {
  await page.goto('/annuaire');
  await expect(page.getByRole('heading', { name: 'Annuaire des clubs' })).toBeVisible();
  await expect(page.getByTestId('directory-new')).toBeVisible();
  await expect(page.getByText('Synchroniser avec Google')).toHaveCount(0);
});

test('réglages : la ligne « Contacts » sous le compte connecté', async ({ page }) => {
  await mockGoogleContacts(page);
  await page.goto('/parametres#mails');
  await page.getByText('Compte Google', { exact: true }).click();
  await expect(page.getByTestId('google-connected')).toContainText('orga@gmail.com');
  await expect(page.getByText('Contacts : accès accordé')).toBeVisible();
});
