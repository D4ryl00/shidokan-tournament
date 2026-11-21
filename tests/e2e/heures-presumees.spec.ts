import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

// Heures de passage présumées côté organisation (« vers H:MM ») : onglet Combats.
const STAMP = Date.now();

/** Heure de Paris décalée de `offset` minutes, « HH:MM ». */
const clock = (offset: number) =>
  new Date(Date.now() + offset * 60_000).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const today = () => new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });

/**
 * Compétition du jour, une session et une zone, catégories prêtes : quatre cadettes en combat ou trois katakas.
 * `plannedStart` : heure prévue de la session ; `launch` : session lancée puis démarrée maintenant.
 */
async function setup(page: Page, request: APIRequestContext, name: string, kind: 'combat' | 'kata', { plannedStart, launch }: { plannedStart: string; launch: boolean }) {
  const id = await createCompetition(page, name);
  const base = `/api/competitions/${id}`;
  expect((await request.patch(base, { data: { date: today() } })).ok()).toBeTruthy();
  const [zone] = (await (await request.get(`${base}/zones`)).json()) as { id: string }[];
  const waves = (await (await request.put(`${base}/waves`, { data: [{ name: 'Session 1', rules: { ageBandCodes: ['cadet'], disciplines: [] } }] })).json()) as { id: string }[];
  const waveId = waves[0]!.id;
  const names = kind === 'combat' ? ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'] : ['ECHO', 'FOXTROT', 'GOLF'];
  for (const lastName of names) {
    const fields = kind === 'combat' ? { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' } : { discipline: 'kata', ruleset: null, weightClassId: null };
    const res = await request.post(`${base}/registrations`, { data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', source: 'manual', ...fields } });
    expect(res.ok()).toBeTruthy();
  }
  const cats = (await (await request.get(`${base}/categories`)).json()) as { id: string }[];
  for (const c of cats) expect((await request.patch(`${base}/categories/${c.id}`, { data: { status: 'ready', zoneId: zone!.id } })).ok()).toBeTruthy();
  expect((await request.put(`${base}/wave-schedules`, { data: { waveId, plannedStart } })).ok()).toBeTruthy();
  if (launch) {
    expect((await request.post(`${base}/launch`, { data: { waveId } })).status()).toBe(204);
    // Session démarrée maintenant : sans démarrage, la zone est « à l'heure » (le curseur part de l'heure prévue).
    expect((await request.put(`${base}/wave-schedules`, { data: { waveId, actualStart: clock(0) } })).ok()).toBeTruthy();
  }
  await page.goto(`/competitions/${id}/combats?session=${waveId}`);
  return id;
}

const VERS = /^vers\s\d{1,2}:\d{2}$/;

test('combats : heures dans la file, sur l’appel et retard de zone', async ({ page, request }) => {
  await setup(page, request, `Heures présumées combats ${STAMP}`, 'combat', { plannedStart: clock(-5), launch: true });
  const card = page.getByTestId('zone-card');
  const onCall = card.getByTestId('next-match').first();
  // Session prévue 5 min plus tôt, démarrée maintenant : la zone est en retard.
  await expect(card.getByTestId('zone-drift')).toContainText('en retard de', { timeout: 15_000 });
  // « À l'appel » : l'heure brute, même déjà passée (démarrée à la minute).
  await expect(onCall.getByTestId('oncall-time')).toHaveText(VERS);
  // « Ensuite » : chaque ligne a son heure, au-dessus de son bouton.
  const second = card.getByTestId('next-match').nth(1);
  await expect(second.getByTestId('passage-time')).toHaveText(VERS);
  const secondNumber = await second.getAttribute('data-number');
  // Liste des catégories : zone, combat en cours et finale.
  const times = page.getByTestId('schedule-category').first().getByTestId('category-times');
  await expect(times).toContainText('sur le tatami');
  await expect(times).toContainText('finale vers');

  // Le résultat du combat à l'appel saisi : la ligne suivante passe à l'appel, avec son heure.
  await onCall.getByRole('button', { name: 'Saisir le résultat' }).click();
  await page.getByTestId('result-winner-a').click();
  await page.getByTestId('result-save').click();
  await expect(page.getByTestId('result-save')).toHaveCount(0);
  await expect(onCall).toHaveAttribute('data-number', secondNumber!);
  await expect(onCall.getByTestId('oncall-time')).toHaveText(VERS);
  // Liste : le combat suivant est à son tour sur le tatami, la finale garde son heure.
  await expect(times).toHaveText(/^Tatami 1 · sur le tatami · finale vers\s\d{1,2}:\d{2}$/);

  // À 360 px, rien n'est coupé.
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(onCall.getByTestId('oncall-time')).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('combats : session pas encore lancée, heures prévues sans retard de zone', async ({ page, request }) => {
  await setup(page, request, `Heures présumées non lancée ${STAMP}`, 'combat', { plannedStart: '09:00', launch: false });
  const card = page.getByTestId('zone-card');
  await expect(card.locator('[data-testid="passage-time"][data-planned="true"]').first()).toHaveText(VERS, { timeout: 15_000 });
  await expect(card.getByTestId('next-match').first().getByTestId('oncall-time')).toHaveAttribute('data-planned', 'true');
  await expect(card.getByTestId('next-match').first().getByTestId('oncall-time')).toHaveText('vers 9:00');
  await expect(page.getByTestId('schedule-category').first().getByTestId('category-times')).toContainText('1er combat vers 9:00');
  await expect(card.getByTestId('zone-drift')).toHaveCount(0);
});

test('notation kata : une heure sous chaque kataka non noté', async ({ page, request }) => {
  await setup(page, request, `Heures présumées kata ${STAMP}`, 'kata', { plannedStart: clock(-5), launch: true });
  const card = page.getByTestId('zone-card');
  // File de la zone : chaque kataka a sa ligne et son heure.
  await expect(card.getByTestId('next-kata').nth(1).getByTestId('passage-time')).toHaveText(VERS, { timeout: 15_000 });
  await card.getByTestId('next-kata').first().getByRole('button', { name: 'Noter' }).click();
  const rows = page.getByTestId('kata-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByTestId('passage-time')).toHaveText('sur le tatami');
  await expect(rows.nth(1).getByTestId('passage-time')).toHaveText(VERS);
  await expect(rows.nth(2).getByTestId('passage-time')).toHaveText(VERS);

  await page.getByTestId('kata-judges').click();
  await page.getByRole('option', { name: '1', exact: true }).click();
  const score = async (r: number, note: string) => {
    await rows.nth(r).getByTestId('kata-note').first().fill(note);
    await rows.nth(r).getByTestId('kata-save').click();
    await expect(rows.nth(r).getByTestId('kata-save')).toBeDisabled();
  };
  // Noté : plus d'heure ; le suivant est sur le tatami.
  await score(0, '9');
  await expect(rows.nth(0).getByTestId('passage-time')).toHaveCount(0);
  await expect(rows.nth(1).getByTestId('passage-time')).toHaveText('sur le tatami');
  await score(1, '8');
  await score(2, '7');
  // Finale : une heure par finaliste (clés de la finale, dans l'ordre des finalistes).
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(3).getByTestId('passage-time')).toHaveText('sur le tatami');
  await expect(rows.nth(4).getByTestId('passage-time')).toHaveText(VERS);
  await expect(page.getByTestId('kata-row').getByTestId('passage-time')).toHaveCount(2);
});
