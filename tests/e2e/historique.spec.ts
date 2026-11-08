import { expect, test, type APIRequestContext } from '@playwright/test';
import { clipped, createCompetition, showList } from './helpers.js';

async function reg(request: APIRequestContext, id: string, lastName: string, weightClassId: string, extra: object = {}): Promise<string> {
  const res = await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, firstName: 'Léa', lastName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, approxWeightKg: 46, source: 'manual', ...extra },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { row: { id: string } }).row.id;
}

/** Deux déplacements manuels liés : A puis B vers le même tableau libre. */
async function seed(request: APIRequestContext, id: string) {
  const a = await reg(request, id, 'CADA', 'cadet:F:-47');
  const b = await reg(request, id, 'CADB', 'cadet:F:-47');
  await reg(request, id, 'CADC', 'cadet:F:-47');
  expect((await request.post(`/api/competitions/${id}/free-tableaux`, { data: { name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' } })).status()).toBe(201);
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const gala = cats.find((c) => c.label.includes('Gala 1'))!.id;
  for (const registrationId of [a, b]) {
    const r = await request.post(`/api/competitions/${id}/replacement/move`, { data: { registrationId, categoryId: gala } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
}

test('historique de la Réaffectation : cascade, mise en évidence, annulation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe historique annulable');
  await seed(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);

  const panel = page.getByTestId('history-panel');
  const entries = panel.getByTestId('history-entry');
  await expect(entries).toHaveCount(2);
  // Le texte « Annule aussi » de la plus ancienne cite l'autre : on repère chaque ligne par son titre exact.
  const oldest = entries.filter({ has: page.getByText('CADA Léa', { exact: true }) });
  const newest = entries.filter({ has: page.getByText('CADB Léa', { exact: true }) });
  await expect(oldest).toContainText('Annule aussi :');
  await expect(oldest).toContainText('CADB');
  await expect(newest).not.toContainText('Annule aussi');

  // Survol : la plus récente est surlignée « annulée aussi ».
  await oldest.getByTestId('history-undo').hover();
  await expect(oldest).toHaveAttribute('data-highlight', 'main');
  await expect(newest).toHaveAttribute('data-highlight', 'also');
  await page.mouse.move(0, 0);
  await expect(newest).not.toHaveAttribute('data-highlight', /.+/);

  // Fenêtre : 2 lignes, la plus récente « annulée aussi ».
  await oldest.getByTestId('history-undo').click();
  const dialog = page.getByTestId('undo-dialog');
  await expect(page.getByRole('dialog')).toContainText('Annuler cette action ?');
  await expect(dialog).toContainText('demandée');
  await expect(dialog).toContainText('annulée aussi');
  await expect(dialog).toContainText('Les tableaux concernés sont remis comme avant');
  await expect(newest).toHaveAttribute('data-highlight', 'also');
  await expect(page.getByTestId('undo-confirm')).toHaveText('Annuler ces 2 actions');
  expect(await clipped(page)).toEqual([]);
  await page.getByTestId('undo-confirm').click();

  await expect(dialog).toHaveCount(0);
  await expect(entries).toHaveCount(2);
  await expect(oldest).toContainText('Annulée à');
  await expect(newest).toContainText('Annulée à');
  await expect(panel.getByTestId('history-undo')).toHaveCount(0);

  // Filtre « Tableaux » : rien.
  await panel.getByTestId('history-filter').getByText('Tableaux', { exact: true }).click();
  await expect(entries).toHaveCount(0);
  await expect(panel).toContainText('Rien pour ce filtre.');
});

test('historique à 360 px : rien de coupé, bouton de la Liste', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe historique annulable étroite');
  await seed(request, id);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/competitions/${id}/reaffectation`);
  await expect(page.getByTestId('history-entry')).toHaveCount(2);
  expect(await clipped(page)).toEqual([]);

  await page.goto(`/competitions/${id}/tableaux`);

  await showList(page);
  await page.getByTestId('history-open').click();
  const panel = page.getByTestId('history-panel');
  await expect(panel.getByTestId('history-entry')).toHaveCount(2);
  expect(await clipped(page)).toEqual([]);
  await expect(page.getByTestId('history-open')).toContainText('Historique (2)');
});

test('tiroir de la Liste utilisable, suppression d’un tableau libre avec sa cascade', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe historique annulable libre');
  await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await showList(page);
  await page.getByTestId('history-open').click();
  await expect(page.getByTestId('history-panel').getByTestId('history-entry')).toHaveCount(2);
  // Sans voile : la page reste cliquable derrière le tiroir.
  await page.getByTestId('category-row').first().click();
  await expect(page.getByTestId('category-row').first()).toHaveAttribute('aria-current', 'true');

  await page.goto(`/competitions/${id}/categories`);
  const section = page.getByRole('group', { name: 'Tableaux libres', exact: true });
  await section.getByTestId('free-tableau').filter({ hasText: 'Gala 1' }).getByRole('button', { name: 'Supprimer' }).click();
  const dialog = page.getByTestId('free-delete-dialog');
  await expect(dialog.getByTestId('undo-line')).toHaveCount(2);
  const deleted = page.waitForResponse((r) => r.url().includes('/free-tableaux/') && r.url().includes('expect=') && r.request().method() === 'DELETE');
  await page.getByTestId('free-delete-confirm').click();
  expect((await deleted).ok()).toBeTruthy();
  await expect(section.getByTestId('free-tableau')).toHaveCount(0);
  const hist = (await (await request.get(`/api/competitions/${id}/history`)).json()) as { entries: { status: string }[] };
  expect(hist.entries.map((e) => e.status)).toEqual(['undone', 'undone']);
});

test('historique illisible : message d’erreur au lieu d’un chargement sans fin, « Réessayer » le recharge', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe journal illisible');
  await seed(request, id);
  let failing = true;
  await page.route(`**/api/competitions/${id}/history**`, (route) =>
    failing ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Erreur interne du serveur' }) }) : route.continue());
  await page.goto(`/competitions/${id}/reaffectation`);
  const error = page.getByTestId('history-error');
  await expect(error).toContainText('L’historique n’a pas pu être chargé.', { timeout: 15000 });
  await expect(error).toContainText('Erreur interne du serveur');
  failing = false;
  await error.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByTestId('history-panel').getByTestId('history-entry')).toHaveCount(2);
  await expect(error).toHaveCount(0);
});

test('page sans historique (Pesée) : l’historique n’est pas chargé', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe poste sans journal');
  await seed(request, id);
  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().includes(`/api/competitions/${id}/history`)) asked.push(r.url()); });
  const weighIn = page.waitForResponse((r) => r.url().includes(`/api/competitions/${id}/weigh-in`) && r.request().method() === 'GET');
  await page.goto(`/competitions/${id}/pesee`);
  expect((await weighIn).ok()).toBeTruthy();
  // Un changement des données du jour (autre poste) : toujours rien.
  await reg(request, id, 'CADD', 'cadet:F:-47');
  await page.waitForLoadState('networkidle');
  expect(asked).toEqual([]);
  // La Réaffectation, elle, le charge.
  await page.goto(`/competitions/${id}/reaffectation`);
  await expect(page.getByTestId('history-panel').getByTestId('history-entry')).toHaveCount(2);
  expect(asked.length).toBeGreaterThan(0);
});
