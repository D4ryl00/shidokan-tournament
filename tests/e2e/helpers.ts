import { expect, type Page } from '@playwright/test';

export async function createCompetition(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByTestId('new-competition').click();
  await page.getByTestId('competition-name').fill(name);
  await page.getByTestId('competition-submit').click();
  const row = page.getByTestId('competition-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name }).click();
  await expect(page).toHaveURL(/\/competitions\/[^/]+\/reglages$/);
  return page.url().split('/')[4]!;
}

/** Étape de chaque onglet d'une compétition (barre du haut : Préparer, Jour J, Après). */
const STAGE_OF: Record<string, string> = {
  Inscriptions: 'preparer', Clubs: 'preparer', 'Fiche club': 'preparer', 'Import FFK': 'preparer', Sessions: 'preparer', 'Grille âge / poids': 'preparer', Réglages: 'preparer',
  Pesée: 'jour-j', Réaffectation: 'jour-j', Tableaux: 'jour-j', Combats: 'jour-j', Podiums: 'apres',
};

/** Ouvre un onglet d'une compétition, en passant par son étape s'il n'est pas affiché. */
export async function openTab(page: Page, label: string): Promise<void> {
  const tab = page.getByRole('tab', { name: label, exact: true });
  if (!(await tab.isVisible())) await page.getByTestId(`stage-${STAGE_OF[label]}`).click();
  await tab.click();
}

/** Choisit le thème dans le menu du thème. */
export async function chooseTheme(page: Page, label: 'Auto' | 'Clair' | 'Sombre'): Promise<void> {
  await page.getByTestId('theme-toggle').click();
  await page.getByRole('menuitem', { name: label }).click();
}
