import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { HELP } from '../../src/web/help.js';
import { COMPETITION_TABS } from '../../src/web/tabs.js';
import { createCompetition } from './helpers.js';

type Cat = { id: string; label: string };

async function seed(request: APIRequestContext, id: string) {
  let i = 0;
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    });
  for (let k = 0; k < 2; k++) await reg({});
  for (let k = 0; k < 3; k++) await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  return (await (await request.get(`/api/competitions/${id}/categories`)).json()) as Cat[];
}

const short = (page: Page, topic: string) => page.locator(`[data-testid="help-short"][data-topic="${topic}"]`);

async function openAndClose(page: Page, topic: keyof typeof HELP) {
  await page.getByRole('button', { name: `Aide : ${HELP[topic].title}` }).first().click();
  const modal = page.getByRole('dialog', { name: HELP[topic].title });
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
}

test('aides des bénévoles : pesée et combats', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe aides bénévoles');
  await seed(request, id);
  await page.goto(`/competitions/${id}/pesee`);
  await expect(short(page, 'pesee')).toHaveText('Tapez le poids lu sur la balance puis Entrée : le combattant est marqué présent.');
  await openAndClose(page, 'pesee');
  await page.goto(`/competitions/${id}/combats`);
  await expect(short(page, 'combats')).toBeVisible();
  await expect(short(page, 'combats.categories')).toBeVisible();
  await openAndClose(page, 'combats');
});

test('aide dans la saisie d’un résultat : fermer l’aide garde la fenêtre du résultat', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe aides résultat');
  const cats = await seed(request, id);
  const duel = cats.find((c) => c.label.startsWith('Karaté'))!;
  await page.goto(`/competitions/${id}/combats`);
  await page.getByTestId('schedule-category').filter({ hasText: duel.label }).getByRole('button').first().click();
  await page.locator('[data-testid="bracket-match"][data-match]').first().click();
  await expect(page.getByTestId('result-save')).toBeVisible();
  await expect(short(page, 'combats.resultat')).toBeVisible();
  await page.getByRole('button', { name: `Aide : ${HELP['combats.resultat'].title}` }).click();
  await expect(page.getByRole('dialog', { name: HELP['combats.resultat'].title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: HELP['combats.resultat'].title })).toHaveCount(0);
  await expect(page.getByTestId('result-save')).toBeVisible();
});

test('aide de la notation kata', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe aides kata');
  const cats = await seed(request, id);
  const kata = cats.find((c) => c.label.startsWith('Kata'))!;
  await page.goto(`/competitions/${id}/combats`);
  await page.getByTestId('schedule-category').filter({ hasText: kata.label }).getByRole('button').first().click();
  await expect(short(page, 'combats.kata')).toBeVisible();
  await openAndClose(page, 'combats.kata');
});

test('chaque onglet affiche son aide et son ⓘ', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe aides onglets');
  for (const t of COMPETITION_TABS) {
    await page.goto(`/competitions/${id}/${t.path}`);
    await expect(short(page, t.path), t.path).toBeVisible();
    await openAndClose(page, t.path);
  }
});

test('page d’accueil : aide des compétitions', async ({ page }) => {
  await page.goto('/');
  await expect(short(page, 'competitions')).toBeVisible();
});

test('réglages : ouvrir une aide n’enregistre rien', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe aides réglages');
  await page.goto(`/competitions/${id}/reglages`);
  const writes: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  await expect(short(page, 'reglages.recasement')).toBeVisible();
  await openAndClose(page, 'reglages.recasement');
  await page.waitForTimeout(300);
  expect(writes).toEqual([]);
});

test('grille : passages d’âge en clair', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe aides grille');
  await page.goto(`/competitions/${id}/grille`);
  await expect(page.getByText('C : tranche au-dessus')).toHaveCount(0);
  await expect(short(page, 'grille.passages')).toBeVisible();
  const kinds = page.getByLabel('Type de passage');
  await expect(kinds.first()).toHaveValue('Toujours permis');
  await kinds.first().click();
  await page.getByRole('option', { name: 'Seulement si le mélange seniors / vétérans est activé' }).click();
  await page.getByRole('button', { name: 'Enregistrer la grille' }).click();
  await expect(page.getByText('Grille enregistrée')).toBeVisible();
  const grid = (await (await request.get(`/api/competitions/${id}/grid`)).json()) as { ageLinks: { kind: string }[] };
  expect(grid.ageLinks[0]!.kind).toBe('D');
});

test('impression : aucune aide sur la feuille', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe aides impression');
  await seed(request, id);
  for (const url of [`/competitions/${id}/impression`, `/competitions/${id}/impression/pesee`]) {
    await page.emulateMedia({ media: 'screen' });
    await page.goto(url);
    await expect(short(page, 'impression'), url).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('help-short')).toBeHidden();
    await expect(page.getByTestId('help-button')).toHaveCount(0);
  }
});
