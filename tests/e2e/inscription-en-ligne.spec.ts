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
  // Deux adresses ; le clic sur « Enregistrer » suit directement la frappe.
  await page.getByTestId('directory-email').fill('coach@dojo.example, président pas une adresse');
  await page.getByTestId('directory-email').blur();
  await expect(page.getByText('Adresse invalide : président, pas, une, adresse')).toBeVisible();
  await page.getByTestId('directory-email').fill('coach@dojo.example, president@dojo.example');
  await page.getByTestId('directory-save').click();
  await expect(page.getByTestId('directory-row').filter({ hasText: club })).toContainText('coach@dojo.example');
  await expect(page.getByTestId('directory-row').filter({ hasText: club })).toContainText('president@dojo.example');
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

test('catégorie fermée : non proposée au club', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe fermée en ligne');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entry = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo fermé ${Date.now()}` } })).json()) as { id: string };
  const [link] = (await (await request.post(`/api/competitions/${id}/invitations`, { data: { directoryIds: [entry.id] } })).json()) as { token: string }[];
  await request.patch(`/api/competitions/${id}/club-entry`, { data: { status: 'open', deadline: '2026-11-15' } });

  // L'organisateur ferme le shido-mix des cadettes (jiyu seul : pas de shobu chez les mineurs).
  await page.goto(`/competitions/${id}/grille`);
  await page.getByTestId('open-cell-cadet|F|shido-mix|jiyu').click();
  await expect(page.getByTestId('open-cell-cadet|F|shido-mix|jiyu')).not.toBeChecked();

  await page.goto(`/inscription/${link!.token}`);
  await page.getByTestId('add-fighter').click();
  await fillFighter(page, { last: 'PETIT', first: 'Zoé', sex: 'Féminin', age: 'Cadets', kg: '50' });
  const combats = page.getByTestId('club-line-form').getByRole('group', { name: 'Discipline de combat' });
  await expect(combats.getByText('Karaté', { exact: true })).toBeVisible();
  await expect(combats.getByText('Mix', { exact: true })).toHaveCount(0);
  // Les cadets (garçons) gardent le shido-mix.
  const sex = page.getByTestId('club-line-form').getByRole('group', { name: 'Sexe' });
  await sex.getByText('Masculin', { exact: true }).click();
  await expect(combats.getByText('Mix', { exact: true })).toBeVisible();
  // Mix choisi pour un garçon, puis le sexe repasse à Féminin : le choix fermé est retiré (pas de refus du serveur à la clé).
  await combats.getByText('Mix', { exact: true }).click();
  await sex.getByText('Féminin', { exact: true }).click();
  await page.getByTestId('line-save').click();
  await expect(page.getByText('Aucune discipline cochée.')).toBeVisible();
  await expect(page.getByText('catégorie non ouverte à cette compétition')).toHaveCount(0);
  // Page du club : le résumé de ce qui n'est pas ouvert.
  await expect(page.getByTestId('club-entry-closed')).toContainText('Cadets (F) : pas de Shido-mix-martial');
});

test('envoi du lien : une case par adresse pour un club qui en a plusieurs ; seules les adresses cochées partent', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plusieurs adresses');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const add = async (name: string, coachEmails: string[]) => ((await (await request.post('/api/club-directory', { data: { ...EMPTY, name, coachEmails } })).json()) as { id: string }).id;
  const stamp = Date.now();
  const multi = `Dojo multi ${stamp}`;
  const solo = `Dojo solo ${stamp}`;
  await request.post(`/api/competitions/${id}/invitations`, {
    data: { directoryIds: [await add(multi, ['coach@multi.fr', 'pres@multi.fr', 'secr@multi.fr']), await add(solo, ['coach@solo.fr'])] },
  });
  // Pas de serveur d'envoi ici : l'envoi est intercepté, on regarde ce qui part.
  const bodies: unknown[] = [];
  await page.route(`**/api/competitions/${id}/invitations/send`, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: [] });
  });
  await page.route(`**/api/competitions/${id}/invitations/*/mailto`, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: 'intercepté' } });
  });

  await page.goto(`/competitions/${id}/fiche-club`);
  const row = page.getByTestId('invitation-row').filter({ hasText: multi });
  await expect(row).toContainText('pres@multi.fr');
  await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
  await page.getByTestId('send-invitations').click();
  const dialog = page.getByRole('dialog', { name: 'Envoyer le lien par mail' });
  const recipients = dialog.getByTestId('send-recipients').filter({ hasText: multi });
  for (const e of ['coach@multi.fr', 'pres@multi.fr', 'secr@multi.fr']) await expect(recipients.getByRole('checkbox', { name: e })).toBeChecked();
  await expect(dialog.getByTestId('send-recipients').filter({ hasText: solo })).toContainText('coach@solo.fr');
  await recipients.getByRole('checkbox', { name: 'pres@multi.fr' }).uncheck();
  await dialog.getByTestId('send-confirm').click();
  // L'envoi fini ferme la fenêtre et vide la sélection : attendre avant de recocher.
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('send-invitations')).toBeDisabled();
  expect(bodies).toHaveLength(1);
  const ids = (await (await request.get(`/api/competitions/${id}/invitations`)).json()) as { clubId: string; clubName: string }[];
  const idOf = (name: string) => ids.find((i) => i.clubName === name)!.clubId;
  expect(bodies[0]).toEqual({ clubs: [{ clubId: idOf(multi), emails: ['coach@multi.fr', 'secr@multi.fr'] }, { clubId: idOf(solo) }] });

  // Toutes décochées : « Envoyer » bloqué. La fenêtre repart avec toutes les cases cochées.
  await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
  await page.getByTestId('send-invitations').click();
  for (const e of ['coach@multi.fr', 'pres@multi.fr', 'secr@multi.fr']) await recipients.getByRole('checkbox', { name: e }).uncheck();
  await expect(dialog.getByText('Cochez au moins une adresse.')).toBeVisible();
  await expect(dialog.getByTestId('send-confirm')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // « Ouvrir dans ma messagerie » : le même choix.
  await row.getByRole('button', { name: 'Ouvrir dans ma messagerie' }).click();
  const mailto = page.getByRole('dialog', { name: 'Ouvrir dans ma messagerie' });
  await expect(mailto.getByRole('checkbox', { name: 'secr@multi.fr' })).toBeChecked();
  await mailto.getByRole('checkbox', { name: 'coach@multi.fr' }).uncheck();
  await mailto.getByRole('button', { name: 'Ouvrir ma messagerie' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({ emails: ['pres@multi.fr', 'secr@multi.fr'] });
});
