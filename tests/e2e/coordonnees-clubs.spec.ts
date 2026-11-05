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
  await expect(dialog).toContainText(`modifié le ${today()}`);

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

test('onglet Clubs : la notification « Comparer » disparaît quand on quitte la page', async ({ page, request }) => {
  const { club, competitionId } = await setup(page, request, 'notification');
  await page.goto(`/competitions/${competitionId}/clubs`);
  await page.getByRole('button', { name: `Modifier ${club}` }).click();
  await page.getByTestId('club-edit-name').fill(`${club} bis`);
  await page.getByTestId('club-edit-save').click();
  const note = page.locator('.mantine-Notification-root').filter({ hasText: `${club} bis diffère de l’annuaire.` });
  await expect(note).toBeVisible();
  await page.getByRole('link', { name: 'Fiche club' }).or(page.getByRole('tab', { name: 'Fiche club' })).first().click();
  await expect(page.getByTestId('competition-changes-banner')).toBeVisible();
  await expect(note).toHaveCount(0);
  // Nettoyage : le changement est ignoré, pour ne pas gêner « Voir les changements » des autres tests.
  const open = (await (await request.get(`/api/club-changes?competitionId=${competitionId}`)).json()) as { clubId: string; changedAt: string }[];
  for (const c of open) expect((await request.post(`/api/club-changes/${c.clubId}/ignore`, { data: { changedAt: c.changedAt } })).status()).toBe(204);
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

/** Ouvre la fiche d'annuaire dans l'annuaire, remplace le téléphone et la troisième adresse, enregistre. */
async function editEntry(page: Page, club: string, patch: { phone?: string; emails?: string; notes?: string }) {
  await page.goto('/annuaire');
  await page.getByTestId('directory-row').filter({ hasText: club }).getByRole('button', { name: 'Modifier' }).click();
  const form = page.getByRole('dialog', { name: 'Modifier le club' });
  if (patch.phone) await form.getByLabel('Téléphone').fill(patch.phone);
  if (patch.emails) await form.getByTestId('directory-email').fill(patch.emails);
  if (patch.notes) await form.getByLabel('Notes').fill(patch.notes);
  await form.getByTestId('directory-save').click();
  await expect(form).toBeHidden();
}
const clubIn = async (request: APIRequestContext, competitionId: string, name: string) =>
  ((await (await request.get(`/api/competitions/${competitionId}/clubs`)).json()) as { name: string; coachPhone: string | null; coachEmails: string[] }[]).find((c) => c.name === name)!;

test('fiche modifiée : fenêtre « Appliquer aux compétitions à venir ? », conflit gardé, passée absente, gérée ailleurs sans choix, résultat par compétition', async ({ page, request, playwright }) => {
  const a = await setup(page, request, 'report-a');
  const club = a.club;
  const b = await newCompetition(page, request, `Coupe report-b ${Date.now()}`);
  const linkB = await inviteWithLink(request, b, a.entry.id);
  const past = await newCompetition(page, request, `Coupe report-passée ${Date.now()}`);
  await inviteWithLink(request, past, a.entry.id);
  expect((await request.patch(`/api/competitions/${past}`, { data: { date: local(new Date(Date.now() - 3 * 86_400_000)) } })).ok()).toBe(true);
  const elsewhere = await newCompetition(page, request, `Coupe report-ailleurs ${Date.now()}`);
  await inviteWithLink(request, elsewhere, a.entry.id);
  await coachSaves(playwright, linkB.token, { coachPhone: '06 88 88 88 88' });

  // Le serveur du test gère toutes les compétitions : l'une d'elles est présentée comme tenue par un PC.
  await page.route(`**/api/club-directory/${a.entry.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { upcoming: { competitionId: string }[] };
    await route.fulfill({ response: res, json: { ...body, upcoming: body.upcoming.map((l) => (l.competitionId === elsewhere ? { ...l, managedHere: false, ownerName: 'PC du dojo' } : l)) } });
  });
  await editEntry(page, club, { phone: '06 12 12 12 12', emails: 'une@dojo.example, deux@dojo.example, nouveau@dojo.example' });

  const dialog = page.getByRole('dialog', { name: 'Appliquer aux compétitions à venir ?' });
  await expect(dialog).toBeVisible();
  const nameA = (await (await request.get(`/api/competitions/${a.competitionId}`)).json() as { name: string }).name;
  const nameB = (await (await request.get(`/api/competitions/${b}`)).json() as { name: string }).name;
  const nameP = (await (await request.get(`/api/competitions/${past}`)).json() as { name: string }).name;
  await expect(dialog).toContainText(nameA);
  await expect(dialog).not.toContainText(nameP);
  await expect(dialog.getByTestId(`apply-line-${a.competitionId}-coachPhone`).getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByTestId(`apply-line-${a.competitionId}-coachEmails`)).toContainText('retire trois@dojo.example');
  await expect(dialog.getByTestId(`apply-line-${a.competitionId}-coachEmails`)).toContainText('ajoute nouveau@dojo.example');
  const conflict = dialog.getByTestId(`apply-line-${b}-coachPhone`);
  await expect(conflict).toContainText('Conflit');
  await expect(conflict.getByRole('radio', { name: 'Garder le club' })).toBeChecked();
  await expect(conflict).toContainText('06 88 88 88 88');
  const foreign = dialog.getByTestId(`apply-line-${elsewhere}-coachPhone`);
  await expect(foreign.getByRole('checkbox')).toHaveCount(0);
  await expect(foreign.getByRole('radio')).toHaveCount(0);
  await expect(dialog).toContainText('Gérée par PC du dojo : à appliquer après le retour de la main.');

  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(dialog.getByTestId('apply-result')).toHaveCount(2);
  await expect(dialog.getByTestId('apply-result').filter({ hasText: nameA })).toContainText('appliqué');
  await expect(dialog.getByTestId('apply-result').filter({ hasText: nameB })).toContainText('appliqué');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();

  expect(await clubIn(request, a.competitionId, club)).toMatchObject({ coachPhone: '06 12 12 12 12', coachEmails: ['une@dojo.example', 'deux@dojo.example', 'nouveau@dojo.example'] });
  expect(await clubIn(request, b, club)).toMatchObject({ coachPhone: '06 88 88 88 88', coachEmails: ['une@dojo.example', 'deux@dojo.example', 'nouveau@dojo.example'] });
  expect((await clubIn(request, past, club)).coachPhone).toBe('06 11 22 33 44');
  expect((await clubIn(request, elsewhere, club)).coachPhone).toBe('06 11 22 33 44');
});

test('« Ne rien appliquer » : aucune requête, clubs inchangés, fiche enregistrée ; sans différence ou en archivant, aucune fenêtre', async ({ page, request }) => {
  const a = await setup(page, request, 'report-rien');
  let applied = 0;
  await page.route('**/apply-to-clubs', async (route) => { applied++; await route.continue(); });
  await editEntry(page, a.club, { phone: '06 13 13 13 13' });
  const dialog = page.getByRole('dialog', { name: 'Appliquer aux compétitions à venir ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Ne rien appliquer' }).click();
  await expect(dialog).toBeHidden();
  expect(applied).toBe(0);
  expect((await clubIn(request, a.competitionId, a.club)).coachPhone).toBe('06 11 22 33 44');
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 13 13 13 13');

  // Une note change : aucun champ comparé n'a bougé, aucune fenêtre.
  await editEntry(page, a.club, { notes: 'Remarque' });
  await expect(dialog).toHaveCount(0);
  // Archiver passe par la même requête sans rien proposer.
  await page.getByTestId('directory-row').filter({ hasText: a.club }).getByRole('button', { name: 'Autres actions' }).click();
  await page.getByRole('menuitem', { name: 'Archiver' }).click();
  await expect(page.getByTestId('directory-row').filter({ hasText: a.club })).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
});

test('conflit : « Prendre l’annuaire » est envoyé, « Appliquer » est désactivé quand rien n’est choisi', async ({ page, request, playwright }) => {
  const a = await setup(page, request, 'report-choix');
  await coachSaves(playwright, a.token, { coachPhone: '06 99 99 99 99' });
  await editEntry(page, a.club, { phone: '06 14 14 14 14' });
  const dialog = page.getByRole('dialog', { name: 'Appliquer aux compétitions à venir ?' });
  const submit = dialog.getByRole('button', { name: 'Appliquer', exact: true });
  await expect(dialog.getByTestId(`apply-line-${a.competitionId}-coachPhone`)).toContainText('Conflit');
  await expect(submit).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Prendre l’annuaire' }).check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog.getByTestId('apply-result')).toContainText('appliqué');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  expect((await clubIn(request, a.competitionId, a.club)).coachPhone).toBe('06 14 14 14 14');
});

test('le coach efface téléphone et adresses : les adresses de la fiche restent cochées, Enregistrer ne les vide pas', async ({ page, request, playwright }) => {
  const { club, entry, competitionId, token } = await setup(page, request, 'tout-effacé');
  await coachSaves(playwright, token, { coachPhone: null, coachEmails: [] });
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${club} : garder quelles informations ?` });
  await expect(dialog.getByRole('radio', { name: 'Annuaire : 06 11 22 33 44' })).toBeChecked();
  for (const e of ['une', 'deux', 'trois']) await expect(dialog.getByRole('checkbox', { name: `${e}@dojo.example (seulement dans l’annuaire)` })).toBeChecked();
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  expect(await entryOf(request, entry.id)).toMatchObject({ coachPhone: '06 11 22 33 44', coachEmails: ['une@dojo.example', 'deux@dojo.example', 'trois@dojo.example'] });
});

test('une ancienne différence ne revient pas dans la fiche : adresse retirée de la fiche, téléphone changé par le coach', async ({ page, request, playwright }) => {
  const { club, entry, competitionId, token } = await setup(page, request, 'ancienne');
  // L'organisateur retire « trois » de la fiche ; le club l'a encore. Le coach ne change que son téléphone.
  expect((await request.patch(`/api/club-directory/${entry.id}`, { data: { coachEmails: ['une@dojo.example', 'deux@dojo.example'] } })).ok()).toBe(true);
  await coachSaves(playwright, token, { coachPhone: '06 31 31 31 31' });
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${club} : garder quelles informations ?` });
  await expect(dialog.getByRole('checkbox', { name: 'trois@dojo.example (seulement dans la compétition)' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  expect(await entryOf(request, entry.id)).toMatchObject({ coachPhone: '06 31 31 31 31', coachEmails: ['une@dojo.example', 'deux@dojo.example'] });
});

test('adresses identiques dans un autre ordre : la fiche garde son ordre et son adresse principale', async ({ page, request, playwright }) => {
  const { club, entry, competitionId, token } = await setup(page, request, 'ordre');
  await coachSaves(playwright, token, { coachPhone: '06 32 32 32 32', coachEmails: ['trois@dojo.example', 'deux@dojo.example', 'une@dojo.example'] });
  await page.goto(`/competitions/${competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${club} : garder quelles informations ?` });
  await expect(dialog.getByTestId('change-same-coachEmails')).toBeVisible();
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  expect(await entryOf(request, entry.id)).toMatchObject({ coachPhone: '06 32 32 32 32', coachEmails: ['une@dojo.example', 'deux@dojo.example', 'trois@dojo.example'] });
});

test('fiche corrigée à la main : la pastille et le bandeau disparaissent sans recharger la page', async ({ page, request, playwright }) => {
  const { club, competitionId, token } = await setup(page, request, 'correction');
  await coachSaves(playwright, token, { coachPhone: '06 33 33 33 33' });
  await page.goto('/annuaire');
  const row = page.getByTestId('directory-row').filter({ hasText: club });
  await expect(row.getByTestId('club-change-pill')).toBeVisible();
  await row.getByRole('button', { name: 'Modifier' }).click();
  const form = page.getByRole('dialog', { name: 'Modifier le club' });
  await form.getByLabel('Téléphone').fill('06 33 33 33 33');
  await form.getByTestId('directory-save').click();
  await expect(form).toBeHidden();
  await expect(row.getByTestId('club-change-pill')).toHaveCount(0);
  expect(await changesOf(request, competitionId)).toEqual([]);
});

test('960 px : l’étiquette « Conflit » ne rétrécit pas, les adresses de l’annuaire restent lisibles à côté de la pastille et des boutons', async ({ page, request, playwright }) => {
  const long = `${'adresse-tres-longue-'.repeat(4)}@exemple-de-domaine-interminable.example`;
  const a = await setup(page, request, 'largeurs');
  await coachSaves(playwright, a.token, { coachPhone: '06 34 34 34 34', coachEmails: ['une@dojo.example', long] });
  await page.setViewportSize({ width: 960, height: 700 });

  // Annuaire : chaque adresse tient sur une ligne (pas de coupure en plein mot), le tableau défile de côté si besoin.
  await page.goto('/annuaire');
  const row = page.getByTestId('directory-row').filter({ hasText: a.club });
  await expect(row.getByTestId('club-change-pill')).toBeVisible();
  const broken = await row.locator('td').nth(4).locator('p').evaluateAll((els) => els.filter((el) => el.textContent!.length < 30 && el.getBoundingClientRect().height > 1.6 * parseFloat(getComputedStyle(el).lineHeight)).map((el) => el.textContent));
  expect(broken).toEqual([]);

  // Fenêtre « Appliquer aux compétitions à venir ? » : deux conflits, l'étiquette garde son texte entier.
  await row.getByRole('button', { name: 'Modifier' }).click();
  const form = page.getByRole('dialog', { name: 'Modifier le club' });
  await form.getByLabel('Téléphone').fill('06 35 35 35 35');
  await form.getByTestId('directory-email').fill('autre@dojo.example');
  await form.getByTestId('directory-save').click();
  const dialog = page.getByRole('dialog', { name: 'Appliquer aux compétitions à venir ?' });
  await expect(dialog.getByText('Conflit')).toHaveCount(2);
  const cut = await dialog.getByText('Conflit').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
  expect(cut).toBe(0);
  await dialog.getByRole('button', { name: 'Ne rien appliquer' }).click();
  // Nettoyage : le changement est ignoré.
  const open = (await (await request.get(`/api/club-changes?competitionId=${a.competitionId}`)).json()) as { clubId: string; changedAt: string }[];
  for (const c of open) expect((await request.post(`/api/club-changes/${c.clubId}/ignore`, { data: { changedAt: c.changedAt } })).status()).toBe(204);
});

const DECISION = /\/api\/club-changes\/[^/]+\/(resolve|ignore)$/;
/**
 * Les listes relues après une décision arrivent en retard (cas du réseau réel), sauf celle des changements : elle remonte la fenêtre avant les autres,
 * et la décision reste en cours pendant ce temps.
 */
async function slowListsAfterDecision(page: Page) {
  let decided = false;
  page.on('request', (r) => { if (r.method() === 'POST' && DECISION.test(r.url())) decided = true; });
  await page.route(/\/api\/(club-directory|competitions\/[^/]+\/(clubs|invitations|directory-clubs))$/, async (route) => {
    if (decided && route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
}
/** Réponse d'une liste demandée après la réponse de la décision : la décision est alors finie (fin de `onSettled`). */
function listAfterDecision(page: Page, list: RegExp): Promise<void> {
  return new Promise((done) => {
    let answered = false;
    page.on('response', (r) => { if (DECISION.test(r.url())) answered = true; });
    page.on('request', (q) => { if (answered && q.method() === 'GET' && list.test(q.url())) void q.response().then(() => done()); });
  });
}
/** Liste des changements limitée à ces compétitions : d'autres tests en laissent sur la base partagée. */
async function onlyCompetitions(page: Page, competitionIds: string[]) {
  await page.route(/\/api\/club-changes(\?|$)/, async (route) => {
    const list = (await (await route.fetch()).json()) as { competitionId: string }[];
    await route.fulfill({ json: list.filter((c) => competitionIds.includes(c.competitionId)) });
  });
}
/**
 * Compétitions tenues par un PC : le vrai serveur répond (version de l'annuaire comprise), seul « géré ici » est changé et la liste est limitée à ces
 * compétitions. Le serveur de test gère lui-même ces compétitions et supprime donc la ligne décidée ; un vrai serveur la garde quand le club diffère encore
 * des valeurs enregistrées. La liste relue la rend donc comme le ferait le vrai serveur : même club, version de la fiche augmentée (la fenêtre est remontée),
 * plus aucun champ « modifié par cet enregistrement ». Les champs qui diffèrent (`fields`) ne sont pas recalculés : les tests n'en lisent rien.
 */
async function managedElsewhere(page: Page, competitionIds: string[]) {
  await slowListsAfterDecision(page);
  type Change = { clubId: string; competitionId: string; directoryVersion: number; values: Record<string, unknown>; directory: Record<string, unknown> };
  const seen = new Map<string, Change>();
  const kept = new Map<string, Change>();
  const same = (f: string, x: unknown, y: unknown) =>
    f === 'coachEmails' ? JSON.stringify(((x as string[]) ?? []).map((e) => e.toLowerCase()).sort()) === JSON.stringify(((y as string[]) ?? []).map((e) => e.toLowerCase()).sort()) : (x ?? null) === (y ?? null);
  await page.route('**/api/club-changes/*/resolve', async (route) => {
    const res = await route.fetch();
    const body = route.request().postDataJSON() as { values: Record<string, unknown> };
    const clubId = route.request().url().split('/').at(-2)!;
    const before = seen.get(clubId);
    const fields = ['name', 'coachName', 'coachPhone', 'coachEmails', 'affiliationNumber'];
    if (res.ok() && before && fields.some((f) => !same(f, body.values[f], before.values[f]))) {
      kept.set(clubId, { ...before, directory: { ...before.directory, ...body.values }, directoryVersion: before.directoryVersion + 1, changedFields: [] } as Change);
    }
    await route.fulfill({ response: res });
  });
  await page.route(/\/api\/club-changes(\?|$)/, async (route) => {
    const list = ((await (await route.fetch()).json()) as Change[]).filter((c) => competitionIds.includes(c.competitionId));
    for (const c of list) seen.set(c.clubId, c);
    const all = [...list, ...[...kept.values()].filter((k) => !list.some((c) => c.clubId === k.clubId))];
    await route.fulfill({ json: all.map((c) => ({ ...c, managedHere: false, ownerName: 'PC du dojo' })) });
  });
}
const noteOf = (page: Page, text: string) => page.locator('.mantine-Notification-root').filter({ hasText: text });
const nameOf = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/competitions/${id}`)).json()) as { name: string }).name;

test('compétition gérée ailleurs, chaîne : après la première décision la fenêtre passe au club suivant, avec la notification', async ({ page, request, playwright }) => {
  // Deux compétitions de même date : classées par nom, « ailleurs-1 » avant « ailleurs-2 ».
  const a = await setup(page, request, 'ailleurs-1');
  const b = await setup(page, request, 'ailleurs-2');
  await coachSaves(playwright, a.token, { coachPhone: '06 36 36 36 36', coachName: 'Paul Martin' });
  await coachSaves(playwright, b.token, { coachPhone: '06 37 37 37 37', coachName: 'Paul Martin' });
  await managedElsewhere(page, [a.competitionId, b.competitionId]);
  await page.goto('/annuaire');
  await page.getByTestId('directory-changes-banner').getByRole('button', { name: 'Voir les changements' }).click();
  const first = page.getByRole('dialog', { name: `${a.club} : garder quelles informations ?` });
  // Téléphone de la compétition (la fiche change, sa version monte), nom du coach de l’annuaire : le club diffère encore de la fiche.
  await first.getByTestId('change-field-coachName').getByRole('radio', { name: /^Annuaire :/ }).check();
  await first.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(page.getByRole('dialog', { name: `${b.club} : garder quelles informations ?` })).toBeVisible();
  await expect(noteOf(page, `Annuaire enregistré. Le club de ${await nameOf(request, a.competitionId)} reste à mettre à jour après le retour de la main.`)).toBeVisible();
});

test('compétition gérée ailleurs, « Comparer » hors chaîne : la fenêtre se ferme après l’enregistrement, avec la notification', async ({ page, request, playwright }) => {
  const a = await setup(page, request, 'ailleurs-seul');
  await coachSaves(playwright, a.token, { coachPhone: '06 38 38 38 38', coachName: 'Paul Martin' });
  await managedElsewhere(page, [a.competitionId]);
  await page.goto(`/competitions/${a.competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${a.club} : garder quelles informations ?` });
  await dialog.getByTestId('change-field-coachName').getByRole('radio', { name: /^Annuaire :/ }).check();
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(noteOf(page, `Annuaire enregistré. Le club de ${await nameOf(request, a.competitionId)} reste à mettre à jour après le retour de la main.`)).toBeVisible();
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 38 38 38 38');
});

test('compétition gérée ailleurs, valeur de la compétition choisie : la fenêtre se ferme sans notification, il ne reste rien à mettre à jour', async ({ page, request, playwright }) => {
  const a = await setup(page, request, 'ailleurs-garde');
  await coachSaves(playwright, a.token, { coachPhone: '06 39 39 39 39' });
  await managedElsewhere(page, [a.competitionId]);
  await page.goto(`/competitions/${a.competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${a.club} : garder quelles informations ?` });
  await expect(dialog.getByRole('radio', { name: /^Compétition : 06 39/ })).toBeChecked();
  // La notification viendrait à la fin de la décision, après les listes retardées : on attend l'une d'elles, demandée après la décision, puis un court délai.
  const late = listAfterDecision(page, /\/invitations$/);
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await late;
  await page.waitForTimeout(300);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Compte lu une fois, sans attente : `toHaveCount(0)` réessaierait jusqu’à la fermeture automatique d’une notification affichée à tort.
  expect(await page.locator('.mantine-Notification-root').filter({ hasText: 'Annuaire enregistré' }).count()).toBe(0);
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 39 39 39 39');
});

test('le coach enregistre encore pendant la comparaison : refus, la fenêtre remontée affiche « rouvrez la comparaison » et une seule décision part', async ({ page, request, playwright }) => {
  const a = await setup(page, request, 'refus-409');
  await coachSaves(playwright, a.token, { coachPhone: '06 40 40 40 40' });
  // Sans mises à jour en direct : la page ne relit pas d'elle-même la seconde saisie du coach avant le clic (sinon, pas de refus).
  await page.route(/\/api\/competitions\/[^/]+\/events$/, (route) => route.abort());
  await page.goto(`/competitions/${a.competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${a.club} : garder quelles informations ?` });
  await expect(dialog.getByRole('radio', { name: /^Compétition : 06 40/ })).toBeChecked();
  await coachSaves(playwright, a.token, { coachPhone: '06 41 41 41 41' });
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && DECISION.test(r.url())) posts++; });
  await slowListsAfterDecision(page);
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  // Fenêtre remontée sur la saisie relue, décision pas encore finie (listes en retard) : aucune seconde décision possible, chargement visible.
  await expect(dialog.getByRole('radio', { name: /^Compétition : 06 41/ })).toBeChecked();
  await expect(dialog.getByTestId('change-notice')).toHaveCount(0);
  await expect(dialog.getByTestId('change-save')).toBeDisabled();
  await expect(dialog.getByTestId('change-save')).toHaveAttribute('data-loading', 'true');
  await expect(dialog.getByRole('button', { name: 'Ignorer ce changement' })).toBeDisabled();
  await dialog.getByTestId('change-save').click({ force: true });
  await dialog.getByRole('button', { name: 'Ignorer ce changement' }).click({ force: true });
  await expect(dialog.getByTestId('change-notice')).toHaveText('Cette fiche vient de changer : rouvrez la comparaison.');
  await expect(dialog.getByRole('radio', { name: /^Compétition : 06 41/ })).toBeChecked();
  expect(posts).toBe(1);
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 11 22 33 44');
  // Nouvelle décision sur la version relue : acceptée, le message disparaît avec la fenêtre.
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 41 41 41 41');
  // Décision réussie : l'ancien refus n'est pas annoncé à la disparition du changement (compte lu une fois, sans attente).
  await page.waitForTimeout(300);
  expect(await page.locator('.mantine-Notification-root').filter({ hasText: 'Ce changement n’existe plus' }).count()).toBe(0);
});

test('changement ignoré ailleurs pendant la comparaison : la fenêtre se ferme, une notification nomme le club, rien n’est enregistré', async ({ page, request, playwright }) => {
  const a = await setup(page, request, 'disparu-404');
  await coachSaves(playwright, a.token, { coachPhone: '06 42 42 42 42' });
  await page.route(/\/api\/competitions\/[^/]+\/events$/, (route) => route.abort());
  await page.goto(`/competitions/${a.competitionId}/fiche-club`);
  await page.getByTestId('competition-changes-banner').getByRole('button', { name: 'Comparer' }).click();
  const dialog = page.getByRole('dialog', { name: `${a.club} : garder quelles informations ?` });
  await expect(dialog.getByRole('radio', { name: /^Compétition : 06 42/ })).toBeChecked();
  const open = ((await (await request.get(`/api/club-changes?competitionId=${a.competitionId}`)).json()) as { clubId: string; changedAt: string }[])[0]!;
  expect((await request.post(`/api/club-changes/${open.clubId}/ignore`, { data: { changedAt: open.changedAt } })).status()).toBe(204);
  await dialog.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(noteOf(page, `${a.club} : ce changement n’existe plus, rien n’a été enregistré.`)).toBeVisible();
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 11 22 33 44');
});

test('chaîne : un refus sur un club disparu entre-temps est annoncé à son nom, pas dans la fenêtre du club suivant', async ({ page, request, playwright }) => {
  // Deux compétitions de même date : classées par nom, « chaine-refus-1 » avant « chaine-refus-2 ».
  const a = await setup(page, request, 'chaine-refus-1');
  const b = await setup(page, request, 'chaine-refus-2');
  await coachSaves(playwright, a.token, { coachPhone: '06 43 43 43 43' });
  await coachSaves(playwright, b.token, { coachPhone: '06 44 44 44 44' });
  await onlyCompetitions(page, [a.competitionId, b.competitionId]);
  await page.goto('/annuaire');
  await page.getByTestId('directory-changes-banner').getByRole('button', { name: 'Voir les changements' }).click();
  const first = page.getByRole('dialog', { name: `${a.club} : garder quelles informations ?` });
  await expect(first).toBeVisible();
  // Pendant la comparaison, la fiche de A est corrigée ailleurs et rejoint le club : sa version change (refus), puis le changement disparaît.
  expect((await request.patch(`/api/club-directory/${a.entry.id}`, { data: { coachPhone: '06 43 43 43 43' } })).ok()).toBe(true);
  await first.getByTestId('change-field-coachPhone').getByRole('radio', { name: /^Annuaire :/ }).check();
  await first.getByRole('button', { name: 'Enregistrer dans l’annuaire' }).click();
  const next = page.getByRole('dialog', { name: `${b.club} : garder quelles informations ?` });
  await expect(next).toBeVisible();
  await expect(noteOf(page, `${a.club} : ce changement n’existe plus, rien n’a été enregistré.`)).toBeVisible();
  expect(await next.getByTestId('change-notice').count()).toBe(0);
  expect((await entryOf(request, a.entry.id)).coachPhone).toBe('06 43 43 43 43');
  // Nettoyage : le changement restant est ignoré.
  await next.getByRole('button', { name: 'Ignorer ce changement' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('960 px : les adresses courtes et ordinaires tiennent sur une ligne dans l’annuaire, l’onglet Clubs et les invitations', async ({ page, request }) => {
  const run = Date.now();
  const competitionId = await newCompetition(page, request, `Coupe adresses ${run}`);
  const emails = ['coach@lac.example', 'tresor@sud.example', 'contact@dojonice.example'];
  const clubs: string[] = [];
  for (const [i, email] of emails.entries()) {
    const club = `Dojo ${'Z'.repeat(i + 1)} adresses ${run}`;
    const entry = (await (await request.post('/api/club-directory', { data: { name: club, affiliationNumber: null, coachName: 'Marc Durand', coachPhone: '06 11 22 33 44', coachEmails: [email], notes: null } })).json()) as { id: string };
    await inviteWithLink(request, competitionId, entry.id);
    clubs.push(club);
  }
  await page.setViewportSize({ width: 960, height: 700 });
  const broken = (rows: ReturnType<Page['locator']>) =>
    rows.locator('p').evaluateAll((els) => els.filter((el) => /@/.test(el.textContent!) && el.getBoundingClientRect().height > 1.6 * parseFloat(getComputedStyle(el).lineHeight)).map((el) => el.textContent));
  const seen = (rows: ReturnType<Page['locator']>) => rows.getByText('@', { exact: false }).count();

  await page.goto('/annuaire');
  // Seules les fiches du test : une longue adresse d'un autre test élargirait la colonne et masquerait le défaut.
  await page.getByPlaceholder('Rechercher un nom ou un numéro').fill(`adresses ${run}`);
  await expect(page.getByTestId('directory-row')).toHaveCount(3);
  const dir = page.getByTestId('directory-row').filter({ hasText: `adresses ${run}` });
  await expect(dir).toHaveCount(3);
  expect(await broken(dir)).toEqual([]);
  expect(await seen(dir)).toBe(3);

  await page.goto(`/competitions/${competitionId}/clubs`);
  const tab = page.getByTestId('club-row');
  await expect(tab).toHaveCount(3);
  expect(await broken(tab)).toEqual([]);

  await page.goto(`/competitions/${competitionId}/fiche-club`);
  const inv = page.getByTestId('invitation-row');
  await expect(inv).toHaveCount(3);
  expect(await broken(inv)).toEqual([]);
  expect(clubs).toHaveLength(3);
});
