import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

/** Captures d'écran pour un contrôle visuel, seulement si E2E_SCREENSHOTS donne un dossier. */
const shot = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, `${name}.png`), fullPage: true });
};

async function fillFighter(page: Page, f: { last: string; first: string; sex: 'Féminin' | 'Masculin'; age: string; kg: string; combat?: string; ruleset?: string; kata?: boolean; grade?: string }) {
  const form = page.getByTestId('club-line-form');
  await form.getByTestId('line-last-name').fill(f.last);
  await form.getByTestId('line-first-name').fill(f.first);
  await form.getByRole('group', { name: 'Sexe' }).getByText(f.sex, { exact: true }).click();
  await form.getByTestId('line-age').click();
  await page.getByRole('option', { name: f.age, exact: true }).click();
  await form.getByTestId('line-weight').fill(f.kg);
  if (f.combat) await form.getByRole('group', { name: 'Discipline de combat' }).getByText(f.combat, { exact: true }).click();
  if (f.ruleset) await form.getByRole('group', { name: 'Règlement' }).getByText(f.ruleset, { exact: true }).click();
  if (f.kata) await form.getByTestId('line-kata').check();
  if (f.grade) await form.getByTestId('line-grade').fill(f.grade);
}

test('inscription en ligne : annuaire → invitation → le coach inscrit, modifie, supprime → « En ligne » → figé : lecture seule', async ({ page, context }) => {
  const club = `Dojo en ligne ${Date.now()}`;

  // 1. Annuaire, puis compétition.
  await page.goto('/');
  await page.getByTestId('nav-directory').click();
  await page.getByTestId('directory-new').click();
  await page.getByTestId('directory-name').fill(club);
  await page.getByTestId('directory-email').fill('coach@dojo.example');
  await page.getByTestId('directory-save').click();
  await expect(page.getByTestId('directory-row').filter({ hasText: club })).toBeVisible();
  await shot(page, '1-annuaire');
  const id = await createCompetition(page, 'Coupe en ligne');

  // 2. Ouvrir, inviter, lire le lien.
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('club-entry-toggle').click();
  await expect(page.getByTestId('club-entry-status')).toHaveText('Inscriptions ouvertes');
  await page.getByTestId('invite-select').click();
  await page.getByTestId('invite-select').fill(club);
  await page.getByRole('option', { name: club }).click();
  await page.getByTestId('invite-clubs').click();
  const url = await page.getByTestId('invitation-link').filter({ hasText: club }).getByTestId('invitation-url').innerText();
  expect(url).toMatch(/\/inscription\/[A-Za-z0-9_-]{32}$/);
  await shot(page, '2-liens-crees');
  await page.keyboard.press('Escape');

  // 3. Le coach, sur téléphone.
  const coach = await context.newPage();
  await coach.setViewportSize({ width: 390, height: 844 });
  await coach.goto(url);
  await expect(coach.getByTestId('club-entry-state')).toHaveText('Inscriptions ouvertes');
  await coach.getByTestId('add-fighter').click();
  await fillFighter(coach, { last: 'MARTIN', first: 'Léa', sex: 'Féminin', age: 'Cadets', kg: '54', combat: 'Karaté', ruleset: 'Jiyu', kata: true, grade: '1er kyu' });
  await shot(coach, '3-formulaire');
  await coach.getByTestId('line-save').click();
  await coach.reload();
  await expect(coach.getByTestId('club-line')).toHaveCount(1);
  await expect(coach.getByTestId('club-line-disciplines')).toHaveText('Karaté (jiyu) + Kata');
  await shot(coach, '4-liste');

  // 4. Modifier (Boxing), ajouter puis supprimer un second combattant.
  await coach.getByTestId('club-line').getByRole('button', { name: 'Modifier' }).click();
  await coach.getByTestId('club-line-form').getByRole('group', { name: 'Discipline de combat' }).getByText('Boxing', { exact: true }).click();
  await coach.getByTestId('line-save').click();
  await expect(coach.getByTestId('club-line-disciplines')).toHaveText('Shido-boxing (jiyu) + Kata');
  await coach.getByTestId('add-fighter').click();
  await fillFighter(coach, { last: 'DURAND', first: 'Hugo', sex: 'Masculin', age: 'Seniors', kg: '75', kata: true });
  await coach.getByTestId('line-save').click();
  await expect(coach.getByTestId('club-line')).toHaveCount(2);
  await coach.getByTestId('club-line').filter({ hasText: 'DURAND' }).getByRole('button', { name: 'Modifier' }).click();
  await coach.getByTestId('line-delete').click();
  await coach.getByTestId('line-delete-confirm').click();
  await expect(coach.getByTestId('club-line')).toHaveCount(1);

  // 5. L'organisateur voit les inscriptions « En ligne ».
  await page.goto(`/competitions/${id}/inscriptions`);
  const rows = page.getByTestId('registration-row').filter({ hasText: 'MARTIN' });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'En ligne' })).toHaveCount(2);

  // 6. Figer : la page du club passe en lecture seule.
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('club-entry-toggle').click();
  await expect(page.getByTestId('club-entry-status')).toHaveText('Inscriptions closes : contactez l’organisateur.');
  await coach.reload();
  await expect(coach.getByTestId('club-entry-state')).toHaveText('Inscriptions closes : contactez l’organisateur.');
  await expect(coach.getByTestId('add-fighter')).toHaveCount(0);
  await expect(coach.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await shot(coach, '5-fige');
});
