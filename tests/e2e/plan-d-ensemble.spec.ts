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
    await expect(ladder.getByTestId('ladder-bar')).toHaveCount(0);
    const first = rows.first();
    await expect(first).toHaveAttribute('data-rule', 'return');
    // Le retour est la ligne de départ : sans numéro, toujours fait.
    await expect(first.getByTestId('ladder-start')).toContainText('Au départ, corrections imposées');
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
    await expect(mine.getByTestId('ladder-start')).toContainText('Au départ, corrections imposées');
    await expect(mine.getByTestId('ladder-bar').first()).toBeVisible();

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
  await expect(ladder.getByTestId('ladder-start')).toContainText('Au départ, corrections imposées');
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="rule-ladder"], [data-testid="rule-ladder"] *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName} ${e.getAttribute('data-testid') ?? ''} ${(e.textContent ?? '').slice(0, 30)}`).slice(0, 8));
  expect(wide).toEqual([]);
  const box = await ladder.boundingBox();
  for (const bar of await ladder.getByTestId('ladder-bar').all()) {
    const b = await bar.boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
  // La progression d’un calcul long arrive dans une place gardée : rien ne bouge sous elle.
  const row = ladder.locator('[data-testid="ladder-row"][data-rule="mixSexes"]');
  const top = () => row.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
  await page.route('**/replacement/plan', slowPlan(2000));
  await row.getByTestId('ladder-switch').click({ force: true });
  const y = await top();
  await expect(page.getByTestId('plan-progress')).toBeVisible();
  expect(await top()).toBe(y);
  const wideNow = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="plan-progress"], [data-testid="plan-progress"] *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
  expect(wideNow).toBe(0);
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
  const bar = (rule: string) => ladder.locator(`[data-testid="ladder-row"][data-rule="${rule}"]`).getByTestId('ladder-bar');
  // En-tête du tableau, ligne de départ (aucune correction imposée ici) : 3 seuls à caser.
  await expect(ladder.getByTestId('ladder-header')).toContainText('Combattants : casés · restent seuls');
  await expect(ladder.getByTestId('ladder-start-detail')).toHaveText('aucune correction');
  await expect(bar('return')).toHaveAttribute('data-alone', '3');
  await expect(bar('return')).toHaveAttribute('data-placed', '0');
  await expect(bar('weight')).toHaveAttribute('data-alone', '2');
  await expect(bar('weight')).toHaveAttribute('data-placed', '1');
  await expect(bar('weight').getByTestId('ladder-alone')).toHaveText('2 seuls');
  await expect(bar('weightGap')).toHaveAttribute('data-alone', '2');
  await expect(bar('ageUp')).toHaveAttribute('data-alone', '1');
  // Casés découpés par couleur : un par la règle sans validation, un par la tranche d’âge.
  expect(await bar('ageUp').getByTestId('ladder-segment').evaluateAll((els) => els.map((e) => [e.getAttribute('data-band'), e.textContent]))).toEqual([['0', '1'], ['1', '1']]);
  await expect(bar('seniorsVeterans')).toHaveAttribute('data-alone', '0');
  await expect(bar('seniorsVeterans').getByTestId('ladder-alone')).toHaveCount(0);
  // Une règle désactivée (sans barre) garde ses colonnes : interrupteur aligné sur celui d’une règle active.
  const switchX = async (rule: string) => (await ladder.locator(`[data-testid="ladder-row"][data-rule="${rule}"]`).getByTestId('ladder-switch').boundingBox())!.x;
  expect(await switchX('mixSexes')).toBeCloseTo(await switchX('weight'), 0);
  // « Retour » n’a pas de numéro : « Catégorie de poids voisine » est la règle 1.
  await expect(ladder.locator('[data-testid="ladder-row"][data-rule="weight"]')).toContainText('1Catégorie de poids voisine');
  const show = page.getByTestId('plan-show');
  await expect(show).toHaveText('Voir le plan jusqu’à la règle 7 (3 déplacements, 0 seul)');
  await show.click();
  const view = page.getByTestId('plan-view');
  await expect(view).toContainText('Restent seuls 0 (au lieu de 3)');
  await expect(view).toContainText('Déplacements 3');
  await expect(view).toContainText('Validés 0 / 2');
  // Groupes du plus coûteux au moins coûteux, avec les règles qu’ils couvrent.
  const bands = view.getByTestId('plan-band');
  expect(await bands.evaluateAll((els) => els.map((e) => e.getAttribute('data-band')))).toEqual(['3', '1', '0']);
  await expect(bands.nth(0)).toContainText('Concessions fortes');
  await expect(bands.nth(0)).toContainText('règle 6 · 1 déplacement');
  await expect(bands.nth(0)).toContainText('VETE Paul');
  await expect(bands.nth(1)).toContainText('Concessions légères');
  await expect(bands.nth(1)).toContainText('règles 3–4 · 1 déplacement');
  await expect(bands.nth(1)).toContainText('MINI Léa');
  await expect(bands.nth(1)).toContainText('Tranche d’âge au-dessus');
  await expect(bands.nth(1)).toContainText('Minimes → Cadets');
  await expect(bands.nth(2)).toContainText('Sans validation');
  await expect(bands.nth(2)).toContainText('règles 1–2 · 1 déplacement');
  await expect(bands.nth(2)).toContainText('SEULE Léa');
  await expect(view.getByTestId('plan-move').filter({ hasText: 'SEULE Léa' }).getByTestId('plan-move-validate')).toHaveCount(0);

  // La ligne remonte sous « Tranche d’âge au-dessus » : VETE n’est plus déplacé, MINI change de couleur.
  await ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').getByText('Tranche d’âge au-dessus').click();
  await expect(show).toHaveText('Voir le plan jusqu’à la règle 4 (2 déplacements, 1 seul)');
  await expect(view.getByTestId('plan-move')).toHaveCount(2);
  await expect(view.getByTestId('plan-changes')).toContainText('VETE Paul n’est plus déplacé.');
  await expect(view.getByTestId('plan-alone')).toContainText('VETE Paul');
  await expect(view.locator('[data-testid="plan-band"][data-band="3"]')).toContainText('MINI Léa');
  await expect(view.getByTestId('plan-proven')).toHaveText('Aucune combinaison dans ces règles ne laisse moins de 1 seul.');
});

test('coupure sous la ligne de départ : seulement les corrections imposées', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan départ');
  await seedPlan(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const ladder = page.getByTestId('rule-ladder');
  await ladder.getByTestId('ladder-start').click();
  await expect(ladder.locator('[data-testid="ladder-row"][data-rule="return"]').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
  await expect(page.getByTestId('plan-show')).toHaveText('Voir le plan des corrections imposées (0 déplacement, 3 seuls)');
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
  // Les déplacements appliqués ne sont pas signalés comme « n’est plus déplacé ».
  await expect(view.getByText(/n’est plus déplacé/)).toHaveCount(0);
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
  // Le refus ne vaut que pour le plan : la carte propose toujours ce déplacement.
  const card = page.getByTestId('replacement-case').filter({ hasText: 'VETE' });
  await expect(card.getByTestId('replacement-proposal-refused')).toHaveCount(0);
  await expect(card.getByTestId('replacement-proposal').first()).toBeVisible();
  // Gardé sur le poste.
  await page.reload();
  await page.getByTestId('plan-show').click();
  await expect(view.getByTestId('plan-refused')).toContainText('VETE Paul');
  // La raison ne répète pas le nom, comme dans les lignes du plan.
  await expect(view.getByTestId('plan-refused')).not.toContainText('VETE Paul :');
  await view.getByTestId('plan-unrefuse').click();
  await expect(view.getByTestId('plan-move')).toHaveCount(3);
  await expect(view.getByTestId('plan-unrefuse')).toHaveCount(0);
  await expect(moveOf('VETE Paul')).toBeVisible();
});

test('refus du plan gardé après « Appliquer le plan »', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan refus appliqué');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  await moveOf('VETE Paul').getByTestId('plan-move-refuse').click();
  await expect(view.getByTestId('plan-move')).toHaveCount(2);
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await view.getByTestId('plan-apply').click();
  await page.getByTestId('plan-apply-confirm').click();
  await expect(page.getByText('2 réaffectations appliquées.')).toBeVisible();
  // Le refus reste ; la validation appliquée n’est plus un choix.
  await expect(view.getByTestId('plan-refused')).toContainText('VETE Paul');
  await expect(view.getByTestId('plan-move')).toHaveCount(0);
  await expect(page.getByTestId('plan-restart-choices')).toBeEnabled();
});

test('« Recommencer le plan » efface validations, modifications et refus du plan', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan recommencer');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  const restart = page.getByTestId('plan-restart-choices');
  await expect(restart).toBeDisabled();
  // Validation d'abord : un « Modifier » de SEULE vers -47 ne la défait pas (les choix sont fixés avant le calcul).
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  await moveOf('VETE Paul').getByTestId('plan-move-refuse').click();
  await moveOf('SEULE Léa').getByTestId('plan-move-modify').click();
  await moveOf('SEULE Léa').getByTestId('plan-move-target').click();
  await page.getByRole('option', { name: /Cadets F · -47 kg/ }).click();
  await expect(moveOf('SEULE Léa')).toContainText('hors règles');
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  await page.getByTestId('plan-card-decisions').uncheck();
  await restart.click();
  // Plus aucun choix : le plan revient à son calcul de départ ; la coche ne bouge pas.
  await expect(view.getByTestId('plan-move')).toHaveCount(3);
  await expect(view.getByTestId('plan-unrefuse')).toHaveCount(0);
  await expect(moveOf('SEULE Léa')).not.toContainText('hors règles');
  await expect(moveOf('MINI Léa').getByTestId('plan-move-validate')).toBeVisible();
  await expect(page.getByTestId('plan-card-decisions')).not.toBeChecked();
  await expect(restart).toBeDisabled();
});

test('coche décochée : le plan reprend une proposition refusée sur la carte et une carte mise de côté', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan coche');
  await seedPlan(request, id);
  const { view, moveOf } = await openPlan(page, id);
  const cards = page.getByTestId('replacement-case');
  // Refus sur la carte de VETE, carte de MINI mise de côté.
  const vete = cards.filter({ hasText: 'VETE' });
  await vete.getByTestId('replacement-proposal').filter({ hasText: /seniors|Seniors/ }).first().getByTestId('proposal-refuse').click();
  await expect(vete.getByTestId('replacement-proposal-refused')).toHaveCount(1);
  await cards.filter({ hasText: 'MINI' }).getByTestId('case-set-aside').click();
  await page.getByTestId('case-set-aside-confirm').click();
  await expect(moveOf('VETE Paul')).toHaveCount(0);
  await expect(moveOf('MINI Léa')).toHaveCount(0);
  const box = page.getByTestId('plan-card-decisions');
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(moveOf('VETE Paul')).toBeVisible();
  await expect(moveOf('MINI Léa')).toBeVisible();
  // Les cartes ne changent pas.
  await expect(vete.getByTestId('replacement-proposal-refused')).toHaveCount(1);
  await expect(page.getByTestId('set-aside-section')).toContainText('Mises de côté (1)');
  await box.check();
  await expect(moveOf('VETE Paul')).toHaveCount(0);
  await expect(view.getByTestId('plan-move')).toHaveCount(1);
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

/** Retarde de `ms` chaque calcul du plan demandé par la page (la demande peut être annulée pendant ce temps). */
const slowPlan = (ms: number) => async (route: import('@playwright/test').Route) => {
  await new Promise((r) => setTimeout(r, ms));
  try { await route.fallback(); } catch { /* demande annulée */ }
};
const isPlanPost = (r: import('@playwright/test').Request) => r.url().endsWith('/replacement/plan') && r.method() === 'POST';

test('annuler un calcul long : le plan affiché est signalé périmé, « Relancer le calcul » le remet à jour', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan annulé');
  await seedPlan(request, id);
  const { view } = await openPlan(page, id);
  const apply = view.getByTestId('plan-apply');
  await expect(apply).toBeEnabled();
  const sent: { at: number; req: import('@playwright/test').Request }[] = [];
  page.on('request', (r) => { if (isPlanPost(r)) sent.push({ at: Date.now(), req: r }); });
  const slow = slowPlan(5000);
  await page.route('**/replacement/plan', slow);
  const ladder = page.getByTestId('rule-ladder');
  const switchOf = (rule: string) => ladder.locator(`[data-testid="ladder-row"][data-rule="${rule}"]`).getByTestId('ladder-switch');
  const mix = switchOf('mixSexes');
  const mixWas = await mix.isChecked();
  const first = sent.length;
  await mix.click({ force: true });
  // Le geste se voit tout de suite, sans attendre le calcul (5 s).
  await expect(mix).toBeChecked({ checked: !mixWas, timeout: 1000 });
  await expect(apply).toBeDisabled();
  await expect(page.getByTestId('plan-progress')).toBeVisible();
  await expect.poll(() => sent.length).toBe(first + 1);
  // Un second geste pendant le calcul : l’interrupteur répond aussitôt (vraie souris, rien ne le recouvre), son nouvel état se
  // voit, et il relance le calcul bien avant la fin du premier.
  const weight = switchOf('weight');
  const weightWas = await weight.isChecked();
  await ladder.locator('[data-testid="ladder-row"][data-rule="weight"]').locator('.mantine-Switch-track').click({ timeout: 1000 });
  await expect(weight).toBeChecked({ checked: !weightWas, timeout: 1000 });
  await expect(mix).toBeChecked({ checked: !mixWas });
  await expect.poll(() => sent.length).toBe(first + 2);
  expect(sent[first + 1]!.at - sent[first]!.at).toBeLessThan(4000);
  // Les deux changements sont enregistrés (le second ne défait pas le premier).
  const { settings } = await (await request.get(`/api/competitions/${id}`)).json();
  expect(settings.mixSexes.enabled).toBe(!mixWas);
  expect(settings.replacementRules.off.includes('weight')).toBe(weightWas);
  await expect(page.getByTestId('plan-progress')).toBeVisible();
  const aborted = page.waitForEvent('requestfailed', (r) => r === sent[first + 1]!.req);
  await page.getByRole('button', { name: 'Annuler le calcul' }).click();
  const message = page.getByText('Calcul annulé : le plan affiché ne tient pas compte de votre dernier changement.');
  // L'annulation arrête vraiment la demande (et ne se contente pas de lever un drapeau).
  await aborted;
  await expect(message).toBeVisible({ timeout: 1000 });
  await expect(apply).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Annuler le calcul' })).toHaveCount(0);
  // Un autre poste écrit : le plan annulé n’est pas relancé (seuls un geste d’ici ou « Relancer le calcul » le relancent).
  const before = sent.length;
  await request.post(`/api/competitions/${id}/registrations`, {
    data: { clubId: null, lastName: 'TARDIVE', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', approxWeightKg: 50, source: 'onsite' },
  });
  await expect(page.getByTestId('replacement-case').filter({ hasText: 'TARDIVE' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(sent.length).toBe(before);
  await expect(message).toBeVisible();
  await expect(apply).toBeDisabled();
  await page.unroute('**/replacement/plan', slow);
  await page.getByRole('button', { name: 'Relancer le calcul' }).click();
  await expect(message).toHaveCount(0);
  await expect(apply).toBeEnabled();
  // Le plan relancé voit l’inscription de l’autre poste (4 seuls au départ au lieu de 3).
  await expect(view).toContainText('(au lieu de 4)');

  // Annuler de nouveau, puis un geste : tout calcul complet efface l’annulation, même pour le même choix.
  await page.route('**/replacement/plan', slow);
  await mix.click({ force: true });
  await page.getByRole('button', { name: 'Annuler le calcul' }).click();
  await expect(message).toBeVisible();
  await page.unroute('**/replacement/plan', slow);
  await mix.click({ force: true });
  await expect(message).toHaveCount(0);
  await expect(apply).toBeEnabled();

  // Les choix du plan restent aussi utilisables pendant un calcul (chacun le relance) ; seul « Appliquer le plan » attend.
  await page.route('**/replacement/plan', slow);
  await mix.click({ force: true });
  await expect(page.getByTestId('plan-progress')).toBeVisible();
  const mini = view.getByTestId('plan-move').filter({ hasText: 'MINI Léa' });
  const n = sent.length;
  await mini.getByTestId('plan-move-validate').click({ timeout: 1000 });
  await expect(mini.getByTestId('plan-move-unvalidate')).toBeVisible({ timeout: 1000 });
  await expect.poll(() => sent.length).toBe(n + 1);
  await expect(apply).toBeDisabled();
  await page.unroute('**/replacement/plan', slow);
});

test('un calcul en cours n’est pas relancé par l’écriture d’un autre poste : un seul nouveau calcul part à sa fin', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan en direct');
  await seedPlan(request, id);
  const { view } = await openPlan(page, id);
  const sent: import('@playwright/test').Request[] = [];
  const failed: import('@playwright/test').Request[] = [];
  page.on('request', (r) => { if (isPlanPost(r)) sent.push(r); });
  page.on('requestfailed', (r) => { if (isPlanPost(r)) failed.push(r); });
  await page.route('**/replacement/plan', slowPlan(3000));
  await page.getByTestId('rule-ladder').locator('[data-testid="ladder-row"][data-rule="mixSexes"]').getByTestId('ladder-switch').click({ force: true });
  await expect.poll(() => sent.length).toBe(1);
  // Deux écritures d’un autre poste pendant le calcul.
  for (const data of [
    { lastName: 'TARDIVE', firstName: 'Léa', sex: 'F', weightClassId: 'cadet:F:-54', approxWeightKg: 50 },
    { lastName: 'TARDIF', firstName: 'Paul', sex: 'M', weightClassId: 'cadet:M:-57', approxWeightKg: 55 },
  ]) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', source: 'onsite', ...data },
    });
  }
  // Les autres données sont relues tout de suite ; le calcul continue.
  await expect(page.getByTestId('replacement-case').filter({ hasText: 'TARDIF' })).toBeVisible();
  expect(sent.length).toBe(1);
  // À sa fin, un seul nouveau calcul, qui voit les deux inscriptions.
  await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(2);
  await expect(view.getByTestId('plan-apply')).toBeEnabled({ timeout: 10_000 });
  await expect(view).toContainText('(au lieu de 5)');
  await expect(view).toContainText('TARDIF Paul');
  await page.waitForTimeout(500);
  expect(sent.length).toBe(2);
  expect(failed).toEqual([]);
});

test('sans plan (calcul en erreur), la liste des règles reste réglable', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan en erreur');
  await seedPlan(request, id);
  await page.route('**/replacement/plan', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Calcul impossible' }) }));
  await page.goto(`/competitions/${id}/reaffectation`);
  const ladder = page.getByTestId('rule-ladder');
  await expect(ladder.getByTestId('ladder-row')).toHaveCount(11);
  await expect(ladder.getByTestId('ladder-bar')).toHaveCount(0);
  await expect(page.getByTestId('api-error').first()).toContainText('Calcul impossible');
  await expect(page.getByTestId('plan-show')).toHaveCount(0);
  // La ligne se déplace quand même.
  await ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').getByText('Tranche d’âge au-dessus').click();
  await expect(ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
  // Et au clavier : le nom de la règle est un bouton (Entrée ou Espace).
  const cutHere = ladder.getByRole('button', { name: 'S’arrêter après « Mélange seniors / vétérans »' });
  await expect(cutHere).toHaveAttribute('aria-pressed', 'false');
  await cutHere.focus();
  await page.keyboard.press('Enter');
  await expect(ladder.locator('[data-testid="ladder-row"][data-rule="seniorsVeterans"]').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
  await expect(cutHere).toHaveAttribute('aria-pressed', 'true');
  await ladder.getByRole('button', { name: 'S’arrêter après « Catégorie de poids voisine »' }).press('Space');
  await expect(ladder.locator('[data-testid="ladder-row"][data-rule="weight"]').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'ladder-cut');
  const { settings } = await (await request.get(`/api/competitions/${id}`)).json();
  expect(settings.replacementRules.cutAfter).toBe('weight');
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
  await expect(down).toContainText('âge : une tranche au-dessous');
  await expect(down).not.toContainText('une tranche au-dessus');
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

test('plan : mentions « pré-accord coach », « règle désactivée » et « sous la ligne »', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan mentions');
  const club = await (await request.post(`/api/competitions/${id}/clubs`, { data: { name: 'Club accord', preApproval: true } })).json() as { id: string };
  const reg = regIn(request, id);
  await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45, clubId: club.id });
  for (const n of ['CADA', 'CADB']) await reg({ lastName: n, weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const man = { firstName: 'Paul', sex: 'M', approxWeightKg: 74 };
  await reg({ ...man, lastName: 'VETE', ageBandCode: 'v1', weightClassId: 'v1:M:-75' });
  for (const n of ['SENA', 'SENB']) await reg({ ...man, lastName: n, ageBandCode: 'senior', weightClassId: 'senior:M:-75' });
  const { view, moveOf } = await openPlan(page, id);
  // Club au pré-accord : la montée d’âge de MINI le porte, pas le mélange seniors / vétérans de VETE (club sans pré-accord).
  await expect(moveOf('MINI Léa')).toContainText('pré-accord coach');
  await expect(moveOf('VETE Paul')).not.toContainText('pré-accord coach');
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await moveOf('VETE Paul').getByTestId('plan-move-validate').click();
  await expect(view).toContainText('Validés 2 / 2');
  const ladder = page.getByTestId('rule-ladder');
  // La ligne remonte sous « Tranche d’âge au-dessus » : VETE, épinglé, reste, « sous la ligne ».
  await ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').getByText('Tranche d’âge au-dessus').click();
  await expect(moveOf('VETE Paul')).toContainText('sous la ligne');
  await expect(moveOf('MINI Léa')).not.toContainText('sous la ligne');
  // La règle de MINI désactivée : MINI, épinglée, reste, « règle désactivée ».
  await ladder.locator('[data-testid="ladder-row"][data-rule="ageUp"]').getByTestId('ladder-switch').click({ force: true });
  await expect(moveOf('MINI Léa')).toContainText('règle désactivée');
  await expect(moveOf('VETE Paul')).toContainText('sous la ligne');
  await expect(view.getByTestId('plan-move')).toHaveCount(2);
  await expect(view).toContainText('Validés 2 / 2');
});

/** Deux sessions : le matin MINI (minime) peut monter chez les cadettes ; l’après-midi VETE (vétéran) peut rejoindre les seniors. */
async function seedSessions(request: APIRequestContext, id: string) {
  const reg = regIn(request, id);
  const mini = await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  for (const n of ['CADA', 'CADB']) await reg({ lastName: n, weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const man = { firstName: 'Paul', sex: 'M', approxWeightKg: 74 };
  await reg({ ...man, lastName: 'VETE', ageBandCode: 'v1', weightClassId: 'v1:M:-75' });
  for (const n of ['SENA', 'SENB']) await reg({ ...man, lastName: n, ageBandCode: 'senior', weightClassId: 'senior:M:-75' });
  const waves = await (await request.put(`/api/competitions/${id}/waves`, { data: [
    { name: 'Matin', rules: { ageBandCodes: ['minime', 'cadet'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['senior', 'v1'], disciplines: [] } },
  ] })).json() as { id: string; name: string }[];
  return { mini, morning: waves.find((w) => w.name === 'Matin')!.id };
}

/** Choisit la session et (ré)ouvre le plan (l’écran se recharge à chaque session). */
async function openSession(page: Page, name: string) {
  await page.getByTestId('replacement-wave').getByText(name, { exact: true }).click();
  await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
  const show = page.getByTestId('plan-show');
  await expect(show).toBeVisible();
  if ((await show.getAttribute('aria-expanded')) !== 'true') await show.click();
  await expect(page.getByTestId('plan-view')).toBeVisible();
}

test('plan : les choix sont gardés par session', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan sessions');
  await seedSessions(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const session = (name: string) => openSession(page, name);
  await session('Matin');
  const view = page.getByTestId('plan-view');
  const moveOf = (name: string) => view.getByTestId('plan-move').filter({ hasText: name });
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  await expect(view).toContainText('Validés 1 / 1');
  // L’après-midi a ses propres choix (aucun).
  await session('Après-midi');
  await expect(moveOf('VETE Paul').getByTestId('plan-move-validate')).toBeVisible();
  await expect(view.getByTestId('plan-move').filter({ hasText: 'MINI Léa' })).toHaveCount(0);
  await expect(view).toContainText('Validés 0 / 1');
  await moveOf('VETE Paul').getByTestId('plan-move-validate').click();
  await expect(view).toContainText('Validés 1 / 1');
  // De retour le matin, l’épingle de MINI est toujours là ; et l’après-midi, celle de VETE (gardées sur le poste, page rechargée).
  await session('Matin');
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  await page.reload();
  await session('Après-midi');
  await expect(moveOf('VETE Paul').getByTestId('plan-move-unvalidate')).toBeVisible();
});

test('plan : un choix devenu impossible est retiré et nommé, dans sa session seulement', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan choix retiré');
  const { mini, morning } = await seedSessions(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const session = (name: string) => openSession(page, name);
  await session('Matin');
  const view = page.getByTestId('plan-view');
  const moveOf = (name: string) => view.getByTestId('plan-move').filter({ hasText: name });
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await expect(view).toContainText('Validés 1 / 1');
  // Un autre poste pointe MINI absente : son déplacement épinglé n’existe plus.
  const put = await request.put(`/api/competitions/${id}/weigh-in/${mini.fighterId}`, { data: { presence: 'absent', waveId: morning } });
  expect(put.status(), await put.text()).toBe(204);
  const dropped = view.getByTestId('plan-dropped');
  await expect(dropped).toHaveText('Certains choix ne sont plus possibles et ont été retirés : MINI Léa.');
  await expect(view.getByTestId('plan-move')).toHaveCount(0);
  // Le message ne suit pas dans l’autre session, et le choix retiré ne revient pas.
  await session('Après-midi');
  await expect(moveOf('VETE Paul')).toBeVisible();
  await expect(view.getByTestId('plan-dropped')).toHaveCount(0);
  await session('Matin');
  await expect(view.getByTestId('plan-move-unvalidate')).toHaveCount(0);
});

test('réglages : une relecture pendant une saisie ne l’efface pas, et l’enregistrement garde ce qu’un autre poste a changé', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe réglages relus');
  await page.goto(`/competitions/${id}/reglages`);
  const place = page.getByLabel('Lieu', { exact: true });
  await place.fill('Dojo de la saisie');
  // Pendant ce temps, un autre poste renomme la compétition ; l’onglet revient au premier plan (relecture des données).
  expect((await request.patch(`/api/competitions/${id}`, { data: { name: 'Coupe renommée ailleurs' } })).ok()).toBe(true);
  const reread = page.waitForResponse((r) => r.url().endsWith(`/api/competitions/${id}`) && r.request().method() === 'GET');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await reread;
  await page.waitForTimeout(300);
  await expect(place).toHaveValue('Dojo de la saisie');
  await page.getByTestId('settings-save').click();
  await expect(page.getByText('Réglages enregistrés')).toBeVisible();
  const c = await (await request.get(`/api/competitions/${id}`)).json();
  expect(c.location).toBe('Dojo de la saisie');
  expect(c.name).toBe('Coupe renommée ailleurs');
  // Le formulaire reprend la compétition enregistrée.
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Coupe renommée ailleurs');
});

test('un geste sur les règles pendant le premier calcul d’un choix le relance : le plan final tient compte des deux', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe plan geste et choix');
  await seedPlan(request, id);
  const { view: rules } = await (await request.post(`/api/competitions/${id}/replacement/plan`, { data: { choices: [] } })).json();
  await request.put(`/api/competitions/${id}/replacement/rules`, { data: { ...rules, on: { ...rules.on, mixSexes: false } } });
  const { view, moveOf } = await openPlan(page, id);
  const apply = view.getByTestId('plan-apply');
  await expect(apply).toBeEnabled();
  const sent: import('@playwright/test').Request[] = [];
  const failed: import('@playwright/test').Request[] = [];
  page.on('request', (r) => { if (isPlanPost(r)) sent.push(r); });
  page.on('requestfailed', (r) => { if (isPlanPost(r)) failed.push(r); });
  const slow = slowPlan(3000);
  await page.route('**/replacement/plan', slow);
  // Valider : un nouveau choix, donc un calcul encore sans résultat.
  await moveOf('MINI Léa').getByTestId('plan-move-validate').click();
  await expect.poll(() => sent.length).toBe(1);
  const row = page.getByTestId('rule-ladder').locator('[data-testid="ladder-row"][data-rule="mixSexes"]');
  const sw = row.getByTestId('ladder-switch');
  await sw.click({ force: true });
  await expect(sw).toBeChecked({ timeout: 1000 });
  // Règle activée pas encore calculée : une ligne active, la barre en attente.
  await expect(row.getByTestId('ladder-pending')).toBeVisible();
  await expect(row).toContainText('pas encore calculée');
  // Le geste arrête le calcul commencé avant lui et en relance un, bien avant la fin du premier.
  await expect.poll(() => sent.length, { timeout: 2000 }).toBe(2);
  await expect.poll(() => failed.includes(sent[0]!)).toBe(true);
  await page.unroute('**/replacement/plan', slow);
  await expect(apply).toBeEnabled({ timeout: 10_000 });
  await expect(sw).toBeChecked();
  await expect(row.getByTestId('ladder-pending')).toHaveCount(0);
  await expect(row.getByTestId('ladder-bar')).toBeVisible();
  await expect(moveOf('MINI Léa').getByTestId('plan-move-unvalidate')).toBeVisible();
  const { settings } = await (await request.get(`/api/competitions/${id}`)).json();
  expect(settings.mixSexes.enabled).toBe(true);

  // Pendant l’enregistrement d’une règle (avant le recalcul), « Appliquer le plan » attend aussi.
  const slowPut = async (route: import('@playwright/test').Route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  };
  await page.route('**/replacement/rules', slowPut);
  const n = sent.length;
  await sw.click({ force: true });
  await expect(apply).toBeDisabled({ timeout: 500 });
  expect(sent.length).toBe(n);
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(n + 1);
  await expect(apply).toBeEnabled({ timeout: 10_000 });
  await expect(sw).not.toBeChecked();
  await page.unroute('**/replacement/rules', slowPut);
});

test('réglages : une zone ajoutée ailleurs pendant une saisie n’est jamais supprimée sans être vue', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe relecture des zones');
  await page.goto(`/competitions/${id}/reglages`);
  const names = page.getByTestId('zone-name');
  const zones = await (await request.get(`/api/competitions/${id}/zones`)).json() as { id: string; name: string; disciplines: string[] | null }[];
  await expect(names).toHaveCount(zones.length);
  await names.first().fill('Tatami A');
  expect((await request.put(`/api/competitions/${id}/zones`, {
    data: [...zones.map((z) => ({ id: z.id, name: z.name, disciplines: z.disciplines })), { name: 'Zone ailleurs', disciplines: null }],
  })).ok()).toBe(true);
  const reread = page.waitForResponse((r) => r.url().endsWith(`/api/competitions/${id}/zones`) && r.request().method() === 'GET');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await reread;
  await page.waitForTimeout(300);
  // La saisie reste ; l’enregistrement est refusé au lieu de supprimer la zone qu’il n’a pas vue.
  await expect(names).toHaveCount(zones.length);
  await expect(names.first()).toHaveValue('Tatami A');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('api-error')).toContainText('Les zones ont été modifiées ailleurs entre-temps');
  const after = await (await request.get(`/api/competitions/${id}/zones`)).json() as { name: string }[];
  expect(after.map((z) => z.name)).toContain('Zone ailleurs');
  // Saisie défaite à la main : le formulaire reprend les zones enregistrées.
  await names.first().fill(zones[0]!.name);
  await expect(names).toHaveCount(zones.length + 1);
  await expect(names.last()).toHaveValue('Zone ailleurs');
});

test('la page : compteurs, puis ① Plan automatique, puis ② Cas un par un', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe deux blocs');
  await seedPlan(request, id);
  await page.goto(`/competitions/${id}/reaffectation`);
  const summary = page.getByTestId('replacement-summary');
  const planStep = page.getByTestId('replacement-step-plan');
  const cardsStep = page.getByTestId('replacement-step-cards');
  await expect(planStep).toContainText('① Plan automatique');
  await expect(planStep).toContainText('Le cas général : choisissez jusqu’où vont les règles, vérifiez le plan, puis appliquez-le.');
  await expect(cardsStep).toContainText('② Cas un par un : ce que le plan ne règle pas');
  await expect(cardsStep).toContainText('Une fois le plan appliqué, les combattants encore seuls sont ici, carte par carte.');
  await expect(planStep.getByTestId('rule-ladder')).toBeVisible();
  await expect(planStep.getByTestId('plan-card-decisions')).toBeVisible();
  await expect(cardsStep.getByTestId('replacement-case').first()).toBeVisible();
  await expect(planStep.getByTestId('replacement-case')).toHaveCount(0);
  const y = async (l: ReturnType<typeof page.getByTestId>) => (await l.boundingBox())!.y;
  expect(await y(summary)).toBeLessThan(await y(planStep));
  expect(await y(planStep)).toBeLessThan(await y(cardsStep));
  // Mises de côté dans ② ; l'historique (« Repartir de zéro ») sous les deux blocs, hors d'eux.
  await cardsStep.getByTestId('replacement-case').first().getByTestId('case-set-aside').click();
  await page.getByTestId('case-set-aside-confirm').click();
  await expect(cardsStep.getByTestId('set-aside-section')).toBeVisible();
  await page.getByTestId('plan-show').click();
  await page.getByTestId('plan-apply').click();
  await page.getByTestId('plan-apply-confirm').click();
  const reset = page.getByTestId('replacement-reset');
  await expect(reset).toBeVisible();
  await expect(planStep.getByTestId('replacement-reset')).toHaveCount(0);
  await expect(cardsStep.getByTestId('replacement-reset')).toHaveCount(0);
  expect(await y(reset)).toBeGreaterThan(await y(cardsStep));
  // Téléphone : rien de coupé.
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await clipped(page)).toEqual([]);
});

test('une annulation refusée dans l’historique : l’erreur dans sa fenêtre, pas dans le bloc des cartes', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe annulation refusée');
  await seedPlan(request, id);
  const { view } = await openPlan(page, id);
  await view.getByTestId('plan-apply').click();
  await page.getByTestId('plan-apply-confirm').click();
  await expect(page.getByText('1 réaffectation appliquée.')).toBeVisible();
  await page.route('**/replacement/undo', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Catégorie déjà lancée' }) }));
  await page.getByTestId('recasement-undo').first().click();
  await page.getByTestId('recasement-undo-confirm').click();
  await expect(page.getByRole('dialog').getByTestId('api-error')).toContainText('Catégorie déjà lancée');
  await expect(page.getByTestId('replacement-step-cards').getByTestId('api-error')).toHaveCount(0);
});
