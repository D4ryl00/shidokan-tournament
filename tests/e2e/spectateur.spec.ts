import { expect, test, type Page } from '@playwright/test';
import { clipped, SERVER_SESSION } from './helpers.js';

// Mode spectateur : serveur en ligne (port 3101). L'organisateur réutilise la session ouverte une fois par `global-setup.ts`
// (aucune connexion de plus : 10 par adresse en 15 minutes) ; le visiteur n'a aucune session.
test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

const NAME = `Spectateurs Démo ${Date.now()}`;
/** Déplie la première catégorie de l'onglet Tableaux (elle peut déjà l'être). */
async function openFirstCategory(v: Page) {
  const item = v.getByTestId('public-category-item').first();
  await expect(item).toBeVisible();
  if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
  await expect(v.getByTestId('public-bracket-scroll')).toBeVisible();
}
const TABS = ['suivis', 'zones', 'tableaux', 'resultats'] as const;

test('spectateur : compétition privée invisible, rendue publique, suivi d’un combattant, résultat en direct, nom masqué, retour en privé', async ({ page, request, browser }) => {
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });

  // 1. Compétition créée et lancée par l'API, encore privée.
  const id = ((await (await request.post('/api/competitions', { data: { name: NAME, date: today } })).json()) as { id: string }).id;
  const base = `/api/competitions/${id}`;
  const [zone] = (await (await request.get(`${base}/zones`)).json()) as { id: string }[];
  for (const [lastName, firstName] of [['ALPHA', 'Anna'], ['BRAVO', 'Berta'], ['CHARLIE', 'Cora'], ['MASQUEE', 'Mina']]) {
    const res = await request.post(`${base}/registrations`, { data: { clubId: null, lastName, firstName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' } });
    expect(res.ok()).toBeTruthy();
  }
  type Reg = { id: string; fighterId: string; fighter: { lastName: string; firstName: string } };
  const regs = (await (await request.get(`${base}/registrations`)).json()) as Reg[];
  const masked = regs.find((r) => r.fighter.lastName === 'MASQUEE')!;
  expect((await request.put(`${base}/fighters/${masked.fighterId}/public-name`, { data: { hidden: true } })).ok()).toBeTruthy();
  type Cat = { id: string; bracket: { matches: { id: string; a: { registrationId?: string }; b: { registrationId?: string } }[] } };
  const cats = async () => (await (await request.get(`${base}/categories`)).json()) as Cat[];
  for (const c of await cats()) expect((await request.patch(`${base}/categories/${c.id}`, { data: { status: 'ready', zoneId: zone!.id } })).ok()).toBeTruthy();
  expect((await request.post(`${base}/launch`, { data: { waveId: null } })).status()).toBe(204);
  const cat = (await cats())[0]!;
  const first = cat.bracket.matches.find((m) => m.id === 'w1-0')!;
  // Le vainqueur du premier combat : un côté non masqué.
  const winnerSide = first.a.registrationId === masked.id ? 'b' : 'a';
  const winner = regs.find((r) => r.id === (winnerSide === 'a' ? first.a : first.b).registrationId)!;

  const visitor = await browser.newContext({ baseURL: 'http://localhost:3101', storageState: { cookies: [], origins: [] } });
  const v = await visitor.newPage();
  await v.goto('/');
  await expect(v.getByRole('heading', { name: 'Compétitions' })).toBeVisible();
  await expect(v.getByTestId('public-empty').or(v.getByTestId('public-competition').first())).toBeVisible();
  await expect(v.getByText(NAME)).toHaveCount(0);

  // 2. Rendue publique dans les Réglages.
  await page.goto(`/competitions/${id}/reglages`);
  await page.getByTestId('visibility').getByText('Publique', { exact: true }).click();
  await expect(page.getByTestId('visibility-link')).toBeVisible();
  await v.reload();
  const today_ = v.getByRole('region', { name: 'Aujourd’hui' });
  await expect(today_.getByTestId('public-competition').filter({ hasText: NAME })).toBeVisible();
  await expect(v.getByRole('link', { name: 'Connexion organisateurs' })).toBeVisible();

  // 3. Le visiteur cherche un nom, l'épingle, lit zone et numéro.
  await today_.getByTestId('public-competition').filter({ hasText: NAME }).click();
  await expect(v).toHaveURL(new RegExp(`/public/${id}`));
  await v.getByTestId('public-search').fill(winner.fighter.lastName);
  const row = v.getByTestId('public-search-fighter').filter({ hasText: winner.fighter.lastName });
  await expect(row).toHaveCount(1);
  await row.getByTestId('public-star').click();
  await v.getByTestId('public-search').fill('');
  const next = v.getByTestId('public-follow-card').getByTestId('public-follow-next');
  await expect(next).toContainText(/Tatami 1/);
  await expect(next).toContainText(/n° \d+/);

  // 4. L'organisateur saisit un résultat : la page du visiteur affiche le vainqueur sans recharger.
  expect((await request.put(`${base}/categories/${cat.id}/results/w1-0`, { data: { winner: winnerSide, method: 'points' } })).ok()).toBeTruthy();
  await expect(v.getByTestId('public-follow-line')).toContainText('a battu', { timeout: 15_000 });
  await expect(v.getByTestId('public-follow-line')).toContainText('Gagné');

  // 5. Un combattant masqué n'apparaît nulle part dans le texte de la page.
  await v.getByTestId('public-search').fill('MASQUEE');
  await expect(v.getByTestId('public-search-empty')).toBeVisible();
  await v.getByTestId('public-search').fill('');
  for (const tab of TABS) {
    await v.goto(`/public/${id}?onglet=${tab}`);
    await expect(v.getByTestId(`public-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    if (tab === 'tableaux') await openFirstCategory(v);
    const text = await v.locator('body').innerText();
    expect(text, tab).not.toMatch(/masquee|\bmina\b/i);
    if (tab === 'tableaux') expect(text).toContain('Combattant masqué');
  }

  // 6. À 360 px, rien ne dépasse sur les quatre onglets (avant le retour en privé, qui vide la page).
  await v.setViewportSize({ width: 360, height: 740 });
  for (const tab of TABS) {
    await v.goto(`/public/${id}?onglet=${tab}`);
    await expect(v.getByTestId(`public-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    if (tab === 'tableaux') await openFirstCategory(v);
    expect(await clipped(v), tab).toEqual([]);
    expect(await v.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), tab).toBeLessThanOrEqual(0);
  }

  // 7. Sur téléphone : depuis Zones, un passage ouvre son tableau à l'écran ; Retour revient sur Zones ; un autre onglet repart du haut.
  await v.setViewportSize({ width: 360, height: 640 });
  await v.goto(`/public/${id}?onglet=zones`);
  await expect(v.getByTestId('public-zones-session')).toHaveText(/^Session unique(?: · démarrée vers\s\d{1,2}:\d{2})?$/);
  await v.getByTestId('public-zone-passage').first().click();
  await expect(v).toHaveURL(new RegExp(`onglet=tableaux&categorie=${cat.id}`));
  await expect(v.getByTestId('public-category')).toBeInViewport();
  await v.goBack();
  await expect(v.getByTestId('public-tab-zones')).toHaveAttribute('aria-current', 'page');
  await v.goto(`/public/${id}?onglet=tableaux`);
  const item = v.getByTestId('public-category-item').first();
  await item.click();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
  // Le tableau s'ouvre juste sous la catégorie touchée, à l'écran.
  await expect(v.getByTestId('public-category')).toBeInViewport();
  const [itemBox, detailBox] = [await item.boundingBox(), await v.getByTestId('public-category').boundingBox()];
  expect(detailBox!.y).toBeGreaterThanOrEqual(itemBox!.y + itemBox!.height);
  expect(detailBox!.y - (itemBox!.y + itemBox!.height)).toBeLessThan(20);
  await v.evaluate(() => window.scrollTo(0, 200));
  await v.getByTestId('public-tab-resultats').click();
  await expect(v.getByTestId('public-tab-resultats')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => v.evaluate(() => window.scrollY)).toBe(0);
  // Page de connexion ouverte depuis l'accueil public : un lien y ramène (aucune connexion faite).
  await v.getByTestId('organiser-login').click();
  await expect(v.getByTestId('login-email')).toBeVisible();
  await v.getByTestId('login-back-public').click();
  await expect(v.getByRole('heading', { name: 'Compétitions' })).toBeVisible();

  // 8. iPhone (390 × 844) : la fin de chaque onglet se laisse remonter au-dessus de la barre d'onglets fixe ; champs à 16 px.
  await v.setViewportSize({ width: 390, height: 844 });
  for (const tab of TABS) {
    await v.goto(`/public/${id}?onglet=${tab}`);
    await expect(v.getByTestId(`public-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    if (tab === 'tableaux') await openFirstCategory(v);
    await v.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const [last, bar] = [await v.locator('.sk-pub-body > :last-child').boundingBox(), await v.locator('.sk-pub-tabs').boundingBox()];
    expect(last!.y + last!.height, tab).toBeLessThanOrEqual(bar!.y);
  }
  await v.goto(`/public/${id}?onglet=suivis`);
  expect(await v.getByTestId('public-search').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

  // 9. Repassée en privée : la page ouverte l'annonce.
  await v.goto(`/public/${id}`);
  await expect(v.getByRole('heading', { name: NAME })).toBeVisible();
  await page.getByTestId('visibility').getByText('Privée', { exact: true }).click();
  await expect(v.getByTestId('public-gone')).toHaveText(/Cette compétition n’est plus affichée\./, { timeout: 15_000 });
  await v.goto('/');
  await expect(v.getByText(NAME)).toHaveCount(0);
  await visitor.close();
});
