import { expect, test, type Page } from '@playwright/test';
import { createCompetition, clipped } from './helpers.js';

const LAPTOP = 'http://localhost:3102';
const openMatch = async (page: Page, label: string, matchId: string) => {
  await page.getByTestId('schedule-category').filter({ hasText: label }).getByRole('button').first().click();
  await page.locator(`[data-testid="bracket-match"][data-match="${matchId}"]`).click();
};
const saveWinner = async (page: Page, side: 'a' | 'b') => {
  await page.getByTestId(`result-winner-${side}`).click();
  await page.getByTestId('result-save').click();
  await expect(page.getByTestId('result-save')).toHaveCount(0);
};

test('relier le portable, zone autonome, saisir deux combats ; la table centrale saisit le même combat sur le PC principal ; repasser en ligne ; trancher la carte', async ({ page, browser, request }) => {
  // PC principal : quatre cadettes -54 sur le Tatami 1, session lancée.
  const id = await createCompetition(page, 'Coupe zones autonomes');
  for (let k = 0; k < 4; k++) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `ZONE${k}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' },
    });
  }
  const [cat] = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string; name: string }[];
  expect((await request.patch(`/api/competitions/${id}/categories/${cat!.id}`, { data: { status: 'ready', zoneId: zones[0]!.id } })).ok()).toBe(true);
  expect((await request.post(`/api/competitions/${id}/launch`, { data: { waveId: null } })).ok()).toBe(true);

  // Portable : relié au PC principal, zone Tatami 1.
  const laptop = await (await browser.newContext({ baseURL: LAPTOP, locale: 'fr-FR' })).newPage();
  await laptop.goto('/parametres');
  await laptop.getByTestId('zone-link-url').fill('http://localhost:3100');
  await laptop.getByTestId('zone-link-probe').click();
  await laptop.getByTestId('zone-link-competition').selectOption(id);
  await laptop.getByTestId('zone-link-zone').selectOption(zones[0]!.id);
  await laptop.getByTestId('zone-link-save').click();
  await expect(laptop.getByTestId('zone-link-status')).toContainText('Copie à jour à', { timeout: 10_000 });

  await laptop.goto(`/competitions/${id}/combats`);
  await expect(laptop.getByTestId('management-banner')).toContainText('Copie du PC principal — à jour à');
  await laptop.getByTestId('zone-autonomous').click();
  await laptop.getByTestId('zone-autonomous-confirm').click();
  await expect(laptop.getByTestId('zone-autonomy-bar')).toContainText('Zone autonome Tatami 1 depuis');
  await expect(laptop.getByTestId('poste-account')).toContainText('Zone : Tatami 1');
  await openMatch(laptop, cat!.label, 'w1-0');
  await saveWinner(laptop, 'a');
  await openMatch(laptop, cat!.label, 'w1-1');
  await saveWinner(laptop, 'a');
  await expect(laptop.getByTestId('zone-autonomy-bar')).toContainText('2 saisies à renvoyer');

  // Pendant ce temps, la table centrale saisit le même premier combat, avec l'autre vainqueur.
  await page.goto(`/competitions/${id}/combats`);
  await openMatch(page, cat!.label, 'w1-0');
  await saveWinner(page, 'b');

  await laptop.getByTestId('zone-online').click();
  await expect(laptop.getByText('2 saisies reçues de Tatami 1 : 0 appliquée, 0 déjà présente, 2 à trancher')).toBeVisible();
  await expect(laptop.getByTestId('zone-open-main')).toHaveAttribute('href', 'http://localhost:3100');

  // PC principal : deux cartes (le conflit, et le combat suivant de la catégorie en attente), file de la zone en attente.
  await expect(page.getByTestId('zone-card-item')).toHaveCount(2);
  await expect(page.getByTestId('queue-held').first()).toBeVisible();
  // Le message d'attente, seul signe qu'un passage est bloqué, se lit en entier même sur un petit portable (rien ne sort de la carte).
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 1024, height: size.height });
  expect(await clipped(page)).toEqual([]);
  await page.setViewportSize(size);
  await page.getByTestId('zone-card-item').first().getByTestId('zone-keep-zone').click();
  await expect(page.getByTestId('zone-card-item')).toHaveCount(0);
  await expect(page.getByTestId('queue-held')).toHaveCount(0);
  // Les deux saisies de la zone sont là : la finale est le prochain combat.
  await expect(page.getByTestId('zone-card').first().getByTestId('next-match')).toHaveCount(1);
  await expect(page.getByTestId('zone-card').first().getByTestId('next-match')).toContainText('ZONE');

  await request.put(`${LAPTOP}/api/zone-link`, { data: null });
});
