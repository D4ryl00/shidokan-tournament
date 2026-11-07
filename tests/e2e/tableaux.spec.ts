import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCompetition, showList } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  const club = async (name: string) => (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()).id as string;
  const tani = await club('Tani Dojo');
  const others = [await club('Issa'), await club('Shinsengumi')];
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    });
  await reg({ clubId: tani, lastName: 'TANI1' });
  await reg({ clubId: tani, lastName: 'TANI2' });
  await reg({ clubId: others[0], lastName: 'ISSA' });
  await reg({ clubId: others[1], lastName: 'SHIN' });
  await reg({ clubId: others[1], lastName: 'KATA', discipline: 'kata', ruleset: null, weightClassId: null });
}

test('tableaux : catégories, séparation des clubs, format, tirage, prête, impression', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe tableaux');
  await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await expect(page.getByTestId('category-row')).toHaveCount(2);
  await expect(page.getByTestId('category-row').filter({ hasText: 'Kata' }).getByTestId('category-alone')).toBeVisible();

  await page.getByTestId('category-row').filter({ hasText: '-54' }).click();
  const matches = page.getByTestId('bracket-match');
  await expect(matches).toHaveCount(3);
  // Tableau en arbre : demi-finales reliées à la finale.
  await expect(page.getByTestId('bracket-tree')).toBeVisible();
  await expect(page.locator('.bracket-slot.has-next')).toHaveCount(2);
  // 1er tour : les deux Tani Dojo ne s'affrontent pas.
  for (const i of [0, 1]) await expect(matches.nth(i)).not.toContainText(/TANI1[\s\S]*TANI2|TANI2[\s\S]*TANI1/);

  await page.getByTestId('category-format').click();
  await page.getByRole('option', { name: 'Poule (tous contre tous)' }).click();
  await expect(matches).toHaveCount(6);

  const before = await page.getByTestId('bracket-entrant').allTextContents();
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    await page.getByTestId('category-redraw').click();
    await page.waitForTimeout(200);
    changed = (await page.getByTestId('bracket-entrant').allTextContents()).join() !== before.join();
  }
  expect(changed).toBe(true);

  await page.getByTestId('category-ready').click();
  await expect(page.getByTestId('category-row').filter({ hasText: '-54' }).getByTestId('category-status')).toHaveText('Prête');

  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section')).toHaveCount(1); // le kata seul n'est pas imprimé
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button')).toHaveCount(0);
  await page.goto(`/competitions/${id}/impression?categories=${(await (await request.get(`/api/competitions/${id}/categories`)).json()).map((c: { id: string }) => c.id).join(',')}`);
  await expect(page.getByTestId('print-section')).toHaveCount(2);
});

test('tableau d’un seul combattant : sa case est affichée et permet de le déplacer', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe tableau seul');
  await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await page.getByTestId('category-row').filter({ hasText: 'Kata' }).click();
  const view = page.getByTestId('bracket-view');
  await expect(view).toContainText('n’a pas d’adversaire dans cette catégorie');
  const entrant = view.getByTestId('bracket-entrant');
  await expect(entrant).toHaveCount(1);
  await expect(entrant).toContainText('KATA');
  await expect(entrant).toContainText('Shinsengumi');
  await expect(page.getByTestId('swap-select')).toContainText('Cliquez sur l’inscrit pour le déplacer');
  await entrant.click();
  await expect(page.getByTestId('move-entrant-panel')).toContainText('KATA');
});

test('impression : un grand tableau tient sur une page A4 paysage', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe grands tableaux');
  for (let i = 0; i < 17; i++) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `GRAND${i}`, firstName: 'Combattante', sex: 'F', ageBandCode: 'senior', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-55', source: 'manual' },
    });
  }
  for (let i = 0; i < 9; i++) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `DOUBLE${i}`, firstName: 'Combattant', sex: 'M', ageBandCode: 'senior', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:M:-75', source: 'manual' },
    });
  }
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; registrationIds: string[] }[];
  const nine = cats.find((c) => c.registrationIds.length === 9)!;
  await request.patch(`/api/competitions/${id}/categories/${nine.id}`, { data: { format: 'double_elimination' } });

  await page.setViewportSize({ width: 1123, height: 794 });
  await page.goto(`/competitions/${id}/impression`);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('print-section')).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('print-fit')).toHaveCount(2);
  for (const box of await page.getByTestId('print-fit').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.width).toBeLessThanOrEqual(1050);
    expect(box.height).toBeLessThanOrEqual(660);
  }
});

test('impression : poule en grille croisée, kata sans badge', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe grille');
  for (let i = 0; i < 3; i++) {
    await request.post(`/api/competitions/${id}/registrations`, { data: { clubId: null, lastName: `POULE${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' } });
    await request.post(`/api/competitions/${id}/registrations`, { data: { clubId: null, lastName: `KATA${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' } });
  }
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section')).toHaveCount(2);
  await expect(page.getByTestId('pool-grid')).toHaveCount(1);
  await expect(page.getByTestId('print-section').filter({ hasText: 'Kata' }).locator('.mantine-Badge-root')).toHaveCount(0);
});

test('impression : nom de la zone sur le tableau', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe zones impression');
  const reg = (lastName: string, weightClassId: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
  for (let i = 0; i < 4; i++) await reg(`ZONE${i}`, 'cadet:F:-54');
  for (let i = 0; i < 2; i++) await reg(`SANS${i}`, 'cadet:F:-61');
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string; name: string }[];
  await request.put(`/api/competitions/${id}/zones`, { data: [{ id: zones[0]!.id, name: 'Ring' }, { id: zones[1]!.id, name: zones[1]!.name }] });
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const withZone = cats.find((c) => c.label.includes('-54'))!;
  const without = cats.find((c) => c.label.includes('-61'))!;
  await request.patch(`/api/competitions/${id}/categories/${withZone.id}`, { data: { zoneId: zones[0]!.id } });
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section').filter({ hasText: withZone.label })).toContainText('Zone : Ring');
  // Non épinglée : la zone de la répartition automatique (l'autre zone, moins chargée).
  await expect(page.getByTestId('print-section').filter({ hasText: without.label })).toContainText('Zone : Tatami 2');
});

test('même club au 1er tour : club en orange, message et annulation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe meme club ecran');
  await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await page.getByTestId('category-row').filter({ hasText: '-54' }).click();
  await expect(page.getByTestId('same-club')).toHaveCount(0);
  const entrant = (n: string) => page.getByTestId('bracket-view').getByTestId('bracket-entrant').filter({ hasText: n }).first();
  // Les deux Tani Dojo sont séparés au tirage.
  const matches = page.getByTestId('bracket-match');
  const m0 = (await matches.nth(0).textContent()) ?? '';
  const m1 = (await matches.nth(1).textContent()) ?? '';
  const tani1In0 = m0.includes('TANI1');
  const tani1Match = tani1In0 ? m0 : m1;
  const opponent = tani1Match.includes('ISSA') ? 'ISSA' : 'SHIN';
  // TANI2 est dans l'autre match : l'échanger avec l'adversaire de TANI1.
  await entrant('TANI2').click();
  await entrant(opponent).click();
  await expect(page.getByTestId('same-club')).toHaveCount(2);
  const toast = page.locator('.mantine-Notification-root').filter({ hasText: 'se rencontrent au 1er tour.' });
  await expect(toast).toContainText('TANI1');
  await expect(toast).toContainText('Tani Dojo');
  await toast.getByTestId('undo-toast-action').click();
  await expect(page.getByTestId('same-club')).toHaveCount(0);
});

test('planche : groupes, recherche, bac, même club, agrandir, Liste retenue', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe planche');
  await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  // Planche par défaut : deux cartes (-54 kg et kata) dans deux groupes.
  await expect(page.getByTestId('planche-card')).toHaveCount(2);
  await expect(page.getByTestId('planche-group')).toHaveCount(2);
  await expect(page.getByTestId('planche-jump')).toHaveCount(2);
  const card = page.getByTestId('planche-card').filter({ hasText: '-54' });
  await expect(card.getByTestId('planche-chip')).toHaveCount(4);
  await expect(card).toContainText('COMBAT 1');
  // Bac : le kata est seul.
  await expect(page.getByTestId('planche-tray')).toContainText('Sans adversaire (1)');
  await expect(page.getByTestId('planche-tray').getByTestId('planche-chip')).toHaveCount(1);
  // Recherche.
  await page.getByTestId('planche-search').fill('issa');
  await expect(page.getByTestId('planche-card')).toHaveCount(1);
  await page.getByTestId('planche-search').fill('zzz');
  await expect(page.getByText('Aucune catégorie ne correspond.')).toBeVisible();
  await page.getByTestId('planche-search').fill('');
  // Classer par zone : une zone automatique.
  await page.getByTestId('planche-sort').click();
  await page.getByRole('option', { name: 'Zone' }).click();
  await expect(page.getByTestId('planche-group').first()).toContainText('Tatami 1');
  // Agrandir : le vrai tableau, avec Nouveau tirage.
  await card.getByTestId('card-grow').click();
  await expect(card.getByTestId('bracket-view')).toBeVisible();
  await expect(card.getByTestId('card-redraw')).toBeVisible();
  // La Liste est retenue.
  await showList(page);
  await page.reload();
  await expect(page.getByTestId('category-row')).toHaveCount(2);
  await page.getByTestId('brackets-view').getByText('Planche', { exact: true }).click();
  await expect(page.getByTestId('planche')).toBeVisible();
  // « Ouvrir dans la liste ».
  await page.getByTestId('planche-card').filter({ hasText: '-54' }).getByTestId('card-open-list').click();
  await expect(page.getByTestId('category-actions')).toBeVisible();
});

test('planche : lien « voir » entoure la carte, lisible à 360 px', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe planche voir');
  await seed(request, id);
  const cid = ((await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[]).find((c) => c.label.includes('-54'))!.id;
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/competitions/${id}/tableaux?vue=planche&voir=${cid}`);
  await expect(page.getByTestId('planche-card').and(page.locator(`[data-category="${cid}"]`))).toHaveAttribute('data-ring', 'see');
  await expect(page.getByTestId('planche-card').and(page.locator(`[data-category="${cid}"]`))).not.toHaveAttribute('data-ring', 'see', { timeout: 5000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
