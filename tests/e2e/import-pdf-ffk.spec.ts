import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { buildFfkPdf } from '../helpers/ffk-pdf.js';
import { createCompetition, inviteWithLink, SERVER_SESSION } from './helpers.js';

// Import du PDF « État des inscriptions » de la FFK. Coach : serveur en ligne (port 3101, session de l'organisateur ouverte par global-setup,
// jamais de nouvelle connexion). Organisateur : serveur local (port 3100), voir le dernier test. Noms inventés.
const ONLINE = { baseURL: 'http://localhost:3101', storageState: SERVER_SESSION };
const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };

const pdf = async (title: string, fighters: string[]) =>
  Buffer.from(await buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', categories: [{ title, status: 'Inscrits', fighters }] }));

const fighterLine = (lastName: string, firstName: string, ageBandCode: string, weightClassId: string, over: object = {}) => ({
  lastName, firstName, sex: 'M', ageBandCode, weightClassId, weightKg: null, combats: ['karate'], kata: false, grade: null, ruleset: 'jiyu', prefs: {}, shobuKeep: null, ...over,
});

/** Compétition à venir, inscriptions ouvertes, un club invité avec son lien. */
async function coachSetup(page: Page, request: APIRequestContext, name: string) {
  const id = await createCompetition(page, name);
  expect((await request.patch(`/api/competitions/${id}/club-entry`, { data: { status: 'open', deadline: null } })).ok()).toBe(true);
  const entry = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo PDF ${name} ${Date.now()}` } })).json()) as { id: string };
  const link = await inviteWithLink(request, id, entry.id);
  return { id, token: link.token };
}

const lineOf = (request: APIRequestContext, token: string, line: object) => request.post(`/api/inscription/${token}/lines`, { data: { line } });
const linesOf = async (request: APIRequestContext, token: string) =>
  ((await (await request.get(`/api/inscription/${token}`)).json()) as { lines: { line: { lastName: string; weightKg: number | null; weightClassId: string | null; combats: string[]; kata: boolean } }[] }).lines;

/** Ouvre la fenêtre d'import, choisit la discipline et le PDF. */
async function choose(page: Page, file: Buffer, discipline: string) {
  await page.getByTestId('ffk-import').click();
  const win = page.getByTestId('ffk-start-form');
  await win.getByTestId('ffk-discipline').click();
  await page.getByRole('option', { name: discipline, exact: true }).click();
  await page.getByTestId('ffk-file').click({ trial: true });
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({ name: 'etat-des-inscriptions.pdf', mimeType: 'application/pdf', buffer: file });
  return win;
}

test.describe('coach', () => {
  test.use(ONLINE);

  test('liste vide : 3 fiches, une enregistrée, une passée, arrêt à la troisième ; réimport : 1 déjà à jour', async ({ page, request }) => {
    const { token } = await coachSetup(page, request, 'Coupe PDF coach');
    const file = await pdf('Senior Masculin -75 KG', ['DURAND LEO', 'MARTIN HUGO', 'PETIT NOAH']);
    await page.goto(`/inscription/${token}`);
    // Où trouver le PDF : une ligne sur la page, le chemin complet dans la fenêtre.
    await expect(page.getByTestId('ffk-import-hint')).toContainText('ffkcompetition.fr');

    const win = await choose(page, file, 'Karaté');
    await expect(win.getByTestId('ffk-pdf-source')).toContainText('onglet « Récap », puis téléchargez « Etat des inscriptions »');
    await expect(win.getByRole('link', { name: 'ffkcompetition.fr' })).toHaveAttribute('href', 'https://www.ffkcompetition.fr');
    await expect(win.getByTestId('ffk-counts')).toContainText('3 nouveaux');
    await expect(page.getByTestId('ffk-begin')).toHaveText('Commencer (3 fiches)');
    await page.getByTestId('ffk-begin').click();

    // Fiche 1 : valeurs du PDF marquées « FFK » ; poids actuel tapé, enregistré.
    const form = page.getByTestId('club-line-form');
    await expect(form.getByTestId('ffk-progress')).toContainText('Fiche 1 sur 3');
    await expect(form.getByTestId('ffk-mark-name').first()).toHaveText('FFK');
    await expect(form.getByTestId('line-last-name')).toHaveValue('DURAND');
    await form.getByTestId('line-weight').fill('74');
    await form.getByRole('button', { name: 'Enregistrer · suivant →' }).click();

    // Fiche 2 : « Ne pas l'ajouter ».
    await expect(form.getByTestId('ffk-progress')).toContainText('Fiche 2 sur 3');
    await expect(form.getByTestId('line-last-name')).toHaveValue('MARTIN');
    await form.getByRole('button', { name: 'Ne pas l’ajouter' }).click();

    // Fiche 3 : on ferme la fenêtre.
    await expect(form.getByTestId('ffk-progress')).toContainText('Fiche 3 sur 3');
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();

    await expect.poll(async () => (await linesOf(request, token)).map((l) => l.line.lastName)).toEqual(['DURAND']);
    expect((await linesOf(request, token))[0]!.line.weightKg).toBe(74);
    await page.reload();
    await expect(page.getByTestId('club-line')).toHaveCount(1);

    // Réimport du même PDF : la fiche enregistrée est à jour.
    const again = await choose(page, file, 'Karaté');
    await expect(again.getByTestId('ffk-counts')).toContainText('1 déjà à jour');
    await expect(again.getByTestId('ffk-counts')).toContainText('2 nouveaux');
    await expect(page.getByRole('button', { name: 'Commencer (2 fiches)' })).toBeVisible();
  });

  test('conflit et absent : « Votre fiche » gardée, l’absent est décoché, « Terminer » ne retire rien', async ({ page, request }) => {
    const { token } = await coachSetup(page, request, 'Coupe PDF conflit');
    expect((await lineOf(request, token, fighterLine('DURAND', 'Leo', 'pupille', 'pupille:M:-35'))).ok()).toBe(true);
    expect((await lineOf(request, token, fighterLine('MOREAU', 'Hugo', 'senior', 'senior:M:-75'))).ok()).toBe(true);
    await page.goto(`/inscription/${token}`);

    const win = await choose(page, await pdf('Pupille Masculin -40 KG', ['DURAND LEO']), 'Karaté');
    await expect(win.getByTestId('ffk-counts')).toContainText('1 fiche existante à revoir');
    await page.getByTestId('ffk-begin').click();

    const form = page.getByTestId('club-line-form');
    await expect(form.getByTestId('ffk-banner')).toContainText('Fiche déjà créée.');
    const group = form.getByRole('group', { name: /^Catégorie de poids : valeur à garder/ });
    await expect(group.getByTestId('ffk-choice-ffk')).toContainText('-40');
    await expect(group.getByTestId('ffk-choice-fiche')).toContainText('-35');
    await group.getByTestId('ffk-choice-fiche').click();
    await expect(group.getByTestId('ffk-choice-fiche')).toHaveAttribute('aria-pressed', 'true');
    await form.getByRole('button', { name: 'Enregistrer · suivant →' }).click();

    // Fin : l'absent du PDF est listé, décoché ; « Terminer » ne retire personne.
    const end = page.getByTestId('ffk-end');
    await expect(end).toBeVisible();
    await expect(end.getByTestId('ffk-absent')).toHaveCount(1);
    await expect(end.getByRole('checkbox', { name: /MOREAU Hugo/ })).not.toBeChecked();
    await end.getByTestId('ffk-finish').click();
    await expect(end).toBeHidden();

    const lines = await linesOf(request, token);
    expect(lines.map((l) => l.line.lastName).sort()).toEqual(['DURAND', 'MOREAU']);
    expect(lines.find((l) => l.line.lastName === 'DURAND')!.line.weightClassId).toBe('pupille:M:-35');
  });

  test('absents cochés : « Terminer » retire le karaté (kata gardé), supprime une fiche karaté seul, laisse l’absent décoché', async ({ page, request }) => {
    const { token } = await coachSetup(page, request, 'Coupe PDF retraits');
    expect((await lineOf(request, token, fighterLine('DURAND', 'Leo', 'senior', 'senior:M:-75'))).ok()).toBe(true);
    expect((await lineOf(request, token, fighterLine('MOREAU', 'Hugo', 'senior', 'senior:M:-75', { kata: true }))).ok()).toBe(true);
    expect((await lineOf(request, token, fighterLine('ROUX', 'Tom', 'senior', 'senior:M:-75'))).ok()).toBe(true);
    expect((await lineOf(request, token, fighterLine('FAURE', 'Paul', 'senior', 'senior:M:-75'))).ok()).toBe(true);
    await page.goto(`/inscription/${token}`);

    // Le seul combattant du PDF est déjà à jour : on passe directement à la fin.
    const win = await choose(page, await pdf('Senior Masculin -75 KG', ['DURAND LEO']), 'Karaté');
    await expect(win.getByTestId('ffk-counts')).toContainText('1 déjà à jour');
    await page.getByRole('button', { name: 'Continuer' }).click();

    const end = page.getByTestId('ffk-end');
    await expect(end.getByTestId('ffk-absent')).toHaveCount(3);
    await expect(end.getByText('Seniors · -75 kg · aussi en Kata')).toBeVisible();
    await expect(end.getByText('Seniors · -75 kg · seulement en karaté : cocher supprime sa fiche')).toHaveCount(2);
    await end.getByRole('checkbox', { name: /MOREAU Hugo/ }).check();
    await end.getByRole('checkbox', { name: /ROUX Tom/ }).check();
    await expect(end.getByRole('checkbox', { name: /FAURE Paul/ })).not.toBeChecked();
    await end.getByTestId('ffk-finish').click();
    await expect(end).toBeHidden();
    await expect(page.getByText('Import FFK : 0 ajouté · 0 mis à jour · 0 laissé tel quel · Karaté retiré de 1 fiche · 1 fiche supprimée.')).toBeVisible();

    const lines = await linesOf(request, token);
    const byName = (n: string) => lines.find((l) => l.line.lastName === n)?.line;
    expect(lines.map((l) => l.line.lastName).sort()).toEqual(['DURAND', 'FAURE', 'MOREAU']);
    expect(byName('MOREAU')).toMatchObject({ combats: [], kata: true });
    expect(byName('FAURE')).toMatchObject({ combats: ['karate'], kata: false });
    expect(byName('DURAND')).toMatchObject({ combats: ['karate'] });
    await expect(page.getByTestId('club-line')).toHaveCount(3);
  });
});

test('organisateur : Fiche club, club de l’annuaire, kata, une fiche enregistrée → visible dans Inscriptions', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe PDF organisateur');
  const club = `Dojo PDF orga ${Date.now()}`;
  await page.request.post('/api/club-directory', { data: { ...EMPTY, name: club } });
  await page.goto(`/competitions/${id}/fiche-club`);

  const win = await choose(page, await pdf('Senior Masculin -75 KG', ['LAMBERT THEO']), 'Kata');
  await win.getByTestId('club-picker').getByLabel('Club').click();
  await page.getByRole('option', { name: club, exact: true }).click();
  await expect(win.getByTestId('ffk-counts')).toContainText('1 nouveau');
  await page.getByTestId('ffk-begin').click();

  const form = page.getByTestId('club-line-form');
  await expect(form.getByTestId('ffk-progress')).toContainText('Fiche 1 sur 1');
  await expect(form.getByTestId('line-last-name')).toHaveValue('LAMBERT');
  await form.getByRole('button', { name: 'Enregistrer · suivant →' }).click();
  await page.getByTestId('ffk-finish').click();
  await expect(page.getByTestId('ffk-end')).toBeHidden();

  await page.goto(`/competitions/${id}/inscriptions`);
  const row = page.getByTestId('registration-row').filter({ hasText: 'LAMBERT' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(club);
  await expect(row).toContainText(/kata/i);
});
