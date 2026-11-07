import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCompetition, openTab } from './helpers.js';

test('tableaux libres dans l’onglet Catégories', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe placements libres');
  await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
  ] });

  // L'onglet s'appelle « Catégories » ; l'ancienne adresse y redirige.
  await openTab(page, 'Catégories');
  await expect(page).toHaveURL(/\/categories$/);
  await page.goto(`/competitions/${id}/grille`);
  await expect(page).toHaveURL(/\/categories$/);
  await expect(page.getByRole('group', { name: 'Catégories ouvertes', exact: true })).toBeVisible();
  const section = page.getByRole('group', { name: 'Tableaux libres', exact: true });
  await expect(section).toBeVisible();
  await expect(page.getByRole('group', { name: 'Catégories de poids', exact: true })).toBeVisible();
  // Ajouter
  await section.getByRole('button', { name: 'Ajouter un tableau libre' }).click();
  await page.getByLabel('Nom du tableau').fill('Gala 1');
  await page.getByLabel('Discipline', { exact: true }).selectOption({ label: 'Karaté' });
  await page.getByLabel('Règlement', { exact: true }).selectOption({ label: 'Jiyu ippon kumite' });
  const created = page.waitForResponse((r) => r.url().includes('/free-tableaux') && r.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await created).status()).toBe(201);
  const row = section.getByTestId('free-tableau').filter({ hasText: 'Gala 1' });
  await expect(row).toContainText('0 combattant');
  await expect(row.getByLabel('Session de Gala 1')).toHaveValue('none');

  // Session
  const patched = page.waitForResponse((r) => r.url().includes('/categories/') && r.request().method() === 'PATCH');
  await row.getByLabel('Session de Gala 1').selectOption({ label: 'Matin' });
  expect((await patched).ok()).toBeTruthy();
  await expect(row.getByLabel('Session de Gala 1').locator('option:checked')).toHaveText('Matin');

  // Modifier le nom
  await row.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Nom du tableau').fill('Gala A');
  const renamed = page.waitForResponse((r) => r.url().includes('/free-tableaux/') && r.request().method() === 'PATCH');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect((await renamed).ok()).toBeTruthy();
  const row2 = section.getByTestId('free-tableau').filter({ hasText: 'Gala A' });
  await expect(row2).toBeVisible();
  // Supprimer (vide)
  await row2.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('Aucun combattant à renvoyer')).toBeVisible();
  const deleted = page.waitForResponse((r) => r.url().includes('/free-tableaux/') && r.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Supprimer le tableau' }).click();
  expect((await deleted).ok()).toBeTruthy();
  await expect(section.getByTestId('free-tableau')).toHaveCount(0);
});

async function reg(request: APIRequestContext, id: string, lastName: string, weightClassId: string, extra: object = {}) {
  const res = await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, firstName: 'Léa', lastName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, approxWeightKg: 46, source: 'manual', ...extra },
  });
  expect(res.ok()).toBeTruthy();
}

test('gala entre deux catégories', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe gala placements');
  for (const n of ['CADA', 'CADB', 'CADC']) await reg(request, id, n, 'cadet:F:-47');
  for (const n of ['LOURDA', 'LOURDB', 'LOURDC']) await reg(request, id, n, 'cadet:F:+61', { approxWeightKg: 62 });
  await reg(request, id, 'SEULE', 'cadet:F:-61', { approxWeightKg: 58 });
  expect((await request.post(`/api/competitions/${id}/free-tableaux`, { data: { name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' } })).status()).toBe(201);

  await page.goto(`/competitions/${id}/tableaux`);
  const rowOf = (text: string) => page.getByTestId('category-row').filter({ hasText: text });
  const panel = page.getByTestId('move-entrant-panel');
  const moveTo = async (lastName: string, target: string) => {
    await page.getByTestId('bracket-entrant').filter({ hasText: lastName }).first().click();
    await expect(panel).toContainText(lastName);
    await panel.getByTestId('move-entrant-select').click();
    await page.getByRole('option', { name: new RegExp(`^${target}`) }).click();
    const previewed = page.waitForResponse((r) => r.url().includes('/replacement/preview') && r.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Déplacer…' }).click();
    expect((await previewed).ok()).toBeTruthy();
    const moved = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
    await page.getByTestId('move-entrant-confirm').click();
    expect((await moved).ok()).toBeTruthy();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('swap-select')).toContainText('Échange manuel');
  };

  await rowOf('-47').click();
  await expect(page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' }).first()).toBeVisible();
  // Le groupe « Tableaux libres » est proposé.
  await page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' }).first().click();
  await panel.getByTestId('move-entrant-select').click();
  await expect(page.getByRole('group', { name: 'Tableaux libres' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' }).first().click(); // désélectionne
  await expect(panel).toHaveCount(0);
  await moveTo('CADA', 'Gala 1');
  await rowOf('+61').click();
  await moveTo('LOURDA', 'Gala 1');

  await rowOf('Gala 1').click();
  await expect(page.getByTestId('bracket-match')).toHaveCount(1);
  const badges = page.getByTestId('replacement-badge');
  await expect(badges).toHaveCount(2);
  await expect(badges.first()).toContainText('Placé à la main');

  // Appliquer le plan de la réaffectation ne touche pas au tableau libre.
  await openTab(page, 'Réaffectation');
  await page.getByTestId('plan-show').click();
  const view = page.getByTestId('plan-view');
  await expect(view).toBeVisible();
  await view.getByTestId('plan-apply').click();
  const applied = page.waitForResponse((r) => r.url().includes('/replacement/plan/apply') && r.request().method() === 'POST');
  await page.getByTestId('plan-apply-confirm').click();
  expect((await applied).ok()).toBeTruthy();
  const cats = async () => (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { label: string; registrationIds: string[] }[];
  expect((await cats()).find((c) => c.label.includes('Gala 1'))!.registrationIds).toHaveLength(2);

  // Annuler le déplacement manuel de CADA : il revient dans sa catégorie.
  await openTab(page, 'Tableaux');
  await rowOf('Gala 1').click();
  await page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' }).first().click();
  await panel.getByTestId('move-entrant-undo').click();
  // La fenêtre d'annulation montre le lot : le déplacement de CADA, et celui de LOURDA (plus récent, même tableau) « annulé aussi ».
  const lot = page.getByTestId('undo-dialog');
  // (L'application du plan, juste avant, touche aussi ces catégories : elle part avec, dans le lot.)
  await expect(lot.locator('[data-role="main"]')).toContainText('CADA');
  await expect(lot.locator('[data-role="also"]').filter({ hasText: 'LOURDA' })).toHaveCount(1);
  const undone = page.waitForResponse((r) => r.url().endsWith('/history/undo') && r.request().method() === 'POST');
  await page.getByTestId('undo-confirm').click();
  expect((await undone).ok()).toBeTruthy();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' })).toHaveCount(0);
  const after = await cats();
  expect(after.find((c) => c.label.includes('Gala 1'))!.registrationIds).toHaveLength(0);
  await rowOf('-47').click();
  await expect(page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' }).first()).toBeVisible();
  await rowOf('+61').click();
  await expect(page.getByTestId('bracket-entrant').filter({ hasText: 'LOURDA' }).first()).toBeVisible();
});

test('échange gardé après une arrivée', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe échange gardé');
  for (const n of ['AAA', 'BBB', 'CCC', 'DDD']) await reg(request, id, n, 'cadet:F:-47');
  await page.goto(`/competitions/${id}/tableaux`);
  await page.getByTestId('category-row').first().click();
  const pairs = async () => (await page.getByTestId('bracket-match').allInnerTexts()).map((t) => ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].filter((n) => t.includes(n)).sort().join('+'));
  const before = await pairs();
  // Échange : le premier de la première rencontre contre le premier de la seconde.
  const first = page.getByTestId('bracket-match').nth(0).getByTestId('bracket-entrant').first();
  const second = page.getByTestId('bracket-match').nth(1).getByTestId('bracket-entrant').first();
  await first.click();
  const swapped = page.waitForResponse((r) => r.url().includes('/swap') && r.request().method() === 'POST');
  await second.click();
  expect((await swapped).ok()).toBeTruthy();
  await expect.poll(pairs).not.toEqual(before);
  const arranged = await pairs();
  const kept = arranged.filter((p) => p.includes('+'));
  expect(kept).toHaveLength(2);

  await reg(request, id, 'EEE', 'cadet:F:-47');
  await page.reload();
  await page.getByTestId('category-row').first().click();
  await expect(page.getByTestId('bracket-entrant').filter({ hasText: 'EEE' }).first()).toBeVisible();
  const now = await pairs();
  for (const p of kept) expect(now).toContain(p);
});

test('alerte et remise à zéro', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe alerte placements');
  for (const n of ['ALPHA', 'BRAVO', 'CHARLIE']) await reg(request, id, n, 'cadet:F:-47');
  const gala = (await (await request.post(`/api/competitions/${id}/free-tableaux`, { data: { name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' } })).json()) as { id: string };
  const regs = (await (await request.get(`/api/competitions/${id}/registrations`)).json()) as { id: string; fighter: { lastName: string } }[];
  const idOf = (n: string) => regs.find((r) => r.fighter.lastName === n)!.id;
  for (const n of ['ALPHA', 'BRAVO']) {
    const res = await request.post(`/api/competitions/${id}/replacement/move`, { data: { registrationId: idOf(n), categoryId: gala.id } });
    expect(res.ok()).toBeTruthy();
  }
  // Annuler BRAVO : ALPHA reste seul, placé à la main, dans Gala 1.
  expect((await request.post(`/api/competitions/${id}/replacement/undo-manual`, { data: { registrationId: idOf('BRAVO') } })).ok()).toBeTruthy();

  await page.goto(`/competitions/${id}/reaffectation`);
  const card = page.getByTestId('replacement-case').filter({ hasText: 'ALPHA' });
  await expect(card).toContainText('Sans adversaire');
  await expect(card).toContainText(/Seule? dans le tableau libre Gala 1/);
  await expect(card.getByTestId('case-alert-hint')).toHaveText('Placée à la main : le calcul ne la déplace pas. Déplacez-la vous-même ou annulez son déplacement manuel.');
  await expect(card.getByTestId('replacement-proposal')).toHaveCount(0);
  await expect(card.getByTestId('manual-move-select')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Annuler son déplacement manuel' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Mettre de côté' })).toBeVisible();
  await expect(page.getByTestId('replacement-summary')).toContainText('Sans adversaire1');

  await page.getByTestId('replacement-reset').click();
  const dialog = page.getByRole('dialog', { name: 'Repartir de zéro ?' });
  await expect(dialog).toContainText('dont 1 déplacement manuel');
  const reset = page.waitForResponse((r) => r.url().includes('/replacement/reset') && r.request().method() === 'POST');
  await dialog.getByTestId('replacement-reset-confirm').click();
  expect((await reset).ok()).toBeTruthy();
  await expect(page.getByTestId('replacement-case').filter({ hasText: 'ALPHA' })).toHaveCount(0);
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { label: string; registrationIds: string[] }[];
  const g = cats.find((c) => c.label.includes('Gala 1'));
  expect(g).toBeTruthy();
  expect(g!.registrationIds).toHaveLength(0);
});

test('Tableaux : déplacer vers un tableau libre en attente prévient du changement de session', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe gala en attente');
  await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] });
  for (const n of ['CADA', 'CADB', 'CADC']) await reg(request, id, n, 'cadet:F:-47');
  expect((await request.post(`/api/competitions/${id}/free-tableaux`, { data: { name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' } })).status()).toBe(201);

  await page.goto(`/competitions/${id}/tableaux`);
  await page.getByTestId('brackets-wave').getByText('Après-midi', { exact: true }).click();
  await page.getByTestId('category-row').filter({ hasText: '-47' }).click();
  await page.getByTestId('bracket-entrant').filter({ hasText: 'CADA' }).first().click();
  const panel = page.getByTestId('move-entrant-panel');
  await panel.getByTestId('move-entrant-select').click();
  // Comme sur les cartes de la Réaffectation : la cible dit sa session.
  const option = page.getByRole('option', { name: /^Gala 1/ });
  await expect(option).toContainText('· session en attente');
  await option.click();
  const previewed = page.waitForResponse((r) => r.url().includes('/replacement/preview') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Déplacer…' }).click();
  expect((await previewed).ok()).toBeTruthy();
  const warning = page.getByRole('dialog').getByTestId('wave-change-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('CADA');
  await expect(warning).toContainText('dans une catégorie en attente (dans aucune session)');
});
