import { expect, test } from '@playwright/test';
import { createCompetition } from './helpers.js';

test('figer et imprimer la vague, finales sur le Ring, régénérer à la suite, rouvrir et refiger', async ({ page, request, context }) => {
  const id = await createCompetition(page, 'Coupe figeage');
  let i = 0;
  const reg = async (weightClassId: string) =>
    (await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    })).json()).row as { fighterId: string };
  const cadettes = [];
  for (let k = 0; k < 8; k++) cadettes.push(await reg('cadet:F:-54'));
  for (let k = 0; k < 2; k++) await reg('cadet:F:-61');
  const [t1, t2] = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  await request.put(`/api/competitions/${id}/zones`, { data: [{ id: t1!.id, name: 'Tatami 1' }, { id: t2!.id, name: 'Ring' }] });
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const big = cats.find((c) => c.label.includes('-54'))!;

  // Réglages : finales sur le Ring.
  await page.goto(`/competitions/${id}/reglages`);
  await page.getByTestId('finals-zone').click();
  await page.getByRole('option', { name: 'Ring', exact: true }).click();
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();

  // Combats : figer est bloqué tant que les catégories ne sont pas prêtes.
  await page.getByRole('tab', { name: 'Combats' }).click();
  await expect(page.getByTestId('wave-state')).toHaveText('En préparation');
  await page.getByTestId('launch-open').click();
  await expect(page.getByTestId('launch-blocking')).toContainText('2 catégories ne sont pas prêtes');
  await page.keyboard.press('Escape');
  for (const c of cats) await request.patch(`/api/competitions/${id}/categories/${c.id}`, { data: { status: 'ready' } });
  await page.reload();
  await page.getByTestId('launch-open').click();
  await expect(page.getByTestId('launch-blocking')).toHaveCount(0);
  await page.getByTestId('launch-confirm').click();
  await expect(page.getByTestId('launch-print')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('wave-state')).toHaveText('Lancée');

  // Impression de la vague : la finale des cadettes est sur le Ring.
  const [sheet] = await Promise.all([context.waitForEvent('page'), page.getByTestId('wave-print').click()]);
  await expect(sheet.getByTestId('print-section').filter({ hasText: big.label })).toContainText('Zone des finales : Ring');
  await sheet.close();

  // Absente tardive : rien ne bouge sans confirmation ; « Régénérer » renumérote à la suite.
  await request.put(`/api/competitions/${id}/weigh-in/${cadettes[0]!.fighterId}`, { data: { presence: 'absent' } });
  await page.getByRole('tab', { name: 'Tableaux' }).click();
  await page.getByText(big.label).first().click();
  await expect(page.getByText('Les inscrits ont changé')).toBeVisible();
  // À l'écran aussi, la finale déplacée indique sa zone.
  await expect(page.getByTestId('match-zone').first()).toHaveText('Zone des finales : Ring');
  await page.getByTestId('category-regenerate').click();
  await page.getByTestId('regenerate-confirm').click();
  await expect(page.getByText('Les inscrits ont changé')).toHaveCount(0);
  await page.goto(`/competitions/${id}/impression?categories=${big.id}`);
  await expect(page.getByTestId('print-section')).toContainText('mis à jour à');

  // Rouvrir, puis refiger : la vague est de nouveau lancée.
  await page.goto(`/competitions/${id}/combats`);
  await page.getByTestId('reopen-open').click();
  await page.getByTestId('reopen-confirm').click();
  await expect(page.getByTestId('wave-state')).toHaveText('Rouverte');
  await page.getByTestId('refreeze-open').click();
  await expect(page.getByTestId('number-preview')).toContainText('Aucun numéro ne change');
  await page.getByTestId('number-confirm').click();
  await expect(page.getByTestId('wave-state')).toHaveText('Lancée');
});
