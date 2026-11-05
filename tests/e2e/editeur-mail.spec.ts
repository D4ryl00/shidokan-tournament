import { expect, test, type Page } from '@playwright/test';
import { createCompetition, SERVER_SESSION } from './helpers.js';

test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION });

test('réglages : le message par défaut s’ouvre avec ses paragraphes ; un message non touché n’est pas réenregistré ; le gras est conservé après rechargement', async ({ page }) => {
  const patches: string[] = [];
  page.on('request', (r) => r.method() === 'PATCH' && r.url().includes('/api/app-settings') && patches.push(r.url()));

  await page.goto('/parametres');
  const editor = page.getByTestId('mail-editor').locator('.ProseMirror');
  await expect(editor.locator('p').first()).toContainText('Bonjour');
  expect(await editor.locator('p').count()).toBeGreaterThan(3);
  expect(patches).toEqual([]);

  // Sélectionne la dernière ligne du message (« Shidokan France ») et la met en gras.
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  for (let i = 0; i < 'Shidokan France'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Gras' }).click();
  await page.getByTestId('mail-editor').locator('xpath=ancestor::*[@id="clubs"]').getByRole('button', { name: /Enregistrer/ }).first().click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
  expect(patches.length).toBe(1);

  await page.reload();
  await expect(page.getByTestId('mail-editor').locator('.ProseMirror strong')).toContainText('Shidokan France');
});

/** Image fabriquée par le navigateur (canvas), en base64 : `type` image/png ou image/webp. */
const drawnImage = (page: Page, type: string) =>
  page.evaluate(async (t) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), t));
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }, type).then((b64) => Buffer.from(b64, 'base64'));

test('images et mode code : image, tailles, WebP converti, SVG refusé ; message de compétition ; code filtré ; collage de tableau', async ({ page, request }) => {
  const settingsEditor = () => page.getByTestId('mail-editor').locator('.ProseMirror');
  const saveSettings = () => page.getByTestId('mail-editor').locator('xpath=ancestor::*[@id="clubs"]').getByRole('button', { name: /Enregistrer/ }).first();
  const input = () => page.getByTestId('mail-editor-image-input');

  // 1. Dans les réglages : une image s'affiche, taille Petite, enregistrée et conservée après rechargement.
  await page.goto('/parametres');
  await expect(settingsEditor().locator('p').first()).toContainText('Bonjour');
  await input().setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await drawnImage(page, 'image/png') });
  const image = settingsEditor().locator('img[src^="/api/mail-images/"]');
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(image).toHaveAttribute('width', '400');
  await image.click();
  await page.getByTestId('mail-image-size-small').click();
  await expect(image).toHaveAttribute('width', '200');
  await saveSettings().click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
  await page.reload();
  await expect(settingsEditor().locator('img[src^="/api/mail-images/"]')).toHaveAttribute('width', '200');
  const src = (await settingsEditor().locator('img[src^="/api/mail-images/"]').getAttribute('src'))!;
  expect(src).toMatch(/^\/api\/mail-images\//);

  // 2. Un WebP arrive en JPEG ou PNG ; un SVG est refusé avec le message.
  await input().setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: await drawnImage(page, 'image/webp') });
  await expect(settingsEditor().locator('img[src^="/api/mail-images/"]')).toHaveCount(2);
  const converted = (await settingsEditor().locator('img[src^="/api/mail-images/"]').nth(1).getAttribute('src'))!;
  expect((await request.get(converted)).headers()['content-type']).toMatch(/^image\/(jpeg|png)$/);
  await input().setInputFiles({ name: 'dessin.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(page.getByText('Format d’image non accepté : JPEG, PNG, WebP ou GIF.')).toBeVisible();
  await expect(settingsEditor().locator('img[src^="/api/mail-images/"]')).toHaveCount(2);
  await page.reload(); // la deuxième image n'a pas été enregistrée : le message des réglages n'a que la première
  await expect(settingsEditor().locator('img[src^="/api/mail-images/"]')).toHaveCount(1);

  // 3. Message d'une compétition : objet puis texte gardés, enregistrés ; l'image des réglages est reprise ; retour au message de l'application.
  const id = await createCompetition(page, 'Messages enrichis Kyoto');
  // Le message ne s'affiche qu'avec au moins un club invité.
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const directory = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `Dojo Kyoto ${Date.now()}`, coachEmails: ['coach@kyoto.example'] } })).json()) as { id: string };
  await request.post(`/api/competitions/${id}/invitations`, { data: { directoryIds: [directory.id] } });
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).click();
  const editor = page.getByTestId('mail-editor').locator('.ProseMirror');
  await expect(editor.locator('img[src^="/api/mail-images/"]')).toHaveAttribute('src', src);
  await page.getByLabel('Objet').fill('Objet propre Kyoto');
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Texte propre Kyoto');
  await page.getByRole('button', { name: 'Enregistrer pour cette compétition' }).click();
  await expect(page.getByText('Message enregistré.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).click();
  await expect(page.getByLabel('Objet')).toHaveValue('Objet propre Kyoto');
  await expect(editor).toContainText('Texte propre Kyoto');
  await expect(editor.locator('img[src^="/api/mail-images/"]')).toHaveAttribute('src', src);
  await page.getByRole('button', { name: 'Revenir au message de l’application' }).click();
  await expect(editor).not.toContainText('Texte propre Kyoto');
  await expect(editor.locator('img[src^="/api/mail-images/"]')).toHaveAttribute('src', src);
  await expect(page.getByLabel('Objet')).not.toHaveValue('Objet propre Kyoto');

  // 4. Mode code : script et image externe retirés à la sortie, enregistrement refusé pendant le mode, rien enregistré comme texte.
  const save = page.getByRole('button', { name: 'Enregistrer pour cette compétition' });
  // Code ouvert puis refermé sans y toucher : le message n'est pas modifié.
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Code source (HTML)' }).click();
  await expect(page.getByText('Revenez à l’éditeur pour enregistrer.')).toBeVisible();
  await page.getByRole('button', { name: 'Code source (HTML)' }).click();
  await expect(page.getByText('Revenez à l’éditeur pour enregistrer.')).toBeHidden();
  await expect(save).toBeDisabled();
  await editor.locator('p').first().click();
  await page.keyboard.type('x'); // rend le message modifié
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: 'Code source (HTML)' }).click();
  await expect(save).toBeDisabled();
  await expect(page.getByText('Revenez à l’éditeur pour enregistrer.')).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<p>Code propre</p><script>alert(1)</script><img src="https://e.fr/a.png">');
  await page.getByRole('button', { name: 'Code source (HTML)' }).click();
  await expect(page.getByText(/Retiré du code :/)).toBeVisible();
  await expect(editor).toContainText('Code propre');
  await expect(editor).not.toContainText('<p>');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Message enregistré.')).toBeVisible();
  const saved = (await (await request.get(`/api/competitions/${id}`)).json()) as { settings: { invitationMail: { body: string } } };
  expect(saved.settings.invitationMail.body).toContain('Code propre');
  expect(saved.settings.invitationMail.body).not.toMatch(/script|e\.fr|&lt;/);

  // 5. Coller un tableau : signalé, pas de tableau dans le message.
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).isVisible();
  await editor.locator('p').first().click();
  await editor.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<table><tr><td>cellule</td></tr></table>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText(/Retiré du collage : tableau/)).toBeVisible();
  await expect(editor.locator('table')).toHaveCount(0);

  // Nettoyage : l'image ne reste pas dans le message des réglages.
  await page.goto('/parametres');
  await settingsEditor().locator('img[src^="/api/mail-images/"]').click();
  await page.keyboard.press('Backspace');
  await expect(settingsEditor().locator('img[src^="/api/mail-images/"]')).toHaveCount(0);
  await saveSettings().click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
});
