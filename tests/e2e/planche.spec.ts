import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition, showList } from './helpers.js';

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
/** ⓘ d'une pastille : frère de la pastille, dans son enveloppe. */
const info = (where: ReturnType<typeof card> | Page, name: string) => where.getByTestId('planche-chip-wrap').filter({ hasText: name }).getByTestId('fighter-info');
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

  // Recherche sans résultat : rien n'est caché.
  const shownCards = await page.getByTestId('planche-card').count();
  await page.getByTestId('planche-search').fill('zzz');
  await expect(page.getByTestId('planche-search-count')).toHaveText('0 / 0');
  await expect(page.getByTestId('planche-card')).toHaveCount(shownCards);
  await page.getByTestId('planche-search').fill('');

  // 360 px : rien de coupé, bandeau compris.
  await page.setViewportSize({ width: 360, height: 740 });
  await chip(page, c54, 'CARO').click();
  await expect(banner).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const [label, size] of [['bureau', { width: 1280, height: 600 }], ['360 px', { width: 360, height: 700 }]] as const) {
  test(`planche : le bandeau reste visible sous la barre et ne décale rien (${label})`, async ({ page, request }) => {
    const id = await createCompetition(page, `Coupe bandeau ${label}`);
    const ids = await seed(request, id);
    await page.setViewportSize(size);
    await page.goto(`/competitions/${id}/tableaux`);
    const target = chip(page, card(page, ids.c54), 'CARO');
    await expect(target).toBeVisible();
    const tray = page.getByTestId('planche-tray').getByTestId('planche-chip').filter({ hasText: 'SOLO' });
    await tray.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 150));
    const before = await target.boundingBox();
    await tray.click();
    const banner = page.getByTestId('planche-banner');
    await expect(banner).toBeVisible();
    const bar = (await page.locator('div.no-print').first().boundingBox())!;
    const box = (await banner.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    // Rien ne bouge : le second clic tombera sur ce que l'on visait.
    const after = await target.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(await clipped(page)).toEqual([]);
  });
}

test('planche : un poste de zone voit le bac sans la consigne de glisser', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe bac zone');
  await seed(request, id);
  const [zone] = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [`poste:${id}`, JSON.stringify({ kind: 'zone', zoneId: zone!.id })]);
  await page.goto(`/competitions/${id}/tableaux`);
  const tray = page.getByTestId('planche-tray');
  await expect(tray).toContainText('Sans adversaire');
  await expect(tray).not.toContainText('À glisser');
});

test('planche : carte agrandie et poste de zone, ⓘ ouvre la fiche', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe fiche zone');
  const ids = await seed(request, id);
  const [zone] = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [`poste:${id}`, JSON.stringify({ kind: 'zone', zoneId: zone!.id })]);
  await page.goto(`/competitions/${id}/tableaux`);
  const sheet = page.getByTestId('fighter-info-sheet');
  // Bac : ⓘ d'une pastille.
  await info(page.getByTestId('planche-tray'), 'SOLO').click();
  await expect(sheet.getByTestId('fighter-sheet')).toContainText('Licence');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // Carte agrandie : ⓘ d'une case du tableau.
  const c54 = card(page, ids.c54);
  await c54.getByTestId('card-grow').click();
  await c54.getByTestId('bracket-entrant-wrap').filter({ hasText: 'ALBA' }).getByTestId('fighter-info').click();
  await expect(sheet).toContainText('ALBA x');
  await expect(sheet.getByTestId('fighter-sheet')).toContainText('Licence');
  await page.keyboard.press('Escape');
  // Un clic sur le nom (pastille du bac, puis case du tableau) n'ouvre pas la fiche.
  await page.getByTestId('planche-tray').getByTestId('planche-chip').filter({ hasText: 'SOLO' }).click();
  await expect(sheet).toHaveCount(0);
  await c54.getByTestId('bracket-entrant').filter({ hasText: 'ALBA' }).click();
  await expect(sheet).toHaveCount(0);
});

test('planche : ⓘ ouvre la fiche sans choisir la pastille ; clic-clic intact', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe fiche planche');
  const ids = await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  const c54 = card(page, ids.c54);
  const alba = chip(page, c54, 'ALBA');
  await info(c54, 'ALBA').click();
  const sheet = page.getByTestId('fighter-info-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('ALBA x');
  await expect(sheet.getByTestId('fighter-sheet')).toContainText('Licence');
  await expect(alba).toHaveAttribute('aria-pressed', 'false');
  // Clic ailleurs : fermée (la bulle recouvre les pastilles voisines, on clique hors de la carte) ; une seule bulle à la fois.
  await page.mouse.click(2, 2);
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(0);
  await info(c54, 'BRUN').click();
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(1);
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('BRUN x');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(0);
  // Pastille choisie, puis fiche d'une autre et clic dedans : rien ne bouge, la première reste choisie.
  await alba.click();
  await expect(alba).toHaveAttribute('aria-pressed', 'true');
  await info(c54, 'CARO').click();
  await page.getByTestId('fighter-info-sheet').getByTestId('fighter-sheet').click();
  await expect(page.getByTestId('drop-dialog')).toHaveCount(0);
  await expect(alba).toHaveAttribute('aria-pressed', 'true');
  // Clavier : Entrée sur ⓘ ouvre la fiche sans choisir la pastille.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await info(c54, 'DIDI').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('DIDI x');
  await expect(chip(page, c54, 'DIDI')).toHaveAttribute('aria-pressed', 'false');
  // Échap avec le focus resté sur ⓘ ferme la fiche.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(0);
  // Le bac aussi ; glisser depuis ⓘ ne déplace rien.
  const tray = page.getByTestId('planche-tray');
  await info(tray, 'SOLO').dragTo(chip(page, c54, 'ALBA'));
  await expect(page.getByTestId('drop-dialog')).toHaveCount(0);
  // Au clavier aussi, une seule bulle : Entrée sur ⓘ, puis sur un autre ⓘ.
  await info(c54, 'ALBA').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('ALBA x');
  await info(c54, 'BRUN').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(1);
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('BRUN x');
  await expect(info(c54, 'BRUN')).toHaveAttribute('aria-expanded', 'true');
  await expect(info(c54, 'ALBA')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(0);
  // Espace sur ⓘ ouvre la fiche sans choisir la pastille.
  await info(tray, 'SOLO').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('SOLO x');
  await expect(tray.getByTestId('planche-chip').filter({ hasText: 'SOLO' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(0);
  await info(tray, 'SOLO').click();
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('SOLO x');
});

/**
 * Assez de groupes pour faire défiler la page (benjamins, minimes, cadets, juniors, kata) ; deux DUPONT dans deux catégories
 * (benjamines -35 et cadettes -54).
 */
async function seedMany(request: APIRequestContext, id: string): Promise<Record<'b35' | 'c54', string>> {
  // « DUPONT Léa » : nom et prénom (deux combattantes différentes) ; sinon le prénom est « x ».
  const reg = async (name: string, sex: 'F' | 'M', ageBandCode: string, weightClassId: string | null) => {
    const kata = weightClassId === null;
    const [lastName, firstName = 'x'] = name.split(' ');
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName, lastName, sex, ageBandCode, discipline: kata ? 'kata' : 'karate', ruleset: kata ? null : 'jiyu', weightClassId, source: 'manual' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  const pairs: [string, string, 'F' | 'M', string, string | null][] = [
    ['DUPONT Léa', 'ABEL', 'F', 'benjamin', 'benjamin:F:-35'], ['BRAS', 'CYR', 'M', 'benjamin', 'benjamin:M:-40'],
    ['DORA', 'EMMA', 'F', 'minime', 'minime:F:-45'], ['FRED', 'GUS', 'M', 'minime', 'minime:M:-50'],
    ['DUPONT Zoé', 'HANA', 'F', 'cadet', 'cadet:F:-54'], ['IVAN', 'JOEL', 'M', 'cadet', 'cadet:M:-63'],
    ['KIM', 'LOU', 'F', 'junior', 'junior:F:-59'], ['MAX', 'NOE', 'M', 'junior', 'junior:M:-68'],
    ['OPHE', 'PIA', 'F', 'cadet', null],
  ];
  for (const [a, b, sex, band, w] of pairs) { await reg(a, sex, band, w); await reg(b, sex, band, w); }
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const of = (w: string) => cats.find((c) => c.label.includes(w))!.id;
  return { b35: of('-35'), c54: of('-54') };
}

test('planche : barre épinglée ; la recherche défile jusqu’aux cartes et passe de l’une à l’autre (planche, liste, 390 px)', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe recherche');
  const ids = await seedMany(request, id);
  const H = 600;
  await page.setViewportSize({ width: 1280, height: H });
  await page.goto(`/competitions/${id}/tableaux`);
  const cards = page.getByTestId('planche-card');
  await expect(cards).toHaveCount(9);
  const pinned = page.getByTestId('planche-bar');
  const search = page.getByTestId('planche-search');
  const count = page.getByTestId('planche-search-count');
  const appBar = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sk-bar-h')) || 0);
  /** En haut de l'élément : sous la barre épinglée (rien de masqué) et dans l'écran. */
  const underBar = async (l: ReturnType<Page['locator']>) => {
    const p = (await pinned.boundingBox())!;
    const b = (await l.boundingBox())!;
    return b.y >= p.y + p.height - 1 && b.y < H;
  };

  // En bas de la page : la barre et les pastilles des groupes restent en haut, sous la barre de l'appli, avec une ombre.
  await expect(pinned).not.toHaveAttribute('data-stuck', 'true');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const bar = await appBar();
  for (const l of [search, page.getByTestId('planche-jumps')]) {
    const b = (await l.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(bar - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(H);
  }
  await expect(pinned).toHaveAttribute('data-stuck', 'true');
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sk-planche-bar-h')))).toBeGreaterThan(40);
  // Une pastille de groupe : le groupe arrive sous la barre épinglée, pas dessous.
  await page.getByTestId('planche-jump').nth(1).click();
  await expect.poll(() => underBar(page.getByTestId('planche-group').nth(1))).toBe(true);

  // Recherche : rien n'est caché ; les deux cartes de DUPONT sont entourées, la première est la courante et vient sous la barre.
  await search.fill('dupont');
  await expect(count).toHaveText('1 / 2');
  await expect(cards).toHaveCount(9);
  const b35 = card(page, ids.b35);
  const c54 = card(page, ids.c54);
  await expect(b35).toHaveAttribute('data-match', 'current');
  await expect(c54).toHaveAttribute('data-match', 'other');
  await expect(page.locator('[data-match]')).toHaveCount(2);
  await expect.poll(() => underBar(b35)).toBe(true);
  // ↓ : la seconde défile sous la barre, non masquée.
  await search.press('ArrowDown');
  await expect(count).toHaveText('2 / 2');
  await expect(c54).toHaveAttribute('data-match', 'current');
  await expect(b35).toHaveAttribute('data-match', 'other');
  await expect.poll(() => underBar(c54)).toBe(true);
  // Entrée : suivant, en boucle ; Maj+Entrée et ↑ : précédent ; les boutons font de même.
  await search.press('Enter');
  await expect(count).toHaveText('1 / 2');
  await search.press('Shift+Enter');
  await expect(count).toHaveText('2 / 2');
  await search.press('ArrowUp');
  await expect(count).toHaveText('1 / 2');
  await page.getByTestId('planche-search-next').click();
  await expect(count).toHaveText('2 / 2');
  await page.getByTestId('planche-search-prev').click();
  await expect(count).toHaveText('1 / 2');
  await expect.poll(() => underBar(b35)).toBe(true);
  // Sans résultat : rien n'est caché.
  await search.fill('zzz');
  await expect(count).toHaveText('0 / 0');
  await expect(cards).toHaveCount(9);
  await expect(page.locator('[data-match]')).toHaveCount(0);
  // Échap vide la recherche.
  await search.fill('dupont');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(count).toHaveCount(0);
  await expect(page.locator('[data-match]')).toHaveCount(0);
  // « Seulement à traiter » reste un filtre (ici, aucune carte sans adversaire ni cas).
  await page.getByTestId('planche-todo').check();
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('Aucune catégorie ne correspond.')).toBeVisible();
  await page.getByTestId('planche-todo').uncheck();
  await expect(cards).toHaveCount(9);

  // Vue Liste : la recherche choisit la catégorie (son tableau s'affiche) et la liste défile jusqu'à elle.
  await showList(page);
  const rows = page.getByTestId('category-row');
  await expect(rows).toHaveCount(9);
  await search.fill('dupont');
  await expect(count).toHaveText('1 / 2');
  await expect(rows).toHaveCount(9);
  const row = (cid: string) => page.locator(`[data-testid="category-row"][data-category="${cid}"]`);
  await expect(row(ids.b35)).toHaveAttribute('aria-current', 'true');
  await expect(row(ids.b35)).toHaveAttribute('data-match', 'current');
  await expect(page.getByRole('heading', { level: 3, name: /-35/ })).toBeVisible();
  await search.press('ArrowDown');
  await expect(count).toHaveText('2 / 2');
  await expect(row(ids.c54)).toHaveAttribute('aria-current', 'true');
  await expect(row(ids.c54)).toBeInViewport();
  await expect(page.getByRole('heading', { level: 3, name: /-54/ })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');

  // 390 px : le bloc épinglé reste compact (pastilles sur une ligne qui défile), rien de coupé ni de débordement.
  await page.getByTestId('brackets-view').getByText('Planche', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards).toHaveCount(9);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const jumps = (await page.getByTestId('planche-jumps').boundingBox())!;
  expect(jumps.height).toBeLessThan(40);
  const p = (await pinned.boundingBox())!;
  expect(p.y).toBeGreaterThanOrEqual((await appBar()) - 1);
  expect(p.y + p.height).toBeLessThan(844 / 2);
  await search.fill('dupont');
  await search.press('ArrowDown');
  await expect(count).toHaveText('2 / 2');
  await expect.poll(() => underBar(c54)).toBe(true);
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
