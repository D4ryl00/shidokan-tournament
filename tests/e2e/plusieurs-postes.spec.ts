import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

/** Quatre cadettes -54 (élimination directe, deux demi-finales), placées sur le Tatami 1. */
async function seed(request: APIRequestContext, id: string) {
  const clubs: string[] = [];
  for (const name of ['Tani Dojo', 'Issa']) clubs.push((await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()).id);
  for (let k = 0; k < 4; k++) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: clubs[k % 2], lastName: `POSTE${k}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' },
    });
  }
  const [cat] = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string; name: string }[];
  await request.patch(`/api/competitions/${id}/categories/${cat!.id}`, { data: { zoneId: zones[0]!.id } });
  return { cat: cat!, zones };
}

const choosePoste = async (page: Page, label: string) => {
  await page.getByTestId('poste-select').click();
  await page.getByRole('option', { name: label, exact: true }).click();
};
const openMatch = async (page: Page, label: string, matchId: string) => {
  await page.getByTestId('schedule-category').filter({ hasText: label }).getByRole('button').first().click();
  await page.locator(`[data-testid="bracket-match"][data-match="${matchId}"]`).click();
};

test('deux postes : un résultat saisi sur l’un apparaît sur l’autre sans recharger ; le même combat saisi avec l’écran d’avant → « Modifié entre-temps… »', async ({ page, browser, request }) => {
  const id = await createCompetition(page, 'Coupe deux postes');
  const { cat } = await seed(request, id);
  const zonePage = await (await browser.newContext({ baseURL: 'http://localhost:3100' })).newPage();
  await zonePage.goto(`/competitions/${id}/combats`);
  await choosePoste(zonePage, 'Zone : Tatami 1');
  await expect(zonePage.getByTestId('zone-card').getByTestId('next-match')).toHaveCount(2);
  await page.goto(`/competitions/${id}/combats`);

  // Le poste de la zone ouvre la saisie du combat w1-0 ; l'organisation enregistre ce même combat avant lui.
  await openMatch(zonePage, cat.label, 'w1-0');
  await openMatch(page, cat.label, 'w1-0');
  await page.getByTestId('result-winner-a').click();
  await page.getByTestId('result-save').click();
  await expect(page.getByTestId('result-save')).toHaveCount(0);

  await zonePage.getByTestId('result-winner-b').click();
  await zonePage.getByTestId('result-save').click();
  await expect(zonePage.getByText('Modifié entre-temps par un autre poste : l’écran a été rechargé.').first()).toBeVisible();
  await zonePage.keyboard.press('Escape');
  // Sans recharger : la file de la zone a perdu le combat saisi par l'autre poste.
  await expect(zonePage.getByTestId('zone-card').getByTestId('next-match')).toHaveCount(1);

  // Et dans l'autre sens : un résultat saisi sur la zone apparaît à l'organisation.
  await openMatch(zonePage, cat.label, 'w1-1');
  await zonePage.getByTestId('result-winner-a').click();
  await zonePage.getByTestId('result-save').click();
  await expect(zonePage.getByTestId('result-save')).toHaveCount(0);
  await expect(page.getByTestId('zone-card').first().getByTestId('next-match')).toHaveCount(1);
  await expect(page.getByTestId('zone-card').first()).toContainText('POSTE');
});

test('poste Zone : seulement Combats et Tableaux, sa zone seulement, même après un rechargement et une adresse tapée', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe poste zone');
  await seed(request, id);
  await page.goto(`/competitions/${id}/combats`);
  await choosePoste(page, 'Zone : Tatami 1');
  await expect(page.getByRole('tab')).toHaveText(['Tableaux', 'Combats']);
  await expect(page.getByTestId('zone-card')).toHaveCount(1);
  await expect(page.getByTestId('schedule-zone')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab')).toHaveText(['Tableaux', 'Combats']);
  await page.goto(`/competitions/${id}/reglages`);
  await expect(page).toHaveURL(new RegExp(`/competitions/${id}/combats`));
  await choosePoste(page, 'Organisation (tout)');
  await expect(page.getByRole('tab', { name: 'Réglages' })).toBeVisible();
});
