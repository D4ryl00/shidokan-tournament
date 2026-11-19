import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCompetition, openTab } from './helpers.js';

/** Deux clubs : Dojo Alpha (ZORO, MARC) et Dojo Zeta (ABEL) ; ABEL a donné 38,5 kg, MARC fait du kata. */
async function seed(request: APIRequestContext, id: string) {
  const club = async (name: string) => ((await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()) as { id: string }).id;
  const alpha = await club('Dojo Alpha');
  const zeta = await club('Dojo Zeta');
  const reg = async (clubId: string, lastName: string, extra: object) => {
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId, lastName, firstName: 'Lou', sex: 'M', ageBandCode: 'cadet', source: 'manual', ...extra },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  await reg(alpha, 'ZORO', { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:M:-63' });
  await reg(alpha, 'MARC', { discipline: 'kata', ruleset: null, weightClassId: null });
  await reg(zeta, 'ABEL', { ageBandCode: 'senior', discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:M:-75', approxWeightKg: 38.5 });
}

test('pesée : ordre Club avec en-têtes ou Nom, règlement et poids déclaré, Entrée suit l’ordre affiché', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe ordre des pesees');
  await seed(request, id);
  await page.goto(`/competitions/${id}/pesee`);
  await page.evaluate(() => localStorage.removeItem('pesee-ordre'));
  await page.reload();

  const rows = page.getByTestId('weighin-row');
  const headers = page.getByTestId('weighin-club-header');
  // Club par défaut : un en-tête par club, nombre de combattants, puis les combattants de chaque club par nom.
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(0)).toContainText('Dojo Alpha');
  await expect(headers.nth(0)).toContainText('2 combattants');
  await expect(headers.nth(1)).toContainText('Dojo Zeta');
  await expect(headers.nth(1)).toContainText('1 combattant');
  await expect(rows.nth(0)).toContainText('MARC');
  await expect(rows.nth(1)).toContainText('ZORO');
  await expect(rows.nth(2)).toContainText('ABEL');

  // Règlement et poids déclaré, seulement pour les combats.
  await expect(rows.nth(2)).toContainText('Shobu');
  await expect(rows.nth(2)).toContainText('déclaré 38,5 kg');
  await expect(rows.nth(1)).toContainText('Jiyu');
  await expect(rows.nth(1)).not.toContainText('déclaré');
  await expect(rows.nth(0)).not.toContainText('Jiyu');

  // Entrée : champ suivant dans l'ordre affiché (MARC est du kata, sans champ : ZORO puis ABEL).
  const weights = page.getByTestId('weighin-weight');
  await weights.nth(0).fill('60');
  await weights.nth(0).press('Enter');
  await expect(weights.nth(1)).toBeFocused();

  // Ordre Nom : plus d'en-têtes, tri par nom, choix gardé après rechargement.
  await page.getByTestId('weighin-order').getByText('Nom', { exact: true }).click();
  await expect(headers).toHaveCount(0);
  await expect(rows.nth(0)).toContainText('ABEL');
  await expect(rows.nth(1)).toContainText('MARC');
  await expect(rows.nth(2)).toContainText('ZORO');
  await page.reload();
  await expect(headers).toHaveCount(0);
  await expect(rows.nth(0)).toContainText('ABEL');
  // Entrée suit l'ordre Nom : ABEL puis ZORO.
  await weights.nth(0).fill('61');
  await weights.nth(0).press('Enter');
  await expect(weights.nth(1)).toBeFocused();
  await expect(weights.nth(1).locator('xpath=ancestor::tr')).toContainText('ZORO');
  await page.getByTestId('weighin-order').getByText('Club', { exact: true }).click();
  await expect(headers).toHaveCount(2);
});
