import { expect, test, type Page } from '@playwright/test';
import { createCompetition, openTab } from './helpers.js';

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
  await openTab(page, 'Combats');
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
  // Sans zone possible : pas de numéro de passage, numérotation propre à la catégorie (« c1 »).
  const box = cats.find((c) => c.label.includes('Shido-boxing'))!;
  await page.goto(`/competitions/${id}/impression?categories=${box.id}`);
  await expect(page.getByTestId('print-section')).toContainText('Combat c1');
  await page.goto(`/competitions/${id}/combats`);
  await expect(page.getByTestId('zones-impossible')).toBeVisible();
  await expect(tatami.getByTestId('next-match').first()).toContainText('combat 2');

  // Épingler les cadettes sur le Ring.
  const card = page.getByTestId('schedule-category').filter({ hasText: cadettes.label });
  await card.getByTestId('schedule-zone').click();
  await page.getByRole('option', { name: 'Ring', exact: true }).click();
  await expect(card.getByTestId('schedule-zone')).toHaveValue('Ring');
  await expect(page.getByTestId('zone-card').filter({ hasText: 'Ring' }).getByTestId('next-match').first()).toContainText('combat 1');
});

test('ordre de passage (relecture) : session par défaut = la première qui a encore des combats, catégories de la session seulement', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe ordre sessions');
  let i = 0;
  const reg = async (ageBandCode: string, weightClassId: string) =>
    (await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', ageBandCode, discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    })).json()).row as { fighterId: string };
  for (let k = 0; k < 2; k++) await reg('minime', 'minime:F:-45');
  const cadets = [await reg('cadet', 'cadet:F:-54'), await reg('cadet', 'cadet:F:-54')];
  const [matin, aprem] = (await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] })).json()) as { id: string }[];
  // La pesée de l'après-midi est close alors que le matin combat encore.
  for (const c of cadets) await request.put(`/api/competitions/${id}/weigh-in/${c.fighterId}`, { data: { presence: 'present', waveId: aprem!.id } });
  await request.post(`/api/competitions/${id}/weigh-in/close`, { data: { waveId: aprem!.id } });
  await page.goto(`/competitions/${id}/combats`);
  await expect(page.getByTestId('matches-wave').locator(`input[value="${matin!.id}"]`)).toBeChecked();
  await expect(page.getByTestId('schedule-category')).toHaveText([/Minimes/]);
  // Le matin terminé : l'après-midi devient la vague par défaut.
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const minimes = cats.find((c) => c.label.includes('Minimes'))!;
  await request.put(`/api/competitions/${id}/categories/${minimes.id}/results/w1-0`, { data: { winner: 'a', method: 'points' } });
  await page.goto(`/competitions/${id}/combats`);
  await expect(page.getByTestId('matches-wave').locator(`input[value="${aprem!.id}"]`)).toBeChecked();
  await expect(page.getByTestId('schedule-category')).toHaveText([/Cadets/]);
});
