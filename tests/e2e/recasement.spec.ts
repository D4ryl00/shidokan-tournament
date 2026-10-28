import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createCompetition } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  const reg = async (data: object) =>
    (await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    })).json()).row;
  await reg({ lastName: 'MARTIN', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ lastName: 'BERNARD', approxWeightKg: 50 });
  await reg({ lastName: 'DUBOIS', weightClassId: 'cadet:F:-61' });
  await reg({ lastName: 'THOMAS', weightClassId: 'cadet:F:-61' });
  await reg({ lastName: 'PETIT', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 44 });
  await reg({ lastName: 'ROBERT', firstName: 'Paul', sex: 'M', ageBandCode: 'senior', ruleset: 'shobu', weightClassId: 'senior:M:-75' });
}

/** La carte d'un combattant (son nom en titre, pas cité comme adversaire dans une autre carte). */
const caseOf = (page: Page, name: string) => page.getByTestId('replacement-case').filter({ has: page.getByTestId('case-name').filter({ hasText: name }) });

test('pesée puis réaffectation : aperçu, validation, refus, plan d’ensemble, retour, annulation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe réaffectation');
  await seed(request, id);

  // 1. Pesée
  await page.goto(`/competitions/${id}/pesee`);
  const bernard = page.getByTestId('weighin-row').filter({ hasText: 'BERNARD' });
  await bernard.getByTestId('weighin-weight').fill('50,5');
  await bernard.getByTestId('weighin-weight').press('Enter');
  await expect(bernard.getByTestId('weighin-presence').locator('input[value="present"]')).toBeChecked();
  await page.getByTestId('weighin-row').filter({ hasText: 'THOMAS' }).getByTestId('weighin-presence').getByText('Absent').click();
  await expect(page.getByTestId('weighin-counters')).toContainText('1 absent');
  await page.getByTestId('weighin-row').filter({ hasText: 'ROBERT' }).getByTestId('weighin-presence').getByText('Absent').click();
  await expect(page.getByTestId('weighin-counters')).toContainText('2 absents');
  await page.goto(`/competitions/${id}/impression/pesee?par=categorie`);
  await expect(page.getByTestId('weighin-sheet').filter({ hasText: 'Pesée — Karaté · Jiyu · Cadets F · -61 kg' })).toContainText('DUBOIS');
  // Ordre de la grille (Minimes avant Cadets ; -47 avant -54 avant -61), pas l'ordre alphabétique.
  await expect(page.getByTestId('weighin-sheet').locator('h1')).toHaveText([
    'Pesée — Karaté · Jiyu · Minimes F · -45 kg',
    'Pesée — Karaté · Jiyu · Cadets F · -47 kg',
    'Pesée — Karaté · Jiyu · Cadets F · -54 kg',
    'Pesée — Karaté · Jiyu · Cadets F · -61 kg',
    'Pesée — Karaté · Shobu · Seniors M · -75 kg',
  ]);

  // 1 bis. Tableaux : nombre de cas par catégorie
  await page.goto(`/competitions/${id}/tableaux`);
  await expect(page.getByTestId('category-row').filter({ hasText: 'Cadets F · -61 kg' }).getByTestId('category-cases')).toHaveText('1 cas à traiter');
  await expect(page.getByTestId('category-row').filter({ hasText: 'Shobu' }).getByTestId('category-all-absent')).toBeVisible();
  // Formats proposés d'après les présents (comme le serveur) : DUBOIS seule présente en -61 → pas de « combat unique »
  await page.getByTestId('category-row').filter({ hasText: 'Cadets F · -61 kg' }).click();
  await page.getByTestId('category-format').click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option', { name: /seul combat/i })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 2. Recasement : aperçu et validation d'un cas simple
  await page.goto(`/competitions/${id}/reaffectation`);
  const martin = caseOf(page, 'MARTIN Léa');
  await expect(martin).toBeVisible();
  const simple = martin.getByTestId('replacement-proposal').filter({ hasText: '-54' }).first();
  await expect(simple.getByTestId('move-why')).toHaveText('Seule dans sa catégorie');
  await expect(simple.getByTestId('move-to')).toContainText('-47 / -54 kg');
  await expect(simple).toContainText('avec BERNARD Léa · écart 4,5 kg (max 5)');
  await simple.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('preview-content')).toContainText('MARTIN Léa contre BERNARD Léa');
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByText('Réaffectation validée.')).toBeVisible();
  await expect(page.getByTestId('recasement-row')).toHaveCount(1);

  await page.goto(`/competitions/${id}/inscriptions`);
  const badge = page.getByTestId('registration-row').filter({ hasText: 'MARTIN' }).getByTestId('replacement-badge');
  await expect(badge).toHaveAttribute('data-state', 'validated');
  await badge.click();
  await expect(page.getByTestId('recasement-detail')).toContainText('Origine : Karaté · Jiyu · Cadets F · -47 kg');
  await expect(page.getByTestId('recasement-detail')).toContainText('Arrivée : Karaté · Jiyu · Cadets F · -47 / -54 kg');
  await page.goto(`/competitions/${id}/pesee`);
  await expect(page.getByTestId('weighin-row').filter({ hasText: 'MARTIN' }).getByTestId('weighin-recased')).toBeVisible();

  // 3. Refus
  await page.goto(`/competitions/${id}/reaffectation`);
  const dubois = caseOf(page, 'DUBOIS');
  const before = await dubois.getByTestId('replacement-proposal').count();
  if (before > 0) {
    await dubois.getByTestId('proposal-refuse').first().click();
    await expect(dubois.getByTestId('replacement-proposal')).toHaveCount(before - 1);
    await expect(dubois.getByTestId('replacement-proposal-refused')).toHaveCount(1);
    await dubois.getByTestId('proposal-unrefuse').click();
    await expect(dubois.getByTestId('replacement-proposal')).toHaveCount(before);
    await dubois.getByTestId('proposal-refuse').first().click();
    await expect(dubois.getByTestId('replacement-proposal-refused')).toHaveCount(1);
  }

  // 4. Plan d'ensemble : chaque déplacement à valider est validé, puis le plan est appliqué, avec son aperçu.
  await page.getByTestId('plan-show').click();
  const plan = page.getByTestId('plan-view');
  const validate = plan.getByTestId('plan-move-validate');
  while ((await validate.count()) > 0) {
    const row = plan.getByTestId('plan-move').filter({ has: page.getByTestId('plan-move-validate') }).first();
    const rid = await row.getAttribute('data-registration');
    await row.getByTestId('plan-move-validate').click();
    await expect(plan.locator(`[data-testid="plan-move"][data-registration="${rid}"]`).getByTestId('plan-move-unvalidate')).toBeVisible();
  }
  if ((await plan.getByTestId('plan-move').count()) > 0) {
    await plan.getByTestId('plan-apply').click();
    await expect(page.getByRole('dialog').getByTestId('preview-content')).toBeVisible();
    await page.getByTestId('plan-apply-confirm').click();
    await expect(page.getByText(/réaffectations? appliquées?/)).toBeVisible();
  }
  // Tout ce qui respecte les règles est classé. Une proposition hors de l'écart de poids autorisé peut rester (selon celle que le
  // refus de l'étape 3 a écartée) : le plan ne l'applique jamais.
  await expect(page.getByTestId('replacement-proposal').filter({ hasNotText: 'au-delà du seuil' })).toHaveCount(0);

  // 5. Inscription sur place d'une nouvelle -47 → retour proposé et validé
  await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, lastName: 'NOUVELLE', firstName: 'Zoé', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-47', source: 'onsite' },
  });
  await page.reload();
  const ret = caseOf(page, 'MARTIN Léa');
  await expect(ret.getByTestId('move-why')).toHaveText('Retour dans sa catégorie d’origine (elle a de nouveau des combattants)');
  await expect(ret.getByTestId('plan-rule')).toHaveText(['Retour · imposé']);
  await ret.getByTestId('proposal-apply').click();
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByText('Réaffectation validée.')).toBeVisible();

  // 6. Annulation depuis l'historique
  const rows = page.getByTestId('recasement-row');
  const count = await rows.count();
  await rows.first().getByTestId('recasement-undo').click();
  await page.getByTestId('recasement-undo-confirm').click();
  await expect(page.getByText('Réaffectation annulée.')).toBeVisible();
  await expect(rows).toHaveCount(count);
  await expect(rows.first()).toContainText('annulé');

  // 7. Aucune pastille à l'impression
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section').first()).toBeVisible();
  await expect(page.getByTestId('replacement-badge')).toHaveCount(0);
});

test('repartir de zéro remet la réaffectation à l’état d’avant', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe repartir de zéro');
  await seed(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const martin = caseOf(page, 'MARTIN Léa');
  await martin.getByTestId('replacement-proposal').filter({ hasText: '-54' }).first().getByTestId('proposal-apply').click();
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByTestId('recasement-row')).toHaveCount(1);
  await expect(martin).toHaveCount(0);

  await expect(page.getByTestId('replacement-reset')).toHaveText('Repartir de zéro');
  await page.getByTestId('replacement-reset').click();
  const dialog = page.getByRole('dialog', { name: 'Repartir de zéro ?' });
  await expect(dialog).toContainText('1 réaffectation validée est annulée');
  await expect(dialog).toContainText('Les refus, les cartes mises de côté et l’historique sont effacés. Les règles ne changent pas.');
  await dialog.getByRole('button', { name: 'Tout annuler' }).click();
  await expect(page.getByTestId('recasement-row')).toHaveCount(0);
  await expect(page.getByText('Aucune pour l’instant.')).toBeVisible();
  await expect(page.getByTestId('replacement-reset')).toHaveCount(0);
  await expect(martin).toBeVisible();
});

test('repartir de zéro refusé : le motif se lit dans la confirmation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe repartir de zéro refusé');
  await seed(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const martin = caseOf(page, 'MARTIN Léa');
  await martin.getByTestId('replacement-proposal').filter({ hasText: '-54' }).first().getByTestId('proposal-apply').click();
  await page.getByTestId('proposal-confirm').click();
  await expect(page.getByTestId('recasement-row')).toHaveCount(1);
  const refusal = 'Une catégorie concernée a déjà commencé ou sa session est lancée : rouvrez-la pour repartir de zéro.';
  await page.route('**/replacement/reset', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: refusal }) }));
  await page.getByTestId('replacement-reset').click();
  const dialog = page.getByRole('dialog', { name: 'Repartir de zéro ?' });
  await dialog.getByRole('button', { name: 'Tout annuler' }).click();
  await expect(dialog).toContainText(refusal);
  await expect(page.getByTestId('recasement-row')).toHaveCount(1);
});

test('carte : pourquoi, de et vers lisibles, pastille de la correction imposée', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe cartes lisibles');
  const reg = async (data: object) =>
    (await (await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'Emma', sex: 'F', ageBandCode: 'minime', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'minime:F:-40', source: 'manual', ...data },
    })).json()).row as { fighterId: string };
  const girard = await reg({ lastName: 'GIRARD' });
  const jade = await reg({ lastName: 'RICHARD', firstName: 'Jade' });
  await request.put(`/api/competitions/${id}/weigh-in/${girard.fighterId}`, { data: { weighInKg: 41 } });
  await request.put(`/api/competitions/${id}/weigh-in/${jade.fighterId}`, { data: { weighInKg: 39 } });
  await page.goto(`/competitions/${id}/reaffectation`);
  const card = caseOf(page, 'GIRARD Emma');
  const alone = card.getByTestId('replacement-proposal').filter({ hasText: 'vide' });
  await expect(alone.getByTestId('move-why')).toHaveText('Pesée à 41 kg : trop lourde pour -40 kg (tolérance 0,5 kg)');
  await expect(alone.getByTestId('move-from')).toHaveText('Karaté · Jiyu · Minimes F · -40 kg');
  await expect(alone.getByTestId('move-from').locator('[data-changed="true"]')).toHaveText('-40 kg');
  await expect(alone.getByTestId('move-to').locator('[data-changed="true"]')).toHaveText('-45 kg');
  await expect(alone).toContainText('2 combattants → il en restera 1');
  await expect(alone).toContainText('vide : elle y sera seule, à réaffecter ensuite');
  await expect(alone.getByTestId('plan-rule')).toHaveText(['Correction de pesée · imposée']);
});

test('repartir de zéro : session choisie seulement, bouton rouge', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe repartir par session');
  const api = `/api/competitions/${id}`;
  const reg = (data: object) => request.post(`${api}/registrations`, {
    data: { clubId: null, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
  });
  await reg({ lastName: 'MINA', ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
  await reg({ lastName: 'MILA', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 42 });
  await reg({ lastName: 'CARA', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ lastName: 'CLEO', weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const waves = (await (await request.put(`${api}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior'], disciplines: [] } },
  ] })).json()) as { id: string }[];
  for (const w of waves) {
    const r = await (await request.get(`${api}/replacement?vague=${w.id}`)).json();
    await request.post(`${api}/replacement/apply`, { data: { proposalId: r.proposals[r.cases[0].id][0].id } });
  }
  await page.goto(`/competitions/${id}/reaffectation`);
  await page.getByTestId('replacement-wave').getByText('Matin').click();
  const button = page.getByTestId('replacement-reset');
  await expect(button).toHaveText('Repartir de zéro (session Matin)');
  const [r, g, b] = (await button.evaluate((e) => getComputedStyle(e).color)).match(/\d+/g)!.map(Number);
  expect(r! - Math.max(g!, b!)).toBeGreaterThan(60);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Repartir de zéro ?' });
  await expect(dialog).toContainText('1 réaffectation validée est annulée');
  await dialog.getByRole('button', { name: 'Tout annuler dans cette session' }).click();
  await expect(page.getByText('Réaffectation remise à zéro.')).toBeVisible();
  // L'historique de l'après-midi est toujours là.
  await expect(page.getByTestId('recasement-row')).toHaveCount(1);
  await expect(page.getByTestId('recasement-row')).toContainText('Cadets');
});

test('carte d’un split : le nom de celui qui vient, et d’où il vient', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe carte split');
  const reg = (data: object) => request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, sex: 'M', ageBandCode: 'benjamin', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'benjamin:M:-40', source: 'manual', ...data },
  });
  await reg({ lastName: 'ROUSSEAU', firstName: 'Tom', ageBandCode: 'minime', weightClassId: 'minime:M:-50', approxWeightKg: 45 });
  await reg({ lastName: 'GARNIER', firstName: 'Sacha', approxWeightKg: 40 });
  await reg({ lastName: 'GUERIN', firstName: 'Louis', approxWeightKg: 39 });
  await reg({ lastName: 'RICHARD', firstName: 'Tom', approxWeightKg: 39 });
  await page.goto(`/competitions/${id}/reaffectation`);
  const split = caseOf(page, 'ROUSSEAU Tom').getByTestId('replacement-proposal').filter({ has: page.getByTestId('move-mover') }).first();
  await expect(split.getByTestId('move-mover')).toContainText('GARNIER Sacha');
  await expect(split.getByTestId('move-why')).toHaveText('Donner un adversaire à ROUSSEAU Tom, seul en Karaté · Jiyu · Minimes M · -50 kg');
  await expect(split.getByTestId('move-from')).toHaveText('Karaté · Jiyu · Benjamins M · -40 kg');
  await expect(split).toContainText('3 combattants → il en restera 2');
  await expect(split.getByTestId('plan-rule')).toHaveCount(2);
});
