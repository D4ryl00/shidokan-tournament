import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCompetition } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  const reg = async (data: object) =>
    (await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    })).json()).row;
  await reg({ lastName: 'MARTIN', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ lastName: 'BERNARD', approxWeightKg: 50 });
  await reg({ lastName: 'DUBOIS', weightClassId: 'cadet:F:-61' });
  await reg({ lastName: 'THOMAS', weightClassId: 'cadet:F:-61' });
  await reg({ lastName: 'PETIT', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 44 });
  await reg({ lastName: 'ROBERT', firstName: 'Paul', sex: 'M', ageBandCode: 'senior', ruleset: 'shobu', weightClassId: 'senior:M:-75' });
}

test('pesée puis recasement : aperçu, validation, refus, masse, retour, annulation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe recasement');
  await seed(request, id);

  // 1. Pesée
  await page.goto(`/competitions/${id}/pesee`);
  const bernard = page.getByTestId('weighin-row').filter({ hasText: 'BERNARD' });
  await bernard.getByTestId('weighin-weight').fill('50,5');
  await bernard.getByTestId('weighin-weight').press('Enter');
  await expect(bernard.getByTestId('weighin-presence').locator('input[value="present"]')).toBeChecked();
  await page.getByTestId('weighin-row').filter({ hasText: 'THOMAS' }).getByTestId('weighin-presence').getByText('Absent').click();
  await expect(page.getByTestId('weighin-counters')).toContainText('1 absent(s)');
  await page.getByTestId('weighin-row').filter({ hasText: 'ROBERT' }).getByTestId('weighin-presence').getByText('Absent').click();
  await expect(page.getByTestId('weighin-counters')).toContainText('2 absent(s)');
  await page.goto(`/competitions/${id}/impression/pesee?par=categorie`);
  await expect(page.getByTestId('weighin-sheet').filter({ hasText: 'Pesée — Karaté · Jiyu · Cadets F · -61 kg' })).toContainText('DUBOIS');
  // Ordre de la grille (Minimes avant Cadets ; -47 avant -54 avant -61), pas l'ordre alphabétique.
  await expect(page.getByTestId('weighin-sheet').locator('h1')).toHaveText([
    'Pesée — Karaté · Jiyu · Minimes F · -45 kg',
    'Pesée — Karaté · Jiyu · Cadets F · -47 kg',
    'Pesée — Karaté · Jiyu · Cadets F · -54 kg',
    'Pesée — Karaté · Jiyu · Cadets F · -61 kg',
    'Pesée — Karaté · Shobu · Seniors M · -75 kg',
  ]);

  // 1 bis. Tableaux : nombre de cas par catégorie
  await page.goto(`/competitions/${id}/tableaux`);
  await expect(page.getByTestId('category-row').filter({ hasText: 'Cadets F · -61 kg' }).getByTestId('category-cases')).toHaveText('1 cas à traiter');
  await expect(page.getByTestId('category-row').filter({ hasText: 'Shobu' }).getByTestId('category-all-absent')).toBeVisible();
  // Formats proposés d'après les présents (comme le serveur) : DUBOIS seule présente en -61 → pas de « combat unique »
  await page.getByTestId('category-row').filter({ hasText: 'Cadets F · -61 kg' }).click();
  await page.getByTestId('category-format').click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option', { name: /seul combat/i })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 2. Recasement : aperçu et validation d'un cas simple
  await page.goto(`/competitions/${id}/recasement`);
  const martin = page.getByTestId('replacement-case').filter({ hasText: 'MARTIN Léa' });
  await expect(martin).toBeVisible();
  const simple = martin.getByTestId('replacement-proposal').filter({ hasText: '-54' }).first();
  await expect(simple.getByTestId('replacement-badge')).toHaveText('⚖ Poids 4,5 kg');
  await expect(simple).toContainText('écart 4,5 kg');
  await simple.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('preview-content')).toContainText('MARTIN Léa contre BERNARD Léa');
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByText('Recasement validé.')).toBeVisible();
  await expect(page.getByTestId('recasement-row')).toHaveCount(1);

  await page.goto(`/competitions/${id}/inscriptions`);
  const badge = page.getByTestId('registration-row').filter({ hasText: 'MARTIN' }).getByTestId('replacement-badge');
  await expect(badge).toHaveAttribute('data-state', 'validated');
  await badge.click();
  await expect(page.getByTestId('recasement-detail')).toContainText('Origine : Karaté · Jiyu · Cadets F · -47 kg');
  await expect(page.getByTestId('recasement-detail')).toContainText('Arrivée : Karaté · Jiyu · Cadets F · -47 / -54 kg');
  await page.goto(`/competitions/${id}/pesee`);
  await expect(page.getByTestId('weighin-row').filter({ hasText: 'MARTIN' }).getByTestId('weighin-recased')).toBeVisible();

  // 3. Refus
  await page.goto(`/competitions/${id}/recasement`);
  const dubois = page.getByTestId('replacement-case').filter({ hasText: 'DUBOIS' });
  const before = await dubois.getByTestId('replacement-proposal').count();
  if (before > 0) {
    await dubois.getByTestId('proposal-refuse').first().click();
    await expect(dubois.getByTestId('replacement-proposal')).toHaveCount(before - 1);
    await expect(dubois.getByTestId('replacement-proposal-refused')).toHaveCount(1);
    await dubois.getByTestId('proposal-unrefuse').click();
    await expect(dubois.getByTestId('replacement-proposal')).toHaveCount(before);
    await dubois.getByTestId('proposal-refuse').first().click();
    await expect(dubois.getByTestId('replacement-proposal-refused')).toHaveCount(1);
  }

  // 4. Tout classer automatiquement : aperçu qui sépare simples et manuels
  if ((await page.getByTestId('replacement-proposal').count()) > 0) {
    await page.getByTestId('bulk-all').click();
    await expect(page.getByTestId('preview-content')).toBeVisible();
    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByText(/recasement\(s\) appliqué\(s\)/)).toBeVisible();
  }
  await expect(page.getByTestId('replacement-proposal')).toHaveCount(0);

  // 5. Inscription sur place d'une nouvelle -47 → retour proposé et validé
  await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, lastName: 'NOUVELLE', firstName: 'Zoé', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47', source: 'onsite' },
  });
  await page.reload();
  const ret = page.getByTestId('replacement-case').filter({ hasText: 'MARTIN Léa' });
  await expect(ret.getByTestId('replacement-badge')).toHaveText('↩ Retour');
  await ret.getByTestId('proposal-apply').click();
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByText('Recasement validé.')).toBeVisible();

  // 6. Annulation depuis l'historique
  const rows = page.getByTestId('recasement-row');
  const count = await rows.count();
  await rows.first().getByTestId('recasement-undo').click();
  await page.getByTestId('recasement-undo-confirm').click();
  await expect(page.getByText('Recasement annulé.')).toBeVisible();
  await expect(rows).toHaveCount(count);
  await expect(rows.first()).toContainText('annulé');

  // 7. Aucune pastille à l'impression
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section').first()).toBeVisible();
  await expect(page.getByTestId('replacement-badge')).toHaveCount(0);
});
