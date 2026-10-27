import { expect, type Page } from '@playwright/test';
import { CONTACTS_SCOPE } from '../../src/domain/app-settings.js';

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
  if (!(await tab.isVisible())) {
    await page.getByTestId(`stage-${STAGE_OF[label]}`).click();
    // Étape à un seul onglet (Après → Podiums) : pas de barre d'onglets, l'étape ouvre directement l'onglet.
    if (label === 'Podiums') return;
  }
  await tab.click();
}

/** Choisit le thème dans le menu du thème. */
export async function chooseTheme(page: Page, label: 'Auto' | 'Clair' | 'Sombre'): Promise<void> {
  await page.getByTestId('theme-toggle').click();
  await page.getByRole('menuitem', { name: label }).click();
}

/**
 * Texte coupé par des points de suspension (le reste n'est lisible qu'au survol). Le nom de la compétition, dans sa barre,
 * n'est pas compté : il se coupe exprès quand la place manque.
 */
export async function ellipsized(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1)
      .filter((el) => !el.closest('[data-testid="competition-title"]') && el.dataset.testid !== 'competition-title')
      .map((el) => `« ${el.textContent?.trim().slice(0, 60)} »`),
  );
}

/**
 * Contenu coupé par un conteneur qui cache ce qui dépasse (`overflow: hidden`, sans défilement) : texte ou bouton qui sort
 * d'une carte ou d'un tableau, invisible et inatteignable. Un texte coupé exprès (points de suspension) n'est pas compté.
 */
export async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || !el.textContent?.trim()) continue;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.textOverflow === 'ellipsis') break;
        if (cs.overflowX === 'visible') continue;
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 1) out.push(`${el.tagName.toLowerCase()} « ${el.textContent.trim().slice(0, 60)} » dépasse de ${Math.round(r.right - ar.right)} px`);
        }
        break;
      }
    }
    return [...new Set(out)].slice(0, 10);
  });
}

/** Contacts Google simulés pour l'écran de synchronisation : un compte connecté avec le droit sur les contacts, et un aperçu. */
export const GOOGLE_PREVIEW = (() => {
  const club = (id: string, name: string, extra: object) => ({ id, name, coachName: null, coachPhone: null, coachEmail: null, googleContactId: null, version: 1, ...extra });
  const contact = (id: string, name: string, extra: object) => ({ resourceName: `people/${id}`, name, email: null, phone: null, organization: null, groups: ['contactGroups/coachs'], ...extra });
  const marc = contact('marc', 'Marc Durand', { phone: '06 55 66 77 88' });
  const paul = contact('paul', 'Paul Martin', { email: 'paul.martin@exemple.fr' });
  const sophie = contact('sophie', 'Sophie Leroy', { phone: '07 12 34 56 78' });
  const ali = contact('ali', 'Ali Benali', { email: 'ali@exemple.fr' });
  return {
    state: 'ok',
    account: 'orga@gmail.com',
    labels: [{ resourceName: 'contactGroups/coachs', name: 'Coachs' }],
    label: null,
    total: 4,
    preview: {
      diffs: [{ clubId: 'c-lilas', clubName: 'Dojo des Lilas', version: 3, contact: marc, fields: [{ field: 'coachPhone', directory: '06 11 22 33 44', google: '06 55 66 77 88' }] }],
      newContacts: [
        { contact: paul, exact: { clubId: 'c-est', reason: 'email' }, maybe: [] },
        { contact: sophie, exact: null, maybe: [] },
      ],
      pending: [{ contact: ali, exact: null, maybe: [] }],
      linked: [{ contact: marc, clubIds: ['c-lilas'] }],
      clubs: [
        club('c-lilas', 'Dojo des Lilas', { coachName: 'Marc Durand', coachPhone: '06 11 22 33 44', googleContactId: 'people/marc', version: 3 }),
        club('c-est', 'Shidokan Est', { coachName: 'Paul Martin', coachEmail: 'paul.martin@exemple.fr', version: 5 }),
      ],
    },
  };
})();

/** Simule un compte Google connecté (avec le droit sur les contacts) et l'aperçu de la synchronisation ; rend les corps envoyés à « Appliquer ». */
export async function mockGoogleContacts(page: Page, preview: object = GOOGLE_PREVIEW, { status = 'ok' }: { status?: 'ok' | 'reconnect' } = {}): Promise<{ applied: unknown[]; previews: unknown[] }> {
  const applied: unknown[] = [];
  const previews: unknown[] = [];
  await page.route('**/api/app-settings', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (route.request().method() === 'GET') {
      body.googleAvailable = true;
      body.google = { email: 'orga@gmail.com', fromName: 'Shidokan France', status, lastRefreshAt: null, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', CONTACTS_SCOPE] };
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/club-directory/google/preview', async (route) => {
    previews.push(route.request().postDataJSON());
    await route.fulfill({ json: preview });
  });
  await page.route('**/api/club-directory/google/apply', async (route) => {
    applied.push(route.request().postDataJSON());
    await route.fulfill({ json: { updated: 0, linked: 1, created: 1 } });
  });
  return { applied, previews };
}
