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
