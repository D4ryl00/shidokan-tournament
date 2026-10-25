import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createCompetition, openTab } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  let i = 0;
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `NOM${++i}`, firstName: 'Léa', sex: 'F', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
    });
  for (let k = 0; k < 2; k++) await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  for (let k = 0; k < 2; k++) await reg({ ageBandCode: 'cadet', weightClassId: 'cadet:F:-54' });
  for (let k = 0; k < 2; k++) await reg({ ageBandCode: 'senior', weightClassId: 'senior:F:-55' });
}

const card = (page: Page, name: string) => page.getByTestId('wave-card').filter({ has: page.locator(`input[value="${name}"]`) });

async function addWave(page: Page, name: string, bands: string[]) {
  await page.getByTestId('wave-add').click();
  const c = page.getByTestId('wave-card').last();
  await c.getByTestId('wave-name').fill(name);
  for (const b of bands) await c.getByText(b, { exact: true }).click();
}

test('sessions : règles, retrait, ajout à la main, conflit, suppression', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe sessions');
  await seed(request, id);
  await page.goto(`/competitions/${id}/sessions`);
  await expect(page.getByTestId('waves-none')).toBeVisible();
  await addWave(page, 'Matin', ['Poussins', 'Pupilles', 'Benjamins', 'Minimes']);
  await addWave(page, 'Après-midi', ['Cadets', 'Juniors', 'Seniors']);
  await page.getByTestId('wave-save').click();
  await expect(page.getByText('Sessions enregistrées')).toBeVisible();
  await expect(card(page, 'Matin').getByTestId('wave-category')).toHaveText([/Minimes F/]);
  await expect(card(page, 'Après-midi').getByTestId('wave-category')).toHaveCount(2);

  // Retirer : la catégorie passe en attente ; « Ajouter à… » la place à la main dans une autre vague
  await card(page, 'Matin').getByTestId('wave-category').filter({ hasText: 'Minimes F' }).getByRole('button', { name: 'Retirer' }).click();
  const waiting = page.getByTestId('waves-waiting');
  await expect(waiting.getByTestId('waiting-category')).toHaveText([/Minimes F/]);
  await waiting.getByTestId('waiting-category').filter({ hasText: 'Minimes F' }).getByRole('combobox').selectOption({ label: 'Après-midi' });
  await expect(card(page, 'Après-midi').getByTestId('wave-category').filter({ hasText: 'Minimes F' })).toContainText('Ajoutée à la main');

  // Conflit : Cadets cochés dans les deux vagues
  await card(page, 'Matin').getByText('Cadets', { exact: true }).click();
  await expect(page.getByTestId('waves-conflicts')).toContainText('Cadets F');
  await expect(page.getByTestId('waves-conflicts')).toContainText('placée dans Matin');
  await card(page, 'Matin').getByText('Cadets', { exact: true }).click();

  // Supprimer « Après-midi » : confirmation ; ses catégories retombent sur les règles
  await card(page, 'Après-midi').getByRole('button', { name: 'Supprimer la session « Après-midi »' }).click();
  await expect(page.getByTestId('wave-delete-confirm')).toContainText('3 catégories');
  await page.getByTestId('wave-delete-go').click();
  await page.getByTestId('wave-save').click();
  await expect(page.getByText('Sessions enregistrées').last()).toBeVisible(); // la notification du 1er enregistrement peut être encore là
  await expect(card(page, 'Matin').getByTestId('wave-category')).toHaveText([/Minimes F/]);
  await expect(waiting.getByTestId('waiting-category')).toHaveCount(2);
});

test('pesée par session : présence indépendante, clôture limitée à la session, feuilles de la session', async ({ page, request, context }) => {
  const id = await createCompetition(page, 'Coupe pesée sessions');
  const reg = (lastName: string, discipline: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId: discipline === 'kata' ? null : 'cadet:F:-54', source: 'manual' },
    });
  await reg('DEUX', 'karate');
  await reg('DEUX', 'kata');
  await reg('KATA', 'kata');
  await reg('COMBAT', 'karate');
  await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Kata', rules: { ageBandCodes: [], disciplines: ['kata'] } },
    { name: 'Combats', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] });
  await page.goto(`/competitions/${id}/pesee`);
  const row = (name: string) => page.getByTestId('weighin-row').filter({ hasText: name });
  await page.getByTestId('weighin-wave').getByText('Kata', { exact: true }).click(); // session par défaut : la première
  await expect(page.getByTestId('weighin-row')).toHaveCount(2);
  await row('DEUX').getByTestId('weighin-presence').getByText('Présent').click();
  await page.getByTestId('weighin-wave').getByText('Combats', { exact: true }).click();
  await expect(page).toHaveURL(/session=/);
  await expect(page.getByTestId('weighin-row')).toHaveCount(2);
  await row('DEUX').getByTestId('weighin-presence').getByText('Absent').click();
  await expect(row('DEUX').getByTestId('weighin-presence').locator('input[value="absent"]')).toBeChecked();
  await page.getByTestId('weighin-wave').getByText('Kata', { exact: true }).click();
  await expect(row('DEUX').getByTestId('weighin-presence').locator('input[value="present"]')).toBeChecked();
  // Clôture de la vague Kata : seul KATA (non pesé) devient absent
  await page.getByTestId('weighin-close').click();
  await page.getByTestId('weighin-close-confirm').click();
  await expect(page.getByText('1 combattant(s) marqué(s) absent(s).')).toBeVisible();
  await expect(page.getByText('Pesée clôturée')).toBeVisible();
  await page.getByTestId('weighin-wave').getByText('Combats', { exact: true }).click();
  await expect(page.getByText('Pesée clôturée')).toHaveCount(0);
  await expect(row('COMBAT').getByTestId('weighin-presence').locator('input[value="unknown"]')).toBeChecked();
  // Feuilles de pesée de la vague Combats : ses combattants seulement
  const [sheet] = await Promise.all([context.waitForEvent('page'), page.getByTestId('weighin-sheets-club').click()]);
  await expect(sheet.getByTestId('weighin-sheet')).toContainText('COMBAT');
  await expect(sheet.getByTestId('weighin-sheet').filter({ hasText: 'KATA ' })).toHaveCount(0);
});

test('sessions (mineurs) : session par défaut non clôturée, feuilles sans session ou périmée, écran Sessions non enregistré', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe sessions mineurs');
  const reg = (lastName: string, discipline: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId: discipline === 'kata' ? null : 'cadet:F:-54', source: 'manual' },
    });
  await reg('KATAONLY', 'kata');
  await reg('COMBAT', 'karate');
  const [kata, combat] = (await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Kata', rules: { ageBandCodes: [], disciplines: ['kata'] } },
    { name: 'Combats', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] })).json()) as { id: string }[];
  await request.post(`/api/competitions/${id}/weigh-in/close`, { data: { waveId: kata!.id } });
  // Pesée : vague proposée = la première non clôturée, écrite dans l'adresse
  await page.goto(`/competitions/${id}/pesee`);
  await expect(page).toHaveURL(new RegExp(`session=${combat!.id}`));
  await expect(page.getByTestId('weighin-wave').locator(`input[value="${combat!.id}"]`)).toBeChecked();
  // Feuilles : sans vague ou vague périmée → même repli
  for (const q of ['', '?session=perimee', '?vague=perimee']) {
    await page.goto(`/competitions/${id}/impression/pesee${q}`);
    await expect(page.getByTestId('weighin-sheet').first()).toContainText('COMBAT');
    await expect(page.getByText('KATAONLY')).toHaveCount(0);
  }
  // Écran Vagues : modifications non enregistrées signalées et protégées
  await page.goto(`/competitions/${id}/sessions`);
  await expect(page.getByTestId('waves-unsaved')).toHaveCount(0);
  await page.getByTestId('wave-name').first().fill('Kata du matin');
  await expect(page.getByTestId('waves-unsaved')).toBeVisible();
  // Quitter l'écran (ici par l'étape Jour J) avec une saisie non enregistrée demande confirmation.
  await page.getByTestId('stage-jour-j').click();
  await expect(page.getByTestId('leave-confirm')).toBeVisible();
  await page.getByTestId('leave-stay').click();
  await page.getByTestId('wave-save').click();
  await expect(page.getByTestId('waves-unsaved')).toHaveCount(0);
});

test('réaffectation par session : cas de la session, changement de session signalé et validé un par un', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe réaffectation sessions');
  const reg = async (lastName: string, ageBandCode: string, weightClassId: string, approxWeightKg: number) =>
    (await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode, discipline: 'karate', ruleset: 'jiyu', weightClassId, approxWeightKg, source: 'manual' },
    })).json()).row as { fighterId: string };
  // Matin : une minime seule, dont la seule proposition est la catégorie cadette (Après-midi).
  const mini = await reg('MINI', 'minime', 'minime:F:-45', 45);
  for (const n of ['CADA', 'CADB']) await reg(n, 'cadet', 'cadet:F:-47', 46);
  // Après-midi : une cadette -61 seule, recasable en +61 (cas simple).
  await reg('SEULE', 'cadet', 'cadet:F:-61', 58);
  for (const n of ['LOURDEA', 'LOURDEB']) await reg(n, 'cadet', 'cadet:F:+61', 60);
  const [matin] = (await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior'], disciplines: [] } },
  ] })).json()) as { id: string }[];
  await request.put(`/api/competitions/${id}/weigh-in/${mini.fighterId}`, { data: { weighInKg: 45, waveId: matin!.id } });

  await page.goto(`/competitions/${id}/reaffectation`);
  const cases = page.getByTestId('replacement-case');
  await page.getByTestId('replacement-wave').getByText('Après-midi', { exact: true }).click();
  await expect(page).toHaveURL(/session=/);
  await expect(cases).toHaveCount(1);
  await expect(cases).toContainText('SEULE');
  await page.getByTestId('bulk-simple').click();
  await page.getByTestId('bulk-confirm').click();
  await expect(page.getByText('1 réaffectation(s) appliquée(s).')).toBeVisible();
  await expect(page.getByText('Aucun cas à traiter')).toBeVisible();

  await page.getByTestId('replacement-wave').getByText('Matin', { exact: true }).click();
  await expect(cases).toHaveCount(1);
  await expect(cases).toContainText('MINI');
  const proposal = cases.getByTestId('replacement-proposal');
  await expect(proposal.getByTestId('wave-change')).toHaveText('↪ Change de session : Matin → Après-midi');
  await expect(page.getByText('Les changements de session se valident un par un.')).toBeVisible();
  // « Tout classer automatiquement » ne la prend pas.
  await page.getByTestId('bulk-all').click();
  await expect(page.getByTestId('bulk-confirm')).toHaveText('Confirmer (0)');
  await expect(page.getByTestId('bulk-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');
  // Validée à la main : la minime passe dans l'Après-midi, à pointer, son poids gardé.
  await proposal.getByTestId('proposal-apply').click();
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByText('Réaffectation validée.')).toBeVisible();
  await expect(cases).toHaveCount(0);

  await openTab(page, 'Pesée');
  await page.getByTestId('weighin-wave').getByText('Après-midi', { exact: true }).click();
  const row = page.getByTestId('weighin-row').filter({ hasText: 'MINI' });
  await expect(row.getByTestId('weighin-presence').locator('input[value="unknown"]')).toBeChecked();
  await expect(row.getByTestId('weighin-weight')).toHaveValue('45 kg');
});

test('réaffectation par session (relecture) : session gardée d’un onglet à l’autre, avertissements du déplacement manuel', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe réaffectation sessions relecture');
  const reg = (lastName: string, ageBandCode: string, weightClassId: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode, discipline: 'karate', ruleset: 'jiyu', weightClassId, approxWeightKg: 46, source: 'manual' },
    });
  const mini = (await (await reg('MINI', 'minime', 'minime:F:-45')).json()).row as { fighterId: string };
  for (const n of ['CADA', 'CADB']) await reg(n, 'cadet', 'cadet:F:-47');
  await reg('JUNIOR', 'junior', 'junior:F:-48');
  const [matin] = (await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ] })).json()) as { id: string }[];
  // La pesée du Matin est close : le recasement du Matin vient ensuite.
  await request.put(`/api/competitions/${id}/weigh-in/${mini.fighterId}`, { data: { presence: 'present', waveId: matin!.id } });
  await request.post(`/api/competitions/${id}/weigh-in/close`, { data: { waveId: matin!.id } });
  await page.goto(`/competitions/${id}/pesee`);
  await page.getByTestId('weighin-wave').getByText('Matin', { exact: true }).click();
  await openTab(page, 'Réaffectation');
  await expect(page.getByTestId('replacement-wave').locator(`input[value="${matin!.id}"]`)).toBeChecked();
  const cases = page.getByTestId('replacement-case');
  await expect(cases).toContainText('MINI');
  // Déplacement manuel vers une catégorie d'une autre vague, puis vers une catégorie en attente.
  const select = cases.getByTestId('manual-move-select');
  await select.click();
  await page.getByRole('option', { name: /Cadets F.*session Après-midi/ }).click();
  await cases.getByTestId('manual-move').click();
  await expect(page.getByTestId('wave-change-warning')).toContainText('passera dans la session « Après-midi »');
  await page.keyboard.press('Escape');
  // Juniors F : deux tranches d'écart, absente de la liste tant qu'on ne demande pas toutes les catégories.
  await select.click();
  await expect(page.getByRole('option', { name: /Juniors F/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await cases.getByTestId('manual-move-all').click();
  await select.click();
  await page.getByRole('option', { name: /Juniors F.*session en attente.*règle\(s\) enfreinte\(s\)/ }).click();
  await cases.getByTestId('manual-move').click();
  await expect(page.getByTestId('wave-change-warning')).toContainText('dans aucune session');
});

test('sessions : tout cocher les tranches d’âge et les disciplines', async ({ page }) => {
  const id = await createCompetition(page, 'Coupe sessions tout cocher');
  await page.goto(`/competitions/${id}/sessions`);
  await page.getByTestId('wave-add').click();
  const card = page.getByTestId('wave-card');
  await card.getByTestId('wave-all-ages').click();
  await expect(card.getByTestId('wave-all-ages')).toHaveText('Tout décocher');
  await card.getByTestId('wave-all-disciplines').click();
  await page.getByTestId('wave-save').click();
  const waves = (await (await page.request.get(`/api/competitions/${id}/waves`)).json()) as { rules: { ageBandCodes: string[]; disciplines: string[] } }[];
  expect(waves[0]!.rules.ageBandCodes.length).toBe(14);
  expect(waves[0]!.rules.disciplines.length).toBe(5);
  await card.getByTestId('wave-all-ages').click();
  await expect(card.getByTestId('wave-all-ages')).toHaveText('Tout cocher');
});

test('tableaux par session : la session choisie, celles en attente, toutes', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe tableaux par session');
  const reg = (lastName: string, ageBandCode: string, weightClassId: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode, discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
  for (const n of ['MINA', 'MINB']) await reg(n, 'minime', 'minime:F:-45');
  for (const n of ['CADA', 'CADB']) await reg(n, 'cadet', 'cadet:F:-47');
  await request.put(`/api/competitions/${id}/waves`, { data: [{ name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } }] });
  await page.goto(`/competitions/${id}/tableaux`);
  const rows = page.getByTestId('category-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Minimes');
  await expect(page.getByTestId('print-all')).toHaveText('Imprimer la session');
  await page.getByTestId('brackets-wave').getByText('En attente (1)').click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Cadets');
  await page.getByTestId('brackets-wave').getByText('Toutes').click();
  await expect(rows).toHaveCount(2);
});

test('anciennes adresses : /vagues et /recasement redirigées, ?vague= toujours lu', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe anciennes adresses');
  const [w] = (await (await request.put(`/api/competitions/${id}/waves`, { data: [{ name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } }, { name: 'Soir', rules: { ageBandCodes: ['cadet'], disciplines: [] } }] })).json()) as { id: string }[];
  await page.goto(`/competitions/${id}/vagues`);
  await expect(page).toHaveURL(new RegExp(`/competitions/${id}/sessions$`));
  await page.goto(`/competitions/${id}/recasement?vague=${w!.id}`);
  await expect(page).toHaveURL(new RegExp(`/competitions/${id}/reaffectation\\?session=${w!.id}$`));
  await expect(page.getByRole('tab', { name: 'Réaffectation' })).toHaveAttribute('aria-selected', 'true');
});
