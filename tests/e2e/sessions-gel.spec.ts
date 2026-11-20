import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCompetition } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, lastName: 'NOM', firstName: 'Léa', sex: 'F', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ageBandCode: 'minime', weightClassId: 'minime:F:-45' },
  });
  const res = await request.put(`/api/competitions/${id}/waves`, {
    data: { waves: [{ name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } }], knownIds: [] },
  });
  expect(res.ok()).toBe(true);
}

test('figer puis ne plus figer', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe gel');
  await page.goto(`/competitions/${id}/sessions`);
  await expect(page.getByTestId('waves-none')).toBeVisible();
  await expect(page.getByTestId('sessions-freeze')).toHaveCount(0); // sans session : masqué
  await seed(request, id);
  await page.goto(`/competitions/${id}/sessions`);

  await page.getByTestId('sessions-freeze').click();
  await expect(page.getByTestId('sessions-freeze-confirm')).toContainText(
    'Chaque catégorie garde sa session actuelle. Les nouvelles inscriptions et les recasements ne la changeront plus. Vous pourrez toujours changer une catégorie de session à la main.',
  );
  await page.getByTestId('sessions-freeze-go').click();
  await expect(page.getByTestId('sessions-frozen-at')).toContainText('Sessions figées le');
  await expect(page.getByTestId('sessions-freeze')).toHaveCount(0);

  await page.getByTestId('sessions-unfreeze').click();
  await expect(page.getByTestId('sessions-unfreeze-confirm')).toContainText(
    'Les catégories reprennent la session de la majorité de leurs combattants ; certaines peuvent changer de session.',
  );
  await page.getByTestId('sessions-unfreeze-go').click();
  await expect(page.getByTestId('sessions-freeze')).toBeVisible();
  await expect(page.getByTestId('sessions-frozen-at')).toHaveCount(0);
});

test('figé sans aucune session : « Ne plus figer » reste possible', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe gel vide');
  await seed(request, id);
  expect((await request.post(`/api/competitions/${id}/waves/freeze`)).ok()).toBe(true);
  const waves = (await (await request.get(`/api/competitions/${id}/waves`)).json()) as { id: string }[];
  const del = await request.put(`/api/competitions/${id}/waves`, { data: { waves: [], knownIds: waves.map((w) => w.id) } });
  expect(del.ok()).toBe(true);
  await page.goto(`/competitions/${id}/sessions`);
  await expect(page.getByTestId('sessions-frozen-at')).toContainText('Sessions figées le');
  await expect(page.getByTestId('sessions-freeze')).toHaveCount(0);
  await page.getByTestId('sessions-unfreeze').click();
  await page.getByTestId('sessions-unfreeze-go').click();
  await expect(page.getByTestId('sessions-frozen-at')).toHaveCount(0);
});

test('échec du figeage : l’erreur s’affiche dans la fenêtre, qui reste ouverte', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe gel erreur');
  await seed(request, id);
  await page.goto(`/competitions/${id}/sessions`);
  await page.route(`**/api/competitions/${id}/waves/freeze`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Sessions déjà figées' }) }));
  await page.getByTestId('sessions-freeze').click();
  await page.getByTestId('sessions-freeze-go').click();
  await expect(page.getByTestId('sessions-freeze-confirm')).toContainText('Sessions déjà figées');
  await expect(page.getByTestId('sessions-freeze-go')).toBeVisible();
});
