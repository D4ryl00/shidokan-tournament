import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clipped, createCompetition, openTab } from './helpers.js';

const orderOf = (rows: ReturnType<import('@playwright/test').Page['getByTestId']>) => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));

test('réglages de l’application : ranger les règles par défaut, une nouvelle compétition les reprend', async ({ page, request }) => {
  const before = await (await request.get('/api/app-settings')).json();
  try {
    await page.goto('/parametres');
    const section = page.getByRole('group', { name: 'Règles de réaffectation par défaut' });
    await expect(section).toContainText('Copiées dans chaque nouvelle compétition. Les compétitions déjà créées ne changent pas.');
    const ladder = section.getByTestId('rule-ladder');
    const rows = ladder.getByTestId('ladder-row');
    await expect(rows).toHaveCount(11);
    // Pas de barres sans plan, pas de boutons ni d’interrupteur pour le retour dans la catégorie d’origine.
    await expect(ladder.getByTestId('ladder-alone')).toHaveCount(0);
    const first = rows.first();
    await expect(first).toHaveAttribute('data-rule', 'return');
    await expect(first.getByTestId('ladder-switch')).toHaveCount(0);
    await expect(first.getByTestId('ladder-up')).toHaveCount(0);
    await expect(first.getByTestId('ladder-down')).toHaveCount(0);

    const ageDown = rows.filter({ hasText: 'Tranche d’âge au-dessous' });
    await ageDown.getByTestId('ladder-down').click();
    await rows.filter({ hasText: 'Mélange seniors / vétérans' }).getByText('Mélange seniors / vétérans').click();
    await expect(rows.filter({ hasText: 'Mélange seniors / vétérans' }).locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
    await expect(ladder.getByTestId('ladder-cut')).toContainText('je m’arrête ici');
    const sw = rows.filter({ hasText: 'Mélange filles / garçons' }).getByTestId('ladder-switch');
    const wasOn = await sw.isChecked();
    await sw.click({ force: true });
    await section.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

    const id = await createCompetition(page, 'Coupe règles par défaut');
    await page.goto(`/competitions/${id}/reglages`);
    await openTab(page, 'Réaffectation');
    const mine = page.getByTestId('rule-ladder');
    const mineRows = mine.getByTestId('ladder-row');
    await expect(mineRows).toHaveCount(11);
    expect(await orderOf(mineRows)).toEqual([
      'return', 'weight', 'split', 'weightGap', 'ageUp', 'seniorsVeterans', 'ageDown', 'discipline', 'shobuToJiyu', 'mixSexes', 'minorsAdults',
    ]);
    await expect(mineRows.filter({ hasText: 'Mélange seniors / vétérans' }).locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
    const mineSwitch = mineRows.filter({ hasText: 'Mélange filles / garçons' }).getByTestId('ladder-switch');
    if (wasOn) await expect(mineSwitch).not.toBeChecked(); else await expect(mineSwitch).toBeChecked();
    // Le plan donne la ligne de départ et une barre par règle active.
    await expect(mine.getByTestId('ladder-start')).toContainText('Sans rien changer');
    await expect(mine.getByTestId('ladder-alone').first()).toBeVisible();

    // Retour aux réglages par défaut de l’application : un changement local est défait.
    await mineSwitch.click({ force: true });
    if (wasOn) await expect(mineSwitch).toBeChecked(); else await expect(mineSwitch).not.toBeChecked();
    await page.getByRole('button', { name: 'Revenir aux réglages par défaut' }).click();
    if (wasOn) await expect(mineSwitch).not.toBeChecked(); else await expect(mineSwitch).toBeChecked();
  } finally {
    await request.patch('/api/app-settings', { data: { defaultReplacementRules: before.defaultReplacementRules } });
  }
});

test('la liste des règles tient dans un écran de téléphone, barres comprises', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe règles mobile');
  for (const [last, w] of [['MARTIN', 'cadet:F:-47'], ['BERNARD', 'cadet:F:-54']] as const) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'Léa', lastName: last, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: w, source: 'manual' },
    });
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/competitions/${id}/reaffectation`);
  const ladder = page.getByTestId('rule-ladder');
  await expect(ladder.getByTestId('ladder-start')).toContainText('Sans rien changer');
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="rule-ladder"], [data-testid="rule-ladder"] *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName} ${e.getAttribute('data-testid') ?? ''} ${(e.textContent ?? '').slice(0, 30)}`).slice(0, 8));
  expect(wide).toEqual([]);
  const box = await ladder.boundingBox();
  for (const bar of await ladder.getByTestId('ladder-alone').all()) {
    const b = await bar.boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
});

/**
 * Trois combattants seuls : SEULE (-61) rejoint les +61 (poids voisin, sans validation) ; MINI (minime) monte chez les
 * cadettes -47 (tranche d’âge au-dessus, à valider) ; VETE (vétéran) rejoint les seniors -75 (mélange seniors / vétérans, à valider).
 */
async function seedPlan(request: APIRequestContext, id: string) {
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
    });
  await reg({ lastName: 'SEULE', weightClassId: 'cadet:F:-61', approxWeightKg: 58 });
  for (const n of ['LOURDEA', 'LOURDEB']) await reg({ lastName: n, weightClassId: 'cadet:F:+61', approxWeightKg: 60 });
  await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  for (const n of ['CADA', 'CADB']) await reg({ lastName: n, weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const man = { firstName: 'Paul', sex: 'M', approxWeightKg: 74 };
  await reg({ ...man, lastName: 'VETE', ageBandCode: 'v1', weightClassId: 'v1:M:-75' });
  for (const n of ['SENA', 'SENB']) await reg({ ...man, lastName: n, ageBandCode: 'senior', weightClassId: 'senior:M:-75' });
}

async function openPlan(page: Page, id: string) {
  await page.goto(`/competitions/${id}/reaffectation`);
  await page.getByTestId('plan-show').click();
  const view = page.getByTestId('plan-view');
  await expect(view).toBeVisible();
  return { view, moveOf: (name: string) => view.getByTestId('plan-move').filter({ hasText: name }) };
}

test('le diagramme baisse règle par règle ; déplacer la ligne change le plan', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan diagramme');
  await seedPlan(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const ladder = page.getByTestId('rule-ladder');
  const bar = (rule: string) => ladder.locator(`[data-testid="ladder-row"][data-rule="${rule}"]`).getByTestId('ladder-alone');
  await expect(ladder.getByTestId('ladder-start').getByTestId('ladder-alone')).toHaveText('3');
  await expect(bar('weight')).toHaveText('2');
  await expect(bar('weightGap')).toHaveText('2');
  await expect(bar('ageUp')).toHaveText('1');
  await expect(bar('seniorsVeterans')).toHaveText('0');
  const show = page.getByTestId('plan-show');
  await expect(show).toHaveText('Voir le plan jusqu’à la règle 8 (3 déplacements, 0 seul)');
  await show.click();
  const view = page.getByTestId('plan-view');
  await expect(view).toContainText('Restent seuls 0 (au lieu de 3)');
  await expect(view).toContainText('Déplacements 3');
  await expect(view).toContainText('Validés 0 / 2');
  // Groupes du plus coûteux au moins coûteux, avec les règles qu’ils couvrent.
  const bands = view.getByTestId('plan-band');
  expect(await bands.evaluateAll((els) => els.map((e) => e.getAttribute('data-band')))).toEqual(['3', '1', '0']);
  await expect(bands.nth(0)).toContainText('Concessions fortes');
  await expect(bands.nth(0)).toContainText('règle 7 · 1 déplacement');
  await expect(bands.nth(0)).toContainText('VETE Paul');
  await expect(bands.nth(1)).toContainText('Concessions légères');
  await expect(bands.nth(1)).toContainText('règles 4–5 · 1 déplacement');
  await expect(bands.nth(1)).toContainText('MINI Léa');
  await expect(bands.nth(1)).toContainText('Tranche d’âge au-dessus');
  await expect(bands.nth(1)).toContainText('Minimes → Cadets');
  await expect(bands.nth(2)).toContainText('Sans validation');
  await expect(bands.nth(2)).toContainText('règles 1–3 · 1 déplacement');
  await expect(bands.nth(2)).toContainText('SEULE Léa');
  await expect(view.getByTestId('plan-move').filter({ hasText: 'SEULE Léa' }).getByTestId('plan-move-validate')).toHaveCount(0);

  // La ligne remonte sous « Tranche d’âge au-dessus » : VETE n’est plus déplacé, MINI change de couleur.
  await ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').getByText('Tranche d’âge au-dessus').click();
  await expect(show).toHaveText('Voir le plan jusqu’à la règle 5 (2 déplacements, 1 seul)');
  await expect(view.getByTestId('plan-move')).toHaveCount(2);
  await expect(view.getByTestId('plan-changes')).toContainText('VETE Paul n’est plus déplacé.');
  await expect(view.getByTestId('plan-alone')).toContainText('VETE Paul');
  await expect(view.locator('[data-testid="plan-band"][data-band="3"]')).toContainText('MINI Léa');
  await expect(view.getByTestId('plan-proven')).toHaveText('Aucune combinaison dans ces règles ne laisse moins de 1 seul.');
});

test('valider un déplacement à valider, appliquer : seuls lui et les cas simples sont appliqués', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan appliquer');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toHaveText('Annuler la validation');
  await expect(view).toContainText('Validés 1 / 2');
  await view.getByTestId('plan-apply').click();
  const confirm = page.getByTestId('plan-apply-confirm');
  await expect(confirm).toHaveText('Confirmer (2)');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('MINI Léa');
  await expect(dialog).toContainText('SEULE Léa');
  await expect(dialog).not.toContainText('VETE Paul');
  await expect(dialog.getByTestId('preview-content')).toBeVisible();
  await confirm.click();
  await expect(page.getByText('2 réaffectations appliquées.')).toBeVisible();
  const rows = page.getByTestId('recasement-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'MINI' })).toContainText('en masse · validé à la main');
  await expect(rows.filter({ hasText: 'SEULE' })).toContainText('en masse');
  await expect(rows.filter({ hasText: 'SEULE' })).not.toContainText('validé à la main');
  // Le déplacement non validé reste en attente dans le plan recalculé ; les choix sont vidés.
  await expect(view.getByTestId('plan-move')).toHaveCount(1);
  await expect(moveOf('VETE Paul').getByTestId('plan-move-validate')).toBeVisible();
  await expect(view).toContainText('Validés 0 / 1');
});

test('modifier puis annuler le choix : le plan revient', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan modifier');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  const mini = moveOf('MINI Léa');
  await expect(mini).toContainText('Minimes / Cadets F · -45 / -47 kg');
  await mini.getByTestId('plan-move-modify').click();
  await mini.getByTestId('plan-move-target').click();
  await page.getByRole('option', { name: /Cadets F · -61 kg/ }).click();
  // MINI rejoint SEULE en -61 : SEULE n’a plus besoin de bouger.
  await expect(view.getByTestId('plan-move')).toHaveCount(2);
  await expect(mini).toContainText('hors règles');
  await expect(mini).toContainText('Minimes / Cadets F · -45 / -61 kg');
  const changes = view.getByTestId('plan-changes');
  await expect(changes).toContainText('MINI Léa passe en Karaté · Jiyu · Minimes / Cadets F · -45 / -61 kg au lieu de Karaté · Jiyu · Minimes / Cadets F · -45 / -47 kg.');
  await expect(changes).toContainText('SEULE Léa n’est plus déplacé.');
  // Le choix est gardé sur le poste.
  await page.reload();
  await page.getByTestId('plan-show').click();
  await expect(mini).toContainText('hors règles');
  await mini.getByTestId('plan-move-unchoose').click();
  await expect(view.getByTestId('plan-move')).toHaveCount(3);
  await expect(mini).toContainText('Minimes / Cadets F · -45 / -47 kg');
  await expect(mini).not.toContainText('hors règles');
  await expect(changes).toContainText('SEULE Léa : Karaté · Jiyu · Cadets F · -61 / +61 kg.');
});

test('refuser puis annuler le refus', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan refuser');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  await moveOf('VETE Paul').getByTestId('plan-move-refuse').click();
  await expect(view.getByTestId('plan-move')).toHaveCount(2);
  await expect(view.getByTestId('plan-alone')).toContainText('VETE Paul');
  await expect(view.getByTestId('plan-unrefuse')).toHaveCount(1);
  // Le refus est enregistré : la carte ne le propose plus non plus.
  await expect(page.getByTestId('replacement-case').filter({ hasText: 'VETE' }).getByTestId('replacement-proposal-refused')).toHaveCount(1);
  await view.getByTestId('plan-unrefuse').click();
  await expect(view.getByTestId('plan-move')).toHaveCount(3);
  await expect(view.getByTestId('plan-unrefuse')).toHaveCount(0);
  await expect(moveOf('VETE Paul')).toBeVisible();
});

test('plan périmé à l’application : refusé, les choix restent', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan périmé');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await expect(view).toContainText('Validés 1 / 2');
  await view.getByTestId('plan-apply').click();
  await expect(page.getByTestId('plan-apply-confirm')).toHaveText('Confirmer (2)');
  // Pendant la relecture, une inscription arrive d’un autre poste.
  await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, lastName: 'TARDIVE', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', approxWeightKg: 50, source: 'onsite' },
  });
  await page.getByTestId('plan-apply-confirm').click();
  await expect(view.getByTestId('api-error')).toBeVisible();
  await expect(page.getByTestId('recasement-row')).toHaveCount(0);
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  await expect(view).toContainText('TARDIVE Léa');
});

test('annuler un calcul long : le plan affiché est signalé périmé, « Relancer le calcul » le remet à jour', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan annulé');
  await seedPlan(request, id);
  const { view } = await openPlan(page, id);
  const apply = view.getByTestId('plan-apply');
  await expect(apply).toBeEnabled();
  // La demande est retardée de 2 s (et peut être annulée par le navigateur pendant ce temps).
  const slow = async (route: import('@playwright/test').Route) => {
    await new Promise((r) => setTimeout(r, 2000));
    try { await route.fallback(); } catch { /* demande annulée */ }
  };
  await page.route('**/replacement/plan', slow);
  const ladder = page.getByTestId('rule-ladder');
  await ladder.locator('[data-testid="ladder-row"][data-rule="mixSexes"]').getByTestId('ladder-switch').click({ force: true });
  await expect(apply).toBeDisabled();
  await expect(page.getByText('Calcul du plan', { exact: false }).first()).toBeVisible();
  const aborted = page.waitForEvent('requestfailed', (r) => r.url().includes('/replacement/plan'));
  await page.getByRole('button', { name: 'Annuler le calcul' }).click();
  const message = page.getByText('Calcul annulé : le plan affiché ne tient pas compte de votre dernier changement.');
  // L'annulation arrête vraiment la demande (et ne se contente pas de lever un drapeau).
  await aborted;
  await expect(message).toBeVisible({ timeout: 1000 });
  await expect(apply).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Annuler le calcul' })).toHaveCount(0);
  await page.unroute('**/replacement/plan', slow);
  await page.getByRole('button', { name: 'Relancer le calcul' }).click();
  await expect(message).toHaveCount(0);
  await expect(apply).toBeEnabled();

  // Annuler de nouveau, puis un geste : tout calcul complet efface l’annulation, même pour le même choix.
  await page.route('**/replacement/plan', slow);
  const sw = ladder.locator('[data-testid="ladder-row"][data-rule="mixSexes"]').getByTestId('ladder-switch');
  await sw.click({ force: true });
  await page.getByRole('button', { name: 'Annuler le calcul' }).click();
  await expect(message).toBeVisible();
  await page.unroute('**/replacement/plan', slow);
  await sw.click({ force: true });
  await expect(message).toHaveCount(0);
  await expect(apply).toBeEnabled();
});

test('sans plan (calcul en erreur), la liste des règles reste réglable', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan en erreur');
  await seedPlan(request, id);
  await page.route('**/replacement/plan', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Calcul impossible' }) }));
  await page.goto(`/competitions/${id}/reaffectation`);
  const ladder = page.getByTestId('rule-ladder');
  await expect(ladder.getByTestId('ladder-row')).toHaveCount(11);
  await expect(ladder.getByTestId('ladder-alone')).toHaveCount(0);
  await expect(page.getByTestId('api-error').first()).toContainText('Calcul impossible');
  await expect(page.getByTestId('plan-show')).toHaveCount(0);
  // La ligne se déplace quand même.
  await ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').getByText('Tranche d’âge au-dessus').click();
  await expect(ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
});

test('le plan tient dans un écran de téléphone', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan mobile');
  await seedPlan(request, id);
  await page.setViewportSize({ width: 390, height: 800 });
  const { view, moveOf } = await openPlan(page, id);
  await moveOf('MINI Léa').getByTestId('plan-move-modify').click();
  await expect(moveOf('MINI Léa').getByTestId('plan-move-target')).toBeVisible();
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="plan-show"], [data-testid="plan-view"], [data-testid="plan-view"] *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName} ${e.getAttribute('data-testid') ?? ''} ${(e.textContent ?? '').slice(0, 30)}`).slice(0, 8));
  expect(wide).toEqual([]);
  await expect(view.getByTestId('plan-band')).toHaveCount(3);
  // Rien de coupé dans le plan, ni sur téléphone ni sur grand écran.
  // (Les boutons des cartes de cas débordent déjà à 390 px : seul le plan est vérifié ici.)
  const cut = await view.evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || !el.textContent?.trim()) return false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible') continue;
      return (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && r.right > a.getBoundingClientRect().right + 1;
    }
    return false;
  }).map((el) => `${el.tagName} « ${el.textContent!.trim().slice(0, 40)} »`));
  expect(cut).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await clipped(page)).toEqual([]);
});

const regIn = (request: APIRequestContext, id: string) => async (data: object) =>
  (await (await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', source: 'manual', ...data },
  })).json()).row as { id: string; fighterId: string };

test('appliquer : la confirmation montre ce qui diffère de l’écran', async ({ page, request }) => {
  // À l’écran : MINI monte chez CADA (à valider), qui reste. Sans MINI, CADA rejoint les -54 : absent de l’écran.
  // WALID (pesé 59 kg) part en -63 au-delà de l’écart (à valider) : YANIS, laissé seul, rejoint les -52 (sans validation) ;
  // sans la correction, YANIS n’est pas seul : son déplacement n’est pas appliqué.
  const id = await createCompetition(page, 'Coupe plan différences');
  const reg = regIn(request, id);
  await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  await reg({ lastName: 'CADA', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  for (const [n, kg] of [['PIA', 50], ['PAULA', 50.5]] as const) await reg({ lastName: n, weightClassId: 'cadet:F:-54', approxWeightKg: kg });
  const boy = { firstName: 'Paul', sex: 'M' };
  const w = await reg({ ...boy, lastName: 'WALID', weightClassId: 'cadet:M:-57', approxWeightKg: 56 });
  await reg({ ...boy, lastName: 'YANIS', weightClassId: 'cadet:M:-57', approxWeightKg: 56 });
  for (const n of ['SAMI', 'SACHA']) await reg({ ...boy, lastName: n, weightClassId: 'cadet:M:-63', approxWeightKg: 53 });
  for (const [n, kg] of [['BASILE', 51], ['BRUNO', 51.5]] as const) await reg({ ...boy, lastName: n, weightClassId: 'cadet:M:-52', approxWeightKg: kg });
  await request.put(`/api/competitions/${id}/weigh-in/${w.fighterId}`, { data: { weighInKg: 59 } });
  const { view, moveOf } = await openPlan(page, id);
  await expect(moveOf('YANIS Paul')).toBeVisible();
  await expect(view.getByTestId('plan-move').filter({ hasText: 'CADA Léa' })).toHaveCount(0);
  await view.getByTestId('plan-apply').click();
  const dialog = page.getByRole('dialog');
  await expect(page.getByTestId('plan-apply-confirm')).toHaveText('Confirmer (1)');
  await expect(dialog.getByTestId('plan-apply-move').filter({ hasText: 'CADA Léa' })).toContainText('(pas à l’écran)');
  const skipped = dialog.getByTestId('plan-apply-skipped');
  await expect(skipped).toContainText('Ne sera pas appliqué, sans les déplacements à valider non validés :');
  await expect(skipped).toContainText('YANIS Paul');
  await expect(skipped).not.toContainText('MINI Léa');
  await expect(skipped).not.toContainText('WALID Paul');
  await expect(dialog).toContainText('2 déplacements à valider non validés restent en attente dans le plan.');
});

test('valider un déplacement qui suit une correction de poids : gardé, puis appliqué après elle', async ({ page, request }) => {
  // WANDA (pesée 58 kg) quitte les -54 pour les -61 : YVETTE y reste seule, et ne peut que monter chez les juniors.
  const id = await createCompetition(page, 'Coupe plan chaîne');
  const reg = regIn(request, id);
  const w = await reg({ lastName: 'WANDA', weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ lastName: 'YVETTE', weightClassId: 'cadet:F:-54', approxWeightKg: 53 });
  for (const [n, kg] of [['SOFIA', 58], ['SARAH', 58.5]] as const) await reg({ lastName: n, weightClassId: 'cadet:F:-61', approxWeightKg: kg });
  for (const [n, kg] of [['JADE', 52], ['JULIA', 52.5]] as const) await reg({ lastName: n, ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: kg });
  await request.put(`/api/competitions/${id}/weigh-in/${w.fighterId}`, { data: { weighInKg: 58 } });
  const { view: rules } = await (await request.post(`/api/competitions/${id}/replacement/plan`, { data: { choices: [] } })).json();
  await request.put(`/api/competitions/${id}/replacement/rules`, { data: { ...rules, on: { ...rules.on, weightGap: false } } });
  const { view, moveOf } = await openPlan(page, id);
  await moveOf('YVETTE Léa').getByTestId('plan-move-validate').click();
  await expect(moveOf('YVETTE Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  await expect(view).toContainText('Validés 1 / 1');
  await expect(view.getByTestId('plan-dropped')).toHaveCount(0);
  await expect(moveOf('WANDA Léa')).toBeVisible();
  await view.getByTestId('plan-apply').click();
  await expect(page.getByTestId('plan-apply-confirm')).toHaveText('Confirmer (2)');
  await page.getByTestId('plan-apply-confirm').click();
  await expect(page.getByText('2 réaffectations appliquées.')).toBeVisible();
  await expect(page.getByText('Aucun cas à traiter')).toBeVisible();
});

test('« Modifier » sans règle à valider : pas compté dans « Validés »', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan modifier simple');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  await expect(view).toContainText('Validés 0 / 2');
  const seule = moveOf('SEULE Léa');
  await seule.getByTestId('plan-move-modify').click();
  await seule.getByTestId('plan-move-target').click();
  await page.getByRole('option', { name: /Cadets F · \+61 kg/ }).click();
  await expect(seule.getByTestId('plan-move-unchoose')).toBeVisible();
  await expect(view.locator('[data-testid="plan-band"][data-band="0"]')).toContainText('SEULE Léa');
  await expect(view).toContainText('Validés 0 / 2');
});

test('« Modifier » : seulement les catégories de la session choisie', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan modifier session');
  const reg = regIn(request, id);
  await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  await reg({ lastName: 'SEULE', weightClassId: 'cadet:F:-61', approxWeightKg: 58 });
  for (const n of ['LOURDEA', 'LOURDEB']) await reg({ lastName: n, weightClassId: 'cadet:F:+61', approxWeightKg: 60 });
  await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior'], disciplines: [] } },
  ] });
  await page.goto(`/competitions/${id}/reaffectation`);
  await page.getByTestId('replacement-wave').getByText('Après-midi', { exact: true }).click();
  await page.getByTestId('plan-show').click();
  const seule = page.getByTestId('plan-view').getByTestId('plan-move').filter({ hasText: 'SEULE Léa' });
  await seule.getByTestId('plan-move-modify').click();
  await seule.getByTestId('plan-move-target').click();
  await expect(page.getByRole('option', { name: /Cadets F · \+61 kg/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Minimes/ })).toHaveCount(0);
  // Sur la carte, le déplacement manuel garde toutes les catégories (avec leur session).
  const card = page.getByTestId('replacement-case').filter({ hasText: 'SEULE' });
  await page.keyboard.press('Escape');
  await card.getByTestId('manual-move-all').click({ force: true });
  await card.getByTestId('manual-move-select').click();
  await expect(page.getByRole('option', { name: /Minimes.*session Matin/ })).toBeVisible();
});

test('cartes : correction de poids au-delà de l’écart à confirmer comme une validation ; « ↓ Âge » pour la tranche au-dessous', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe cartes badges');
  const reg = regIn(request, id);
  // WANDA (pesée 58 kg) : les -61 pèsent 52 kg, la correction dépasse l’écart de poids (à valider).
  const w = await reg({ lastName: 'WANDA', weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  for (const n of ['SOFIA', 'SARAH']) await reg({ lastName: n, weightClassId: 'cadet:F:-61', approxWeightKg: 52 });
  await request.put(`/api/competitions/${id}/weigh-in/${w.fighterId}`, { data: { weighInKg: 58 } });
  // MINA, minime seule, peut descendre chez les benjamines.
  await reg({ lastName: 'MINA', ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
  for (const [n, kg] of [['BENA', 37], ['BENB', 38]] as const) await reg({ lastName: n, ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', approxWeightKg: kg });
  await page.goto(`/competitions/${id}/reaffectation`);
  const correction = page.getByTestId('replacement-case').filter({ hasText: 'WANDA' }).getByTestId('replacement-proposal').filter({ hasText: 'validation manuelle' }).first();
  await expect(correction.getByTestId('replacement-badge')).toContainText('⚖ Poids');
  await correction.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('proposal-confirm')).toHaveText('Confirmer la validation');
  await page.keyboard.press('Escape');
  const down = page.getByTestId('replacement-case').filter({ hasText: 'MINA' }).getByTestId('replacement-proposal').filter({ hasText: 'une tranche au-dessous' });
  await expect(down.getByTestId('replacement-badge')).toHaveText('↓ Âge');
});

test('réglages : enregistrer garde la liste des règles changée entre-temps dans Réaffectation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe réglages et règles');
  await page.goto(`/competitions/${id}/reglages`);
  await page.getByTestId('shobu-to-jiyu').click({ force: true });
  // Pendant ce temps, la Table centrale range la liste et active le mélange filles / garçons.
  const { view } = await (await request.post(`/api/competitions/${id}/replacement/plan`, { data: { choices: [] } })).json();
  const order = ['return', 'ageUp', ...view.order.filter((r: string) => r !== 'return' && r !== 'ageUp')];
  expect((await request.put(`/api/competitions/${id}/replacement/rules`, { data: { ...view, order, cutAfter: 'ageUp', on: { ...view.on, mixSexes: true } } })).ok()).toBe(true);
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();
  const { settings } = await (await request.get(`/api/competitions/${id}`)).json();
  expect(settings.shobuToJiyu).toBe(true);
  expect(settings.mixSexes.enabled).toBe(true);
  expect(settings.replacementRules).toMatchObject({ order, cutAfter: 'ageUp' });
});
