import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
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
  // Choisir de nouveau le même fichier refait la tentative.
  await input().setInputFiles({ name: 'dessin.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(page.getByText('Format d’image non accepté : JPEG, PNG, WebP ou GIF.')).toHaveCount(2);
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
  // En mode code : ni image, ni annuler/rétablir.
  await expect(page.getByRole('button', { name: 'Image' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled();
  await input().setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await drawnImage(page, 'image/png') });
  await expect(page.getByText('Revenez à l’éditeur pour ajouter une image.')).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<p>Code propre</p><script>alert(1)</script><img src="https://e.fr/a.png">');
  await page.getByRole('button', { name: 'Code source (HTML)' }).click();
  await expect(page.getByText(/Retiré du code :/)).toBeVisible();
  await expect(editor).toContainText('Code propre');
  await expect(editor).not.toContainText('<p>');
  await expect(save).toBeEnabled();
  // Annuler après la sortie du mode code ne ramène pas le code comme texte.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(editor).toContainText('Code propre');
  await expect(editor).not.toContainText('<p>');
  await expect(editor.locator('img[src^="/api/mail-images/"]')).toHaveCount(0);
  await save.click();
  await expect(page.getByText('Message enregistré.')).toBeVisible();
  const saved = (await (await request.get(`/api/competitions/${id}`)).json()) as { settings: { invitationMail: { body: string } } };
  expect(saved.settings.invitationMail.body).toContain('Code propre');
  expect(saved.settings.invitationMail.body).not.toMatch(/script|e\.fr|&lt;/);

  // 5. Coller un tableau : signalé, pas de tableau dans le message.
  await expect(page.getByRole('button', { name: /Message aux clubs de cette compétition/ })).toBeVisible();
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

/** Une compétition avec un club invité (nom propre à chaque test), son message ouvert. Renvoie ses identifiants. */
async function openedMessage(page: Page, request: APIRequestContext, name: string, club: string) {
  const id = await createCompetition(page, name);
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const directory = (await (await request.post('/api/club-directory', { data: { ...EMPTY, name: `${club} ${Date.now()}`, coachEmails: ['coach@exemple.example'] } })).json()) as { id: string };
  const [link] = (await (await request.post(`/api/competitions/${id}/invitations`, { data: { directoryIds: [directory.id] } })).json()) as { clubId: string }[];
  await page.goto(`/competitions/${id}/fiche-club`);
  await page.getByRole('button', { name: /Message aux clubs de cette compétition/ }).click();
  const editor = page.getByTestId('mail-editor').locator('.ProseMirror');
  await expect(editor.locator('p').first()).toBeVisible();
  return { id, clubId: link!.clubId, editor };
}

const pasteHtml = (editor: Locator, html: string) =>
  editor.evaluate((el, h) => {
    const data = new DataTransfer();
    data.setData('text/html', h);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);

test('liens et couleurs : www. et adresse e-mail complétés, adresse refusée dite, {lien} par la fenêtre de lien, aperçu inerte, retrait annoncé à l’enregistrement', async ({ page, request }) => {
  const { id, clubId, editor } = await openedMessage(page, request, 'Liens Nagoya', 'Dojo Nagoya');
  const setLink = async (address: string) => {
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Lien', exact: true }).click();
    await page.getByPlaceholder('https://… ou {lien}').fill(address);
    await page.getByRole('button', { name: 'Valider' }).click();
  };
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Inscrivez-vous');

  await setLink('www.club.fr');
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://www.club.fr');
  await setLink('contact@club.fr');
  await expect(editor.locator('a')).toHaveAttribute('href', 'mailto:contact@club.fr');
  // Refusées : dit, et le lien précédent ne change pas.
  await setLink('tel:0102030405');
  await expect(page.getByText(/Adresse de lien refusée/)).toBeVisible();
  await expect(editor.locator('a')).toHaveAttribute('href', 'mailto:contact@club.fr');

  // Le lien personnel derrière un mot : gardé à l'enregistrement, sans retrait annoncé.
  await setLink('{lien}');
  await expect(editor.locator('a')).toHaveAttribute('href', '{lien}');
  await page.getByRole('checkbox', { name: /^Choisir Dojo Nagoya/ }).check();
  await page.getByRole('button', { name: 'Enregistrer pour cette compétition' }).click();
  await expect(page.getByText('Message enregistré.')).toBeVisible();
  await expect(page.getByText(/Retiré du message/)).toHaveCount(0);
  const stored = async () => ((await (await request.get(`/api/competitions/${id}`)).json()) as { settings: { invitationMail: { body: string } } }).settings.invitationMail.body;
  expect(await stored()).toContain('href="{lien}"');
  await expect(editor.locator('a')).toHaveAttribute('href', '{lien}');
  const mailto = (await (await request.post(`/api/competitions/${id}/invitations/${clubId}/mailto`, { data: {} })).json()) as { body: string };
  expect(mailto.body).toMatch(/Inscrivez-vous \(https?:\/\/[^)]*\/inscription\/[^)]+\)/);

  // Aperçu : un clic sur un lien ne quitte pas la page.
  const url = page.url();
  await page.getByTestId('invitation-preview').locator('a').click();
  await expect(page.getByTestId('invitation-preview')).toBeVisible();
  expect(page.url()).toBe(url);

  // Couleur nommée collée : gardée. Couleur que le filtre ne connaît pas : retirée, et dit à l'enregistrement.
  await editor.click();
  await pasteHtml(editor, '<p><span style="color: red">rouge</span></p>');
  await expect(editor.locator('span', { hasText: 'rouge' })).toHaveAttribute('style', /color: red/);
  await pasteHtml(editor, '<p><span style="color: var(--x)">variable</span></p>');
  await expect(editor).toContainText('variable');
  await page.getByRole('button', { name: 'Enregistrer pour cette compétition' }).click();
  await expect(page.getByText('Retiré du message : style non permis.')).toBeVisible();
  await expect(page.getByText('Message enregistré.').first()).toBeVisible();
  const body = await stored();
  expect(body).toContain('color:red');
  expect(body).not.toContain('var(--x)');
});

test('réglages : retrait annoncé à l’enregistrement et visible sans recharger ; modification non enregistrée signalée', async ({ page, request }) => {
  const original = ((await (await request.get('/api/app-settings')).json()) as { invitationMail: unknown }).invitationMail;
  await page.goto('/parametres');
  const editor = page.getByTestId('mail-editor').locator('.ProseMirror');
  await expect(editor.locator('p').first()).toContainText('Bonjour');
  await expect(page.getByTestId('texts-unsaved')).toHaveCount(0);

  // Avertissement avant de quitter une page modifiée.
  await page.getByLabel('Objet').fill('Objet modifié');
  await expect(page.getByTestId('texts-unsaved')).toBeVisible();
  const dialogs: string[] = [];
  page.once('dialog', (d) => {
    dialogs.push(d.type());
    void d.accept();
  });
  await page.reload();
  expect(dialogs).toEqual(['beforeunload']);
  await expect(page.getByLabel('Objet')).not.toHaveValue('Objet modifié');

  await editor.locator('p').first().click();
  await pasteHtml(editor, '<p><span style="color: var(--x)">variable</span></p>');
  await expect(editor.locator('span', { hasText: 'variable' })).toHaveAttribute('style', /var\(--x\)/);
  await expect(page.getByTestId('texts-unsaved')).toBeVisible();
  await page.getByTestId('mail-editor').locator('xpath=ancestor::*[@id="clubs"]').getByRole('button', { name: /Enregistrer/ }).first().click();
  await expect(page.getByText('Retiré du message : style non permis.')).toBeVisible();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();
  await expect(page.getByTestId('texts-unsaved')).toHaveCount(0);
  // L'éditeur montre aussitôt ce que le serveur a gardé.
  await expect(editor).toContainText('variable');
  await expect(editor.locator('span[style*="var(--x)"]')).toHaveCount(0);

  await request.patch('/api/app-settings', { data: { invitationMail: original } });
});

test('brouillon du message : quitter l’onglet demande confirmation ; les fenêtres d’envoi et de messagerie préviennent', async ({ page, request }) => {
  const WARNING = 'Le message affiché n’est pas enregistré : c’est la dernière version enregistrée qui partira.';
  const { editor } = await openedMessage(page, request, 'Brouillon Osaka', 'Dojo Osaka');
  await page.getByRole('checkbox', { name: /^Choisir Dojo Osaka/ }).check();
  const openSend = async () => {
    await page.getByTestId('send-invitations').click();
    return page.getByRole('dialog', { name: 'Envoyer le lien par mail' });
  };
  const openMailto = async () => {
    await page.getByRole('button', { name: 'Ouvrir dans ma messagerie' }).click();
    return page.getByRole('dialog', { name: 'Ouvrir dans ma messagerie' });
  };

  // Rien de modifié : ni avertissement, ni confirmation.
  let dialog = await openSend();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('unsaved-message-warning')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  await editor.locator('p').first().click();
  await page.keyboard.type('Brouillon ');
  dialog = await openSend();
  await expect(dialog.getByTestId('unsaved-message-warning')).toHaveText(WARNING);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  dialog = await openMailto();
  await expect(dialog.getByTestId('unsaved-message-warning')).toHaveText(WARNING);
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
  await expect(page.getByTestId('leave-confirm')).toBeVisible();
  await page.getByTestId('leave-stay').click();
  await expect(editor).toContainText('Brouillon');

  await page.getByRole('button', { name: 'Enregistrer pour cette compétition' }).click();
  await expect(page.getByText('Message enregistré.')).toBeVisible();
  dialog = await openSend();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('unsaved-message-warning')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
  await expect(page).toHaveURL(/\/reglages$/);
});

test('fichiers : dépôt hors liste refusé sans quitter la page, image copiée reçue comme fichier, GPS retiré d’un petit JPEG, envoi visible et enregistrement bloqué', async ({ page, request }) => {
  const { editor } = await openedMessage(page, request, 'Images Sendai', 'Dojo Sendai');
  const images = editor.locator('img[src^="/api/mail-images/"]');

  // Un PDF déposé : refus, l'événement est pris (le navigateur n'ouvre pas le fichier).
  const prevented = await editor.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(['%PDF-1.4'], 'affiche.pdf', { type: 'application/pdf' }));
    const box = el.getBoundingClientRect();
    return !el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left + 5, clientY: box.top + 5 }));
  });
  expect(prevented).toBe(true);
  await expect(page.getByText('Format d’image non accepté : JPEG, PNG, WebP ou GIF.')).toBeVisible();
  await expect(images).toHaveCount(0);

  // « Copier l'image » : un fichier et une balise img dans le presse-papiers. Le fichier est pris, rien n'est annoncé comme retiré.
  await editor.locator('p').first().click();
  const png = (await drawnImage(page, 'image/png')).toString('base64');
  await editor.evaluate((el, b64) => {
    const data = new DataTransfer();
    data.setData('text/html', '<meta charset="utf-8"><img src="https://e.fr/photo.png" alt="photo">');
    data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
  await expect(images).toHaveCount(1);
  await expect(page.getByText(/Retiré du collage/)).toHaveCount(0);

  // Pendant l'envoi : indicateur, enregistrement bloqué ; ensuite, de nouveau possible. Un JPEG porteur d'un segment Exif arrive sans.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/mail-images', async (route) => {
    await held;
    await route.continue();
  });
  const save = page.getByRole('button', { name: 'Enregistrer pour cette compétition' });
  const jpeg = await drawnImage(page, 'image/jpeg');
  const marker = Buffer.from('Exif\0\0GPSMARQUE');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, marker.length + 2]), marker]);
  await page.getByTestId('mail-editor-image-input').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]) });
  await expect(page.getByTestId('mail-image-uploading')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(page.getByText('Image en cours d’envoi : vous pourrez enregistrer ensuite.')).toBeVisible();
  release();
  await expect(images).toHaveCount(2);
  await expect(page.getByTestId('mail-image-uploading')).toHaveCount(0);
  await expect(save).toBeEnabled();
  const uploaded = await (await request.get((await images.nth(1).getAttribute('src'))!)).body();
  expect(uploaded.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
  expect(uploaded.includes('GPSMARQUE')).toBe(false);
});

test('un morceau de l’éditeur qui ne charge plus : un message à sa place, le reste de la page reste', async ({ page }) => {
  await page.route(/\/assets\/MailMessageEditor[^/]*\.js/, (route) => route.abort());
  await page.goto('/parametres');
  await expect(page.getByTestId('mail-editor-failed')).toHaveText('L’éditeur n’a pas pu se charger : rechargez la page.');
  await expect(page.getByRole('heading', { name: 'Envoi des mails' })).toBeVisible();
});
