import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

type Cat = { id: string; label: string; registrationIds: string[] };
const categories = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/competitions/${id}/categories`)).json()) as Cat[];

/**
 * BENJ Léa (benjamine −50, karaté et shido-boxing) et deux minimes −50 dans les deux disciplines, toutes du « Dojo Accords »
 * (pré-accord coché) ; BENJ rejoint à la main le groupe des minimes dans chaque discipline.
 */
async function seed(request: APIRequestContext, id: string) {
  const club = (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Dojo Accords', preApproval: true } })).json()) as { id: string };
  const reg = async (lastName: string, ageBandCode: string, discipline: 'karate' | 'shido-boxing') => {
    const res = await request.post(`/api/competitions/${id}/registrations`, {
      data: {
        clubId: club.id, lastName, firstName: 'Léa', sex: 'F', ageBandCode, discipline, ruleset: 'jiyu',
        weightClassId: `${ageBandCode}:F:-50`, approxWeightKg: 48, source: 'manual',
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { row: { id: string } }).row.id;
  };
  const karate = await reg('BENJ', 'benjamin', 'karate');
  const boxing = await reg('BENJ', 'benjamin', 'shido-boxing');
  for (const n of ['MINA', 'MINB']) {
    await reg(n, 'minime', 'karate');
    await reg(n, 'minime', 'shido-boxing');
  }
  const cats = await categories(request, id);
  const minimes = (d: string) => cats.find((c) => c.label.startsWith(d) && c.label.includes('Minimes'))!.id;
  for (const [registrationId, categoryId] of [[karate, minimes('Karaté')], [boxing, minimes('Shido-boxing')]] as const) {
    expect((await request.post(`/api/competitions/${id}/replacement/move`, { data: { registrationId, categoryId } })).ok()).toBeTruthy();
  }
  return { karate, boxing };
}

const section = (page: Page) => page.getByTestId('replacement-step-authorizations');
const line = (page: Page, discipline: string) => section(page).getByTestId('auth-request').filter({ hasText: `${discipline} · Benjamines −50 →` });

test('autorisations : une benjamine chez les minimes, accordée puis refusée, deux disciplines sous un seul numéro', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe autorisations accords');
  const { boxing } = await seed(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);

  // Entre « ② Cas un par un » et l'historique.
  await expect(section(page)).toBeVisible();
  const order = await page.locator('[data-testid^="replacement-step-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order).toEqual(['replacement-step-plan', 'replacement-step-cards', 'replacement-step-authorizations']);

  const s = section(page);
  await expect(s.getByTestId('auth-pending-total')).toHaveText('⏳ 2');
  const club = s.getByTestId('auth-club');
  await expect(club).toHaveCount(1);
  await expect(club).toContainText('Dojo Accords');
  await expect(club.getByTestId('auth-pre-approval')).toHaveText('pré-accord coché sur la fiche');
  // Un seul numéro, une ligne par inscription, la discipline écrite dans chaque ligne.
  const fighter = club.getByTestId('auth-fighter');
  await expect(fighter).toHaveCount(1);
  await expect(fighter.getByText('1. BENJ Léa')).toBeVisible();
  await expect(fighter.getByTestId('auth-request')).toHaveCount(2);
  await expect(line(page, 'Karaté Jiyu')).toContainText('⏳ Âge — Karaté Jiyu · Benjamines −50 → Karaté Jiyu · Benjamines–Minimes −50');
  await expect(line(page, 'Karaté Jiyu')).toHaveAttribute('data-status', 'pending');
  await expect(line(page, 'Shido-boxing Jiyu')).toContainText('Shido-boxing Jiyu · Benjamines −50 → Shido-boxing Jiyu · Benjamines–Minimes −50');

  // Copier pour le club : un seul numéro, la discipline devant chaque puce.
  await club.getByTestId('auth-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Bonjour,');
  expect(text).toContain('Voici les points à valider pour vos combattants (Dojo Accords) :');
  // Les deux inscriptions, dans l'ordre de la liste, sous le même numéro.
  expect(text).toContain('1. BENJ Léa\n   - ');
  expect(text).toContain('   - Karaté Jiyu : Passage des benjamines à un groupe commun Benjamines–Minimes en karaté.');
  expect(text).toContain('   - Shido-boxing Jiyu : Passage des benjamines à un groupe commun Benjamines–Minimes en shido-boxing.');
  expect(text).not.toContain('2. ');
  expect(text).toContain('Merci de nous confirmer votre accord pour ces changements.');
  await expect(page.getByText('Texte copié pour Dojo Accords.')).toBeVisible();

  // « Accordée » : compteur −1 ; cachée par « Seulement en attente », ✓ quand on la décoche.
  const granted = page.waitForResponse((r) => r.url().endsWith('/authorizations/grant') && r.request().method() === 'POST');
  await line(page, 'Karaté Jiyu').getByTestId('auth-grant').click();
  expect((await granted).ok()).toBeTruthy();
  await expect(s.getByTestId('auth-pending-total')).toHaveText('⏳ 1');
  await expect(line(page, 'Karaté Jiyu')).toHaveCount(0);
  await s.getByTestId('auth-only-pending').click();
  await expect(line(page, 'Karaté Jiyu')).toHaveAttribute('data-status', 'granted');
  await expect(line(page, 'Karaté Jiyu')).toContainText(/✓ Âge.*accordée \d\d:\d\d ·/);
  // La demande accordée ne part plus dans le texte.
  await s.getByTestId('auth-copy-all').click();
  const all = await page.evaluate(() => navigator.clipboard.readText());
  expect(all).toMatch(/^=== Dojo Accords ===\nBonjour,/);
  expect(all).toContain('1. BENJ Léa\n   - Passage des benjamines à un groupe commun Benjamines–Minimes en shido-boxing.');
  expect(all).not.toContain('en karaté');
  // « annuler » : de nouveau en attente.
  await line(page, 'Karaté Jiyu').getByTestId('auth-ungrant').click();
  await expect(line(page, 'Karaté Jiyu')).toHaveAttribute('data-status', 'pending');
  await expect(s.getByTestId('auth-pending-total')).toHaveText('⏳ 2');

  // « Refusée… » : la fenêtre d'annulation de l'historique ; confirmé, la demande part et la combattante revient.
  await line(page, 'Shido-boxing Jiyu').getByTestId('auth-refuse').click();
  const dialog = page.getByTestId('undo-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('BENJ');
  const undone = page.waitForResponse((r) => r.url().includes('/history/') && r.request().method() === 'POST');
  await dialog.getByTestId('undo-confirm').click();
  expect((await undone).ok()).toBeTruthy();
  await expect(line(page, 'Shido-boxing Jiyu')).toHaveCount(0);
  await expect(s.getByTestId('auth-pending-total')).toHaveText('⏳ 1');
  const back = (await categories(request, id)).find((c) => c.registrationIds.includes(boxing))!;
  expect(back.label).toBe('Shido-boxing · Jiyu · Benjamins F · -50 kg');
});

test('autorisations : session lancée, « Refusée… » désactivé avec le motif écrit', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe autorisations lancée');
  await seed(request, id);
  for (const c of await categories(request, id)) {
    if (c.registrationIds.length > 0) await request.patch(`/api/competitions/${id}/categories/${c.id}`, { data: { status: 'ready' } });
  }
  expect((await request.post(`/api/competitions/${id}/launch`, { data: { waveId: null } })).status()).toBe(204);
  await page.goto(`/competitions/${id}/reaffectation`);
  const karate = line(page, 'Karaté Jiyu');
  await expect(karate.getByTestId('auth-refuse')).toBeDisabled();
  const motif = karate.getByTestId('auth-blocked');
  await expect(motif).toBeVisible();
  await expect(motif).not.toBeEmpty();
  await expect(karate.getByTestId('auth-refuse')).toHaveAttribute('title', (await motif.textContent())!);
  // « Accordée » reste possible.
  await expect(karate.getByTestId('auth-grant')).toBeEnabled();
});

test('autorisations : téléphone, rien de coupé', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe autorisations étroite');
  await seed(request, id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/competitions/${id}/reaffectation`);
  await section(page).scrollIntoViewIfNeeded();
  await expect(section(page).getByTestId('auth-request')).toHaveCount(2);
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('autorisations : sans déplacement à défaire, « Déplacer à la main ↗ » vers le combattant dans les Tableaux', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe autorisations pesée');
  // Deux minimes −50 ; la plus lourde pèse 52 kg à la pesée : 8 kg d'écart avec la plus légère (44 kg déclarés), sans déplacement.
  const reg = async (lastName: string, approxWeightKg: number) =>
    ((await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'minime', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'minime:F:-50', approxWeightKg, source: 'manual' },
    })).json()) as { row: { id: string; fighterId: string } }).row;
  const light = await reg('LEGERE', 44);
  const heavy = await reg('LOURDE', 48);
  expect((await request.put(`/api/competitions/${id}/weigh-in/${heavy.fighterId}`, { data: { weighInKg: 52 } })).ok()).toBeTruthy();
  const category = (await categories(request, id)).find((c) => c.registrationIds.includes(light.id))!;

  await page.goto(`/competitions/${id}/reaffectation`);
  const row = section(page).getByTestId('auth-request');
  await expect(row).toHaveCount(1);
  await expect(section(page).getByTestId('auth-club')).toContainText('Sans club');
  await expect(row).toContainText('⏳ Poids — Karaté Jiyu · Minimes −50 → reste en Minimes −50 et reçoit Minimes −55 · écart estimé 8 kg maximum');
  await expect(row.getByTestId('auth-no-move')).toHaveText('Aucun déplacement à défaire : ce groupe existait déjà.');
  await expect(row.getByTestId('auth-refuse')).toHaveCount(0);
  await expect(row.getByTestId('auth-manual')).toHaveText('Déplacer à la main ↗');
  await expect(row.getByTestId('auth-manual')).toHaveAttribute('href', `/competitions/${id}/tableaux?vue=liste&categorie=${category.id}&combattant=${light.id}`);
  // Le lien arrive sur la liste, la catégorie choisie et le panneau de déplacement du combattant ouvert.
  await row.getByTestId('auth-manual').click();
  await expect(page).toHaveURL(/\/tableaux/);
  await expect(page.getByTestId('move-entrant-panel')).toBeVisible();
  await page.goBack();
  // Sans club : le message ne nomme pas de club.
  await section(page).getByTestId('auth-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Voici les points à valider pour vos combattants :');
  expect(text).toContain('1. LEGERE Léa\n   - Écart de poids estimé avec ses adversaires : 8 kg maximum.');
});

test('autorisations : ⏳ sur la puce du combattant (planche, galaxie, liste) tant que la demande est en attente', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe autorisations pastilles');
  const { karate, boxing } = await seed(request, id);
  const cats = await categories(request, id);
  const minimesK = cats.find((c) => c.registrationIds.includes(karate))!;
  const chip = (pageOrCard: Page, reg: string) => pageOrCard.locator(`[data-testid="planche-chip-wrap"]:has([data-entrant="${reg}"])`).getByTestId('auth-pending');

  await page.goto(`/competitions/${id}/tableaux?vue=planche`);
  await expect(chip(page, karate)).toHaveText('⏳');
  await expect(chip(page, karate)).toHaveAttribute('title', /Passage des benjamines à un groupe commun Benjamines–Minimes en karaté\./);
  // Les minimes n'ont rien à demander : une seule puce ⏳ par carte, et le décompte sur la carte.
  const card = page.locator(`[data-testid="planche-card"][data-category="${minimesK.id}"]`);
  await expect(card.getByTestId('auth-pending')).toHaveCount(1);
  await expect(card.getByTestId('auth-pending-count')).toHaveText('1 autorisation en attente');

  // Liste : la case du combattant porte aussi ⏳.
  await page.goto(`/competitions/${id}/tableaux?vue=liste&categorie=${minimesK.id}`);
  await expect(page.locator(`[data-testid="bracket-entrant"][data-entrant="${karate}"]`).getByTestId('auth-pending').first()).toHaveText('⏳');

  // Galaxie : la carte compacte aussi.
  await page.goto(`/competitions/${id}/tableaux?vue=galaxie&categorie=${minimesK.id}`);
  await expect(page.getByTestId('auth-pending').first()).toBeVisible();

  // « Accordée » : ⏳ disparaît (karaté seulement ; shido-boxing reste en attente).
  const listed = (await (await request.get(`/api/competitions/${id}/authorizations`)).json()) as { clubs: { requests: { registrationId: string; situation: { kind: string } }[] }[] };
  const situation = listed.clubs.flatMap((c) => c.requests).find((r) => r.registrationId === karate && r.situation.kind === 'age')!.situation;
  expect((await request.post(`/api/competitions/${id}/authorizations/grant`, { data: { registrationId: karate, kind: 'age', situation } })).ok()).toBeTruthy();
  await page.goto(`/competitions/${id}/tableaux?vue=planche`);
  await expect(chip(page, boxing)).toHaveText('⏳');
  await expect(chip(page, karate)).toHaveCount(0);
  await expect(card.getByTestId('auth-pending-count')).toHaveCount(0);
});

test('autorisations : « Refusée… » sur un déplacement du plan, refusé pour de bon : le plan suivant ne le repropose plus', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe autorisations refus du plan');
  // Deux cadettes seules (−47, −54) et une minime seule : le plan les réunit, la minime monte chez les cadettes (à valider).
  const reg = async (lastName: string, ageBandCode: string, weightClassId: string, approxWeightKg: number) =>
    ((await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode, discipline: 'karate', ruleset: 'jiyu', weightClassId, approxWeightKg, source: 'manual' },
    })).json()) as { row: { id: string } }).row.id;
  await reg('CADA', 'cadet', 'cadet:F:-47', 46);
  await reg('CADB', 'cadet', 'cadet:F:-54', 49);
  const mini = await reg('MINI', 'minime', 'minime:F:-45', 45);
  type Plan = { plan: { moves: { id: string; registrationId: string }[]; hash: string }; fingerprint: string };
  const plan = async () => (await (await request.post(`/api/competitions/${id}/replacement/plan`, { data: { choices: [] } })).json()) as Plan;
  const shown = await plan();
  const move = shown.plan.moves.find((m) => m.registrationId === mini)!;
  expect(move).toBeDefined();
  const applied = await request.post(`/api/competitions/${id}/replacement/plan/apply`, { data: { choices: [], withToValidate: true, fingerprint: shown.fingerprint, hash: shown.plan.hash } });
  expect(applied.ok(), await applied.text()).toBeTruthy();

  await page.goto(`/competitions/${id}/reaffectation`);
  const age = section(page).getByTestId('auth-request').filter({ hasText: 'Âge' });
  await expect(age).toHaveCount(1);
  await age.getByTestId('auth-refuse').click();
  const dialog = page.getByTestId('undo-dialog');
  await expect(dialog).toContainText('MINI');
  const refused = page.waitForResponse((r) => r.url().endsWith('/replacement/refuse') && r.request().method() === 'POST');
  await dialog.getByTestId('undo-confirm').click();
  expect((await refused).ok()).toBeTruthy();
  await expect(section(page).getByTestId('auth-request')).toHaveCount(0);
  await expect.poll(async () => (await plan()).plan.moves.map((m) => m.id)).not.toContain(move.id);
});
