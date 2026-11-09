import { expect, test } from '@playwright/test';
import { clipped, createCompetition, openTab, SERVER_SESSION } from './helpers.js';

// Mode spectateur, lot 2 : heures et durées. Serveur en ligne (port 3101), session de l'organisateur réutilisée (aucune connexion
// de plus), visiteur sans session.
test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

const NAME = `Horaires publics ${Date.now()}`;

test('horaires : durées et heure prévue réglées par l’organisateur, estimations lues par le visiteur, mise à jour en direct', async ({ page, request, browser }) => {
  const id = await createCompetition(page, NAME);
  const base = `/api/competitions/${id}`;
  // D'abord à venir (demain) : l'accueil public n'affiche l'heure prévue que dans « À venir ». Elle passera à aujourd'hui plus
  // bas, car l'heure estimée ne se calcule que le jour J.
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  expect((await request.patch(base, { data: { date: day(1) } })).ok()).toBeTruthy();

  // Mise en place par l'API (hors de ce qui est testé) : une session, quatre cadettes, une catégorie prête sur une zone.
  const [zone] = (await (await request.get(`${base}/zones`)).json()) as { id: string }[];
  const waves = (await (await request.put(`${base}/waves`, { data: [{ name: 'Session 1', rules: { ageBandCodes: ['cadet'], disciplines: [] } }] })).json()) as { id: string }[];
  const waveId = waves[0]!.id;
  for (const [lastName, firstName] of [['ALPHA', 'Anna'], ['BRAVO', 'Berta'], ['CHARLIE', 'Cora'], ['DELTA', 'Dora']]) {
    const res = await request.post(`${base}/registrations`, { data: { clubId: null, lastName, firstName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' } });
    expect(res.ok()).toBeTruthy();
  }
  type Cat = { id: string; bracket: { matches: { id: string; a: { registrationId?: string }; b: { registrationId?: string } }[] } };
  const cats = async () => (await (await request.get(`${base}/categories`)).json()) as Cat[];
  for (const c of await cats()) expect((await request.patch(`${base}/categories/${c.id}`, { data: { status: 'ready', zoneId: zone!.id } })).ok()).toBeTruthy();
  expect((await request.patch(base, { data: { visibility: 'public' } })).ok()).toBeTruthy();

  // 1. L'organisateur règle le changement entre deux combats (Réglages) et saisit le début prévu de la session (Combats).
  await page.goto(`/competitions/${id}/reglages`);
  const changeover = page.getByLabel('Changement entre deux combats');
  // Une durée mal saisie bloque l'enregistrement : jamais une valeur que le champ ne montre pas.
  await changeover.fill('0:30x');
  await expect(page.getByTestId('settings-save')).toBeDisabled();
  await expect(page.getByTestId('settings-invalid')).toBeVisible();
  await changeover.fill('0:30');
  await changeover.blur();
  await expect(page.getByTestId('settings-save')).toBeEnabled();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.reload();
  await expect(page.getByLabel('Changement entre deux combats')).toHaveValue('0:30');
  await openTab(page, 'Combats');
  const planned = page.getByTestId('wave-planned');
  await planned.click({ position: { x: 14, y: 10 } });
  await page.keyboard.type('0930');
  await planned.blur();
  await page.getByText('Horaire enregistré').first().waitFor();

  // 2. Le visiteur (sans session) lit l'heure prévue sur l'accueil public, avant le lancement.
  const visitor = await browser.newContext({ baseURL: 'http://localhost:3101', storageState: { cookies: [], origins: [] } });
  const v = await visitor.newPage();
  await v.goto('/');
  const upcoming = v.getByTestId('public-competition').filter({ hasText: NAME });
  await expect(upcoming).toBeVisible();
  await expect(upcoming.getByTestId('public-upcoming-wave')).toHaveText('Session 1 · 9:30');
  expect((await request.patch(base, { data: { date: day(0) } })).ok()).toBeTruthy();

  // 3. Lancement de la session, puis « Maintenant » dans « Démarrée à ».
  expect((await request.post(`${base}/launch`, { data: { waveId } })).status()).toBe(204);
  await page.reload();
  await expect(page.getByTestId('wave-actual')).toBeVisible();
  await page.getByRole('button', { name: 'Maintenant' }).click();
  await expect(page.getByText('Horaire enregistré').first()).toBeVisible();
  await expect(page.getByTestId('wave-actual')).not.toHaveValue('');

  // 4. Onglet Zones : en-tête, heure estimée d'un passage. Le n° 1 est sur le tatami depuis « Maintenant » (démarrée à la
  // minute) : « À suivre » sans heure ; le n° 2, lui, a la sienne.
  const cat = (await cats())[0]!;
  const first = cat.bracket.matches.find((m) => m.id === 'w1-0')!;
  const second = cat.bracket.matches.find((m) => m.id === 'w1-1')!;
  const regs = (await (await request.get(`${base}/registrations`)).json()) as { id: string; fighter: { lastName: string } }[];
  const winnerSide = 'a';
  const winner = regs.find((r) => r.id === first.a.registrationId)!;
  const other = regs.find((r) => r.id === second.a.registrationId)!;
  await v.goto(`/public/${id}?onglet=zones`);
  await expect(v.getByTestId('public-zones-session')).toContainText(/prévue 9:30 · démarrée \d{1,2}:\d{2}/, { timeout: 15_000 });
  const firstPassage = v.getByTestId('public-zone').first().getByTestId('public-zone-passage').first();
  await expect(firstPassage).toContainText('n° 1');
  await expect(firstPassage.getByTestId('public-zone-at')).toHaveCount(0);
  await expect(v.getByTestId('public-zone-at').first()).toHaveText(/^vers\s\d{1,2}:\d{2}$/);

  // 5. Suivis : deux combattants épinglés. Celui du n° 1 (sur le tatami) : pas d'heure ; celui du n° 2 : heure estimée et durée.
  await v.goto(`/public/${id}?onglet=suivis`);
  for (const r of [winner, other]) {
    await v.getByTestId('public-search').fill(r.fighter.lastName);
    await v.getByTestId('public-search-fighter').filter({ hasText: r.fighter.lastName }).getByTestId('public-star').click();
  }
  await v.getByTestId('public-search').fill('');
  const card = (r: typeof winner) => v.getByTestId('public-follow-card').filter({ hasText: r.fighter.lastName });
  await expect(card(winner).getByTestId('public-follow-next')).toContainText('Prochain combat de la zone');
  await expect(card(winner).getByTestId('public-follow-at')).toHaveCount(0);
  await expect(card(other).getByTestId('public-follow-at')).toHaveText(/^vers\s\d{1,2}:\d{2}$/);
  await expect(card(other).getByTestId('public-follow-duration')).toContainText('Durée prévue : ');

  // 6. Un résultat saisi par l'API met à jour Zones sans recharger : le passage suivant devient « À suivre ».
  await v.goto(`/public/${id}?onglet=zones`);
  await expect(firstPassage).toContainText('n° 1');
  expect((await request.put(`${base}/categories/${cat.id}/results/w1-0`, { data: { winner: winnerSide, method: 'points' } })).ok()).toBeTruthy();
  await expect(firstPassage).toContainText('n° 2', { timeout: 15_000 });
  await expect(firstPassage).toContainText('À suivre');
  await expect(v.getByTestId('public-zone-at').first()).toHaveText(/^vers\s\d{1,2}:\d{2}$/);

  // 7. À 360 px, rien n'est coupé sur Zones et Suivis.
  await v.setViewportSize({ width: 360, height: 740 });
  for (const tab of ['zones', 'suivis'] as const) {
    await v.goto(`/public/${id}?onglet=${tab}`);
    await expect(v.getByTestId(`public-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    await expect(v.locator('[data-testid="public-zone-at"], [data-testid="public-follow-at"]').first()).toBeVisible();
    expect(await clipped(v), tab).toEqual([]);
    expect(await v.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), tab).toBeLessThanOrEqual(0);
  }
  await visitor.close();
});
