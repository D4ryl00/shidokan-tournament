import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition } from './helpers.js';

const NAME = `Horaires estimés ${Date.now()}`;

/** Deux zones ; Matin : deux catégories de seniors (4 combattants chacune) ; Après-midi : une de cadettes. */
async function seed(request: APIRequestContext, id: string) {
  const base = `/api/competitions/${id}`;
  const [zone] = (await (await request.get(`${base}/zones`)).json()) as { id: string }[];
  expect((await request.put(`${base}/zones`, { data: [{ id: zone!.id, name: 'Zone 1' }, { name: 'Zone 2' }] })).ok()).toBeTruthy();
  const waves = (await (await request.put(`${base}/waves`, {
    data: [
      { name: 'Matin', rules: { ageBandCodes: ['senior'], disciplines: [] } },
      { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    ],
  })).json()) as { id: string }[];
  let i = 0;
  const reg = async (data: object) => {
    const res = await request.post(`${base}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'x', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
    });
    expect(res.ok()).toBeTruthy();
  };
  for (let k = 0; k < 4; k++) await reg({ sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55' });
  for (let k = 0; k < 4; k++) await reg({ sex: 'M', ageBandCode: 'senior', weightClassId: 'senior:M:-75' });
  for (let k = 0; k < 4; k++) await reg({ sex: 'F', ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
  return { matin: waves[0]!.id, aprem: waves[1]!.id };
}

/** « Fin estimée de la journée : 9:47 » → minutes depuis minuit. */
async function endMinutes(page: Page): Promise<number> {
  const text = (await page.getByTestId('day-estimate-end').textContent()) ?? '';
  const m = /(\d{1,2}):(\d{2})/.exec(text);
  expect(m, text).not.toBeNull();
  return Number(m![1]) * 60 + Number(m![2]);
}

test('sessions : horaires estimés, durées raccourcies sur place, décalage des sessions qui se chevauchent', async ({ page, request }) => {
  const id = await createCompetition(page, NAME);
  const { matin, aprem } = await seed(request, id);
  await page.goto(`/competitions/${id}/sessions`);
  const estimate = page.getByTestId('day-estimate');
  await expect(estimate).toBeVisible();

  // Sans début prévu : des durées depuis le début de la journée, et l'invitation à saisir le début prévu de la première session.
  await expect(page.getByTestId('day-estimate-end')).toHaveText(/^Fin estimée de la journée : \+ (\d+ h( \d{2})?|\d+ min)$/);
  await expect(page.getByTestId('day-estimate-relative')).toContainText('Début prévu');

  // Débuts prévus (onglet Combats, réglés ici par l'API) : Matin à 9:00, Après-midi à 9:05, bien avant la fin du matin.
  // Mise à jour en direct : l'écran suit sans être rechargé.
  for (const [waveId, plannedStart] of [[matin, '09:00'], [aprem, '09:05']] as const) {
    expect((await request.put(`/api/competitions/${id}/wave-schedules`, { data: { waveId, plannedStart } })).ok()).toBeTruthy();
  }
  await expect(page.getByTestId('day-estimate-end')).toHaveText(/^Fin estimée de la journée : \d{1,2}:\d{2}$/, { timeout: 15_000 });
  await expect(page.getByTestId('day-estimate-relative')).toHaveCount(0);
  const waves = estimate.getByTestId('day-estimate-wave');
  await expect(waves).toHaveCount(2);
  await expect(waves.nth(0)).toContainText('Matin');
  await expect(waves.nth(0).getByTestId('day-estimate-zone')).toHaveCount(2);
  await expect(waves.nth(0).getByTestId('day-estimate-zone').first()).toContainText(/Zone \d.*\d{1,2}:\d{2} → \d{1,2}:\d{2}.*\d+ passages?/);
  await expect(waves.nth(0).getByTestId('day-estimate-overlap')).toHaveCount(0);
  // L'après-midi chevauche le matin : alerte, et (décalage coché par défaut) sa zone commence après la fin du matin.
  await expect(waves.nth(1).getByTestId('day-estimate-overlap')).toHaveText(/^Chevauche la session précédente de \d+ min \(Zone \d\)$/);
  await expect(page.getByTestId('day-estimate-shift')).toBeChecked();
  await expect(waves.nth(1).getByTestId('day-estimate-wave-times')).not.toContainText('9:05 →');
  const before = await endMinutes(page);

  // Raccourcir les combats des adultes (round de 2 min → 1 min), dans « Modifier les durées » (replié, après les sessions) :
  // enregistré comme dans Réglages, la fin avance, lue aussi à côté du bouton.
  await expect(estimate.getByTestId('durations-adults')).toBeHidden();
  await page.getByTestId('day-estimate-durations-toggle').click();
  const round = estimate.getByTestId('durations-adults').getByLabel('Round', { exact: true });
  await expect(round).toHaveValue('2:00');
  await expect(page.getByTestId('day-estimate-durations-end')).toHaveText(await page.getByTestId('day-estimate-end').innerText());
  await round.fill('1:5');
  await expect(page.getByTestId('day-estimate-save')).toBeDisabled();
  await round.fill('1:00');
  await expect(page.getByTestId('day-estimate-unsaved')).toBeVisible();
  // Replié, la saisie en cours reste signalée dans l'en-tête.
  await page.getByTestId('day-estimate-durations-toggle').click();
  await expect(round).toBeHidden();
  await expect(page.getByTestId('day-estimate-unsaved')).toBeVisible();
  await page.getByTestId('day-estimate-durations-toggle').click();
  // Quitter l'onglet avec une durée non enregistrée demande confirmation, comme ailleurs.
  await page.getByRole('tab', { name: 'Finales', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/sessions/);
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/competitions/${id}`) && r.ok());
  await page.getByTestId('day-estimate-save').click();
  await saved;
  await expect(page.getByTestId('day-estimate-unsaved')).toHaveCount(0);
  await expect.poll(() => endMinutes(page)).toBeLessThan(before);
  const shortened = await endMinutes(page);
  const h = Math.floor(shortened / 60);
  await expect(page.getByTestId('day-estimate-durations-end')).toHaveText(`Fin estimée de la journée : ${h}:${String(shortened - h * 60).padStart(2, '0')}`);
  const settings = (await (await request.get(`/api/competitions/${id}`)).json()).settings;
  expect(settings.schedule.groups.adults.roundSec).toBe(60);
  expect(settings.schedule.groups.youth.roundSec).toBe(120);

  // Sans décalage : l'après-midi commence à son heure prévue, la fin change, l'alerte reste ; le choix est gardé sur le poste.
  await page.getByTestId('day-estimate-shift').uncheck();
  await expect.poll(() => endMinutes(page)).not.toBe(shortened);
  await expect(waves.nth(1).getByTestId('day-estimate-overlap')).toHaveCount(1);
  await expect(waves.nth(1).getByTestId('day-estimate-wave-times')).toContainText('9:05 →');
  await page.reload();
  await expect(page.getByTestId('day-estimate-shift')).not.toBeChecked();
  await page.getByTestId('day-estimate-durations-toggle').click();
  await expect(page.getByTestId('durations-adults').getByLabel('Round', { exact: true })).toHaveValue('1:00');

  // Une catégorie avec sa propre durée (onglet Tableaux) : signalée, avec son lien ; la zone des finales du matin est donnée.
  const base = `/api/competitions/${id}`;
  const cats = (await (await request.get(`${base}/categories`)).json()) as { id: string; label: string; waveId: string | null }[];
  const own = cats.find((c) => c.label.includes('-75'))!;
  const timing = { rounds: 1, roundSec: 90, restSec: 0, overtimeSec: 0 };
  expect((await request.patch(`${base}/categories/${own.id}`, { data: { durations: { bracket: timing, finals: null, matches: {} } } })).ok()).toBeTruthy();
  const zones = (await (await request.get(`${base}/zones`)).json()) as { id: string; name: string }[];
  expect((await request.put(`${base}/finals/zone`, { data: { waveId: matin, finalsZoneId: zones[1]!.id } })).ok()).toBeTruthy();
  await expect(page.getByTestId('day-estimate-own')).toContainText('1 catégorie a sa propre durée', { timeout: 15_000 });
  await expect(page.getByTestId('day-estimate-own').getByRole('link', { name: own.label })).toHaveAttribute('href', `/competitions/${id}/tableaux?vue=liste&categorie=${own.id}`);
  await expect(waves.nth(0).getByTestId('day-estimate-finals')).toContainText('Finales sur Zone 2', { timeout: 15_000 });

  // Téléphone : rien ne dépasse.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('day-estimate-wave')).toHaveCount(2);
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
