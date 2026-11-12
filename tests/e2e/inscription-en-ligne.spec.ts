import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createClubLink, createCompetition, inviteWithLink, SERVER_SESSION } from './helpers.js';

// Mails et inscriptions en ligne : serveur en ligne seulement (port 3101), session de l'organisateur ouverte une fois par global-setup.
test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

/** Captures d'écran pour un contrôle visuel, seulement si E2E_SCREENSHOTS donne un dossier. */
const shot = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, `${name}.png`), fullPage: true });
};

async function fillFighter(page: Page, f: { last: string; first: string; sex: 'Féminin' | 'Masculin'; age: string; weightClass?: string; kg?: string; combat?: string; ruleset?: string; kata?: boolean; grade?: string }) {
  const form = page.getByTestId('club-line-form');
  await form.getByTestId('line-last-name').fill(f.last);
  await form.getByTestId('line-first-name').fill(f.first);
  await form.getByRole('group', { name: 'Sexe' }).getByText(f.sex, { exact: true }).click();
  await form.getByTestId('line-age').click();
  await page.getByRole('option', { name: f.age, exact: true }).click();
  if (f.weightClass) {
    await form.getByTestId('line-weight-class').click();
    await page.getByRole('option', { name: f.weightClass, exact: true }).click();
  }
  if (f.kg) await form.getByTestId('line-weight').fill(f.kg);
  if (f.combat) await form.getByRole('group', { name: 'Discipline de combat' }).getByText(f.combat, { exact: true }).click();
  if (f.ruleset) await form.getByRole('group', { name: 'Règlement' }).getByText(f.ruleset, { exact: true }).click();
  if (f.kata) await form.getByTestId('line-kata').check();
  if (f.grade) await form.getByTestId('line-grade').fill(f.grade);
}

test('inscription en ligne : annuaire → invitation → le coach inscrit, modifie, supprime → « En ligne » → figé : lecture seule', async ({ page, browser }) => {
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
  // Inviter ne crée aucun lien : le club rejoint le tableau avec « 0 lien », la fenêtre d'un lien créé ne s'ouvre plus.
  await expect(page.getByTestId('invitation-row').filter({ hasText: club })).toContainText('0 lien');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const url = await createClubLink(page, club);
  expect(url).toMatch(/\/inscription\/[A-Za-z0-9_-]{32}$/);
  await expect(page.getByTestId('invitation-row').filter({ hasText: club })).toContainText('1 lien');
  await shot(page, '2-liens-crees');

  // 3. Le coach, sur téléphone.
  // Le coach n'a pas de compte : contexte sans la session de l'organisateur.
  const coach = await (await browser.newContext({ storageState: undefined, locale: 'fr-FR' })).newPage();
  await coach.setViewportSize({ width: 390, height: 844 });
  await coach.goto(url);
  await expect(coach.getByTestId('club-entry-state')).toHaveText('Inscriptions ouvertes');
  await coach.getByTestId('add-fighter').click();
  // Tranche d'âge avec ses âges ; catégorie de poids choisie, poids actuel laissé vide (facultatif).
  await fillFighter(coach, { last: 'MARTIN', first: 'Léa', sex: 'Féminin', age: 'Cadets (14 à 15 ans)', weightClass: '-54 kg', combat: 'Karaté', ruleset: 'Jiyu', kata: true, grade: '1er kyu' });
  await shot(coach, '3-formulaire');
  await coach.getByTestId('line-save').click();
  await coach.reload();
  // Rangée par catégorie par défaut : discipline et règlement en titre de section, une carte par tranche d'âge ;
  // en combat et en kata, la combattante est dans les deux sections. La ligne ne répète pas ce que disent les titres.
  await expect(coach.getByTestId('club-section-title')).toHaveText(['Karaté · Jiyu', 'Kata']);
  await expect(coach.getByTestId('club-group-title')).toHaveText(['Cadets', 'Cadets']);
  await expect(coach.getByTestId('club-line')).toHaveCount(2);
  await expect(coach.getByTestId('club-line').first().getByTestId('club-line-tags')).toHaveText('F-54 kgaussi en Kata');
  await expect(coach.getByTestId('club-line').last().getByTestId('club-line-tags')).toHaveText('Faussi en Karaté jiyu');
  await shot(coach, '4-liste');

  // 4. Modifier (Boxing), ajouter puis supprimer un second combattant.
  await coach.getByTestId('club-line').first().getByRole('button', { name: 'Modifier' }).click();
  await coach.getByTestId('club-line-form').getByRole('group', { name: 'Discipline de combat' }).getByText('Boxing', { exact: true }).click();
  // Poids actuel hors de la catégorie choisie : avertissement, l'enregistrement passe quand même.
  await coach.getByTestId('line-weight').fill('58');
  const outside = 'Le poids actuel (58 kg) est en dehors de la catégorie -54 kg : il correspond à -61 kg.';
  await expect(coach.getByTestId('line-weight-warning')).toHaveText(outside);
  await coach.getByTestId('line-save').click();
  await expect(coach.getByTestId('club-section-title')).toHaveText(['Shido-boxing · Jiyu', 'Kata']);
  await expect(coach.getByTestId('club-line').first().getByTestId('club-line-tags').locator('.sk-tag')).toHaveText(['F', '-54 kg · 58 kg']);
  // L'avertissement de poids concerne le combat : pas sur la carte du kata.
  await expect(coach.getByTestId('line-notice')).toHaveText([outside]);
  await coach.getByTestId('add-fighter').click();
  await fillFighter(coach, { last: 'DURAND', first: 'Hugo', sex: 'Masculin', age: 'Seniors (18 à 34 ans)', kg: '75', kata: true });
  await coach.getByTestId('line-save').click();
  await expect(coach.getByTestId('club-line')).toHaveCount(3);
  await expect(coach.getByTestId('club-group-title')).toHaveText(['Cadets', 'Cadets', 'Seniors']);
  // Sommaire : une pastille par discipline et règlement, avec le nombre de combattants de la section.
  await expect(coach.getByTestId('club-jumps')).toHaveText('Shido-boxing jiyu1Kata2');
  // Une carte se replie sur son titre, qui garde le nombre de combattants.
  const seniors = coach.getByTestId('club-group').filter({ has: coach.getByTestId('club-group-title').getByText('Seniors', { exact: true }) });
  await seniors.getByRole('button', { name: /Seniors/ }).click();
  await expect(seniors.getByTestId('club-line')).toHaveCount(0);
  await expect(seniors).toContainText('1 combattant');
  await seniors.getByRole('button', { name: /Seniors/ }).click();
  // Par âge : un combattant par ligne, avec ses disciplines.
  await coach.getByTestId('club-group-mode').getByText('Âge', { exact: true }).click();
  await expect(coach.getByTestId('club-group-title')).toHaveText(['Cadets', 'Seniors']);
  await expect(coach.getByTestId('club-line').first().getByTestId('club-line-tags').locator('.sk-tag')).toHaveText(['F', '-54 kg · 58 kg', 'Shido-boxing jiyu', 'Kata']);
  await expect(coach.getByTestId('club-jumps')).toHaveText('Cadets1Seniors1');
  await coach.getByTestId('club-search').fill('hugo');
  await expect(coach.getByTestId('club-line')).toHaveText([/DURAND Hugo/]);
  await coach.getByTestId('club-search').fill('');
  await coach.reload();
  await expect(coach.getByTestId('club-group-title')).toHaveText(['Cadets', 'Seniors']); // choix gardé sur l'appareil
  await coach.getByTestId('club-group-mode').getByText('Catégorie', { exact: true }).click();
  await shot(coach, '4b-groupes');
  await coach.getByTestId('club-line').filter({ hasText: 'DURAND' }).getByRole('button', { name: 'Modifier' }).click();
  await coach.getByTestId('line-delete').click();
  await coach.getByTestId('line-delete-confirm').click();
  await expect(coach.getByTestId('club-line')).toHaveCount(2);

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
  const link = await inviteWithLink(request, id, entry.id);
  await request.patch(`/api/competitions/${id}/club-entry`, { data: { status: 'open', deadline: '2026-11-15' } });

  // L'organisateur ferme le shido-mix des cadettes (jiyu seul : pas de shobu chez les mineurs).
  await page.goto(`/competitions/${id}/grille`);
  await page.getByTestId('open-cell-cadet|F|shido-mix|jiyu').click();
  await expect(page.getByTestId('open-cell-cadet|F|shido-mix|jiyu')).not.toBeChecked();

  await page.goto(`/inscription/${link.token}`);
  await page.getByTestId('add-fighter').click();
  await fillFighter(page, { last: 'PETIT', first: 'Zoé', sex: 'Féminin', age: 'Cadets (14 à 15 ans)', kg: '50' });
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
  // Page du club : le détail de ce qui n'est pas ouvert est replié.
  await page.getByRole('button', { name: 'Annuler' }).click();
  const closedDetail = page.getByText('Cadets (F) : pas de Shido-mix-martial');
  await expect(closedDetail).toBeHidden();
  await page.getByTestId('club-entry-closed').getByRole('button', { name: 'Catégories non ouvertes à cette compétition' }).click();
  await expect(closedDetail).toBeVisible();
});

test('plusieurs combats en ligne : aucun règlement commun → le coach doit décocher une discipline', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe sans règlement commun');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entry = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo règlement ${Date.now()}` } })).json()) as { id: string };
  const link = await inviteWithLink(request, id, entry.id);
  await request.patch(`/api/competitions/${id}/club-entry`, { data: { status: 'open', deadline: '2026-11-15' } });
  expect((await request.patch(`/api/competitions/${id}`, { data: { settings: { multipleCombatDisciplinesPerDay: true } } })).ok()).toBeTruthy();
  const cells = [{ ageBandCode: 'senior', sex: 'F', discipline: 'karate', ruleset: 'jiyu' }, { ageBandCode: 'senior', sex: 'F', discipline: 'shido-boxing', ruleset: 'shobu' }];
  expect((await request.put(`/api/competitions/${id}/closed-categories`, { data: { cells, closed: true } })).ok()).toBeTruthy();

  await page.goto(`/inscription/${link.token}`);
  await page.getByTestId('add-fighter').click();
  await fillFighter(page, { last: 'MARTIN', first: 'Léa', sex: 'Féminin', age: 'Seniors (18 à 34 ans)', weightClass: '-55 kg', combat: 'Karaté' });
  const form = page.getByTestId('club-line-form');
  await expect(form.getByRole('group', { name: 'Règlement' }).getByText('Shobu', { exact: true })).toBeVisible();
  await form.getByRole('group', { name: 'Discipline de combat' }).getByText('Boxing', { exact: true }).click();
  await expect(form.getByTestId('line-no-ruleset')).toHaveText('Aucun règlement commun à ces disciplines : décochez-en une.');
  await form.getByRole('group', { name: 'Discipline de combat' }).getByText('Boxing', { exact: true }).click();
  await expect(form.getByTestId('line-no-ruleset')).toHaveCount(0);
});

test('reclassement en ligne : sa discipline n’est pas proposée, triathlon compris, choix résumé sur la carte', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe reclassement lisible');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entry = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo reclassement ${Date.now()}` } })).json()) as { id: string };
  const link = await inviteWithLink(request, id, entry.id);
  await request.patch(`/api/competitions/${id}/club-entry`, { data: { status: 'open', deadline: '2026-11-15' } });

  await page.goto(`/inscription/${link.token}`);
  await page.getByTestId('add-fighter').click();
  const form = page.getByTestId('club-line-form');
  const block = form.getByTestId('line-reclass');
  await fillFighter(page, { last: 'MARTIN', first: 'Léa', sex: 'Féminin', age: 'Seniors (18 à 34 ans)', weightClass: '-55 kg', ruleset: undefined });
  await expect(block).toHaveCount(0);
  await form.getByRole('group', { name: 'Discipline de combat' }).getByText('Karaté', { exact: true }).click();
  await form.getByRole('group', { name: 'Règlement' }).getByText('Shobu', { exact: true }).click();
  await expect(block).toContainText('si Léa se retrouve sans adversaire');

  // Sa propre discipline n'est pas dans la liste ; le triathlon, si.
  const first = block.getByLabel('1er choix');
  await expect(first.locator('option')).toHaveText(['Non, rester en karaté', 'Shido-boxing', 'Shido-mix-martial', 'Triathlon']);
  // Sans autre discipline : pas de question shobu, pas de 2e choix.
  await expect(block.getByLabel('2e choix')).toHaveCount(0);
  await expect(block.getByText('Que lui proposer d’abord ?')).toHaveCount(0);
  await first.selectOption('triathlon');
  await expect(block.getByLabel('2e choix').locator('option')).toHaveText(['Pas de 2e choix', 'Shido-boxing', 'Shido-mix-martial']);
  await block.getByLabel('2e choix').selectOption('shido-mix');
  await expect(block.getByLabel('3e choix').locator('option')).toHaveText(['Pas de 3e choix', 'Shido-boxing']);
  await block.getByRole('radio', { name: 'Rester en karaté, passer en jiyu' }).check();
  await page.getByTestId('line-save').click();
  const card = page.getByTestId('club-line');
  await expect(card.getByTestId('club-line-reclass')).toHaveText('Si sans adversaire : Triathlon, puis Shido-mix-martial');

  // Changer pour une discipline déjà choisie la retire de la liste et renumérote.
  await card.getByRole('button', { name: 'Modifier' }).click();
  await expect(block.getByRole('radio', { name: 'Rester en karaté, passer en jiyu' })).toBeChecked();
  await form.getByRole('group', { name: 'Discipline de combat' }).getByText('Triathlon', { exact: true }).click();
  await expect(first).toHaveValue('shido-mix');
  await expect(first.locator('option')).toHaveText(['Non, rester en triathlon', 'Karaté', 'Shido-boxing', 'Shido-mix-martial']);
  await first.selectOption('');
  await expect(block.getByText('on pourra seulement lui proposer de passer en jiyu')).toBeVisible();
  await page.getByTestId('line-save').click();
  await expect(card.getByTestId('club-line-reclass')).toHaveText('Si sans adversaire : reste en triathlon');
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
  // Envoi fait en tâche de fond : la demande rend l'envoi (ici déjà fini, sans club), l'avancement se relit par GET.
  const job = { id: 'envoi-1', startedAt: new Date().toISOString(), total: 0, results: [], finished: true, error: null };
  await page.route(`**/api/competitions/${id}/invitations/send`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { job: bodies.length ? job : null } });
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: job });
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
  // Par défaut, seule la première adresse du club est cochée.
  await expect(recipients.getByRole('checkbox', { name: 'coach@multi.fr' })).toBeChecked();
  for (const e of ['pres@multi.fr', 'secr@multi.fr']) await expect(recipients.getByRole('checkbox', { name: e })).not.toBeChecked();
  await expect(dialog.getByTestId('send-recipients').filter({ hasText: solo })).toContainText('coach@solo.fr');
  await recipients.getByRole('checkbox', { name: 'secr@multi.fr' }).check();
  await dialog.getByTestId('send-confirm').click();
  // L'envoi lancé ferme la fenêtre, vide la sélection et ouvre le bilan : attendre avant de recocher.
  await expect(dialog).toBeHidden();
  const report = page.getByRole('dialog', { name: 'Envoi des liens' });
  await expect(report).toBeVisible();
  await report.locator('.mantine-Modal-close').click();
  await expect(report).toBeHidden();
  await expect(page.getByTestId('send-invitations')).toBeDisabled();
  expect(bodies).toHaveLength(1);
  const ids = (await (await request.get(`/api/competitions/${id}/invitations`)).json()) as { clubId: string; clubName: string }[];
  const idOf = (name: string) => ids.find((i) => i.clubName === name)!.clubId;
  expect(bodies[0]).toEqual({ clubs: [{ clubId: idOf(multi), emails: ['coach@multi.fr', 'secr@multi.fr'] }, { clubId: idOf(solo) }] });

  // La fenêtre repart du choix par défaut ; la seule case cochée décochée : « Envoyer » bloqué.
  await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
  await page.getByTestId('send-invitations').click();
  await expect(recipients.getByRole('checkbox', { name: 'secr@multi.fr' })).not.toBeChecked();
  await recipients.getByRole('checkbox', { name: 'coach@multi.fr' }).uncheck();
  await expect(dialog.getByText('Cochez au moins une adresse.')).toBeVisible();
  await expect(dialog.getByTestId('send-confirm')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // « Ouvrir dans ma messagerie » : le même choix.
  await row.getByRole('button', { name: 'Ouvrir dans ma messagerie' }).click();
  const mailto = page.getByRole('dialog', { name: 'Ouvrir dans ma messagerie' });
  await expect(mailto.getByRole('checkbox', { name: 'coach@multi.fr' })).toBeChecked();
  await expect(mailto.getByRole('checkbox', { name: 'secr@multi.fr' })).not.toBeChecked();
  await mailto.getByRole('checkbox', { name: 'pres@multi.fr' }).check();
  await mailto.getByRole('button', { name: 'Ouvrir ma messagerie' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({ emails: ['coach@multi.fr', 'pres@multi.fr'] });
});

test('pièces jointes du mail : ajouter, refuser un type, décocher la fiche PDF (gardé), aperçu et messagerie, supprimer', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe pièces jointes');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const club = `Dojo pièces ${Date.now()}`;
  const directoryId = ((await (await request.post('/api/club-directory', { data: { ...EMPTY, name: club, coachEmails: ['coach@pieces.fr'] } })).json()) as { id: string }).id;
  await request.post(`/api/competitions/${id}/invitations`, { data: { directoryIds: [directoryId] } });
  const date = ((await (await request.get(`/api/competitions/${id}`)).json()) as { date: string }).date;
  const pdfName = `fiche-club-${date}.pdf`;

  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).click();
  const box = page.getByTestId('mail-attachments');
  await expect(box.getByRole('checkbox', { name: `Joindre ${pdfName}` })).toBeChecked();
  await box.getByTestId('mail-attachment-input').setInputFiles({ name: 'affiche.png', mimeType: 'image/png', buffer: Buffer.from('\x89PNG affiche') });
  await expect(box.getByRole('checkbox', { name: 'Joindre affiche.png' })).toBeChecked();
  await box.getByTestId('mail-attachment-input').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(box).toContainText('virus.exe : Type de fichier non accepté : .exe');
  await expect(box).toContainText('Si le texte du message cite les pièces jointes, pensez à l’adapter.');

  await page.getByRole('checkbox', { name: `Choisir ${club}` }).check();
  await expect(page.getByTestId('invitation-attachments')).toContainText('affiche.png');
  await expect(page.getByTestId('invitation-attachments')).toContainText(pdfName);
  await box.getByRole('checkbox', { name: `Joindre ${pdfName}` }).uncheck();
  await expect(page.getByTestId('invitation-attachments')).not.toContainText(pdfName);

  // Enregistré avec la compétition.
  await page.reload();
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).click();
  await expect(box.getByRole('checkbox', { name: `Joindre ${pdfName}` })).not.toBeChecked();
  await expect(box.getByRole('checkbox', { name: 'Joindre affiche.png' })).toBeChecked();

  // « Ouvrir dans ma messagerie » : seulement les pièces cochées, à télécharger.
  await page.getByTestId('invitation-row').filter({ hasText: club }).getByRole('button', { name: 'Ouvrir dans ma messagerie' }).click();
  const mailto = page.getByRole('dialog', { name: 'Ouvrir dans ma messagerie' });
  await expect(mailto.getByTestId('mailto-attachments')).toContainText('affiche.png');
  await expect(mailto.getByTestId('mailto-attachments')).not.toContainText('fiche à imprimer');
  await mailto.getByRole('button', { name: 'Annuler' }).click();

  // Fichier disparu du disque (restauration…) : signalé, sa case garde sa valeur, l'aperçu prévient ; l'ajouter de nouveau le répare.
  await box.getByTestId('mail-attachment-input').setInputFiles({ name: 'reglement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(box.getByRole('checkbox', { name: 'Joindre reglement.pdf' })).toBeChecked();
  const listed = (await (await request.get(`/api/competitions/${id}/mail-attachments`)).json()) as { id: string; fileName: string }[];
  fs.rmSync(path.join('tmp/e2e-serveur/pieces-jointes', listed.find((a) => a.fileName === 'reglement.pdf')!.id));
  await page.reload();
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).click();
  await expect(box).toContainText('reglement.pdf — Fichier manquant');
  await expect(box.getByRole('checkbox', { name: 'Joindre reglement.pdf' })).toBeChecked();
  await expect(box.getByRole('checkbox', { name: 'Joindre reglement.pdf' })).toBeEnabled();
  await page.getByRole('checkbox', { name: `Choisir ${club}` }).check();
  await expect(page.getByTestId('invitation-attachments')).toContainText('reglement.pdf (manquante : l’envoi sera refusé)');
  await box.getByTestId('mail-attachment-input').setInputFiles({ name: 'reglement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 bis') });
  await expect(box).not.toContainText('Fichier manquant');
  await expect(page.getByTestId('invitation-attachments')).not.toContainText('manquante');

  await box.getByRole('button', { name: 'Supprimer affiche.png' }).click();
  await expect(box.getByRole('checkbox', { name: 'Joindre affiche.png' })).toHaveCount(0);
  await box.getByRole('button', { name: 'Supprimer reglement.pdf' }).click();
  await expect(box.getByRole('checkbox', { name: 'Joindre reglement.pdf' })).toHaveCount(0);
  expect(await (await request.get(`/api/competitions/${id}/mail-attachments`)).json()).toEqual([]);
});

test('accès d’un club : pastille « 1 lien », créer un lien (affiché une fois), supprimer un lien avec confirmation, puis le dernier', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe accès des clubs');
  const club = `Dojo accès ${Date.now()}`;
  const entry = ((await (await request.post('/api/club-directory', { data: { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: ['coach@acces.fr'], notes: null, name: club } })).json()) as { id: string }).id;
  const first = await inviteWithLink(request, id, entry);

  await page.goto(`/competitions/${id}/fiche-club`);
  const row = page.getByTestId('invitation-row').filter({ hasText: club });
  await row.getByRole('button', { name: `Accès de ${club} : 1 lien` }).click();
  const dialog = page.getByRole('dialog', { name: `Accès de ${club}` });
  await expect(dialog.getByTestId('club-access')).toHaveCount(1);
  await expect(dialog.getByTestId('club-access').first()).toContainText('Jamais envoyé');

  // Un lien de plus : affiché une seule fois, en haut ; l'ancien reste.
  await dialog.getByRole('button', { name: 'Créer un lien' }).click();
  await expect(dialog.getByTestId('new-access-url')).toContainText('/inscription/');
  await expect(dialog.getByTestId('club-access')).toHaveCount(2);
  await expect(dialog.getByTestId('club-access').first()).toContainText('Nouveau');
  await shot(page, 'acces-club');
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: `Accès de ${club} : 2 liens` })).toBeVisible();
  expect((await request.get(`/api/inscription/${first.token}`)).status()).toBe(200);

  // Supprimer le plus ancien : confirmation dans sa carte ; « Annuler » ne change rien.
  await row.getByRole('button', { name: `Accès de ${club} : 2 liens` }).click();
  await expect(dialog.getByTestId('new-access-url')).toHaveCount(0);
  const oldest = dialog.getByTestId('club-access').last();
  await oldest.getByRole('button', { name: 'Supprimer' }).click();
  await expect(oldest).toContainText('Ce lien ne marchera plus.');
  await oldest.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog.getByTestId('club-access')).toHaveCount(2);
  await oldest.getByRole('button', { name: 'Supprimer' }).click();
  await oldest.getByRole('button', { name: 'Supprimer' }).click();
  await expect(dialog.getByTestId('club-access')).toHaveCount(1);
  expect((await request.get(`/api/inscription/${first.token}`)).status()).toBe(410);

  // « Supprimer tous les accès » : la fenêtre se ferme, le club redevient « à inviter ».
  await dialog.getByRole('button', { name: 'Supprimer tous les accès' }).click();
  await dialog.getByRole('button', { name: 'Oui, tout supprimer' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
});

test('clubs à inviter : pendant le chargement de l’annuaire, le champ ne dit pas que tous les clubs sont invités', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe annuaire lent');
  await request.post('/api/club-directory', { data: { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null, name: `Dojo lent ${Date.now()}` } });
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route('**/api/club-directory', async (route) => {
    await released;
    await route.continue();
  });
  await page.goto(`/competitions/${id}/fiche-club`);
  const select = page.getByTestId('invite-select');
  await expect(select).toHaveAttribute('placeholder', 'Chargement de l’annuaire…');
  release();
  await expect(select).toHaveAttribute('placeholder', 'Chercher un club de l’annuaire');
});

test('invité sans lien : la fenêtre Accès le dit, supprimer le dernier lien garde l’invitation, « Retirer l’invitation » le rend à inviter', async ({ page }) => {
  const club = `Dojo sans lien ${Date.now()}`;
  await page.goto('/annuaire');
  await page.getByRole('button', { name: 'Ajouter un club' }).click();
  await page.getByTestId('directory-name').fill(club);
  await page.getByTestId('directory-save').click();
  const id = await createCompetition(page, `Coupe invitation seule ${Date.now()}`);
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('invite-select').click();
  await page.getByTestId('invite-select').fill(club);
  await page.getByRole('option', { name: club }).click();
  await page.getByTestId('invite-clubs').click();
  const row = page.getByTestId('invitation-row').filter({ hasText: club });
  await expect(row).toContainText('0 lien');
  await row.getByRole('button', { name: /^Accès/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Accès/ });
  await expect(dialog.getByTestId('no-access')).toBeVisible();
  // Un lien créé puis supprimé : le club reste invité, la fenêtre reste ouverte.
  await dialog.getByRole('button', { name: 'Créer un lien' }).click();
  await expect(dialog.getByTestId('new-access-url')).toBeVisible();
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
  await expect(dialog.getByTestId('no-access')).toBeVisible();
  await expect(row).toContainText('0 lien');
  await dialog.getByRole('button', { name: 'Retirer l’invitation' }).click();
  await dialog.getByRole('button', { name: 'Oui, retirer' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.getByTestId('invite-select').click();
  await page.getByTestId('invite-select').fill(club);
  await expect(page.getByRole('option', { name: club })).toBeVisible();
});

test('le coach masque le nom d’un combattant : « Combattant masqué » sur la page publique', async ({ page, request, browser }) => {
  const id = await createCompetition(page, 'Coupe nom masqué');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entry = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo masqué ${Date.now()}` } })).json()) as { id: string };
  const link = await inviteWithLink(request, id, entry.id);
  await request.patch(`/api/competitions/${id}/club-entry`, { data: { status: 'open', deadline: '2026-11-15' } });

  await page.goto(`/inscription/${link.token}`);
  await page.getByTestId('add-fighter').click();
  await fillFighter(page, { last: 'DISCRET', first: 'Noé', sex: 'Masculin', age: 'Seniors (18 à 34 ans)', kg: '75', kata: true });
  await expect(page.getByTestId('line-name-hidden')).not.toBeChecked();
  await page.getByTestId('line-name-hidden').check();
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line')).toHaveCount(1);

  // La case est relue à la réouverture, et l'organisateur voit le nom masqué en ligne (le public lit « Combattant masqué »).
  await page.getByTestId('club-line').getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByTestId('line-name-hidden')).toBeChecked();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row').filter({ hasText: 'DISCRET' }).getByTestId('registration-name-hidden-badge')).toBeVisible();

  // Page publique (tableaux lancés) : « Combattant masqué » à la place du nom, nulle part « DISCRET ».
  const base = `/api/competitions/${id}`;
  expect((await request.post(`${base}/registrations`, { data: { clubId: null, lastName: 'VISIBLE', firstName: 'Paul', sex: 'M', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' } })).ok()).toBeTruthy();
  const [zone] = (await (await request.get(`${base}/zones`)).json()) as { id: string }[];
  for (const c of (await (await request.get(`${base}/categories`)).json()) as { id: string }[]) {
    expect((await request.patch(`${base}/categories/${c.id}`, { data: { status: 'ready', zoneId: zone!.id } })).ok()).toBeTruthy();
  }
  expect((await request.post(`${base}/launch`, { data: { waveId: null } })).status()).toBe(204);
  expect((await request.patch(base, { data: { visibility: 'public' } })).ok()).toBeTruthy();
  const visitor = await browser.newContext({ baseURL: 'http://localhost:3101', storageState: { cookies: [], origins: [] } });
  const v = await visitor.newPage();
  await v.goto(`/public/${id}?onglet=tableaux`);
  const item = v.getByTestId('public-category-item').first();
  await expect(item).toBeVisible();
  if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click();
  await expect(v.getByText('Combattant masqué').first()).toBeVisible();
  expect(await v.locator('body').innerText()).not.toMatch(/discret|\bnoé\b/i);
  await visitor.close();
});

test('envoi groupé en cours : avancement retrouvé en ouvrant la page, fenêtre refermable, bilan à la fin', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe envoi long');
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entry = ((await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo long ${Date.now()}`, coachEmails: ['a@long.fr'] } })).json()) as { id: string }).id;
  await request.post(`/api/competitions/${id}/invitations`, { data: { directoryIds: [entry] } });
  // Envoi simulé côté serveur : 1 club sur 3, puis 3 sur 3 quand le test le décide.
  const result = (n: number) => ({ clubId: `c${n}`, clubName: `Club ${n}`, email: `c${n}@x.fr`, status: n === 2 ? 'error' : 'sent', error: n === 2 ? '550 Adresse refusée' : null });
  let job = { id: 'envoi-long', startedAt: new Date().toISOString(), total: 3, results: [result(1)], finished: false, error: null as string | null };
  await page.route(`**/api/competitions/${id}/invitations/send`, (route) => route.fulfill({ json: { job } }));

  await page.goto(`/competitions/${id}/fiche-club`);
  const report = page.getByRole('dialog', { name: 'Envoi des liens' });
  await expect(report.getByTestId('send-progress')).toContainText('Envoi en cours : 1 / 3 clubs');
  await expect(report).toContainText('l’envoi continue sur le serveur');
  await expect(page.getByTestId('send-invitations')).toBeDisabled();
  // Fermée : l'envoi continue, une ligne le rappelle et rouvre la fenêtre.
  await report.locator('.mantine-Modal-close').click();
  await expect(report).toBeHidden();
  // Fenêtre fermée : la barre et le compte restent à côté du bouton d'envoi ; « Détails » rouvre la fenêtre.
  const running = page.getByTestId('send-running');
  await expect(running).toContainText('1/3');
  await expect(running.getByRole('progressbar', { name: 'Avancement de l’envoi' })).toBeVisible();
  const button = await page.getByTestId('send-invitations').boundingBox();
  const bar = await running.boundingBox();
  expect(Math.abs(bar!.y + bar!.height / 2 - (button!.y + button!.height / 2))).toBeLessThan(8);
  await running.getByRole('button', { name: 'Détails' }).click();
  await expect(report).toBeVisible();

  job = { ...job, results: [result(1), result(2), result(3)], finished: true };
  await expect(report.getByTestId('send-progress')).toBeHidden();
  await expect(report).toContainText('2 mails envoyés');
  await expect(report).toContainText('1 club en erreur');
  await expect(report).toContainText('Erreur : 550 Adresse refusée');
  await expect(page.getByTestId('send-running')).toBeHidden();

  // 39 clubs : la fenêtre tient dans l'écran, la liste défile seule sous le bilan.
  job = { ...job, id: 'envoi-39', total: 39, finished: false, results: Array.from({ length: 20 }, (_, i) => result(i + 1)) };
  await page.reload();
  await expect(report.getByTestId('send-progress')).toContainText('20 / 39 clubs');
  job = { ...job, finished: true, results: Array.from({ length: 39 }, (_, i) => result(i + 1)) };
  await expect(report).toContainText('38 mails envoyés');
  // Envoi fini : le club en erreur en tête de liste.
  await expect(report.getByTestId('send-results-list').getByText(/^Club \d+ — /).first()).toHaveText('Club 2 — c2@x.fr');
  const viewport = page.viewportSize()!;
  const box = (await report.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(report.getByText('38 mails envoyés')).toBeInViewport();
  const list = report.getByTestId('send-results-list').locator('.mantine-ScrollArea-viewport');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await report.getByText('Club 39 — c39@x.fr').scrollIntoViewIfNeeded();
  await expect(report.getByText('Club 39 — c39@x.fr')).toBeInViewport();
});
