import { expect, test, type APIRequestContext } from '@playwright/test';
import { clipped, createCompetition, showList } from './helpers.js';

test('réglages : finale des 18 ans et plus en 3 rounds', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe durée finales');
  const url = `/competitions/${id}/reglages#durees`;
  await page.goto(url);

  const select = page.getByTestId('durations-finals-adults');
  await select.click();
  await page.getByRole('option', { name: 'Autre', exact: true }).click();
  const fields = page.getByTestId('durations-finals-fields-adults');
  await expect(fields).toBeVisible();
  await fields.getByLabel('Rounds').fill('3');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/competitions/${id}`) && r.ok());
  await page.getByTestId('settings-save').click();
  await saved;

  await page.reload();
  await expect(page.getByTestId('durations-finals-adults')).toHaveValue('Autre');
  await expect(page.getByTestId('durations-finals-fields-adults').getByLabel('Rounds')).toHaveValue('3');
  let body = await (await request.get(`/api/competitions/${id}`)).json();
  expect(body.settings.schedule.finals.adults.rounds).toBe(3);
  expect(body.settings.schedule.finals.youth).toBeNull();

  // Valeur illisible : « Enregistrer » attend.
  const round = page.getByTestId('durations-finals-fields-adults').getByLabel('Round', { exact: true });
  await round.fill('1:5');
  await expect(page.getByTestId('settings-invalid')).toBeVisible();
  await expect(page.getByTestId('settings-save')).toBeDisabled();
  await round.fill('1:30');
  await expect(page.getByTestId('settings-invalid')).toHaveCount(0);

  // Valeur illisible laissée dans la ligne, puis retour à « Comme les autres combats » : l'enregistrement redevient possible.
  await round.fill('1:5');
  await expect(page.getByTestId('settings-save')).toBeDisabled();
  await page.getByTestId('durations-finals-adults').click();
  await page.getByRole('option', { name: 'Comme les autres combats' }).click();
  await expect(page.getByTestId('durations-finals-fields-adults')).toHaveCount(0);
  await expect(page.getByTestId('settings-invalid')).toHaveCount(0);
  await expect(page.getByTestId('settings-save')).toBeEnabled();
  const saved2 = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/competitions/${id}`) && r.ok());
  await page.getByTestId('settings-save').click();
  await saved2;
  body = await (await request.get(`/api/competitions/${id}`)).json();
  expect(body.settings.schedule.finals.adults).toBeNull();
});

async function seedCadettes(request: APIRequestContext, id: string) {
  const club = async (name: string) => (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()).id as string;
  const clubs = [await club('Tani Dojo'), await club('Issa')];
  for (const [i, lastName] of ['AAA', 'BBB', 'CCC', 'DDD'].entries()) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', clubId: clubs[i % 2], lastName },
    });
  }
}

async function setYouthFinals(request: APIRequestContext, id: string) {
  const comp = await (await request.get(`/api/competitions/${id}`)).json();
  const settings = comp.settings;
  settings.schedule.finals.youth = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 60 };
  expect((await request.patch(`/api/competitions/${id}`, { data: { settings } })).ok()).toBe(true);
}

const categoryOf = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/competitions/${id}/categories`)).json()).find((c: { label?: string; durations: unknown }) => JSON.stringify(c).includes('-54'));

test('tableaux : finale propre au tableau, reprise de la compétition', async ({ page, request }) => {
  const id = await createCompetition(page, 'Tournoi finale tableau');
  await seedCadettes(request, id);
  await setYouthFinals(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await page.getByTestId('category-row').filter({ hasText: '-54' }).click();

  const mode = page.getByTestId('durations-mode');
  await expect(mode).toHaveValue(/finale 3 × 2 min/);
  await mode.click();
  await page.getByRole('option', { name: 'Autre', exact: true }).click();
  await expect(page.getByTestId('durations-own-finals')).toHaveValue('Autre');
  await expect(page.getByTestId('durations-own-finals-fields').getByLabel('Rounds')).toHaveValue('3');

  const own = page.getByTestId('durations-own');
  await own.getByLabel('Rounds').fill('1');
  await own.getByLabel('Prolongation').fill('0:30');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/categories/') && r.ok());
  await page.getByTestId('durations-save').click();
  await saved;

  const cat = await categoryOf(request, id);
  expect(cat.durations.bracket).toMatchObject({ rounds: 1, overtimeSec: 30 });
  expect(cat.durations.finals).toEqual({ rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 60 });
  expect(cat.durations.matches).toEqual({});

  const back = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/categories/') && r.ok());
  await page.getByTestId('durations-mode').click();
  await page.getByRole('option', { name: /^Comme la compétition/ }).click();
  await back;
  expect((await categoryOf(request, id)).durations).toBeNull();
});

test('tableaux : une exception sur la finale reprend la finale de la compétition', async ({ page, request }) => {
  const id = await createCompetition(page, 'Tournoi exception finale');
  await seedCadettes(request, id);
  await setYouthFinals(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await page.getByTestId('category-row').filter({ hasText: '-54' }).click();
  await page.getByTestId('exception-match').click();
  await page.getByRole('option', { name: /Finale/ }).first().click();
  await expect(page.getByTestId('exception-timing').getByLabel('Rounds')).toHaveValue('3');
  await expect(page.getByTestId('exception-timing').getByLabel('Prolongation')).toHaveValue('1:00');
});

test('tableaux : le bloc de durée tient à 360 px', async ({ page, request }) => {
  const id = await createCompetition(page, 'Tournoi durée étroite');
  await seedCadettes(request, id);
  await setYouthFinals(request, id);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await page.getByTestId('category-row').filter({ hasText: '-54' }).click();
  await page.getByTestId('durations-mode').click();
  await page.getByRole('option', { name: 'Autre', exact: true }).click();
  await expect(page.getByTestId('durations-own-finals-fields')).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  // Et dans l'état « comme la compétition », avec la finale de la compétition dans le libellé.
  await page.getByTestId('durations-mode').click();
  await page.getByRole('option', { name: /^Comme la compétition/ }).click();
  await expect(page.getByTestId('durations-mode')).toHaveValue(/finale 3 × 2 min/);
  expect(await clipped(page)).toEqual([]);
});
