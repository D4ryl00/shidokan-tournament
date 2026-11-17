import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { buildFfkWorkbook, FFK_HEADER_2026 } from '../helpers/ffk-fixture.js';
import { createCompetition, openTab } from './helpers.js';

async function pick(page: Page, testId: string, option: string) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Ajoute un combattant sur place, depuis Inscriptions (club, puis fenêtre du combattant). */
async function addOnSite(page: Page, id: string, club: string, last: string, first: string) {
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await page.getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name: club, exact: true }).click();
  await page.getByTestId('fighter-next').click();
  const form = page.getByTestId('club-line-form');
  await form.getByTestId('line-last-name').fill(last);
  await form.getByTestId('line-first-name').fill(first);
  await form.getByRole('group', { name: 'Sexe' }).getByText('Féminin', { exact: true }).click();
  await pick(page, 'line-age', 'Cadets (14 à 15 ans)');
  await pick(page, 'line-weight-class', '-54 kg');
  await form.getByRole('group', { name: 'Discipline de combat' }).getByText('Karaté', { exact: true }).click();
  await form.getByRole('group', { name: 'Règlement' }).getByText('Jiyu', { exact: true }).click();
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line-form')).toHaveCount(0);
}

/** Inscription par l'adresse du serveur (sans poste déclaré) : une entrée « Inscription » de plus au journal. */
const register = (request: APIRequestContext, id: string, clubId: string, lastName: string) =>
  request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId, lastName, firstName: 'Zoé', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' },
  });

const addClub = async (request: APIRequestContext, id: string, name: string): Promise<string> =>
  ((await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()) as { id: string }).id;

test('ajout sur place, puis Journal : entrée, recherche, filtre', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe journal');
  const clubId = await addClub(request, id, 'Tani Dojo');
  await addOnSite(page, id, 'Tani Dojo', 'DUPONT', 'Léa');

  await openTab(page, 'Journal');
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.locator('[data-testid="help-short"][data-topic="journal"]')).toHaveText('Tout ce qui a modifié la compétition, du plus récent au plus ancien.');
  await expect(page.getByTestId('journal-live')).toHaveText('en direct');
  const lea = page.getByTestId('journal-entry').filter({ hasText: 'DUPONT Léa' });
  await expect(lea).toHaveCount(1);
  await expect(lea.getByTestId('journal-title')).toHaveText(/^DUPONT Léa .*· ajoutée$/);
  await expect(lea.getByTestId('journal-via')).toHaveText('Inscription sur place');
  await expect(lea.getByTestId('journal-who')).toHaveText('poste Organisation');
  await expect(page.getByTestId('journal-day').first()).toHaveText(/^\w+ \d+ \w+$/u);

  // En direct : une inscription faite ailleurs apparaît sans recharger.
  await register(request, id, clubId, 'MARTIN');
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'MARTIN Zoé' })).toHaveCount(1);
  await expect(page.getByTestId('journal-entry').first()).toContainText('MARTIN Zoé');

  // Recherche sans accents ni casse : seuls les événements qui ont tous les mots, mots surlignés.
  await page.getByTestId('journal-search').fill('lea dupont');
  await expect(page.getByTestId('journal-entry')).toHaveCount(1);
  await expect(lea.locator('mark')).toHaveText(['DUPONT', 'Léa']);

  // Filtre « Pesée · présence » seul : rien ne correspond ; « Tous » rend le fil.
  await page.getByTestId('journal-types').getByRole('button', { name: 'Pesée · présence' }).click();
  await expect(page.getByTestId('journal-empty')).toHaveText('Aucun événement ne correspond.');
  await expect(page.getByTestId('journal-entry')).toHaveCount(0);
  await page.getByTestId('journal-types').getByRole('button', { name: 'Tous', exact: true }).click();
  await expect(page.getByTestId('journal-types').getByRole('button', { name: 'Tous', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(lea).toHaveCount(1);
  await page.getByTestId('journal-types').getByRole('button', { name: 'Inscription', exact: true }).click();
  await expect(lea).toHaveCount(1);
});

test('pages au défilement ; une nouvelle entrée ne fait pas perdre sa place à celui qui lit plus bas', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe journal pages');
  const clubId = await addClub(request, id, 'Tani Dojo');
  for (let k = 0; k < 110; k++) await register(request, id, clubId, `LIGNE${String(k).padStart(3, '0')}`);
  await page.goto(`/competitions/${id}/journal`);
  const rows = page.getByTestId('journal-entry');
  await expect(rows).toHaveCount(100);
  // En descendant, la suite se charge : la plus ancienne (« Compétition créée ») apparaît.
  await rows.last().scrollIntoViewIfNeeded();
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Compétition créée' })).toHaveCount(1);
  expect(await rows.count()).toBeGreaterThan(100);

  // Lecture au milieu du fil : une inscription arrive en haut, la ligne lue ne bouge pas.
  const read = rows.filter({ hasText: 'LIGNE050 Zoé' });
  await read.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200));
  const before = await read.evaluate((el) => el.getBoundingClientRect().top);
  await register(request, id, clubId, 'NOUVELLE');
  await expect(rows.filter({ hasText: 'NOUVELLE Zoé' })).toHaveCount(1);
  const after = await read.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(2);
});

test('poste Table : pas d’onglet Journal', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe journal table');
  await page.getByTestId('stage-apres').click();
  await expect(page.getByRole('tab', { name: 'Journal', exact: true })).toBeVisible();
  await page.getByTestId('poste-select').click();
  await page.getByRole('option', { name: 'Table centrale', exact: true }).click();
  // Le Journal ouvert au changement de poste : l'onglet par défaut du poste Table le remplace.
  await page.goto(`/competitions/${id}/journal`);
  await expect(page).toHaveURL(/\/inscriptions$/);
  await page.getByTestId('stage-apres').click();
  await expect(page).toHaveURL(/\/podiums$/);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Journal', exact: true })).toHaveCount(0);
});

test('clôture de la pesée : lignes de détail comme la maquette (« NOM Prénom (Club) : absente »)', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe journal pesée');
  const clubId = await addClub(request, id, 'Tani Dojo');
  await register(request, id, clubId, 'LEROY');
  expect((await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId, lastName: 'NGUYEN', firstName: 'Paul', sex: 'M', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:M:-57', source: 'manual' },
  })).ok()).toBe(true);
  expect((await request.post(`/api/competitions/${id}/weigh-in/close`, { data: {} })).ok()).toBe(true);
  await page.goto(`/competitions/${id}/journal`);
  const closed = page.getByTestId('journal-entry').filter({ hasText: 'Pesée close' });
  await closed.getByTestId('journal-toggle').click();
  await expect(closed.getByTestId('journal-detail-line')).toHaveText(['LEROY Zoé (Tani Dojo) : absente', 'NGUYEN Paul (Tani Dojo) : absent']);
});

test('import FFK : une entrée, lignes accordées, « … N autres »', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe journal FFK');
  await addClub(request, id, 'Tani Dojo');
  const names: [string, string][] = [['Chloé', 'ROUX'], ['Emma', 'LEROY'], ['Lina', 'MOREAU'], ['Zoé', 'BLANC'], ['Anna', 'NOIR'], ['Sara', 'GRIS'], ['Mia', 'VERT']];
  const file = buildFfkWorkbook(
    { 'Coupe Shidokan Karate': names.map(([f, l], i): (string | number | null)[] => [f, l, `L${i + 1}`, '0060893 TANI DOJO', 'Féminin', 'Karate', 'Séniors jiyu ippon kumite', -55, null]) },
    { header: FFK_HEADER_2026 },
  );
  await page.goto(`/competitions/${id}/import-ffk`);
  await page.getByTestId('ffk-file').setInputFiles({ name: 'export.xlsx', mimeType: 'application/octet-stream', buffer: file });
  await expect(page.getByTestId('ffk-summary')).toBeVisible();
  for (const [f, l] of names) {
    const card = page.getByTestId('ffk-card').filter({ hasText: `${l} ${f}` });
    await card.getByRole('radio', { name: /^➕ Nouveau combattant/ }).click();
    await card.getByTestId('ffk-card-validate').click();
    await expect(card.getByTestId('ffk-card-state')).toHaveText('Validée');
  }
  await page.getByTestId('ffk-commit').click();
  const done = page.waitForResponse((r) => r.url().includes('/ffk-imports/') && r.url().endsWith('/commit'));
  await page.getByTestId('ffk-commit-confirm').click();
  expect((await done).status()).toBe(200);

  await page.goto(`/competitions/${id}/journal`);
  const entry = page.getByTestId('journal-entry').filter({ hasText: 'Import FFK · ' });
  await expect(entry).toHaveCount(1);
  await expect(page.getByTestId('journal-entry').filter({ hasText: /Opération non détaillée.*ffk-imports/ })).toHaveCount(0); // seule la création du club, faite par l'adresse du serveur, reste brute
  await entry.getByTestId('journal-toggle').click();
  const lines = entry.getByTestId('journal-detail-line');
  await expect(lines).toHaveCount(5);
  await expect(entry.getByTestId('journal-detail-line').filter({ hasText: ': ajoutée' }).first()).toBeVisible();
  const more = entry.getByTestId('journal-more');
  await expect(more).toHaveText('… 3 autres');
  await more.click();
  await expect(lines).toHaveCount(8); // 7 combattantes et le club relié
  await expect(more).toHaveCount(0);
  // Le groupe refermé puis rouvert est de nouveau replié.
  await entry.getByTestId('journal-toggle').click();
  await entry.getByTestId('journal-toggle').click();
  await expect(lines).toHaveCount(5);
});
