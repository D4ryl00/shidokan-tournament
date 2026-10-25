import { expect, test } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

test('petit portable (1024 px) : inscriptions et pesée aux noms longs entièrement visibles (défilement si besoin)', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe mise en page');
  const club = (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Arts Martiaux du Cap (démo)' } })).json()) as { id: string };
  for (const [lastName, firstName] of [['DE LA FONTAINE-MARTIN', 'Marie-Charlotte'], ['BERNARD', 'Léa']]) {
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: club.id, lastName, firstName, sex: 'F', ageBandCode: 'senior', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-61', source: 'onsite' },
    });
    expect(res.status()).toBe(201);
  }
  await page.setViewportSize({ width: 1024, height: 800 });
  for (const tab of ['inscriptions', 'pesee']) {
    await page.goto(`/competitions/${id}/${tab}`);
    await expect(page.getByText('DE LA FONTAINE-MARTIN').first()).toBeVisible();
    expect(await clipped(page), tab).toEqual([]);
  }
});

test('téléphone (320 px) : l’état des inscriptions d’un club se lit en entier', async ({ page }) => {
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
  const url = (await page.getByTestId('invitation-url').textContent())!;
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(url);
  await expect(page.getByTestId('club-entry-state')).toHaveText('Inscriptions closes : contactez l’organisateur.');
  expect(await clipped(page)).toEqual([]);
  // Ni la page ne défile de côté, ni l'état ne sort de l'écran.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect((await page.getByTestId('club-entry-state').boundingBox())!.width).toBeLessThanOrEqual(320 - 32);
});

test('Combats : « Noter » amène le panneau de la catégorie à l’écran', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe défilement');
  const club = (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Dojo' } })).json()) as { id: string };
  const add = async (data: object) => expect((await request.post(`/api/competitions/${id}/registrations`, { data: { clubId: club.id, sex: 'F', ageBandCode: 'senior', source: 'onsite', ...data } })).status()).toBe(201);
  for (const n of ['A', 'B']) await add({ lastName: `KATA${n}`, firstName: 'K', discipline: 'kata', ruleset: null, weightClassId: null, grade: '1er dan' });
  for (const n of 'CDEFGHIJ') await add({ lastName: `COMBAT${n}`, firstName: 'C', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-61' });
  await page.goto(`/competitions/${id}/combats`);
  await page.getByRole('button', { name: 'Noter', exact: true }).first().click();
  await expect(page.getByTestId('selected-category')).toBeInViewport();
});
