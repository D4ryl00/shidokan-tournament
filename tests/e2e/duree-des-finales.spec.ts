import { expect, test } from '@playwright/test';
import { createCompetition } from './helpers.js';

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

  // Retour à « Comme les autres combats ».
  await page.getByTestId('durations-finals-adults').click();
  await page.getByRole('option', { name: 'Comme les autres combats' }).click();
  await expect(page.getByTestId('durations-finals-fields-adults')).toHaveCount(0);
  const saved2 = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/competitions/${id}`) && r.ok());
  await page.getByTestId('settings-save').click();
  await saved2;
  body = await (await request.get(`/api/competitions/${id}`)).json();
  expect(body.settings.schedule.finals.adults).toBeNull();
});
