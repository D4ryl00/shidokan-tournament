import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

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
  // Tranche d'âge avec ses âges ; catégorie de poids choisie, poids actuel laissé vide (facultatif).
  await fillFighter(coach, { last: 'MARTIN', first: 'Léa', sex: 'Féminin', age: 'Cadets (14 à 15 ans)', weightClass: '-54 kg', combat: 'Karaté', ruleset: 'Jiyu', kata: true, grade: '1er kyu' });
  await shot(coach, '3-formulaire');
  await coach.getByTestId('line-save').click();
  await coach.reload();
  await expect(coach.getByTestId('club-line')).toHaveCount(1);
  await expect(coach.getByTestId('club-line')).toContainText('F · Cadets · -54 kg');
  await expect(coach.getByTestId('club-line-disciplines')).toHaveText('Karaté (jiyu) + Kata');
  await shot(coach, '4-liste');

  // 4. Modifier (Boxing), ajouter puis supprimer un second combattant.
  await coach.getByTestId('club-line').getByRole('button', { name: 'Modifier' }).click();
  await coach.getByTestId('club-line-form').getByRole('group', { name: 'Discipline de combat' }).getByText('Boxing', { exact: true }).click();
  // Poids actuel hors de la catégorie choisie : avertissement, l'enregistrement passe quand même.
  await coach.getByTestId('line-weight').fill('58');
  const outside = 'Le poids actuel (58 kg) est en dehors de la catégorie -54 kg : il correspond à -61 kg.';
  await expect(coach.getByTestId('line-weight-warning')).toHaveText(outside);
  await coach.getByTestId('line-save').click();
  await expect(coach.getByTestId('club-line-disciplines')).toHaveText('Shido-boxing (jiyu) + Kata');
  await expect(coach.getByTestId('line-notice')).toHaveText(outside);
  await coach.getByTestId('add-fighter').click();
  await fillFighter(coach, { last: 'DURAND', first: 'Hugo', sex: 'Masculin', age: 'Seniors (18 à 34 ans)', kg: '75', kata: true });
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
  fs.rmSync(path.join('tmp/e2e/pieces-jointes', listed.find((a) => a.fileName === 'reglement.pdf')!.id));
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
  const [first] = (await (await request.post(`/api/competitions/${id}/invitations`, { data: { directoryIds: [entry] } })).json()) as { token: string }[];

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
  expect((await request.get(`/api/inscription/${first!.token}`)).status()).toBe(200);

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
  expect((await request.get(`/api/inscription/${first!.token}`)).status()).toBe(410);

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
