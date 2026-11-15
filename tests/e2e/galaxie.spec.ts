import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

interface Cat { id: string; label: string; registrationIds: string[] }

/**
 * Karaté jiyu cadettes : ALBA, BRUN, CARO, DIDI et EVAN en -54, SOLO seule en -61 ; MIXA seule en Shido-mix -61 ;
 * BOXA et BOXB en Shido-boxing -61, TRIA en triathlon -61 (des voisines du -61 de tailles différentes).
 * Sessions « Matin » (cadets), « Soir » (seniors) et « Vide » (vétérans 1) ; le Mix -61 est mis dans « Soir » à la main.
 */
async function seed(request: APIRequestContext, id: string): Promise<{ c54: string; c61: string; mix: string; soir: string }> {
  const reg = async (lastName: string, discipline: string, weightClassId: string) => {
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'x', lastName, sex: 'F', ageBandCode: 'cadet', discipline, ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  for (const n of ['ALBA', 'BRUN', 'CARO', 'DIDI', 'EVAN']) await reg(n, 'karate', 'cadet:F:-54');
  await reg('SOLO', 'karate', 'cadet:F:-61');
  await reg('MIXA', 'shido-mix', 'cadet:F:-61');
  for (const n of ['BOXA', 'BOXB']) await reg(n, 'shido-boxing', 'cadet:F:-61');
  await reg('TRIA', 'triathlon', 'cadet:F:-61');
  const waves = (await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    { name: 'Soir', rules: { ageBandCodes: ['senior'], disciplines: [] } },
    { name: 'Vide', rules: { ageBandCodes: ['v1'], disciplines: [] } },
  ] })).json()) as { id: string; name: string }[];
  const soir = waves.find((w) => w.name === 'Soir')!.id;
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as Cat[];
  const of = (f: (c: Cat) => boolean) => cats.find(f)!.id;
  const ids = {
    c54: of((c) => c.label.startsWith('Karaté') && c.label.includes('-54')),
    c61: of((c) => c.label.startsWith('Karaté') && c.label.includes('-61')),
    mix: of((c) => c.label.startsWith('Shido-mix')),
    soir,
  };
  expect((await request.patch(`/api/competitions/${id}/categories/${ids.mix}`, { data: { waveOverride: soir } })).ok()).toBeTruthy();
  return ids;
}

/** Erreurs de la console et de la page, relevées pendant tout le test. */
function consoleErrors(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') out.push(m.text()); });
  page.on('pageerror', (e) => out.push(e.message));
  return out;
}

/** Plus grand chevauchement (px, sur le côté le plus court) entre deux cartes visibles de la galaxie. */
async function maxCardOverlap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="galaxy"] [data-testid="planche-card"]'))
      .filter((el) => getComputedStyle(el).visibility === 'visible')
      .map((el) => el.getBoundingClientRect());
    let worst = 0;
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 0 && iy > 0) worst = Math.max(worst, Math.min(ix, iy));
    }));
    return boxes.length < 2 ? -1 : worst;
  });
}

const card = (page: Page, categoryId: string) => page.locator(`[data-testid="planche-card"][data-category="${categoryId}"]`);
const canvas = (page: Page) => page.getByTestId('galaxy-canvas');

async function openGalaxy(page: Page, id: string) {
  await page.goto(`/competitions/${id}/tableaux`);
  await page.getByTestId('brackets-view').getByText('Galaxie', { exact: true }).click();
  await expect(canvas(page)).toBeVisible();
}

test('galaxie : choisir la vue, chercher, voir les voisines en cartes, déplacer au clic-clic et annuler', async ({ page, request }) => {
  const errors = consoleErrors(page);
  const id = await createCompetition(page, 'Galaxie bleue');
  const ids = await seed(request, id);
  // L'écran du PC de la table centrale.
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGalaxy(page, id);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-stars'))).toBeGreaterThanOrEqual(2);
  await expect(canvas(page)).toHaveAttribute('data-selected', '');

  // Une recherche qui ne trouve qu'une catégorie la sélectionne.
  const search = page.getByTestId('planche-search');
  await search.fill('-61');
  await search.fill('-61 Karaté');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);

  // Fin du vol : la sélection et ses voisines en cartes, celle de l'autre session avec son badge.
  const c61 = card(page, ids.c61);
  const c54 = card(page, ids.c54);
  const mix = card(page, ids.mix);
  await expect(c61).toBeVisible();
  await expect(c54).toBeVisible();
  await expect(mix).toBeVisible();
  await expect(mix.getByTestId('card-session')).toHaveText('Soir');
  await expect(c61.getByTestId('card-session')).toHaveCount(0);
  await expect(page.getByTestId('galaxy-legend')).toHaveCSS('opacity', '0');
  // Les cartes rapprochées tiennent sur l'écran sans s'empiler, et la page ne défile pas.
  await expect(page.locator('[data-testid="galaxy"] [data-testid="planche-card"]:visible')).toHaveCount(5);
  await expect.poll(() => maxCardOverlap(page)).toBeGreaterThanOrEqual(0);
  await expect.poll(() => maxCardOverlap(page)).toBeLessThanOrEqual(3);
  for (const id of [ids.c61, ids.c54, ids.mix]) {
    const b = (await card(page, id).boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(720);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

  // Clic sur le titre d'une voisine : elle devient la sélection ; puis retour au -61 par son titre.
  await mix.getByTestId('card-title').click();
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.mix);
  await expect(c61).toBeVisible();
  await c61.getByTestId('card-title').click();
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);
  await expect(c54).toBeVisible();

  // Clic-clic : SOLO, puis la carte -54 → confirmation → déplacement.
  await c61.getByTestId('planche-chip').filter({ hasText: 'SOLO' }).click();
  await expect(page.getByTestId('planche-banner')).toBeVisible();
  await c54.getByTestId('card-count').click();
  await expect(page.getByRole('dialog')).toContainText('Déplacement manuel');
  const moved = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
  await page.getByTestId('drop-confirm').click();
  expect((await moved).ok()).toBeTruthy();
  // Le -61 vidé a disparu : plus de sélection, plus de cartes, et aucune erreur.
  await expect(canvas(page)).toHaveAttribute('data-selected', '');
  await expect(c61).toHaveCount(0);
  expect(errors).toEqual([]);

  // « Annuler » : SOLO revient dans le -61.
  const undone = page.waitForResponse((r) => r.url().includes('/history/undo') && r.request().method() === 'POST');
  await page.locator('.mantine-Notification-root').filter({ hasText: 'SOLO' }).getByTestId('undo-toast-action').click();
  expect((await undone).ok()).toBeTruthy();
  await expect.poll(async () => {
    const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as Cat[];
    const regs = (await (await request.get(`/api/competitions/${id}/registrations`)).json()) as { id: string; fighter: { lastName: string } }[];
    const solo = regs.find((r) => r.fighter.lastName === 'SOLO')!.id;
    return cats.find((c) => c.registrationIds.includes(solo))?.label ?? '';
  }).toMatch(/^Karaté · Jiyu · Cadets F · -61 kg$/);
  expect(errors).toEqual([]);
});

test('galaxie : la vue est retenue sur le poste, Échap désélectionne, portée vide sans erreur', async ({ page, request }) => {
  const errors = consoleErrors(page);
  const id = await createCompetition(page, 'Galaxie retenue');
  const ids = await seed(request, id);
  await openGalaxy(page, id);
  await page.reload();
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByTestId('planche')).toHaveCount(0);

  await page.getByTestId('planche-search').fill('ALBA');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  await page.getByTestId('planche-search').blur();
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-selected', '');

  // Une session sans catégorie : pas de canevas, « Aucune catégorie. ».
  await page.getByTestId('brackets-wave').getByText('Vide', { exact: true }).click();
  await expect(page.getByText('Aucune catégorie.')).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  await page.getByTestId('brackets-wave').getByText('Toutes', { exact: true }).click();
  await expect(canvas(page)).toBeVisible();

  // « Voir dans la planche » : la planche, la carte entourée.
  await page.getByTestId('planche-search').fill('BRUN');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  await card(page, ids.c54).getByTestId('galaxy-see-planche').click();
  await expect(page.getByTestId('planche')).toBeVisible();
  await expect(card(page, ids.c54)).toHaveAttribute('data-ring', 'see');

  // Lien de la Réaffectation : la galaxie s'ouvre sur la catégorie, « Toutes » si elle est d'une autre session.
  await page.goto(`/competitions/${id}/tableaux?vue=galaxie&categorie=${ids.mix}`);
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.mix);
  await expect(page.getByTestId('brackets-wave').locator('input[value="all"]')).toBeChecked();
  await expect(card(page, ids.mix)).toBeVisible();
  await expect(page).not.toHaveURL(/categorie=/);
  expect(errors).toEqual([]);
});

test('galaxie : 360 px sans débordement horizontal', async ({ page, request }) => {
  const id = await createCompetition(page, 'Galaxie étroite');
  await seed(request, id);
  await page.setViewportSize({ width: 360, height: 740 });
  await openGalaxy(page, id);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-stars'))).toBeGreaterThanOrEqual(2);
  const box = (await canvas(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
