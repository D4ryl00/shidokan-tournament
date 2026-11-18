import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** MINI (minime -45, seule) monte chez les cadettes -47 (tranche d’âge au-dessus), où sont CADA et CADB. */
async function seed(request: APIRequestContext, id: string) {
  const club = (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Dojo Détails' } })).json()) as { id: string };
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: club.id, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
    });
  await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  for (const n of ['CADA', 'CADB']) await reg({ lastName: n, weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
}

const column = (scope: Locator, side: 'from' | 'to') => scope.locator(`[data-testid="details-column"][data-side="${side}"]`);

async function ageUpProposal(page: Page, id: string) {
  await page.goto(`/competitions/${id}/reaffectation`);
  const card = page.getByTestId('replacement-case').filter({ has: page.getByTestId('case-name').filter({ hasText: 'MINI Léa' }) });
  return card.getByTestId('replacement-proposal').filter({ hasText: 'Tranche d’âge au-dessus' }).first();
}

test('carte : détails De et Vers, fiches, tableau, galaxie et copie pour le club', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe détails réaffectation');
  await seed(request, id);
  const proposal = await ageUpProposal(page, id);

  const toggle = proposal.getByTestId('move-details-toggle');
  await expect(toggle).toHaveText('Détails ▾');
  await expect(column(proposal, 'from')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveText('Détails ▴');

  const from = column(proposal, 'from');
  const to = column(proposal, 'to');
  await expect(from).toContainText('Karaté · Jiyu · Minimes F · -45 kg');
  await expect(from).toContainText('1 combattant');
  await expect(to).toContainText('2 combattants (3 avec elle)');
  // De : celle qui part, en tête ; Vers : celle qui arrive, à la fin.
  await expect(from.getByTestId('details-fighter').first()).toHaveAttribute('data-mark', 'part');
  await expect(from.getByTestId('details-fighter').first()).toContainText('MINI Léa · Dojo Détails');
  await expect(from.getByTestId('details-fighter').first()).toContainText('≈ 45 kg');
  await expect(to.getByTestId('details-fighter')).toHaveCount(3);
  await expect(to.getByTestId('details-fighter').last()).toHaveAttribute('data-mark', 'arrive');
  await expect(to.getByTestId('details-fighter').last()).toContainText('MINI Léa');

  // Un clic sur un nom déplie sa fiche (sans le club), un autre la referme ; plusieurs à la fois.
  await to.getByTestId('details-fighter').filter({ hasText: 'CADA' }).click();
  const sheet = to.getByTestId('fighter-sheet');
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toContainText('Licence');
  await expect(sheet).not.toContainText('coach');
  await to.getByTestId('details-fighter').filter({ hasText: 'CADB' }).click();
  await expect(to.getByTestId('fighter-sheet')).toHaveCount(2);
  await to.getByTestId('details-fighter').filter({ hasText: 'CADA' }).click();
  await expect(to.getByTestId('fighter-sheet')).toHaveCount(1);

  // Vue « Tableau » : le tableau, sans la liste, celle qui arrive surlignée ; un clic sur un nom donne sa fiche.
  await to.getByText('Tableau', { exact: true }).click();
  await expect(to.getByTestId('bracket-view')).toBeVisible();
  await expect(to.getByTestId('details-fighter')).toHaveCount(0);
  await expect(to.getByTestId('fighter-sheet')).toHaveCount(0);
  // Poule à trois : chaque nom figure dans plusieurs combats.
  const mini = to.getByTestId('bracket-entrant').filter({ hasText: 'MINI Léa' }).first();
  await expect(mini).toHaveAttribute('style', /background: var\(--sk-warn\)/);
  // Un clic sur celle qui arrive la choisit aussi (contour), et donne sa fiche ; un second clic la referme.
  await mini.click();
  await expect(mini).toHaveAttribute('style', /outline/);
  await expect(to.getByTestId('fighter-sheet')).toHaveCount(1);
  await mini.click();
  await expect(to.getByTestId('fighter-sheet')).toHaveCount(0);
  await to.getByTestId('bracket-entrant').filter({ hasText: 'CADB' }).first().click();
  await expect(to.getByTestId('fighter-sheet')).toHaveCount(1);
  await expect(to.getByTestId('details-chosen-name')).toHaveText('CADB Léa · Dojo Détails');
  await expect(to.getByTestId('fighter-sheet')).toContainText('Licence');
  // De reste sur « Combattants ».
  await expect(from.getByTestId('details-fighter')).toHaveCount(1);

  // « Voir dans la galaxie », dans un nouvel onglet.
  const galaxy = from.getByTestId('details-galaxy');
  await expect(galaxy).toHaveAttribute('target', '_blank');
  await expect(galaxy).toHaveAttribute('href', /vue=galaxie&categorie=/);

  // « Copier pour le club ».
  await proposal.getByTestId('move-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Léa MINI - Dojo Détails - Karaté · Jiyu · Minimes F · -45 kg : Tranche d’âge au-dessus Minimes → Cadets.* \(vers Karaté · Jiyu · .*\)$/);
  await expect(page.getByText(`Copié : ${text}`)).toBeVisible();

  // Refermé : plus de colonnes.
  await toggle.click();
  await expect(column(proposal, 'from')).toHaveCount(0);
});

test('plan : détails d’une ligne du plan', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe détails plan');
  await seed(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  await page.getByTestId('plan-show').click();
  const row = page.getByTestId('plan-view').getByTestId('plan-move').filter({ has: page.getByTestId('plan-move-name').filter({ hasText: 'MINI Léa' }) });
  await row.getByTestId('move-details-toggle').click();
  await expect(column(row, 'from')).toContainText('Karaté · Jiyu · Minimes F · -45 kg');
  await expect(column(row, 'from').getByTestId('details-fighter').first()).toHaveAttribute('data-mark', 'part');
  const arrive = column(row, 'to').getByTestId('details-fighter').last();
  await expect(arrive).toHaveAttribute('data-mark', 'arrive');
  await expect(arrive).toContainText('MINI Léa');
  await expect(row.getByTestId('move-copy')).toBeVisible();
});

test('écran étroit : De et Vers l’un sous l’autre, sans défilement horizontal', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe détails étroit');
  await seed(request, id);
  await page.setViewportSize({ width: 390, height: 844 });
  const proposal = await ageUpProposal(page, id);
  await proposal.getByTestId('move-details-toggle').click();
  const from = column(proposal, 'from');
  const to = column(proposal, 'to');
  await expect(to.getByTestId('details-fighter')).toHaveCount(3);
  await to.getByText('Tableau', { exact: true }).click();
  await expect(to.getByTestId('bracket-view')).toBeVisible();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('copie pour le club : presse-papiers refusé, le texte est montré pour être copié à la main', async ({ page, request }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  const id = await createCompetition(page, 'Coupe détails copie refusée');
  await seed(request, id);
  const proposal = await ageUpProposal(page, id);
  await proposal.getByTestId('move-copy').click();
  await expect(page.getByText('Copie impossible : sélectionnez le texte ci-dessous et copiez-le.')).toBeVisible();
  await expect(page.getByTestId('copy-fallback')).toContainText('Léa MINI - Dojo Détails - Karaté · Jiyu · Minimes F · -45 kg : Tranche d’âge au-dessus');
});
