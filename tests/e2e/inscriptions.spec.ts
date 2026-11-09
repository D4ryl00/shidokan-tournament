import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { createCompetition, openTab } from './helpers.js';

async function downloadTemplate(page: Page, id: string): Promise<Buffer> {
  await page.goto(`/competitions/${id}/fiche-club`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('club-form-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^fiche-club-.*\.ods$/);
  return fs.readFileSync((await download.path())!);
}

async function uploadForm(page: Page, buffer: Buffer) {
  await page.getByTestId('club-form-file').setInputFiles({
    name: 'fiche.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer,
  });
}

const HEADER = ['Tani Dojo', 'Jean Coach', '0600000000', null, 'Oui'];

test('fiche club : modèle, aperçu avec erreur, import, réimport corrigé', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe fiche club');
  const template = await downloadTemplate(page, id);

  await uploadForm(page, fillClubForm(template, HEADER, [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
    ['PETIT', 'Noé', 'Masculin', 'Minimes', '-45', 'Karaté', 'Shobu', null, null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Shido-boxing', 'Shobu', null, 'Oui', 74],
  ]));
  await expect(page.getByTestId('club-form-preview-row')).toHaveCount(3);
  // Le champ est vidé aussitôt lu : choisir de nouveau le même fichier (corrigé entre-temps) le relit.
  await expect(page.getByTestId('club-form-file')).toHaveValue('');
  await expect(page.getByTestId('club-form-row-error')).toContainText('réservé aux adultes');
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText('2 inscriptions importées')).toBeVisible();
  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row')).toHaveCount(2);

  await page.goto(`/competitions/${id}/fiche-club`);
  await uploadForm(page, fillClubForm(template, HEADER, [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
    ['PETIT', 'Noé', 'Masculin', 'Minimes', '-45', 'Karaté', 'Jiyu', null, null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Shido-boxing', 'Shobu', null, 'Oui', 74],
  ]));
  await page.getByTestId('club-form-import').click();
  await expect(page.getByText('3 inscriptions importées, 2 remplacées')).toBeVisible();
  await page.goto(`/competitions/${id}/inscriptions`);
  await expect(page.getByTestId('registration-row')).toHaveCount(3);
});

async function pick(page: Page, testId: string, option: string) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Remplit la fenêtre du combattant (celle du coach) ; seuls les champs donnés sont touchés. */
async function fillFighter(page: Page, f: { last?: string; first?: string; sex?: 'Féminin' | 'Masculin'; age?: string; weightClass?: string; combat?: string; ruleset?: string; kata?: boolean }) {
  const form = page.getByTestId('club-line-form');
  if (f.last) await form.getByTestId('line-last-name').fill(f.last);
  if (f.first) await form.getByTestId('line-first-name').fill(f.first);
  if (f.sex) await form.getByRole('group', { name: 'Sexe' }).getByText(f.sex, { exact: true }).click();
  if (f.age) await pick(page, 'line-age', f.age);
  if (f.weightClass) await pick(page, 'line-weight-class', f.weightClass);
  if (f.combat) await form.getByRole('group', { name: 'Discipline de combat' }).getByText(f.combat, { exact: true }).click();
  if (f.ruleset) await form.getByRole('group', { name: 'Règlement' }).getByText(f.ruleset, { exact: true }).click();
  if (f.kata !== undefined) await (f.kata ? form.getByTestId('line-kata').check() : form.getByTestId('line-kata').uncheck());
}

/** Étape « Club » : choisit un club de la liste puis « Suivant ». */
async function chooseClub(page: Page, name: string) {
  await page.getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByTestId('fighter-next').click();
}

async function addClub(page: Page, id: string, name: string): Promise<string> {
  const res = await page.request.post(`/api/competitions/${id}/clubs`, { data: { name } });
  return ((await res.json()) as { id: string }).id;
}

/** Saisie papier : choisit le club dans la liste. */
async function choosePaperClub(page: Page, name: string) {
  await page.getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name, exact: true }).click();
}

const MARTIN = { last: 'MARTIN', first: 'Léa', sex: 'Féminin', age: 'Cadets (14 à 15 ans)', weightClass: '-54 kg', combat: 'Karaté', ruleset: 'Jiyu' } as const;

test('ajouter un combattant : club puis fenêtre du coach, inscriptions sur place', async ({ page }) => {
  const id = await createCompetition(page, 'Fenêtre ajout combattant');
  await addClub(page, id, 'Tani Dojo');
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await expect(page.getByTestId('fighter-next')).toBeDisabled();
  await chooseClub(page, 'Tani Dojo');
  await expect(page.getByRole('dialog', { name: 'Ajouter un combattant · Tani Dojo' })).toBeVisible();
  await fillFighter(page, { ...MARTIN, kata: true });
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line-form')).toHaveCount(0);
  const rows = page.getByTestId('registration-row');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) await expect(row).toContainText('Sur place');
  await expect(rows.filter({ hasText: 'Kata' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Tani Dojo' })).toHaveCount(2);
});

test('ajouter un club depuis Inscriptions', async ({ page }) => {
  const id = await createCompetition(page, 'Fenêtre ajout club');
  const club = `Dojo ajouté ${Date.now()}`;
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await page.getByTestId('club-picker-new').click();
  await page.getByTestId('directory-name').fill(club);
  await page.getByTestId('directory-save').click();
  await expect(page.getByTestId('club-picker').getByLabel('Club')).toHaveValue(club);
  await page.goto('/');
  await page.getByTestId('nav-directory').click();
  await expect(page.getByTestId('directory-row').filter({ hasText: club })).toBeVisible();
});

test('modifier un combattant ouvre la fenêtre entière ; décocher le kata retire l’inscription kata', async ({ page }) => {
  const id = await createCompetition(page, 'Fenêtre modification');
  await addClub(page, id, 'Tani Dojo');
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await chooseClub(page, 'Tani Dojo');
  await fillFighter(page, { ...MARTIN, kata: true });
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('registration-row')).toHaveCount(2);

  // Le crayon d'une ligne ouvre toutes les inscriptions du combattant.
  await page.getByTestId('registration-row').filter({ hasText: 'Karaté' }).getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByTestId('line-kata')).toBeChecked();
  await expect(page.getByTestId('line-last-name')).toHaveValue('MARTIN');
  await fillFighter(page, { kata: false });
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line-form')).toHaveCount(0);
  await expect(page.getByTestId('registration-row')).toHaveCount(1);
  await expect(page.getByTestId('registration-row')).toContainText('Karaté');
});

test('changer de club', async ({ page }) => {
  const id = await createCompetition(page, 'Fenêtre changement de club');
  await addClub(page, id, 'Tani Dojo');
  await addClub(page, id, 'Autre Dojo');
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await chooseClub(page, 'Tani Dojo');
  await fillFighter(page, MARTIN);
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('registration-row')).toContainText('Tani Dojo');

  await page.getByTestId('registration-row').getByRole('button', { name: 'Modifier' }).click();
  await page.getByTestId('fighter-change-club').click();
  await chooseClub(page, 'Autre Dojo');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line-form')).toHaveCount(0);
  await expect(page.getByTestId('registration-row')).toHaveCount(1);
  await expect(page.getByTestId('registration-row')).toContainText('Autre Dojo');
});

test('deux postes : modification périmée', async ({ page, context }) => {
  const id = await createCompetition(page, 'Fenêtre version périmée');
  await addClub(page, id, 'Tani Dojo');
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await chooseClub(page, 'Tani Dojo');
  await fillFighter(page, MARTIN);
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('registration-row')).toHaveCount(1);

  const second = await context.newPage();
  await second.goto(`/competitions/${id}/inscriptions`);
  await second.getByTestId('registration-row').getByRole('button', { name: 'Modifier' }).click();
  await expect(second.getByTestId('line-last-name')).toHaveValue('MARTIN');

  // Le premier poste enregistre d'abord.
  await page.getByTestId('registration-row').getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByTestId('line-last-name')).toHaveValue('MARTIN');
  await fillFighter(page, { weightClass: '-61 kg' });
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line-form')).toHaveCount(0);

  // Le second enregistre une version périmée : la fenêtre se ferme avec le message, la liste montre la valeur du premier.
  await fillFighter(second, { weightClass: '-47 kg' });
  await second.getByTestId('line-save').click();
  await expect(second.getByTestId('club-line-form')).toHaveCount(0);
  await expect(second.getByText('Ce combattant a été modifié entre-temps').first()).toBeVisible();
  await expect(second.getByTestId('registration-row')).toContainText('-61');
});

test('Enregistrer et ajouter un autre garde le club', async ({ page }) => {
  const id = await createCompetition(page, 'Fenêtre ajout enchaîné');
  await addClub(page, id, 'Tani Dojo');
  await page.goto(`/competitions/${id}/inscriptions`);
  await page.getByTestId('registration-add').click();
  await chooseClub(page, 'Tani Dojo');
  await fillFighter(page, MARTIN);
  await page.getByTestId('line-save-next').click();
  // Fenêtre vide, même club.
  await expect(page.getByTestId('line-last-name')).toHaveValue('');
  await expect(page.getByRole('dialog', { name: 'Ajouter un combattant · Tani Dojo' })).toBeVisible();
  await fillFighter(page, { last: 'PETIT', first: 'Noé', sex: 'Masculin', age: 'Cadets (14 à 15 ans)', weightClass: '-52 kg', combat: 'Karaté', ruleset: 'Jiyu' });
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('club-line-form')).toHaveCount(0);
  await expect(page.getByTestId('registration-row')).toHaveCount(2);
  await expect(page.getByTestId('registration-row').filter({ hasText: 'Tani Dojo' })).toHaveCount(2);
});

test('fiche papier : le bouton télécharge le PDF (une page)', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe fiche papier');
  await page.goto(`/competitions/${id}/fiche-club`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('paper-form-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^fiche-club-.*\.pdf$/);
  const pdf = fs.readFileSync((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});



test('saisie d’une fiche papier', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe saisie papier');
  await addClub(page, id, 'Tani Dojo');
  await page.goto(`/competitions/${id}/fiche-club`);
  await choosePaperClub(page, 'Tani Dojo');
  const row = page.getByTestId('paper-entry-row').first();
  await row.getByLabel('Nom', { exact: true }).fill('MARTIN');
  await row.getByLabel('Prénom').fill('Léa');
  await row.getByText('F', { exact: true }).click();
  await row.getByText('C', { exact: true }).click();
  await row.getByLabel('Poids actuel').fill('53,5');
  await row.getByText('Karaté', { exact: true }).click();
  await row.getByText('Kata', { exact: true }).click();
  await row.getByLabel('Grade').fill('1er kyu');
  await row.getByText('Jiyu', { exact: true }).click();
  await row.getByLabel('Reclassement Mix').selectOption('1');
  await page.getByTestId('paper-entry-check').click();
  await expect(page.getByTestId('paper-entry-preview').getByTestId('club-form-preview-row')).toHaveCount(2);
  await page.getByTestId('paper-entry-save').click();
  await expect(page.getByText('Tani Dojo : 2 inscriptions')).toBeVisible();
  const regs = (await (await request.get(`/api/competitions/${id}/registrations`)).json()) as { discipline: string; weightClassId: string | null }[];
  expect(regs.map((r) => r.discipline).sort()).toEqual(['karate', 'kata']);
  expect(regs.find((r) => r.discipline === 'karate')!.weightClassId).toBe('cadet:F:-54');
  // Une saisie commencée puis abandonnée n'écrit rien
  await page.goto(`/competitions/${id}/fiche-club`);
  await addClub(page, id, 'Autre club');
  await page.goto(`/competitions/${id}/fiche-club`);
  await choosePaperClub(page, 'Autre club');
  await page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true }).fill('DURAND');
  await page.goto(`/competitions/${id}/inscriptions`);
  expect(((await (await request.get(`/api/competitions/${id}/registrations`)).json()) as unknown[]).length).toBe(2);
});

test('saisir une fiche papier : choisir le club, pré-accord repris du club', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe papier pré-accord');
  await request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Club accordé', preApproval: true } });
  await addClub(page, id, 'Club sans accord');
  await page.goto(`/competitions/${id}/fiche-club`);
  const accord = page.getByRole('checkbox', { name: /Pré-accord du coach/ });
  await choosePaperClub(page, 'Club accordé');
  await expect(accord).toBeChecked();
  await choosePaperClub(page, 'Club sans accord');
  await expect(accord).not.toBeChecked();
  await choosePaperClub(page, 'Club accordé');
  await accord.uncheck();
  const row = page.getByTestId('paper-entry-row').first();
  await row.getByLabel('Nom', { exact: true }).fill('MARTIN');
  await row.getByLabel('Prénom').fill('Léa');
  await row.getByText('F', { exact: true }).click();
  await row.getByText('C', { exact: true }).click();
  await row.getByText('Kata', { exact: true }).click();
  await page.getByTestId('paper-entry-check').click();
  await page.getByTestId('paper-entry-save').click();
  await expect(page.getByText('Club accordé : 1 inscription')).toBeVisible();
  const clubs = (await (await request.get(`/api/competitions/${id}/clubs`)).json()) as { name: string; preApproval: boolean }[];
  expect(clubs.find((c) => c.name === 'Club accordé')!.preApproval).toBe(false);
});

test('club de l’annuaire choisi puis saisie abandonnée : le club n’est pas dans la compétition', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe papier annuaire');
  const name = `Dojo annuaire ${Date.now()}`;
  await request.post('/api/club-directory', { data: { name, affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null } });
  await page.goto(`/competitions/${id}/fiche-club`);
  await choosePaperClub(page, name);
  const row = page.getByTestId('paper-entry-row').first();
  await row.getByLabel('Nom', { exact: true }).fill('MARTIN');
  await row.getByLabel('Prénom').fill('Léa');
  await row.getByText('F', { exact: true }).click();
  await row.getByText('C', { exact: true }).click();
  await row.getByText('Kata', { exact: true }).click();
  await page.getByTestId('paper-entry-check').click();
  await expect(page.getByTestId('paper-entry-preview')).toBeVisible();
  // « Vérifier » n'écrit rien : abandonner laisse la compétition sans ce club.
  await page.goto(`/competitions/${id}/inscriptions`);
  const clubs = (await (await request.get(`/api/competitions/${id}/clubs`)).json()) as { name: string }[];
  expect(clubs.map((c) => c.name)).not.toContain(name);
  // « Enregistrer la fiche » fait entrer le club dans la compétition.
  await page.goto(`/competitions/${id}/fiche-club`);
  await choosePaperClub(page, name);
  await page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true }).fill('MARTIN');
  await page.getByTestId('paper-entry-row').first().getByLabel('Prénom').fill('Léa');
  await page.getByTestId('paper-entry-row').first().getByText('F', { exact: true }).click();
  await page.getByTestId('paper-entry-row').first().getByText('C', { exact: true }).click();
  await page.getByTestId('paper-entry-row').first().getByText('Kata', { exact: true }).click();
  await page.getByTestId('paper-entry-check').click();
  await page.getByTestId('paper-entry-save').click();
  await expect(page.getByText(`${name} : 1 inscription`)).toBeVisible();
  const after = (await (await request.get(`/api/competitions/${id}/clubs`)).json()) as { name: string }[];
  expect(after.map((c) => c.name)).toContain(name);
});

test('relecture (mineurs) : saisie papier — confirmation avant de quitter, noms accessibles', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe saisie confirmation');
  await page.goto(`/competitions/${id}/fiche-club`);
  await expect(page.getByRole('group', { name: 'Ligne 1 — Sexe' })).toBeVisible();
  await page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true }).fill('MARTIN');
  await openTab(page, 'Inscriptions');
  await expect(page.getByTestId('leave-confirm')).toBeVisible();
  await page.getByTestId('leave-stay').click();
  await expect(page).toHaveURL(/\/fiche-club$/);
  await expect(page.getByTestId('paper-entry-row').first().getByLabel('Nom', { exact: true })).toHaveValue('MARTIN');
  await openTab(page, 'Inscriptions');
  await page.getByTestId('leave-go').click();
  await expect(page).toHaveURL(/\/inscriptions$/);
});
