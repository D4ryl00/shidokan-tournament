import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  let i = 0;
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
    });
  for (let k = 0; k < 2; k++) await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  for (let k = 0; k < 2; k++) await reg({ ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
  for (let k = 0; k < 2; k++) await reg({ ageBandCode: 'senior', weightClassId: 'senior:F:-55' });
}

const card = (page: Page, name: string) => page.getByTestId('wave-card').filter({ has: page.locator(`input[value="${name}"]`) });

async function addWave(page: Page, name: string, bands: string[]) {
  await page.getByTestId('wave-add').click();
  const c = page.getByTestId('wave-card').last();
  await c.getByTestId('wave-name').fill(name);
  for (const b of bands) await c.getByText(b, { exact: true }).click();
}

test('vagues : règles, retrait, ajout à la main, conflit, suppression', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe vagues');
  await seed(request, id);
  await page.goto(`/competitions/${id}/vagues`);
  await expect(page.getByTestId('waves-none')).toBeVisible();
  await addWave(page, 'Matin', ['Poussins', 'Pupilles', 'Benjamins', 'Minimes']);
  await addWave(page, 'Après-midi', ['Cadets', 'Juniors', 'Seniors']);
  await page.getByTestId('wave-save').click();
  await expect(page.getByText('Vagues enregistrées')).toBeVisible();
  await expect(card(page, 'Matin').getByTestId('wave-category')).toHaveText([/Minimes F/]);
  await expect(card(page, 'Après-midi').getByTestId('wave-category')).toHaveCount(2);

  // Retirer : la catégorie passe en attente ; « Ajouter à… » la place à la main dans une autre vague
  await card(page, 'Matin').getByTestId('wave-category').filter({ hasText: 'Minimes F' }).getByRole('button', { name: 'Retirer' }).click();
  const waiting = page.getByTestId('waves-waiting');
  await expect(waiting.getByTestId('waiting-category')).toHaveText([/Minimes F/]);
  await waiting.getByTestId('waiting-category').filter({ hasText: 'Minimes F' }).getByRole('combobox').selectOption({ label: 'Après-midi' });
  await expect(card(page, 'Après-midi').getByTestId('wave-category').filter({ hasText: 'Minimes F' })).toContainText('ajoutée à la main');

  // Conflit : Cadets cochés dans les deux vagues
  await card(page, 'Matin').getByText('Cadets', { exact: true }).click();
  await expect(page.getByTestId('waves-conflicts')).toContainText('Cadets F');
  await expect(page.getByTestId('waves-conflicts')).toContainText('placée dans Matin');
  await card(page, 'Matin').getByText('Cadets', { exact: true }).click();

  // Supprimer « Après-midi » : confirmation ; ses catégories retombent sur les règles
  await card(page, 'Après-midi').getByRole('button', { name: 'Supprimer la vague « Après-midi »' }).click();
  await expect(page.getByTestId('wave-delete-confirm')).toContainText('3 catégories');
  await page.getByTestId('wave-delete-go').click();
  await page.getByTestId('wave-save').click();
  await expect(page.getByText('Vagues enregistrées')).toBeVisible();
  await expect(card(page, 'Matin').getByTestId('wave-category')).toHaveText([/Minimes F/]);
  await expect(waiting.getByTestId('waiting-category')).toHaveCount(2);
});
