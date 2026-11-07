import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

/**
 * -54 kg : ALBA, BRUN, CARO, DIDI ; -61 kg : SOLO (seul, dans le bac) ; -47 kg : LANA, LISE (lancée) ; tableau libre « Gala vide ».
 */
async function seed(request: APIRequestContext, id: string): Promise<Record<'c54' | 'c61' | 'c47', string>> {
  const reg = async (lastName: string, weightClassId: string) => {
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'x', lastName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  for (const n of ['ALBA', 'BRUN', 'CARO', 'DIDI']) await reg(n, 'cadet:F:-54');
  await reg('SOLO', 'cadet:F:-61');
  for (const n of ['LANA', 'LISE']) await reg(n, 'cadet:F:-47');
  expect((await request.post(`/api/competitions/${id}/free-tableaux`, { data: { name: 'Gala vide', discipline: 'karate', ruleset: 'jiyu' } })).status()).toBe(201);
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const of = (w: string) => cats.find((c) => c.label.includes(w))!.id;
  const ids = { c54: of('-54'), c61: of('-61'), c47: of('-47') };
  expect((await request.patch(`/api/competitions/${id}/categories/${ids.c47}`, { data: { status: 'started' } })).ok()).toBeTruthy();
  return ids;
}

/** Carte d'une catégorie (par son id : le libellé change quand un combattant d'un autre poids arrive). */
const card = (page: Page, categoryId: string) => page.locator(`[data-testid="planche-card"][data-category="${categoryId}"]`);
const freeCard = (page: Page, name: string) => page.getByTestId('planche-card').filter({ hasText: name });
const chip = (_page: Page, where: ReturnType<typeof card>, name: string) => where.getByTestId('planche-chip').filter({ hasText: name });

test('planche : glisser pour échanger, déplacer vers un tableau libre, carte lancée refusée', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe glisser-déposer');
  const ids = await seed(request, id);
  // Source et cible à l'écran en même temps (le glisser simulé ne fait pas défiler la page).
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(`/competitions/${id}/tableaux`);
  const c54 = card(page, ids.c54);
  const c61 = card(page, ids.c61);
  const gala = freeCard(page, 'Gala vide');
  await expect(chip(page, c54, 'ALBA')).toBeVisible();

  // Du bac sur un combattant d'une autre catégorie : échange confirmé, les deux placés à la main.
  await page.getByTestId('planche-tray').getByTestId('planche-chip').filter({ hasText: 'SOLO' }).dragTo(chip(page, c54, 'ALBA'));
  const dialog = page.getByTestId('drop-dialog');
  await expect(page.getByRole('dialog')).toContainText('Échanger deux combattants');
  await expect(dialog).toContainText('SOLO x');
  await expect(dialog).toContainText('➜ Vers');
  await expect(page.getByTestId('drop-confirm')).toHaveText('Confirmer l’échange');
  const exchanged = page.waitForResponse((r) => r.url().endsWith('/replacement/exchange') && r.request().method() === 'POST');
  await page.getByTestId('drop-confirm').click();
  expect((await exchanged).ok()).toBeTruthy();
  await expect(chip(page, c54, 'SOLO').getByTestId('replacement-badge')).toContainText('Placé à la main');
  await expect(chip(page, c61, 'ALBA').getByTestId('replacement-badge')).toContainText('Placé à la main');
  await expect(chip(page, c54, 'ALBA')).toHaveCount(0);

  // Sur un tableau libre vide : déplacement confirmé.
  await chip(page, c54, 'BRUN').dragTo(gala);
  await expect(page.getByRole('dialog')).toContainText('Déplacement manuel');
  await expect(page.getByTestId('drop-confirm')).toHaveText('Confirmer le déplacement');
  const moved = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
  await page.getByTestId('drop-confirm').click();
  expect((await moved).ok()).toBeTruthy();
  await expect(chip(page, gala, 'BRUN')).toBeVisible();
  await expect(chip(page, c54, 'BRUN')).toHaveCount(0);

  // Carte lancée : refusée pendant le survol, puis au dépôt.
  const launched = card(page, ids.c47);
  await expect(launched).toHaveAttribute('data-locked', 'true');
  await chip(page, c54, 'CARO').hover();
  await page.mouse.down();
  const box = (await launched.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12, { steps: 8 });
  // Un second mouvement : le survol (dragover) n'est envoyé qu'une fois le glisser commencé.
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + 14, { steps: 2 });
  await expect(launched).toHaveAttribute('data-drop', 'no');
  await expect(launched).toContainText('Catégorie lancée : déverrouillez-la d’abord.');
  await page.mouse.up();
  await expect(page.locator('.mantine-Notification-root').filter({ hasText: 'Catégorie lancée : déverrouillez-la d’abord.' })).toBeVisible();
  await expect(chip(page, c54, 'CARO')).toBeVisible();
  await expect(chip(page, launched, 'CARO')).toHaveCount(0);
});

test('planche : échange de places annulé, clic-clic, historique en cascade, recherche, 360 px', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe clic-clic');
  const ids = await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  const c54 = card(page, ids.c54);
  const gala = freeCard(page, 'Gala vide');
  const content = c54.getByTestId('card-content');
  await expect(c54.getByTestId('planche-chip')).toHaveCount(4);

  // Échange de places dans une carte : tout de suite, message « Annuler », places d'avant.
  const before = await content.innerText();
  const firstOf = (n: number) => content.locator(':scope > div').nth(n).getByTestId('planche-chip').first();
  const swapped = page.waitForResponse((r) => r.url().includes('/swap') && r.request().method() === 'POST');
  await firstOf(0).dragTo(firstOf(1));
  expect((await swapped).ok()).toBeTruthy();
  await expect(content).not.toHaveText(before);
  const toast = page.locator('.mantine-Notification-root').filter({ hasText: 'Places échangées' });
  const undone = page.waitForResponse((r) => r.url().includes('/history/undo') && r.request().method() === 'POST');
  await toast.getByTestId('undo-toast-action').click();
  expect((await undone).ok()).toBeTruthy();
  await expect.poll(() => content.innerText()).toBe(before);

  // Clic-clic : choisir, Échap, choisir, cliquer sur une carte.
  const solo = page.getByTestId('planche-tray').getByTestId('planche-chip').filter({ hasText: 'SOLO' });
  await solo.click();
  const banner = page.getByTestId('planche-banner');
  await expect(banner).toHaveText('Sélection : SOLO x. Cliquez sur un autre combattant pour échanger, ou sur une catégorie pour l’y déplacer. (Échap pour annuler)');
  await page.keyboard.press('Escape');
  await expect(banner).toHaveCount(0);
  await solo.click();
  await expect(banner).toBeVisible();
  await gala.getByText('Aucun combattant pour l’instant.').click();
  await expect(page.getByRole('dialog')).toContainText('Déplacement manuel');
  await expect(banner).toHaveCount(0);
  const moved = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
  await page.getByTestId('drop-confirm').click();
  expect((await moved).ok()).toBeTruthy();
  await expect(chip(page, gala, 'SOLO')).toBeVisible();

  // Un second déplacement vers le même tableau libre : annuler le premier emporte le second.
  await chip(page, c54, 'DIDI').click();
  await gala.getByText('SANS ADVERSAIRE', { exact: true }).click();
  const moved2 = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
  await page.getByTestId('drop-confirm').click();
  expect((await moved2).ok()).toBeTruthy();
  await expect(chip(page, gala, 'DIDI')).toBeVisible();
  await page.getByTestId('history-open').click();
  const entries = page.getByTestId('history-panel').getByTestId('history-entry');
  const oldest = entries.filter({ has: page.getByText('SOLO x', { exact: true }) });
  await expect(oldest).toContainText('Annule aussi :');
  await oldest.getByTestId('history-undo').hover();
  await expect(gala).toHaveAttribute('data-ring', 'undo');
  await page.mouse.move(0, 0);
  await expect(gala).not.toHaveAttribute('data-ring', 'undo');
  await page.getByTestId('history-open').click();

  // Recherche sans résultat.
  await page.getByTestId('planche-search').fill('zzz');
  await expect(page.getByText('Aucune catégorie ne correspond.')).toBeVisible();
  await page.getByTestId('planche-search').fill('');

  // 360 px : rien de coupé, bandeau compris.
  await page.setViewportSize({ width: 360, height: 740 });
  await chip(page, c54, 'CARO').click();
  await expect(banner).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
