import fs from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resolveBracket } from '../../src/domain/brackets/index.js';
import { readWorkbook } from '../../src/server/spreadsheet/read.js';
import { createCompetition } from './helpers.js';

type Cat = { id: string; label: string; registrationIds: string[]; bracket: { kind: string; matches?: { id: string }[]; order?: string[] } };

async function seed(request: APIRequestContext, id: string) {
  const clubs: string[] = [];
  for (const name of ['Tani Dojo', 'Issa', 'Shinsengumi']) clubs.push((await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()).id);
  let i = 0;
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: clubs[i % 3], lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    });
  for (let k = 0; k < 4; k++) await reg({});
  for (let k = 0; k < 3; k++) await reg({ ageBandCode: 'senior', weightClassId: 'senior:F:-55' });
  for (let k = 0; k < 3; k++) await reg({ discipline: 'kata', ruleset: null, weightClassId: null, ...(k === 0 ? { grade: '1er dan' } : {}) });
  return (await (await request.get(`/api/competitions/${id}/categories`)).json()) as Cat[];
}

async function enter(page: Page, matchId: string, side: 'a' | 'b') {
  await page.locator(`[data-testid="bracket-match"][data-match="${matchId}"]`).click();
  await page.getByTestId(`result-winner-${side}`).click();
  await page.getByTestId('result-save').click();
  await expect(page.getByTestId('result-save')).toHaveCount(0);
}

test('journée complète : tatamis, résultats, correction, poule, kata, podiums, exports, sauvegarde', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe jour J');
  const cats = await seed(request, id);
  const elim = cats.find((c) => c.label.includes('Cadets'))!;
  const pool = cats.find((c) => c.label.includes('Seniors'))!;
  const kata = cats.find((c) => c.label.startsWith('Kata'))!;

  // Zones de combat
  await page.goto(`/competitions/${id}/combats`);
  const elimCard = page.getByTestId('schedule-category').filter({ hasText: elim.label });
  await elimCard.getByTestId('schedule-zone').click();
  await page.getByRole('option', { name: 'Tatami 1', exact: true }).click();
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string; name: string }[];
  await request.patch(`/api/competitions/${id}/categories/${pool.id}`, { data: { zoneId: zones[1]!.id } });
  await page.reload();
  await expect(page.getByTestId('zone-card')).toHaveCount(2);
  await expect(page.getByTestId('zone-card').first()).toContainText('Tatami 1');
  await expect(page.getByTestId('zone-card').first().getByTestId('next-match')).toHaveCount(1); // la file montre 6 passages : les 5 du kata, puis 1 combat

  // Élimination directe : demies puis finale
  await page.getByTestId('schedule-category').filter({ hasText: elim.label }).getByRole('button').first().click();
  await enter(page, 'w1-0', 'a');
  await enter(page, 'w1-1', 'a');
  await enter(page, 'w2-0', 'b');
  await expect(page.getByTestId('schedule-category').filter({ hasText: elim.label })).toContainText('Terminée');

  // Effacer demande confirmation et annonce les combats touchés (ici on renonce)
  await page.locator('[data-testid="bracket-match"][data-match="w1-0"]').click();
  await page.getByTestId('result-delete').click();
  await expect(page.getByTestId('result-delete-warning')).toContainText('1 combat suivant');
  await page.getByTestId('result-delete-warning').getByRole('button', { name: 'Non' }).click();
  await expect(page.getByTestId('result-delete-warning')).toHaveCount(0);

  // Correction d'une demie : la finale est à revoir, l'ancien résultat est effacé depuis la liste, puis ressaisie
  await page.getByTestId('result-winner-b').click();
  await expect(page.getByTestId('result-affected')).toContainText('1 combat');
  await page.getByTestId('result-save').click();
  await expect(page.getByTestId('results-stale')).toBeVisible();
  await expect(page.getByTestId('ignored-result')).toHaveCount(1);
  await page.getByTestId('ignored-result-clear').click();
  await expect(page.getByTestId('results-stale')).toHaveCount(0);
  await enter(page, 'w2-0', 'a');

  // Poule en cycle (par l'API) → départage dans l'interface
  const poolMatches = resolveBracket(pool.bracket as never, {}).matches;
  const ids = pool.registrationIds;
  const beats: Record<string, string> = { [ids[0]!]: ids[1]!, [ids[1]!]: ids[2]!, [ids[2]!]: ids[0]! };
  for (const m of poolMatches)
    await request.put(`/api/competitions/${id}/categories/${pool.id}/results/${m.id}`, { data: { winner: beats[m.entrantA!] === m.entrantB ? 'a' : 'b', method: 'points' } });
  await page.reload();
  await page.getByTestId('schedule-category').filter({ hasText: pool.label }).getByRole('button').first().click();
  await page.getByTestId('tiebreak-open').click();
  await page.getByTestId('tiebreak-save').click();
  await expect(page.getByTestId('schedule-category').filter({ hasText: pool.label })).toContainText('Terminée');
  // Effacer ou corriger un résultat de la poule annonce que le départage sera effacé
  await page.locator(`[data-testid="bracket-match"][data-match="${poolMatches[0]!.id}"]`).click();
  await page.getByTestId('result-delete').click();
  await expect(page.getByTestId('result-delete-warning')).toContainText('Le départage de la poule sera effacé');
  await page.getByTestId('result-delete-warning').getByRole('button', { name: 'Non' }).click();
  await page.getByTestId(`result-winner-${beats[poolMatches[0]!.entrantA!] === poolMatches[0]!.entrantB ? 'b' : 'a'}`).click();
  await expect(page.getByTestId('result-affected')).toContainText('Le départage de la poule sera effacé');
  await page.keyboard.press('Escape');

  // Kata : 3 arbitres, tour 1 puis finale
  await page.getByTestId('schedule-category').filter({ hasText: kata.label }).getByRole('button').first().click();
  // Le grade du kataka est affiché aux arbitres
  await expect(page.getByTestId('kata-row').filter({ hasText: 'Grade : 1er dan' })).toHaveCount(1);
  await page.getByTestId('kata-judges').click();
  await page.getByRole('option', { name: '3', exact: true }).click();
  const rows = page.getByTestId('kata-row');
  const notes = [9, 8, 7];
  // On remplit toutes les lignes avant d'enregistrer : enregistrer une ligne ne doit pas effacer les autres.
  for (let r = 0; r < 3; r++) {
    const inputs = rows.nth(r).getByTestId('kata-note');
    for (let j = 0; j < 3; j++) await inputs.nth(j).fill(String(notes[r]));
  }
  for (let r = 0; r < 3; r++) {
    await rows.nth(r).getByTestId('kata-save').click();
    await expect(rows.nth(r).getByTestId('kata-save')).toBeDisabled();
  }
  await expect(rows).toHaveCount(5); // 3 au tour 1 + 2 finalistes
  // Des notes à 3 arbitres sont saisies : on ne peut plus descendre à 2 (les notes seraient masquées)
  await page.getByTestId('kata-judges').click();
  await expect(page.getByRole('option', { name: '3', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '2', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const [r, v] of [[3, 7], [4, 9]] as const) {
    const inputs = rows.nth(r).getByTestId('kata-note');
    for (let j = 0; j < 3; j++) await inputs.nth(j).fill(String(v));
    await rows.nth(r).getByTestId('kata-save').click();
  }
  await expect(page.getByTestId('schedule-category').filter({ hasText: kata.label })).toContainText('Terminée');

  // Podiums et clubs
  await page.goto(`/competitions/${id}/podiums`);
  await expect(page.getByTestId('podium-card').filter({ hasText: 'Terminée' })).toHaveCount(3);
  expect(await page.getByTestId('medal-row').count()).toBeGreaterThan(0);

  // Export .xlsx relu
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-results-xlsx').click()]);
  const book = readWorkbook(fs.readFileSync((await download.path())!));
  expect(book.sheets[0]!.cells.length).toBeGreaterThan(5);
  expect(book.sheets.find((x) => x.name === 'Kata')!.cells.length).toBe(1 + 3 + 2);

  // Feuilles de résultats : 3 sections, sans badges
  await page.goto(`/competitions/${id}/impression?resultats=1`);
  await expect(page.getByTestId('print-section')).toHaveCount(3);
  await expect(page.getByTestId('bracket-podium')).toHaveCount(3);
  await expect(page.getByTestId('replacement-badge')).toHaveCount(0);

  // Sauvegarde : dans les réglages de l'application, plus dans les podiums d'une compétition
  await page.goto(`/competitions/${id}/podiums`);
  await expect(page.getByTestId('podium-card').first()).toBeVisible();
  await expect(page.getByTestId('backup-now')).toHaveCount(0);
  await page.goto('/parametres#sauvegardes');
  await page.getByTestId('backup-now').click();
  await expect(page.getByText('Sauvegarde effectuée.')).toBeVisible();
  expect(await page.getByTestId('backup-row').count()).toBeGreaterThan(0);
  // … et sur le tableau de kata imprimé
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('kata-grade').filter({ hasText: '1er dan' })).toHaveCount(1);
});

test('kata par kataka : à l’appel, notation, finalistes nommés, combats numérotés après les 5 passages', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe kata par kataka');
  const cats = await seed(request, id);
  const kata = cats.find((c) => c.label.startsWith('Kata'))!;
  const elim = cats.find((c) => c.label.includes('Cadets'))!;
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string }[];
  // Kata et cadettes sur le même tatami.
  for (const c of [kata, elim]) await request.patch(`/api/competitions/${id}/categories/${c.id}`, { data: { zoneId: zones[0]!.id } });
  for (const c of cats) await request.patch(`/api/competitions/${id}/categories/${c.id}`, { data: { status: 'ready' } });
  expect((await request.put(`/api/competitions/${id}/waves`, { data: { waves: [{ name: 'Matin', rules: { ageBandCodes: ['cadet', 'senior'], disciplines: [] } }], knownIds: [] } })).ok()).toBe(true);
  const waves = (await (await request.get(`/api/competitions/${id}/waves`)).json()) as { id: string }[];
  const launch = await request.post(`/api/competitions/${id}/launch`, { data: { waveId: waves[0]!.id } });
  expect(launch.ok(), await launch.text()).toBe(true);

  const catsAfter = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as Cat[];
  const order = catsAfter.find((c) => c.id === kata.id)!.bracket.order!;
  expect(order).toHaveLength(3);
  const zoneCard = () => page.getByTestId('zone-card').first();
  const note = (rid: string, round: 'round1' | 'final', v: number) =>
    request.put(`/api/competitions/${id}/categories/${kata.id}/kata/${rid}/${round}`, { data: { notes: [v, v, v, v, v] } });

  await page.goto(`/competitions/${id}/combats`);
  // Le 1er kataka est à l'appel (n° 1), les deux autres sont « Ensuite », un par ligne.
  await expect(zoneCard().getByTestId('next-kata').first()).toHaveAttribute('data-number', '1');
  await expect(zoneCard().getByTestId('kata-current')).toContainText('NOM');
  await expect(zoneCard().getByText('kataka 1 sur 3')).toBeVisible();
  const first = (await zoneCard().getByTestId('kata-current').innerText()).split('\n')[0]!;

  // Note du 1er : le 2e passe à l'appel (n° 2).
  expect((await note(order[0]!, 'round1', 9)).ok()).toBe(true);
  await page.reload();
  await expect(zoneCard().getByTestId('next-kata').first()).toHaveAttribute('data-number', '2');
  await expect(zoneCard().getByText('kataka 2 sur 3')).toBeVisible();
  await expect(zoneCard().getByTestId('kata-current')).not.toContainText(first);

  // Tout le tour 1 noté : les finalistes sont nommés (n° 4 et 5).
  expect((await note(order[1]!, 'round1', 8)).ok()).toBe(true);
  expect((await note(order[2]!, 'round1', 7)).ok()).toBe(true);
  await page.reload();
  await expect(zoneCard().getByTestId('next-kata').first()).toHaveAttribute('data-number', '4');
  await expect(zoneCard().getByTestId('kata-current')).toContainText('NOM');
  await expect(zoneCard().getByTestId('kata-current')).not.toContainText('Finaliste');

  // Les combats viennent après les 5 passages du kata.
  const sched = (await (await request.get(`/api/competitions/${id}/schedule`)).json()) as { zones: { queue: { number: number; kataPart: string | null }[] }[] };
  const combats = sched.zones.filter((z) => z.queue.some((q) => q.kataPart !== null)).flatMap((z) => z.queue).filter((q) => q.kataPart === null).map((q) => q.number);
  expect(combats.length).toBeGreaterThan(0);
  expect(Math.min(...combats)).toBe(6);
});
