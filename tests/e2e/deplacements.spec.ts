import { expect, test } from '@playwright/test';
import { createCompetition } from './helpers.js';

test('déplacer une catégorie en cours de compétition : aperçu à la suite / mélangés, file et impression', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe déplacements');
  let i = 0;
  const reg = (weightClassId: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
  for (const w of ['cadet:F:-54', 'cadet:F:-47', 'cadet:F:-61']) for (let k = 0; k < 4; k++) await reg(w);
  const [t1, t2] = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  for (const c of cats) await request.patch(`/api/competitions/${id}/categories/${c.id}`, { data: { status: 'ready', zoneId: c.label.includes('-61') ? t2!.id : t1!.id } });
  await request.post(`/api/competitions/${id}/launch`, { data: { waveId: null } });
  const a = cats.find((c) => c.label.includes('-54'))!;
  const b = cats.find((c) => c.label.includes('-61'))!;
  await request.put(`/api/competitions/${id}/categories/${a.id}/results/w1-0`, { data: { winner: 'a', method: 'points' } });

  await page.goto(`/competitions/${id}/combats`);
  const card = page.getByTestId('schedule-category').filter({ hasText: a.label });
  await card.getByTestId('schedule-zone').click();
  await page.getByRole('option', { name: 'Tatami 2', exact: true }).click();
  const modal = page.getByTestId('move-modal');
  await expect(modal.getByTestId('move-change')).toHaveCount(2);
  await expect(modal.getByTestId('move-reprint')).toHaveText([a.label]);
  await modal.getByTestId('move-mode').getByText('Mélangés').click();
  await expect(modal.getByTestId('move-reprint')).toContainText([b.label]);
  await modal.getByTestId('move-mode').getByText('À la suite').click();
  await expect(modal.getByTestId('move-reprint')).toHaveCount(1);
  await modal.getByTestId('move-confirm').click();
  await expect(page.getByTestId('move-modal')).toHaveCount(0);
  await expect(card.getByTestId('schedule-zone')).toHaveValue('Tatami 2');
  await expect(page.getByTestId('zone-card').filter({ hasText: 'Tatami 2' }).getByTestId('next-match').filter({ hasText: a.label })).toHaveCount(1);

  await page.goto(`/competitions/${id}/impression?categories=${a.id}`);
  await expect(page.getByTestId('print-section')).toContainText('mis à jour à');
  await expect(page.getByTestId('match-zone')).toHaveText(['Joué sur : Tatami 1']);
});
