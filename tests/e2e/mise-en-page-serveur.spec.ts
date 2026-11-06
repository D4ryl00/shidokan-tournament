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

test('barre du haut de l’application : rien ne se chevauche sur un téléphone, les pages dans le menu ; liens en ligne sur un écran large', async ({ page }) => {
  const header = page.locator('header');
  // Boîtes des éléments visibles de la barre : logo et nom, liens, menu, thème, compte.
  const boxes = () => header.locator('a, button').evaluateAll((els) => els
    .filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && r.width > 0 && r.height > 0; })
    .map((el) => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label') ?? el.textContent!.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
  const overlaps = (list: Awaited<ReturnType<typeof boxes>>) =>
    list.flatMap((a, i) => list.slice(i + 1).filter((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1).map((b) => `${a.name} / ${b.name}`));

  for (const width of [320, 390, 600, 800]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/annuaire');
    await expect(page.getByTestId('app-menu')).toBeVisible();
    const list = await boxes();
    expect(overlaps(list), `${width} px`).toEqual([]);
    expect(Math.max(...list.map((b) => b.right)), `${width} px`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
  // Les pages de l'application dans le menu.
  await page.getByTestId('app-menu').click();
  await expect(page.getByRole('menuitem')).toHaveText(['Compétitions', 'Annuaire', 'Réglages', 'Comptes']);
  await page.getByRole('menuitem', { name: 'Réglages' }).click();
  await expect(page).toHaveURL(/\/parametres$/);

  for (const width of [992, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/annuaire');
    await expect(page.getByTestId('app-menu')).toBeHidden();
    for (const id of ['nav-competitions', 'nav-directory', 'nav-settings', 'nav-accounts']) await expect(page.getByTestId(id)).toBeVisible();
    const list = await boxes();
    expect(overlaps(list), `${width} px`).toEqual([]);
    expect(Math.max(...list.map((b) => b.right)), `${width} px`).toBeLessThanOrEqual(width);
  }
});
