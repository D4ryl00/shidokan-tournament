import { expect, test, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

const zoneRow = (page: Page, name: string) => page.getByTestId('zone-row').filter({ has: page.locator(`input[value="${name}"]`) });
const toggle = async (page: Page, zone: string, discipline: string) => zoneRow(page, zone).getByRole('checkbox', { name: discipline, exact: true }).click();

test('ordre de passage : zones par discipline, kata d’abord, numéros imprimés, mode, contrainte impossible, épinglage', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe ordre de passage');
  let i = 0;
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    });
  for (let k = 0; k < 3; k++) await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  for (let k = 0; k < 4; k++) await reg({});
  for (let k = 0; k < 2; k++) await reg({ discipline: 'shido-boxing', ageBandCode: 'senior', weightClassId: 'senior:F:-55' });
  const [t1, t2] = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  await request.put(`/api/competitions/${id}/zones`, { data: [{ id: t1!.id, name: 'Tatami 1' }, { id: t2!.id, name: 'Ring' }] });
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const cadettes = cats.find((c) => c.label.includes('Cadets') && !c.label.startsWith('Kata'))!;

  // Réglages : le Ring n'accueille que le shido-boxing, le Tatami 1 tout le reste.
  await page.goto(`/competitions/${id}/reglages`);
  for (const d of ['Karaté', 'Shido-mix-martial', 'Triathlon', 'Kata']) await toggle(page, 'Ring', d);
  await toggle(page, 'Tatami 1', 'Shido-boxing');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();

  // Combats : Tatami 1 commence par le kata (n° 1), puis les combats à partir de 2 ; la boxe sur le Ring.
  await page.getByRole('tab', { name: 'Combats' }).click();
  const tatami = page.getByTestId('zone-card').filter({ hasText: 'Tatami 1' });
  await expect(tatami.getByTestId('next-kata')).toContainText('n° 1 — Kata');
  await expect(tatami.getByTestId('next-kata')).toContainText('3 katakas');
  await expect(tatami.getByTestId('next-match').first()).toContainText('combat 2');
  await expect(page.getByTestId('zone-card').filter({ hasText: 'Ring' }).getByTestId('next-match')).toContainText('combat 1');
  await expect(page.getByTestId('schedule-category').filter({ hasText: cadettes.label }).getByTestId('schedule-zone')).toHaveValue('Automatique (Tatami 1)');

  // Impression des cadettes : zone et numéros de passage.
  await page.goto(`/competitions/${id}/impression?categories=${cadettes.id}`);
  await expect(page.getByTestId('print-section')).toContainText('Zone : Tatami 1');
  await expect(page.getByTestId('print-section')).toContainText('Combat 2');

  // Catégorie par catégorie : enregistré sans erreur, la file reste cohérente.
  await page.goto(`/competitions/${id}/reglages`);
  await page.getByTestId('passage-order').click();
  await page.getByRole('option', { name: 'Catégorie par catégorie' }).click();
  // Boxe acceptée nulle part : signalée.
  await toggle(page, 'Ring', 'Karaté');
  await toggle(page, 'Ring', 'Shido-boxing');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();
  await expect(page.getByTestId('zones-impossible')).toContainText('Aucune zone n’accepte : Shido-boxing (1 catégorie)');
  await page.getByRole('tab', { name: 'Combats' }).click();
  await expect(page.getByTestId('zones-impossible')).toBeVisible();
  await expect(tatami.getByTestId('next-match').first()).toContainText('combat 2');

  // Épingler les cadettes sur le Ring.
  const card = page.getByTestId('schedule-category').filter({ hasText: cadettes.label });
  await card.getByTestId('schedule-zone').click();
  await page.getByRole('option', { name: 'Ring', exact: true }).click();
  await expect(card.getByTestId('schedule-zone')).toHaveValue('Ring');
  await expect(page.getByTestId('zone-card').filter({ hasText: 'Ring' }).getByTestId('next-match').first()).toContainText('combat 1');
});
