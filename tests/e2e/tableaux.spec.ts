import { expect, test, type APIRequestContext } from '@playwright/test';
import { createCompetition } from './helpers.js';

async function seed(request: APIRequestContext, id: string) {
  const club = async (name: string) => (await (await request.post(`/api/competitions/${id}/clubs`, { data: { name } })).json()).id as string;
  const tani = await club('Tani Dojo');
  const others = [await club('Issa'), await club('Shinsengumi')];
  const reg = (data: object) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...data },
    });
  await reg({ clubId: tani, lastName: 'TANI1' });
  await reg({ clubId: tani, lastName: 'TANI2' });
  await reg({ clubId: others[0], lastName: 'ISSA' });
  await reg({ clubId: others[1], lastName: 'SHIN' });
  await reg({ clubId: others[1], lastName: 'KATA', discipline: 'kata', ruleset: null, weightClassId: null });
}

test('tableaux : catégories, séparation des clubs, format, tirage, prête, impression', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe tableaux');
  await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  await expect(page.getByTestId('category-row')).toHaveCount(2);
  await expect(page.getByTestId('category-row').filter({ hasText: 'Kata' }).getByTestId('category-alone')).toBeVisible();

  await page.getByTestId('category-row').filter({ hasText: '-54' }).click();
  const matches = page.getByTestId('bracket-match');
  await expect(matches).toHaveCount(3);
  // Tableau en arbre : demi-finales reliées à la finale.
  await expect(page.getByTestId('bracket-tree')).toBeVisible();
  await expect(page.locator('.bracket-slot.has-next')).toHaveCount(2);
  // 1er tour : les deux Tani Dojo ne s'affrontent pas.
  for (const i of [0, 1]) await expect(matches.nth(i)).not.toContainText(/TANI1[\s\S]*TANI2|TANI2[\s\S]*TANI1/);

  await page.getByTestId('category-format').click();
  await page.getByRole('option', { name: 'Poule (tous contre tous)' }).click();
  await expect(matches).toHaveCount(6);

  const before = await page.getByTestId('bracket-entrant').allTextContents();
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    await page.getByTestId('category-redraw').click();
    await page.waitForTimeout(200);
    changed = (await page.getByTestId('bracket-entrant').allTextContents()).join() !== before.join();
  }
  expect(changed).toBe(true);

  await page.getByTestId('category-ready').click();
  await expect(page.getByTestId('category-row').filter({ hasText: '-54' }).getByTestId('category-status')).toHaveText('Prête');

  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section')).toHaveCount(1); // le kata seul n'est pas imprimé
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button')).toHaveCount(0);
  await page.goto(`/competitions/${id}/impression?categories=${(await (await request.get(`/api/competitions/${id}/categories`)).json()).map((c: { id: string }) => c.id).join(',')}`);
  await expect(page.getByTestId('print-section')).toHaveCount(2);
});

test('impression : un grand tableau tient sur une page A4 paysage', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe grands tableaux');
  for (let i = 0; i < 17; i++) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `GRAND${i}`, firstName: 'Combattante', sex: 'F', ageBandCode: 'senior', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-55', source: 'manual' },
    });
  }
  for (let i = 0; i < 9; i++) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName: `DOUBLE${i}`, firstName: 'Combattant', sex: 'M', ageBandCode: 'senior', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:M:-75', source: 'manual' },
    });
  }
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; registrationIds: string[] }[];
  const nine = cats.find((c) => c.registrationIds.length === 9)!;
  await request.patch(`/api/competitions/${id}/categories/${nine.id}`, { data: { format: 'double_elimination' } });

  await page.setViewportSize({ width: 1123, height: 794 });
  await page.goto(`/competitions/${id}/impression`);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('print-section')).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('print-fit')).toHaveCount(2);
  for (const box of await page.getByTestId('print-fit').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.width).toBeLessThanOrEqual(1050);
    expect(box.height).toBeLessThanOrEqual(660);
  }
});

test('impression : poule en grille croisée, kata sans badge', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe grille');
  for (let i = 0; i < 3; i++) {
    await request.post(`/api/competitions/${id}/registrations`, { data: { clubId: null, lastName: `POULE${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' } });
    await request.post(`/api/competitions/${id}/registrations`, { data: { clubId: null, lastName: `KATA${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' } });
  }
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section')).toHaveCount(2);
  await expect(page.getByTestId('pool-grid')).toHaveCount(1);
  await expect(page.getByTestId('print-section').filter({ hasText: 'Kata' }).locator('.mantine-Badge-root')).toHaveCount(0);
});

test('impression : nom de la zone sur le tableau', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe zones impression');
  const reg = (lastName: string, weightClassId: string) =>
    request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: null, lastName, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId, source: 'manual' },
    });
  for (let i = 0; i < 4; i++) await reg(`ZONE${i}`, 'cadet:F:-54');
  for (let i = 0; i < 2; i++) await reg(`SANS${i}`, 'cadet:F:-61');
  const zones = (await (await request.get(`/api/competitions/${id}/zones`)).json()) as { id: string; name: string }[];
  await request.put(`/api/competitions/${id}/zones`, { data: [{ id: zones[0]!.id, name: 'Ring' }, { id: zones[1]!.id, name: zones[1]!.name }] });
  const cats = (await (await request.get(`/api/competitions/${id}/categories`)).json()) as { id: string; label: string }[];
  const withZone = cats.find((c) => c.label.includes('-54'))!;
  const without = cats.find((c) => c.label.includes('-61'))!;
  await request.patch(`/api/competitions/${id}/categories/${withZone.id}`, { data: { zoneId: zones[0]!.id } });
  await page.goto(`/competitions/${id}/impression`);
  await expect(page.getByTestId('print-section').filter({ hasText: withZone.label })).toContainText('Zone : Ring');
  // Non épinglée : la zone de la répartition automatique (l'autre zone, moins chargée).
  await expect(page.getByTestId('print-section').filter({ hasText: without.label })).toContainText('Zone : Tatami 2');
});
