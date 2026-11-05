import { expect, test } from '@playwright/test';
import { clipped, createClubLink, createCompetition, SERVER_SESSION } from './helpers.js';

// Écrans des mails et inscriptions en ligne : serveur en ligne seulement (port 3101), avec la session de l'organisateur.
test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

test('téléphone (320 px) : l’état des inscriptions d’un club se lit en entier', async ({ page, browser }) => {
  const club = `Dojo étroit ${Date.now()}`;
  await page.goto('/');
  await page.getByTestId('nav-directory').click();
  await page.getByTestId('directory-new').click();
  await page.getByTestId('directory-name').fill(club);
  await page.getByTestId('directory-save').click();
  const id = await createCompetition(page, 'Coupe étroite');
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('invite-select').click();
  await page.getByTestId('invite-select').fill(club);
  await page.getByRole('option', { name: club }).click();
  await page.getByTestId('invite-clubs').click();
  await expect(page.getByTestId('invitation-row').filter({ hasText: club })).toContainText('0 lien');
  const url = await createClubLink(page, club);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(url);
  await expect(page.getByTestId('club-entry-state')).toHaveText('Inscriptions closes : contactez l’organisateur.');
  expect(await clipped(page)).toEqual([]);
  // Ni la page ne défile de côté, ni l'état ne sort de l'écran.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect((await page.getByTestId('club-entry-state').boundingBox())!.width).toBeLessThanOrEqual(320 - 32);
});
