import { expect, test } from '@playwright/test';
import { createCompetition, openTab } from './helpers.js';

const orderOf = (rows: ReturnType<import('@playwright/test').Page['getByTestId']>) => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));

test('réglages de l’application : ranger les règles par défaut, une nouvelle compétition les reprend', async ({ page, request }) => {
  const before = await (await request.get('/api/app-settings')).json();
  try {
    await page.goto('/parametres');
    const section = page.getByRole('group', { name: 'Règles de réaffectation par défaut' });
    await expect(section).toContainText('Copiées dans chaque nouvelle compétition. Les compétitions déjà créées ne changent pas.');
    const ladder = section.getByTestId('rule-ladder');
    const rows = ladder.getByTestId('ladder-row');
    await expect(rows).toHaveCount(11);
    // Pas de barres sans plan, pas de boutons ni d’interrupteur pour le retour dans la catégorie d’origine.
    await expect(ladder.getByTestId('ladder-alone')).toHaveCount(0);
    const first = rows.first();
    await expect(first).toHaveAttribute('data-rule', 'return');
    await expect(first.getByTestId('ladder-switch')).toHaveCount(0);
    await expect(first.getByTestId('ladder-up')).toHaveCount(0);
    await expect(first.getByTestId('ladder-down')).toHaveCount(0);

    const ageDown = rows.filter({ hasText: 'Tranche d’âge au-dessous' });
    await ageDown.getByTestId('ladder-down').click();
    await rows.filter({ hasText: 'Mélange seniors / vétérans' }).getByText('Mélange seniors / vétérans').click();
    await expect(rows.filter({ hasText: 'Mélange seniors / vétérans' }).locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
    await expect(ladder.getByTestId('ladder-cut')).toContainText('je m’arrête ici');
    const sw = rows.filter({ hasText: 'Mélange filles / garçons' }).getByTestId('ladder-switch');
    const wasOn = await sw.isChecked();
    await sw.click({ force: true });
    await section.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

    const id = await createCompetition(page, 'Coupe règles par défaut');
    await page.goto(`/competitions/${id}/reglages`);
    await openTab(page, 'Réaffectation');
    const mine = page.getByTestId('rule-ladder');
    const mineRows = mine.getByTestId('ladder-row');
    await expect(mineRows).toHaveCount(11);
    expect(await orderOf(mineRows)).toEqual([
      'return', 'weight', 'split', 'weightGap', 'ageUp', 'seniorsVeterans', 'ageDown', 'discipline', 'shobuToJiyu', 'mixSexes', 'minorsAdults',
    ]);
    await expect(mineRows.filter({ hasText: 'Mélange seniors / vétérans' }).locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
    const mineSwitch = mineRows.filter({ hasText: 'Mélange filles / garçons' }).getByTestId('ladder-switch');
    if (wasOn) await expect(mineSwitch).not.toBeChecked(); else await expect(mineSwitch).toBeChecked();
    // Le plan donne la ligne de départ et une barre par règle active.
    await expect(mine.getByTestId('ladder-start')).toContainText('Sans rien changer');
    await expect(mine.getByTestId('ladder-alone').first()).toBeVisible();

    // Retour aux réglages par défaut de l’application : un changement local est défait.
    await mineSwitch.click({ force: true });
    if (wasOn) await expect(mineSwitch).toBeChecked(); else await expect(mineSwitch).not.toBeChecked();
    await page.getByRole('button', { name: 'Revenir aux réglages par défaut' }).click();
    if (wasOn) await expect(mineSwitch).not.toBeChecked(); else await expect(mineSwitch).toBeChecked();
  } finally {
    await request.patch('/api/app-settings', { data: { defaultReplacementRules: before.defaultReplacementRules } });
  }
});

test('la liste des règles tient dans un écran de téléphone, barres comprises', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe règles mobile');
  for (const [last, w] of [['MARTIN', 'cadet:F:-47'], ['BERNARD', 'cadet:F:-54']] as const) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'Léa', lastName: last, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: w, source: 'manual' },
    });
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/competitions/${id}/reaffectation`);
  const ladder = page.getByTestId('rule-ladder');
  await expect(ladder.getByTestId('ladder-start')).toContainText('Sans rien changer');
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="rule-ladder"], [data-testid="rule-ladder"] *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName} ${e.getAttribute('data-testid') ?? ''} ${(e.textContent ?? '').slice(0, 30)}`).slice(0, 8));
  expect(wide).toEqual([]);
  const box = await ladder.boundingBox();
  for (const bar of await ladder.getByTestId('ladder-alone').all()) {
    const b = await bar.boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
});
