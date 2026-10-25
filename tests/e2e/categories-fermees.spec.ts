import { expect, test, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

let n = 0;
async function register(page: Page, id: string, over: object = {}) {
  n++;
  const res = await page.request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, lastName: `FERME${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...over },
  });
  expect(res.status()).toBe(201);
}

test("grille : fermer une catégorie, avec confirmation s'il y a des inscrits", async ({ page }) => {
  const id = await createCompetition(page, 'Coupe fermée');
  await register(page, id);
  await page.goto(`/competitions/${id}/grille`);
  const cadet = page.getByTestId('open-cell-cadet|F|karate|jiyu');
  await expect(cadet).toBeChecked();
  await cadet.click();
  await expect(page.getByText('1 combattant déjà inscrit : il apparaîtra en Réaffectation.')).toBeVisible();
  await page.getByTestId('open-cells-confirm').click();
  await expect(cadet).not.toBeChecked();
  await page.reload();
  await expect(page.getByTestId('open-cell-cadet|F|karate|jiyu')).not.toBeChecked();
  const kata = page.getByTestId('open-cell-senior|F|kata|');
  await kata.click();
  await expect(page.getByTestId('open-cells-confirm')).toHaveCount(0);
  await expect(kata).not.toBeChecked();
  // Petit portable : le tableau défile au lieu d'être coupé.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.getByTestId('open-categories').scrollIntoViewIfNeeded();
  expect(await clipped(page)).toEqual([]);
});
