import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { HELP } from '../../src/web/help.js';
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
