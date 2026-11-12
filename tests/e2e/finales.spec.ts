import { expect, test, type Page } from '@playwright/test';
import { clipped, createCompetition, openTab } from './helpers.js';

/** Ligne d'une catégorie dans l'onglet Finales. */
const row = (page: Page, label: string) => page.getByTestId('finals-row').filter({ hasText: label });
/** Choix « Où » ou « Quand » d'une ligne (bouton radio de l'interrupteur). */
const choice = (page: Page, label: string, column: 'where' | 'when', option: string) =>
  row(page, label).getByTestId(`finals-${column}`).getByRole('radio', { name: option, exact: true });
const pick = async (page: Page, label: string, column: 'where' | 'when', option: string) => {
  await row(page, label).getByTestId(`finals-${column}`).getByText(option, { exact: true }).click();
  await expect(choice(page, label, column, option)).toBeChecked();
};
const chooseFinalsZone = async (page: Page, name: string) => {
  await page.getByTestId('finals-zone').click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByTestId('finals-zone')).toHaveValue(name);
};

test('onglet Finales : zone des finales, choix par catégorie gardés, session figée puis rouverte et refigée en mélangés', async ({ page, request }) => {
  const id = await createCompetition(page, 'Finales onglet e2e');
  const base = `/api/competitions/${id}`;
  let n = 0;
  const reg = (discipline: 'karate' | 'kata', ageBandCode: string, weightClassId: string | null) =>
    request.post(`${base}/registrations`, {
      data: { clubId: null, lastName: `FIN${++n}`, firstName: 'Léa', sex: 'F', ageBandCode, discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId, source: 'manual' },
    });
  for (let k = 0; k < 4; k++) await reg('karate', 'cadet', 'cadet:F:-54');
  for (let k = 0; k < 4; k++) await reg('karate', 'cadet', 'cadet:F:-61');
  for (let k = 0; k < 3; k++) await reg('kata', 'cadet', null);
  for (let k = 0; k < 2; k++) await reg('karate', 'minime', 'minime:F:-45');
  const [z1, z2] = (await (await request.get(`${base}/zones`)).json()) as { id: string }[];
  await request.put(`${base}/zones`, { data: [{ id: z1!.id, name: 'Tatami 1' }, { id: z2!.id, name: 'Tatami 2' }, { name: 'Tatami 3' }] });
  const zones = (await (await request.get(`${base}/zones`)).json()) as { id: string; name: string }[];
  const zoneId = (name: string) => zones.find((z) => z.name === name)!.id;
  const [matin] = (await (await request.put(`${base}/waves`, {
    data: [{ name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } }, { name: 'Après-midi', rules: { ageBandCodes: ['minime'], disciplines: [] } }],
  })).json()) as { id: string }[];
  const cats = (await (await request.get(`${base}/categories`)).json()) as { id: string; label: string }[];
  const cat = (s: string) => cats.find((c) => c.label.includes(s))!;
  const [c54, c61, kata] = [cat('-54'), cat('-61'), cat('Kata')];
  for (const [c, z] of [[c54, 'Tatami 1'], [c61, 'Tatami 3'], [kata, 'Tatami 2']] as const) {
    expect((await request.patch(`${base}/categories/${c.id}`, { data: { zoneId: zoneId(z) } })).ok()).toBe(true);
  }

  // Réglages renvoie à l'onglet Finales, rangé dans « Préparer » juste après « Sessions ».
  await page.goto(`/competitions/${id}/reglages`);
  await expect(page.getByTestId('finals-tab-link')).toHaveText('Les finales se règlent session par session dans l’onglet Finales.');
  const tabs = await page.getByRole('tab').allTextContents();
  expect(tabs.indexOf('Finales')).toBe(tabs.indexOf('Sessions') + 1);
  await openTab(page, 'Finales');
  await page.getByTestId('finals-wave').getByText('Matin', { exact: true }).click();
  await expect(page.getByTestId('finals-row')).toHaveCount(3);

  // Une zone des finales met toutes les catégories de la session sur elle.
  await chooseFinalsZone(page, 'Tatami 3');
  await expect(choice(page, c54.label, 'where', 'Tatami 3')).toBeChecked();
  await expect(choice(page, kata.label, 'where', 'Tatami 3')).toBeChecked();
  // La catégorie de Tatami 3 n'a pas de choix « Où ».
  await expect(row(page, c61.label)).toContainText('sur Tatami 3');
  await expect(row(page, c61.label).getByTestId('finals-where')).toHaveCount(0);
  await expect(row(page, kata.label)).toContainText('finale = tour 2');

  await page.getByRole('button', { name: 'Tout sur sa zone' }).click();
  await expect(choice(page, c54.label, 'where', 'Sa zone')).toBeChecked();
  await expect(choice(page, kata.label, 'where', 'Sa zone')).toBeChecked();
  await pick(page, c54.label, 'where', 'Tatami 3');
  await page.getByRole('button', { name: 'Tout dès que finie' }).click();
  for (const c of [c54, c61, kata]) await expect(choice(page, c.label, 'when', 'Dès que finie')).toBeChecked();
  await expect(page.getByTestId('finals-summary')).toContainText('Tatami 3 :');

  // Rechargé : les choix sont gardés.
  await page.reload();
  await expect(page.getByTestId('finals-zone')).toHaveValue('Tatami 3');
  await expect(choice(page, c54.label, 'where', 'Tatami 3')).toBeChecked();
  await expect(choice(page, kata.label, 'where', 'Sa zone')).toBeChecked();
  for (const c of [c54, c61, kata]) await expect(choice(page, c.label, 'when', 'Dès que finie')).toBeChecked();

  // Téléphone : rien ne déborde ni n'est coupé (le tableau défile dans sa carte).
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId('finals-row').first()).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 800 });

  // « Aucune » : plus de colonne « Où ».
  await chooseFinalsZone(page, 'Aucune');
  await expect(page.getByTestId('finals-where')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Où' })).toHaveCount(0);
  await expect(page.getByText('« Aucune » : chaque finale reste sur la zone de sa catégorie.')).toBeVisible();
  await chooseFinalsZone(page, 'Tatami 3');

  // Session figée : lecture seule.
  for (const c of [c54, c61, kata]) await request.patch(`${base}/categories/${c.id}`, { data: { status: 'ready' } });
  expect((await request.post(`${base}/launch`, { data: { waveId: matin!.id } })).status()).toBe(204);
  await page.reload();
  await expect(page.getByText('Rouvrez la session dans Combats pour changer.')).toBeVisible();
  await expect(choice(page, c54.label, 'when', 'Fin de session')).toBeDisabled();
  await expect(page.getByTestId('finals-zone')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tout dès que finie' })).toBeDisabled();

  // Rouverte puis changée : refiger renumérote en « mélangés », imposé.
  expect((await request.post(`${base}/launch/reopen`, { data: { waveId: matin!.id } })).status()).toBe(204);
  await page.reload();
  await expect(page.getByText('Rouvrez la session dans Combats pour changer.')).toHaveCount(0);
  await pick(page, c54.label, 'when', 'Fin de session');
  await page.goto(`/competitions/${id}/combats?session=${matin!.id}`);
  await expect(page.getByTestId('wave-state')).toHaveText('Rouverte');
  await page.getByTestId('refreeze-open').click();
  const dialog = page.getByRole('dialog', { name: 'Refiger la session' });
  await expect(dialog.getByRole('radio', { name: 'Mélangés' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'À la suite' })).toBeDisabled();
  await expect(dialog).toContainText('Les finales ont changé : les zones concernées sont renumérotées (mélangés).');
  // Seules les zones refaites sont nommées : celle de la catégorie et la zone des finales (pas Tatami 2, celle du kata).
  await expect(dialog.getByTestId('number-finals')).toContainText('Zones renumérotées : Tatami 1, Tatami 3.');
  await expect(dialog.getByTestId('number-preview')).toContainText(c54.label);
  await dialog.getByTestId('number-confirm').click();
  await expect(page.getByTestId('wave-state')).toHaveText('Lancée');
});
