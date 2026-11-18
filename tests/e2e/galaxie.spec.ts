import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

interface Cat { id: string; label: string; registrationIds: string[] }

/**
 * Karaté jiyu cadettes : ALBA, BRUN, CARO, DIDI et EVAN en -54, SOLO seule en -61 ; MIXA seule en Shido-mix -61 ;
 * BOXA et BOXB en Shido-boxing -61, TRIA en triathlon -61 (des voisines du -61 de tailles différentes).
 * Sessions « Matin » (cadets), « Soir » (seniors) et « Vide » (vétérans 1) ; le Mix -61 est mis dans « Soir » à la main.
 */
async function seed(request: APIRequestContext, id: string, o: { soloOtherDisciplines?: string[] } = {}): Promise<{ c54: string; c61: string; mix: string; soir: string }> {
  const reg = async (lastName: string, discipline: string, weightClassId: string, otherDisciplines: string[] = []) => {
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'x', lastName, sex: 'F', ageBandCode: 'cadet', discipline, ruleset: 'jiyu', weightClassId, source: 'manual', otherDisciplines },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  for (const n of ['ALBA', 'BRUN', 'CARO', 'DIDI', 'EVAN']) await reg(n, 'karate', 'cadet:F:-54');
  await reg('SOLO', 'karate', 'cadet:F:-61', o.soloOtherDisciplines);
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
  // Les cartes rapprochées tiennent sur l'écran sans s'empiler, et la page ne défile pas (une fois le vol fini).
  await expect(page.locator('[data-testid="galaxy"] [data-testid="planche-card"]:visible')).toHaveCount(5);
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
  await expect.poll(() => maxCardOverlap(page)).toBeGreaterThanOrEqual(0);
  await expect.poll(() => maxCardOverlap(page)).toBeLessThanOrEqual(3);
  for (const id of [ids.c61, ids.c54, ids.mix]) {
    const b = (await card(page, id).boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(720);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

  // Jamais de rouge pour une catégorie à un seul combattant : anneau blanc et badge neutre.
  await expect(mix).toHaveAttribute('data-lone', 'true');
  await expect(c54).not.toHaveAttribute('data-lone', 'true');
  const alone = await mix.getByTestId('card-alone').evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = alone.match(/\d+/g)!.map(Number);
  expect(r! > 180 && g! < 130 && b! < 130, `badge ${alone}`).toBe(false);
  expect(await mix.evaluate((el) => getComputedStyle(el).animationName)).toBe('sk-lone-pulse');

  // Pendant un glisser, les cases restent figées : la carte survolée s'agrandit (indication de dépôt) sans que rien bouge.
  const transforms = () => page.locator('[data-testid="galaxy-card"]').evaluateAll((els) => els.map((el) => (el as HTMLElement).style.transform));
  const before = await transforms();
  await c61.getByTestId('planche-chip').filter({ hasText: 'SOLO' }).hover();
  await page.mouse.down();
  const target = (await c54.getByTestId('card-count').boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.move(target.x + target.width / 2 + 2, target.y + target.height / 2 + 1, { steps: 2 });
  await expect(c54).toHaveAttribute('data-drop', 'ok');
  await page.waitForTimeout(400);
  await expect(c54).toHaveAttribute('data-drop', 'ok');
  expect(await transforms()).toEqual(before);
  // La carte survolée grandit vers le bas : ce qui est sous le pointeur ne bouge pas (sinon le dépôt tombe sur une pastille).
  expect(Math.abs((await c54.getByTestId('card-count').boundingBox())!.y - target.y)).toBeLessThanOrEqual(1);
  // Lâché sur le ciel : rien ne se passe.
  const sky = (await canvas(page).boundingBox())!;
  await page.mouse.move(sky.x + 8, sky.y + sky.height - 8, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Clic sur le titre d'une voisine : elle devient la sélection ; puis retour au -61 par son titre.
  await mix.getByTestId('card-title').click();
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.mix);
  await expect(c61).toBeVisible();
  await c61.getByTestId('card-title').click();
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);
  await expect(c54).toBeVisible();

  // Dézoomer renvoie les cartes à leur place ; un clic sur l'étoile choisie y retourne (et ne désélectionne pas).
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
  const at = (await c61.boundingBox())!;
  const [sx, sy] = [at.x + at.width / 2, at.y + at.height / 2];
  await page.mouse.move(sx, sy);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 200);
  await expect(c61).toBeHidden();
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
  await page.mouse.click(sx, sy);
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);
  await expect(c61).toBeVisible();
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');

  // Clic-clic : SOLO, puis la carte -54 → confirmation → déplacement.
  await c61.getByTestId('planche-chip').filter({ hasText: 'SOLO' }).click();
  await expect(page.getByTestId('planche-banner')).toBeVisible();
  await c54.getByTestId('card-count').click();
  await expect(page.getByRole('dialog')).toContainText('Déplacement manuel');
  const moved = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
  await page.getByTestId('drop-confirm').click();
  expect((await moved).ok()).toBeTruthy();
  // Le -61 vidé a disparu : la galaxie suit SOLO dans sa nouvelle catégorie, et aucune erreur.
  await expect(c61).toHaveCount(0);
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  await expect(c54.getByTestId('planche-chip').filter({ hasText: 'SOLO' })).toBeVisible();
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
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

  // Glisser-déposer à la souris : le -61 revenu redevient la sélection (clic sur son titre) ; SOLO, glissé de sa carte,
  // lâché sur la carte -54 (voisine) → confirmation → déplacement.
  const solo = page.locator('[data-testid="galaxy"] [data-testid="planche-chip"]').filter({ hasText: 'SOLO' });
  await expect(solo).toBeVisible();
  const back61 = page.locator('[data-testid="galaxy"] [data-testid="planche-card"]').filter({ has: page.getByTestId('planche-chip').filter({ hasText: 'SOLO' }) });
  const back61Id = (await back61.getAttribute('data-category'))!;
  await back61.getByTestId('card-title').click();
  await expect(canvas(page)).toHaveAttribute('data-selected', back61Id);
  await expect(c54).toBeVisible();
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
  await expect(page.locator('.mantine-Notification-root')).toHaveCount(0, { timeout: 10_000 });
  await solo.hover();
  await page.mouse.down();
  const onto = (await c54.getByTestId('card-count').boundingBox())!;
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 8 });
  await page.mouse.move(onto.x + onto.width / 2 + 2, onto.y + onto.height / 2 + 1, { steps: 2 });
  await expect(c54).toHaveAttribute('data-drop', 'ok');
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toContainText('Déplacement manuel');
  const dropped = page.waitForResponse((r) => r.url().endsWith('/replacement/move') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmer le déplacement' }).click();
  expect((await dropped).ok()).toBeTruthy();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(c54.getByTestId('planche-chip').filter({ hasText: 'SOLO' })).toBeVisible();
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  // « Annuler » du message : SOLO revient dans le -61.
  const undoneAgain = page.waitForResponse((r) => r.url().includes('/history/undo') && r.request().method() === 'POST');
  await page.locator('.mantine-Notification-root').filter({ hasText: 'SOLO' }).getByTestId('undo-toast-action').click();
  expect((await undoneAgain).ok()).toBeTruthy();
  await expect(c54.getByTestId('planche-chip').filter({ hasText: 'SOLO' })).toHaveCount(0);
  await expect(solo).toBeVisible();
  expect(errors).toEqual([]);
});

test('galaxie : la vue est retenue sur le poste, Échap désélectionne, portée vide sans erreur', async ({ page, request }) => {
  const errors = consoleErrors(page);
  const id = await createCompetition(page, 'Galaxie retenue');
  const ids = await seed(request, id);
  await openGalaxy(page, id);
  // La légende est repliée au départ ; son état est retenu sur le poste.
  const legendToggle = page.getByTestId('galaxy-legend-toggle');
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(legendToggle).toHaveText('Légende ▸');
  await legendToggle.click();
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(canvas(page)).toBeVisible();
  await expect(legendToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('planche')).toHaveCount(0);

  await page.getByTestId('planche-search').fill('ALBA');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  // Échap dans le champ de recherche ne retire pas la sélection ; hors du champ, si.
  await page.getByTestId('planche-search').press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  await page.getByTestId('planche-search').blur();
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-selected', '');

  // Changer de session recadre : la sélection est retirée et la vue d'ensemble revient (spec §4.1).
  await page.getByTestId('planche-search').fill('BRUN');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c54);
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
  expect(Number(await canvas(page).getAttribute('data-zoom'))).toBe(4);
  await page.getByTestId('brackets-wave').getByText('Toutes', { exact: true }).click();
  await expect(canvas(page)).toHaveAttribute('data-selected', '');
  await expect(card(page, ids.c54)).toBeHidden();
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-zoom'))).toBeLessThan(2);
  await page.getByTestId('planche-search').fill('');

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
  await expect(canvas(page)).toHaveAttribute('data-flying', 'false');
  expect(Number(await canvas(page).getAttribute('data-zoom'))).toBe(4);

  // La catégorie choisie disparaît sans que son combattant aille ailleurs (inscription supprimée) : plus de sélection,
  // retour à la vue d'ensemble.
  const regs = (await (await request.get(`/api/competitions/${id}/registrations`)).json()) as { id: string; fighter: { lastName: string } }[];
  const mixa = regs.find((r) => r.fighter.lastName === 'MIXA')!.id;
  expect((await request.delete(`/api/competitions/${id}/registrations/${mixa}`)).ok()).toBeTruthy();
  await expect(canvas(page)).toHaveAttribute('data-selected', '');
  await expect(card(page, ids.mix)).toHaveCount(0);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-zoom'))).toBeLessThan(2);
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

  // Au téléphone, choisir une étoile fait défiler la page jusqu'au canevas (les cartes ne finissent pas sous la barre) ;
  // une bande de page reste au-dessus, pour faire défiler la page sans passer par le canevas.
  expect(box.y).toBeGreaterThan(200);
  await page.getByTestId('planche-search').fill('SOLO');
  await expect(canvas(page)).not.toHaveAttribute('data-selected', '');
  // Sous la barre collante de l'appli et la bande de 64 px, et le bas dans l'écran.
  const bar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sk-bar-h')) || 0);
  await expect.poll(async () => Math.abs((await canvas(page).boundingBox())!.y - (bar + 64))).toBeLessThanOrEqual(2);
  const placed = (await canvas(page).boundingBox())!;
  expect(placed.y + placed.height).toBeLessThanOrEqual(740 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // La bande fait défiler la page (ici à la molette, au-dessus du canevas) : la barre revient.
  await page.mouse.move(180, bar + 30);
  await page.mouse.wheel(0, -2000);
  await expect.poll(async () => (await page.getByTestId('planche-search').boundingBox())!.y).toBeGreaterThan(0);
});

test('galaxie : passer sous 600 px garde la barre (la recherche garde la main) ; un clic entre ses boutons va au canevas', async ({ page, request }) => {
  const id = await createCompetition(page, 'Galaxie souple');
  const ids = await seed(request, id);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGalaxy(page, id);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-stars'))).toBeGreaterThanOrEqual(2);

  // Bureau : la bande de la barre flotte sur le canevas ; un clic entre « Tous les liens » et le sélecteur de vue tombe
  // sur le canevas (ciel vide : rien ne change), pas sur la bande.
  const allLinks = (await page.getByTestId('galaxy-all-links').boundingBox())!;
  const between = { x: allLinks.x + allLinks.width + 3, y: allLinks.y + allLinks.height / 2 };
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null, between);
  expect(under).toBe('galaxy-canvas');

  // Recherche en cours, puis la fenêtre passe sous 600 px : la barre passe au-dessus du canevas sans être recréée.
  const search = page.getByTestId('planche-search');
  await search.click();
  await search.pressSequentially('-6');
  await page.setViewportSize({ width: 500, height: 720 });
  await expect.poll(async () => (await search.boundingBox())!.y + 10 < (await canvas(page).boundingBox())!.y).toBe(true);
  await expect(search).toBeFocused();
  await search.pressSequentially('1 Karaté');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);
});

test('galaxie : grille introuvable : un message d’erreur, pas un chargement sans fin', async ({ page, request }) => {
  const id = await createCompetition(page, 'Galaxie sans grille');
  await seed(request, id);
  await page.route(`**/api/competitions/${id}/grid`, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'grille cassée' }) }));
  await page.goto(`/competitions/${id}/tableaux`);
  await page.getByTestId('brackets-view').getByText('Galaxie', { exact: true }).click();
  await expect(page.getByTestId('galaxy').getByTestId('api-error')).toBeVisible({ timeout: 15_000 });
  await expect(canvas(page)).toHaveCount(0);
});

test('galaxie : voisine interdite par les réglages : lien gris, carte, dépôt avec confirmation', async ({ page, request }) => {
  const errors = consoleErrors(page);
  const id = await createCompetition(page, 'Galaxie interdite');
  // SOLO accepte le Shido-mix : seul le réglage interdit le passage (pas ses préférences).
  const ids = await seed(request, id, { soloOtherDisciplines: ['shido-mix'] });
  // « Autre discipline » désactivée : le Mix -61 n'est plus une voisine permise du karaté -61.
  const comp = await (await request.get(`/api/competitions/${id}`)).json();
  const settings = { ...comp.settings, replacementRules: { ...comp.settings.replacementRules, off: ['discipline'] } };
  expect((await request.patch(`/api/competitions/${id}`, { data: { settings } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGalaxy(page, id);
  await page.getByTestId('planche-search').fill('-61 Karaté');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);

  // La voisine interdite vient quand même en carte, avec l'étiquette grise du réglage et son badge de session.
  const mix = card(page, ids.mix);
  await expect(mix).toBeVisible();
  const badge = page.locator(`[data-testid="galaxy-card"][data-category="${ids.mix}"] [data-testid="galaxy-card-rule"]`);
  await expect(badge).toHaveAttribute('data-forbidden', 'true');
  await expect(badge).toHaveText('Interdit : Autre discipline (préférences)');
  await expect(mix.getByTestId('card-session')).toHaveText('Soir');
  // La voisine permise (-54) n'a pas l'étiquette d'interdit.
  await expect(page.locator(`[data-testid="galaxy-card"][data-category="${ids.c54}"] [data-testid="galaxy-card-rule"]`)).not.toHaveAttribute('data-forbidden', 'true');

  // Légende : la ligne des liens interdits (sans sélection : elle s'efface au zoom maximal). Échap est ignoré dans la
  // recherche : on la quitte d'abord.
  await page.getByTestId('planche-search').blur();
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-selected', '');
  await page.getByTestId('galaxy-legend-toggle').click();
  await expect(page.getByTestId('galaxy-legend')).toContainText('interdit par les réglages (déplacement à la main, avec confirmation)');

  // Clic-clic : SOLO vers la carte interdite → la confirmation nomme la règle désactivée.
  await page.getByTestId('planche-search').fill('');
  await page.getByTestId('planche-search').fill('-61 Karaté');
  await expect(card(page, ids.c61)).toBeVisible();
  await expect(mix).toBeVisible();
  await card(page, ids.c61).getByTestId('planche-chip').filter({ hasText: 'SOLO' }).click();
  await expect(page.getByTestId('planche-banner')).toBeVisible();
  await mix.getByTestId('card-count').click();
  await expect(page.getByRole('dialog')).toContainText('Règle « Autre discipline (préférences) » désactivée (réglages de réaffectation).');
  expect(errors).toEqual([]);
});

test('galaxie : « Voir dans la galaxie » depuis un cas de la Réaffectation', async ({ page, request }) => {
  const errors = consoleErrors(page);
  const id = await createCompetition(page, 'Galaxie réaffectation');
  const ids = await seed(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const solo = page.getByTestId('replacement-case').filter({ hasText: 'SOLO' });
  await expect(solo).toBeVisible();
  await solo.getByTestId('case-see-galaxy').click();
  await expect(page).toHaveURL(/\/tableaux/);
  await expect(canvas(page)).toBeVisible();
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);
  await expect(card(page, ids.c61)).toBeVisible();
  expect(errors).toEqual([]);
});

test('galaxie : ⓘ d’une pastille ouvre la fiche', async ({ page, request }) => {
  const id = await createCompetition(page, 'Galaxie fiche');
  const ids = await seed(request, id);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGalaxy(page, id);
  await page.getByTestId('planche-search').fill('-61 Karaté');
  const c61 = card(page, ids.c61);
  await expect(c61).toBeVisible();
  await c61.getByTestId('planche-chip').first().getByTestId('fighter-info').click();
  await expect(page.getByTestId('fighter-info-sheet').getByTestId('fighter-sheet')).toContainText('Licence');
  await expect(page.getByTestId('galaxy-canvas')).toHaveAttribute('data-selected', ids.c61);
});
