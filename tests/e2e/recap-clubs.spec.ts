import { expect, test } from '@playwright/test';
import { createCompetition, inviteWithLink, SERVER_SESSION } from './helpers.js';

// Récapitulatif par mail depuis l'onglet Clubs : serveur en ligne (port 3101), session de l'organisateur ouverte par global-setup.
// Pas de transport de mail factice sur ce serveur : les envois sont interceptés (comme pour les invitations) ; l'envoi réel est couvert par les tests du serveur.
test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

const EMPTY = { affiliationNumber: null, coachName: 'Marc Durand', coachPhone: null, notes: null };

test('onglet Clubs : volet du message, enveloppes (grisée avec sa raison), confirmations et envois', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe récapitulatifs');
  const stamp = Date.now();
  const names = { ok: `Dojo prêt ${stamp}`, noMail: `Dojo sans mail ${stamp}`, empty: `Dojo vide ${stamp}` };
  const clubIds: Record<string, string> = {};
  for (const [key, emails] of [['ok', ['coach@pret.fr', 'pres@pret.fr']], ['noMail', []], ['empty', ['vide@dojo.fr']]] as const) {
    const entry = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: names[key], coachEmails: emails } })).json()) as { id: string };
    clubIds[key] = (await inviteWithLink(request, id, entry.id)).clubId;
  }
  for (const key of ['ok', 'noMail'] as const) {
    await request.post(`/api/competitions/${id}/registrations`, {
      data: { clubId: clubIds[key], lastName: `RECAP${key}`, firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual' },
    });
  }

  const sentTo: string[] = [];
  await page.route(`**/api/competitions/${id}/invitations/*/recap`, async (route) => {
    const clubId = route.request().url().split('/').slice(-2)[0]!;
    sentTo.push(clubId);
    await route.fulfill({ json: { clubId, clubName: names.ok, email: 'coach@pret.fr, pres@pret.fr', status: 'sent', error: null } });
  });
  let job: unknown = null;
  await page.route(`**/api/competitions/${id}/invitations/recaps/send`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { job } });
    const { clubIds } = route.request().postDataJSON() as { clubIds: string[] };
    job = {
      id: 'recap-1', kind: 'recap', startedAt: new Date().toISOString(), total: clubIds.length, finished: true, error: null,
      results: clubIds.map((clubId) => ({ clubId, clubName: names.ok, email: 'coach@pret.fr', status: 'sent', error: null })),
    };
    await route.fulfill({ status: 202, json: job });
  });

  await page.goto(`/competitions/${id}/clubs`);
  const row = (name: string) => page.getByTestId('club-row').filter({ hasText: name });

  // Volet : objet modifié puis enregistré, puis retour au texte de départ.
  const panel = page.getByTestId('recap-message');
  await panel.getByRole('button', { name: /Message du récapitulatif/ }).click();
  await expect(panel.getByTestId('recap-subject')).toHaveValue(/Récapitulatif/);
  await expect(panel.getByTestId('recap-preview')).toBeVisible();
  await panel.getByTestId('recap-subject').fill('Votre récapitulatif e2e');
  await panel.getByTestId('recap-save').click();
  await expect(page.getByText('Message enregistré.')).toBeVisible();
  await expect(panel.getByTestId('recap-preview-subject')).toContainText('Votre récapitulatif e2e');
  await panel.getByTestId('recap-reset').click();
  await expect(panel.getByTestId('recap-subject')).toHaveValue(/^Récapitulatif /);

  // Enveloppes : grisée avec la raison, active sinon.
  await expect(row(names.empty).getByTestId('club-recap-send')).toBeDisabled();
  await expect(row(names.empty).getByTestId('club-recap-send')).toHaveAttribute('title', 'Aucune inscription');
  await expect(row(names.noMail).getByTestId('club-recap-send')).toBeDisabled();
  await expect(row(names.noMail).getByTestId('club-recap-send')).toHaveAttribute('title', 'Pas d’e-mail pour ce club');

  // Un club : confirmation (adresses, objet), envoi, notification.
  await row(names.ok).getByTestId('club-recap-send').click();
  const confirm = page.getByTestId('recap-send-confirm');
  await expect(confirm.getByTestId('recap-send-addresses')).toHaveText('coach@pret.fr, pres@pret.fr');
  await expect(confirm).toContainText('Objet : Récapitulatif');
  await confirm.getByTestId('recap-send-go').click();
  await expect(page.getByText(`Récapitulatif envoyé à ${names.ok}.`)).toBeVisible();
  expect(sentTo).toEqual([clubIds.ok]);

  // Tous les clubs : un seul club part, les deux autres sont sautés avec leur raison.
  await page.getByTestId('recap-send-all').click();
  const all = page.getByTestId('recap-all-confirm');
  await expect(all).toContainText('1 club recevra son récapitulatif');
  await expect(all.getByTestId('recap-skipped')).toContainText(`${names.empty} — Aucune inscription`);
  await expect(all.getByTestId('recap-skipped')).toContainText(`${names.noMail} — Pas d’e-mail pour ce club`);
  await all.getByTestId('recap-all-go').click();
  await expect(page.getByTestId('recap-summary')).toHaveText('1 récapitulatif envoyé.');
});

test('poste local : rien du récapitulatif par mail dans l’onglet Clubs', async ({ page }) => {
  // Le serveur en ligne montre le volet ; l'absence côté local est couverte par le rôle (useAuthMe) : on vérifie ici le cas où le rôle n'est pas « serveur ».
  await page.route('**/api/auth/me', async (route) => {
    const res = await route.fetch();
    const me = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...me, role: 'local' } });
  });
  const id = await createCompetition(page, 'Coupe sans récapitulatif');
  await page.goto(`/competitions/${id}/clubs`);
  await expect(page.getByTestId('recap-message')).toHaveCount(0);
  await expect(page.getByTestId('recap-send-all')).toHaveCount(0);
});
