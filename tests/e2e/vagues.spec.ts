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

test('pesée par vague : présence indépendante, clôture limitée à la vague, feuilles de la vague', async ({ page, request, context }) => {
  const id = await createCompetition(page, 'Coupe pesée vagues');
  const reg = (lastName: string, discipline: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId: discipline === 'kata' ? null : 'cadet:F:-54', source: 'manual' },
    });
  await reg('DEUX', 'karate');
  await reg('DEUX', 'kata');
  await reg('KATA', 'kata');
  await reg('COMBAT', 'karate');
  await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Kata', rules: { ageBandCodes: [], disciplines: ['kata'] } },
    { name: 'Combats', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] });
  await page.goto(`/competitions/${id}/pesee`);
  const row = (name: string) => page.getByTestId('weighin-row').filter({ hasText: name });
  await page.getByTestId('weighin-wave').getByText('Kata', { exact: true }).click(); // vague par défaut : la première
  await expect(page.getByTestId('weighin-row')).toHaveCount(2);
  await row('DEUX').getByTestId('weighin-presence').getByText('Présent').click();
  await page.getByTestId('weighin-wave').getByText('Combats', { exact: true }).click();
  await expect(page).toHaveURL(/vague=/);
  await expect(page.getByTestId('weighin-row')).toHaveCount(2);
  await row('DEUX').getByTestId('weighin-presence').getByText('Absent').click();
  await expect(row('DEUX').getByTestId('weighin-presence').locator('input[value="absent"]')).toBeChecked();
  await page.getByTestId('weighin-wave').getByText('Kata', { exact: true }).click();
  await expect(row('DEUX').getByTestId('weighin-presence').locator('input[value="present"]')).toBeChecked();
  // Clôture de la vague Kata : seul KATA (non pesé) devient absent
  await page.getByTestId('weighin-close').click();
  await page.getByTestId('weighin-close-confirm').click();
  await expect(page.getByText('1 combattant(s) marqué(s) absent(s).')).toBeVisible();
  await expect(page.getByText('Pesée clôturée')).toBeVisible();
  await page.getByTestId('weighin-wave').getByText('Combats', { exact: true }).click();
  await expect(page.getByText('Pesée clôturée')).toHaveCount(0);
  await expect(row('COMBAT').getByTestId('weighin-presence').locator('input[value="unknown"]')).toBeChecked();
  // Feuilles de pesée de la vague Combats : ses combattants seulement
  const [sheet] = await Promise.all([context.waitForEvent('page'), page.getByTestId('weighin-sheets-club').click()]);
  await expect(sheet.getByTestId('weighin-sheet')).toContainText('COMBAT');
  await expect(sheet.getByTestId('weighin-sheet').filter({ hasText: 'KATA ' })).toHaveCount(0);
});

test('vagues (mineurs) : vague par défaut non clôturée, feuilles sans vague ou périmée, écran Vagues non enregistré', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe vagues mineurs');
  const reg = (lastName: string, discipline: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId: discipline === 'kata' ? null : 'cadet:F:-54', source: 'manual' },
    });
  await reg('KATAONLY', 'kata');
  await reg('COMBAT', 'karate');
  const [kata, combat] = (await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Kata', rules: { ageBandCodes: [], disciplines: ['kata'] } },
    { name: 'Combats', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] })).json()) as { id: string }[];
  await request.post(`/api/competitions/${id}/weigh-in/close`, { data: { waveId: kata!.id } });
  // Pesée : vague proposée = la première non clôturée, écrite dans l'adresse
  await page.goto(`/competitions/${id}/pesee`);
  await expect(page).toHaveURL(new RegExp(`vague=${combat!.id}`));
  await expect(page.getByTestId('weighin-wave').locator(`input[value="${combat!.id}"]`)).toBeChecked();
  // Feuilles : sans vague ou vague périmée → même repli
  for (const q of ['', '?vague=perimee']) {
    await page.goto(`/competitions/${id}/impression/pesee${q}`);
    await expect(page.getByTestId('weighin-sheet').first()).toContainText('COMBAT');
    await expect(page.getByText('KATAONLY')).toHaveCount(0);
  }
  // Écran Vagues : modifications non enregistrées signalées et protégées
  await page.goto(`/competitions/${id}/vagues`);
  await expect(page.getByTestId('waves-unsaved')).toHaveCount(0);
  await page.getByTestId('wave-name').first().fill('Kata du matin');
  await expect(page.getByTestId('waves-unsaved')).toBeVisible();
  await page.getByRole('tab', { name: 'Pesée' }).click();
  await expect(page.getByTestId('leave-confirm')).toBeVisible();
  await page.getByTestId('leave-stay').click();
  await page.getByTestId('wave-save').click();
  await expect(page.getByTestId('waves-unsaved')).toHaveCount(0);
});
