import { expect, type Page } from '@playwright/test';
import { fillClubForm } from '../helpers/club-form-fill.js';

export type Cells = (string | number | null)[];

/** En-tête d'une fiche : club, coach, téléphone, e-mail, pré-accord. */
export const HEADER = ['TANI DOJO', 'DUPONT Marc', '0600000001', 'coach@tani.example', 'Non'];
/** Colonnes : nom, prénom, sexe, âge, poids, combat, kata, grade, règlement. */
export const LEA: Cells = ['MARTIN', 'Léa', 'Féminin', 'Cadets', 52, 'Karaté', 'Oui', '2e kyu', 'Jiyu'];
export const LUCA: Cells = ['ROSSI', 'Luca', 'Masculin', 'Cadets', 60, 'Karaté', 'Non', null, 'Jiyu'];
export const NOAH: Cells = ['PETIT', 'Noah', 'Masculin', 'Cadets', 50, 'Karaté', 'Non', null, 'Jiyu'];

/** Télécharge le modèle de la compétition et le remplit (nouveau format). */
export async function filledForm(page: Page, id: string, header: (string | null)[], lines: Cells[]): Promise<Buffer> {
  const response = await page.request.get(`/api/competitions/${id}/club-form.ods`);
  expect(response.ok()).toBe(true);
  return fillClubForm(Buffer.from(await response.body()), header, lines, 'new');
}

/** Ouvre « Fiche club », la fenêtre de départ, choisit le club (par son nom dans la liste) et la fiche remplie. */
export async function openStart(page: Page, id: string, club: string | null, file: Buffer) {
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByTestId('club-form-import-open').click();
  const start = page.getByTestId('club-form-start');
  if (club) {
    await start.getByTestId('club-picker').getByLabel('Club').click();
    await page.getByRole('option', { name: club, exact: true }).click();
  }
  await page.getByTestId('club-form-file').setInputFiles({ name: 'fiche.ods', mimeType: 'application/octet-stream', buffer: file });
  return start;
}

export const clubsOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/competitions/${id}/clubs`)).json()) as { id: string; name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; preApproval: boolean }[];

export const registrationsOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/competitions/${id}/registrations`)).json()) as { discipline: string; ruleset: string | null; approxWeightKg: number | null; source: string; fighter: { lastName: string } }[];
