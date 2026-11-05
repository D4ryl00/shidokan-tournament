import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { chooseTheme, createCompetition, inviteWithLink, SERVER_SESSION } from './helpers.js';

// Coordonnées des clubs entre l'annuaire et les compétitions : serveur en ligne (port 3101), session de l'organisateur ouverte par global-setup.
// Le compte Table centrale n'est pas rejoué ici (une nouvelle connexion épuiserait la limite) : son refus de /api/club-changes est couvert par les tests de permissions.
test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

const BASE = 'http://localhost:3101';
const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Compétition à venir : dans trente jours. */
const inThirtyDays = () => local(new Date(Date.now() + 30 * 86_400_000));
const today = () => new Date().toLocaleDateString('fr-FR');

interface Header { name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; preApproval: boolean; affiliationNumber: string | null }

/** Compétition à venir, inscriptions ouvertes. */
async function newCompetition(page: Page, request: APIRequestContext, name: string): Promise<string> {
  const competitionId = await createCompetition(page, name);
  expect((await request.patch(`/api/competitions/${competitionId}`, { data: { date: inThirtyDays() } })).ok()).toBe(true);
  expect((await request.patch(`/api/competitions/${competitionId}/club-entry`, { data: { status: 'open', deadline: null } })).ok()).toBe(true);
  return competitionId;
}

/** Fiche d'annuaire à trois adresses, club invité avec son lien. */
async function addClub(request: APIRequestContext, competitionId: string, label: string, extraEmail?: string) {
  const club = `Dojo ${label} ${Date.now()}`;
  const emails = ['une@dojo.example', 'deux@dojo.example', 'trois@dojo.example'];
  const entry = (await (await request.post('/api/club-directory', {
    data: { name: club, affiliationNumber: null, coachName: 'Marc Durand', coachPhone: '06 11 22 33 44', coachEmails: extraEmail ? [...emails, extraEmail] : emails, notes: null },
  })).json()) as { id: string };
  const link = await inviteWithLink(request, competitionId, entry.id);
  return { club, entry, token: link.token };
}

/** Un club dans sa propre compétition à venir. */
async function setup(page: Page, request: APIRequestContext, label: string, extraEmail?: string) {
  const competitionId = await newCompetition(page, request, `Coupe ${label} ${Date.now()}`);
  return { competitionId, ...(await addClub(request, competitionId, label, extraEmail)) };
}

/** Le coach enregistre sa page : requête sans session, la route est publique. */
async function coachSaves(playwright: { request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> } }, token: string, patch: Partial<Header>) {
  const coach = await playwright.request.newContext({ baseURL: BASE });
  const view = (await (await coach.get(`/api/inscription/${token}`)).json()) as { club: Header };
  const { name: _name, ...header } = view.club;
  const res = await coach.patch(`/api/inscription/${token}/club`, { data: { ...header, ...patch } });
  expect(res.status()).toBe(200);
  await coach.dispose();
}

const changesOf = async (request: APIRequestContext, competitionId: string) => (await (await request.get(`/api/club-changes?competitionId=${competitionId}`)).json()) as { clubId: string }[];
const entryOf = async (request: APIRequestContext, id: string) => ((await (await request.get('/api/club-directory')).json()) as { id: string; coachPhone: string | null; coachEmails: string[] }[]).find((e) => e.id === id)!;

test('annuaire et fiche club : bandeaux, pastilles, Plus tard, Ignorer (et retour), Enregistrer dans l’annuaire', async ({ page, request, playwright }) => {
  const { club, entry, competitionId, token } = await setup(page, request, 'bandeaux');
  await coachSaves(playwright, token, { coachPhone: '06 99 88 77 66', coachEmails: ['une@dojo.example', 'deux@dojo.example'] });

  // Annuaire : bandeau, pastille, fenêtre avec les choix par défaut.
  await page.goto('/annuaire');
  const total = ((await (await request.get('/api/club-changes')).json()) as unknown[]).length;
  await expect(page.getByTestId('directory-changes-banner')).toHaveText(
    `${total === 1 ? '1 club diffère' : `${total} clubs diffèrent`} de l’annuaire après une modification dans une compétition.Voir les changements`,
  );
  const row = page.getByTestId('directory-row').filter({ hasText: club });
  await expect(row.getByTestId('club-change-pill')).toHaveText('Modifié par le club');
  await row.getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${club} : garder quelles informations ?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Compétition : 06 99 88 77 66' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Annuaire : 06 11 22 33 44' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'trois@dojo.example (seulement dans l’annuaire)' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'une@dojo.example (dans les deux)' })).toBeChecked();
  await expect(dialog.getByTestId('change-same-coachName')).toContainText('Marc Durand (identique)');

  // « Plus tard » : rien ne change.
  await dialog.getByRole('button', { name: 'Plus tard' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('directory-changes-banner')).toBeVisible();
  expect((await entryOf(request, entry.id)).coachPhone).toBe('06 11 22 33 44');

  // Fiche club : bandeau en tête, pastille sur la ligne, hors du panneau en ligne.
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  const banner = page.getByTestId('competition-changes-banner');
  await expect(banner).toContainText(`${club} a été modifié le ${today()} par le club : il diffère de l’annuaire.`);
  await expect(page.getByTestId('invitation-row').filter({ hasText: club }).getByTestId('club-change-pill')).toHaveText('Modifié par le club');

  // « Ignorer ce changement » : le bandeau disparaît ; un enregistrement identique ne le fait pas revenir, un autre téléphone si.
  await banner.getByRole('button', { name: 'Comparer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ignorer ce changement' }).click();
  await expect(banner).toHaveCount(0);
  await coachSaves(playwright, token, { coachPhone: '06 99 88 77 66', coachEmails: ['une@dojo.example', 'deux@dojo.example'] });
  expect(await changesOf(request, competitionId)).toEqual([]);
  await coachSaves(playwright, token, { coachPhone: '06 55 44 33 22' });
  await page.reload();
  await expect(banner).toBeVisible();

  // « Enregistrer dans l'annuaire » : la fiche reçoit les choix (adresse de l'annuaire gardée), le bandeau disparaît.
  await banner.getByRole('button', { name: 'Comparer' }).click();
  const compare = page.getByRole('dialog');
  await compare.getByRole('checkbox', { name: 'trois@dojo.example (seulement dans l’annuaire)' }).check();
  await compare.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(compare).toBeHidden();
  await expect(banner).toHaveCount(0);
  expect(await entryOf(request, entry.id)).toMatchObject({ coachPhone: '06 55 44 33 22', coachEmails: ['une@dojo.example', 'deux@dojo.example', 'trois@dojo.example'] });
  expect(await changesOf(request, competitionId)).toEqual([]);
});

test('onglet Clubs : notification « diffère de l’annuaire » avec Comparer, pastille « Modifié dans la compétition »', async ({ page, request }) => {
  const { club, competitionId } = await setup(page, request, 'onglet');
  await page.goto(`/competitions/${competitionId}/clubs`);
  const renamed = `${club} bis`;
  await page.getByRole('button', { name: `Modifier ${club}` }).click();
  await page.getByTestId('club-edit-name').fill(renamed);
  await page.getByTestId('club-edit-save').click();

  const note = page.locator('.mantine-Notification-root').filter({ hasText: `${renamed} diffère de l’annuaire.` });
  await expect(note).toBeVisible();
  await expect(page.getByTestId('club-row').filter({ hasText: renamed }).getByTestId('club-change-pill')).toHaveText('Modifié dans la compétition');
  await note.getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${renamed} : garder quelles informations ?` });
  await expect(dialog.getByRole('radio', { name: `Compétition : ${renamed}` })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: `Annuaire : ${club}` })).toBeVisible();
  await dialog.getByRole('button', { name: 'Ignorer ce changement' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('club-row').filter({ hasText: renamed }).getByTestId('club-change-pill')).toHaveCount(0);
});

test('téléphone effacé par le club : « (vide) », l’annuaire choisi par défaut ; fenêtre lisible à 960 px, en thème sombre, avec une longue adresse', async ({ page, request, playwright }) => {
  const long = `${'adresse-tres-longue-'.repeat(6)}@exemple-de-domaine-interminable.example`;
  const { club, entry, competitionId, token } = await setup(page, request, 'effacement', long);
  await coachSaves(playwright, token, { coachPhone: null });

  await page.setViewportSize({ width: 960, height: 700 });
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  await chooseTheme(page, 'Sombre');
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${club} : garder quelles informations ?` });
  await expect(dialog.getByRole('radio', { name: 'Compétition : (vide)' })).not.toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Annuaire : 06 11 22 33 44' })).toBeChecked();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(960);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  // Enregistrer avec l'annuaire par défaut : la fiche garde son téléphone.
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  expect((await entryOf(request, entry.id)).coachPhone).toBe('06 11 22 33 44');
  expect(await changesOf(request, competitionId)).toEqual([]);
});

test('« Voir les changements » : le premier, puis le suivant après chaque décision', async ({ page, request, playwright }) => {
  // Deux compétitions de même date : classées par nom, « suite-1 » avant « suite-2 ».
  const first = await setup(page, request, 'suite-1');
  const second = await setup(page, request, 'suite-2');
  await coachSaves(playwright, first.token, { coachPhone: '06 10 10 10 10' });
  await coachSaves(playwright, second.token, { coachPhone: '06 20 20 20 20' });

  await page.goto('/annuaire');
  await page.getByTestId('directory-changes-banner').getByRole('button', { name: 'Voir les changements' }).click();
  await expect(page.getByRole('dialog', { name: `${first.club} : garder quelles informations ?` })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  const next = page.getByRole('dialog', { name: `${second.club} : garder quelles informations ?` });
  await expect(next).toBeVisible();
  await next.getByRole('button', { name: 'Ignorer ce changement' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await entryOf(request, first.entry.id)).coachPhone).toBe('06 10 10 10 10');
  expect((await entryOf(request, second.entry.id)).coachPhone).toBe('06 11 22 33 44');
});

test('plus de trois clubs qui diffèrent dans une compétition : un seul bandeau avec leur nombre', async ({ page, request, playwright }) => {
  const competitionId = await newCompetition(page, request, `Coupe nombreux ${Date.now()}`);
  for (let i = 1; i <= 4; i++) {
    const c = await addClub(request, competitionId, `nombreux-${i}`);
    await coachSaves(playwright, c.token, { coachPhone: `06 00 00 00 0${i}` });
  }
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  const banner = page.getByTestId('competition-changes-banner');
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText('4 clubs diffèrent de l’annuaire.');
  await banner.getByRole('button', { name: 'Voir les changements' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  // Nettoyage : les quatre changements sont ignorés.
  const open = (await (await request.get(`/api/club-changes?competitionId=${competitionId}`)).json()) as { clubId: string; changedAt: string }[];
  for (const c of open) expect((await request.post(`/api/club-changes/${c.clubId}/ignore`, { data: { changedAt: c.changedAt } })).status()).toBe(204);
});

test('adresses toutes décochées : la fiche perd ses adresses après l’enregistrement', async ({ page, request, playwright }) => {
  const { competitionId, entry, token } = await setup(page, request, 'adresses');
  await coachSaves(playwright, token, { coachEmails: ['nouvelle@dojo.example'] });
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'nouvelle@dojo.example (ajoutée dans la compétition)' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'nouvelle@dojo.example (ajoutée dans la compétition)' }).uncheck();
  await expect(dialog.getByText('Aucune adresse cochée : la fiche n’en gardera pas.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  expect((await entryOf(request, entry.id)).coachEmails).toEqual([]);
});

test('compétition gérée ailleurs : « Appliquer aussi » désactivée avec son explication, le club reste inchangé', async ({ page, request, playwright }) => {
  const { club, competitionId, entry, token } = await setup(page, request, 'gerée');
  await coachSaves(playwright, token, { coachPhone: '06 77 77 77 77' });
  // Le serveur du test gère la compétition : la réponse est présentée comme gérée par un PC.
  await page.route(/\/api\/club-changes(\?|$)/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { managedHere: boolean; ownerName: string | null }[];
    await route.fulfill({ response: res, json: body.map((c) => ({ ...c, managedHere: false, ownerName: 'PC du dojo' })) });
  });
  let sent: { applyToClub?: boolean } = {};
  await page.route('**/api/club-changes/*/resolve', async (route) => {
    sent = route.request().postDataJSON();
    await route.continue();
  });
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${club} : garder quelles informations ?` });
  const apply = dialog.getByRole('checkbox', { name: /^Appliquer aussi au club dans / });
  await expect(apply).toBeDisabled();
  await expect(apply).not.toBeChecked();
  await expect(dialog).toContainText('Gérée par PC du dojo : à appliquer après le retour de la main.');
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  expect(sent.applyToClub).toBe(false);
  expect((await entryOf(request, entry.id)).coachPhone).toBe('06 77 77 77 77');
  const clubs = (await (await request.get(`/api/competitions/${competitionId}/clubs`)).json()) as { name: string; coachPhone: string | null }[];
  expect(clubs.find((c) => c.name === club)!.coachPhone).toBe('06 77 77 77 77');
});
