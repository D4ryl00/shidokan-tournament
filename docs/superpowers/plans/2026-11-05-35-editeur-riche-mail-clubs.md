# Étape 35 — Éditeur riche du mail aux clubs : plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rédiger le mail aux clubs dans un éditeur riche avec images, l'envoyer mis en forme à chaque club, et réserver les mails et les inscriptions en ligne au serveur.

**Architecture:** Le message garde sa forme `{ subject, body }`, avec un marqueur `format: 'html'` pour le nouveau format. Le serveur filtre le HTML par liste de ce qui est permis, puis construit pour chaque club la version HTML (styles écrits sur les éléments, images en `cid:`) et la version texte. Les images sont dans une table de la base, citées par l'adresse `/api/mail-images/<id>`. Une option `clubServices` (vraie seulement en rôle `serveur`) ouvre ou refuse tout ce qui concerne les mails et les inscriptions en ligne.

**Tech Stack:** `@mantine/tiptap@8.3.18`, Tiptap 3 (`^3.32.3`), `sanitize-html`, `htmlparser2`, nodemailer, Fastify, drizzle, SQLite, Vitest (environnement `node`, pas de DOM), Playwright sur Chrome.

**Spec:** `docs/superpowers/specs/2026-11-05-editeur-riche-mail-clubs-design.md`

## Global Constraints

- Branche `etape-35-editeur-riche`. Interface, messages d'erreur et commentaires en français. Commits conventionnels.
- Barre : celle de `@mantine/tiptap` et **un seul bouton ajouté, l'image**. Aucun autre bouton sur mesure.
- Hors périmètre : police, taille de texte, tableaux, menu de variables.
- Images : 1200 px de large au plus, 2 Mo au plus après réduction, 10 par message, JPEG, PNG, WebP et GIF à l'entrée (WebP converti, GIF jamais réduit, SVG refusé). Tailles d'affichage 200, 400 et 600 px.
- Un mail : 18 Mo au plus pour images + fiches + pièces (Gmail refuse au-delà de 25 Mo une fois encodé, soit un facteur d'environ 1,37).
- Un refus vérifiable (image absente, mail trop lourd) arrive **avant tout envoi et sans créer de lien**.
- Message au format texte : `text` et `html` identiques à aujourd'hui, au caractère près.
- Valeurs des variables toujours échappées dans le HTML. Filtre appliqué à l'enregistrement et à la construction du mail.
- Aucun vrai mail pendant la construction. Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte. Pas de données réelles dans les tests.
- e2e serveur (port 3101) : 10 connexions par IP en 15 minutes : réutiliser une session. Le nom d'une compétition de test ne doit pas contenir celui d'une autre, ni y être contenu.
- Commandes : `npx vitest run <fichier>`, `npm test`, `npm run typecheck`, `npx playwright test <fichier>`, `npm run test:e2e`.

## Review Focus

1. Un club ou un coach nommé `A&B <b>"x"</b>`, dans le texte et dans une adresse de lien : le mail affiche ce nom tel quel, sans HTML injecté → test en tâche 2.
2. `{lien}` dans le texte d'un lien existant, deux fois dans le message, ou comme adresse d'un mot : un lien valide à chaque fois, jamais de lien dans un lien → test en tâche 2.
3. Une image supprimée de la base entre l'édition et l'envoi, ou un message importé sans ses images : aucun mail, aucun lien créé, message clair → test en tâche 4.
4. Le nettoyage pendant qu'un PC a la main, et une image reprise par une compétition puis retirée du message de l'application : aucune image encore citée n'est supprimée → test en tâche 3.
5. Sortie du mode code avec un script ou une image externe, ou enregistrement pendant le mode code : du code n'est jamais enregistré comme texte, et le retrait est signalé → test en tâche 5.

---

### Task 1: Dépendances, format du message et éditeur sans images

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/domain/mail-template-schema.ts`, `src/domain/mail-template.ts`, `src/web/components/InvitationMail.tsx`, `src/web/pages/AppSettingsPage.tsx`, le point d'entrée qui importe les CSS Mantine
- Create: `src/web/components/mail-editor/MailMessageEditor.tsx`, `src/web/components/mail-editor/index.tsx`, `tests/e2e/editeur-mail.spec.ts`
- Modify aussi : `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`
- Test: `tests/domain/mail-template.test.ts`

**Interfaces:**
- Produces: `MailTemplate { subject: string; body: string; format?: 'html' }` ; `mailBodyToHtml(t: Pick<MailTemplate, 'body' | 'format'>): string` dans `src/domain/mail-template.ts` ; `<MailMessageEditor value onChange readOnly? onSourceModeChange? />`, où `value` et `onChange` portent `{ body: string; format: 'html' }`.

- [ ] **Step 1: Installer et vérifier que l'ensemble fonctionne ici.** Installer `@mantine/tiptap@8.3.18`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-text-style`, `@tiptap/extension-highlight`, `@tiptap/extension-text-align`, `@tiptap/extension-image`, `@tiptap/extension-file-handler` (`^3.32.3`), `sanitize-html`, `@types/sanitize-html`, `htmlparser2`, `domhandler`, `dom-serializer`. Run: `npm run typecheck && npm run build`. Expected: succès. **Si l'éditeur ne s'intègre pas à React 19 ou Vite, s'arrêter et revenir vers l'organisateur** (exigence de la spec) ; ne pas changer d'éditeur.

- [ ] **Step 2: Écrire les tests de format qui échouent**

```ts
it('accepte un ancien message sans format et refuse plus de 5000 caractères', () => {
  expect(mailTemplateSchema.safeParse({ subject: 'S', body: 'x' }).success).toBe(true);
  expect(mailTemplateSchema.safeParse({ subject: 'S', body: 'x'.repeat(5001) }).success).toBe(false);
});
it('accepte le format html jusqu’à 100 000 caractères', () => {
  expect(mailTemplateSchema.safeParse({ subject: 'S', body: '<p>x</p>', format: 'html' }).success).toBe(true);
  expect(mailTemplateSchema.safeParse({ subject: 'S', body: 'x'.repeat(100_001), format: 'html' }).success).toBe(false);
});
it('ouvre un ancien texte sans jamais le lire comme du HTML', () => {
  expect(mailBodyToHtml({ body: 'a < b & <b>c</b>' })).toBe(textToHtml('a < b & <b>c</b>'));
  expect(mailBodyToHtml({ body: '<p>x</p>', format: 'html' })).toBe('<p>x</p>');
});
```

- [ ] **Step 3: Vérifier l'échec.** Run: `npx vitest run tests/domain/mail-template.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implémenter le schéma** (strict, limite selon le format) et `mailBodyToHtml`. Run le même test. Expected: PASS.

- [ ] **Step 5: Écrire `MailMessageEditor`.**
  - Extensions : `StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false, strike: false, link: false, heading: { levels: [1, 2, 3] } })`, `Link` de `@mantine/tiptap` avec `openOnClick: false` et `isAllowedUri` qui accepte aussi exactement `{lien}`, `TextStyle`, `Color`, `Highlight`, `TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] })`.
  - Barre (`RichTextEditor.Toolbar sticky`), par groupes : Undo, Redo | H1, H2, H3 | Bold, Italic, Underline, ClearFormatting | ColorPicker, UnsetColor, Highlight | BulletList, OrderedList, Blockquote | AlignLeft, AlignCenter, AlignRight | Link, Unlink | SourceCode.
  - Palette de `ColorPicker` : `#000000 #c0392b #e67e22 #f1c40f #27ae60 #1c5fb8 #8e44ad #7f8c8d`.
  - Le contrôle de surlignage de Mantine n'a qu'une couleur (jaune) : pas de palette de surlignage, écart à noter dans la spec au Step 8.
  - Zone de texte sur fond blanc et texte foncé dans les deux thèmes.
  - Initialisation depuis `mailBodyToHtml(value)` sans déclencher `onChange` : un message non modifié n'est donc pas réenregistré.
  - Chargement par `React.lazy` depuis `index.tsx`, pour que la page publique des clubs n'embarque pas l'éditeur.

- [ ] **Step 6: Brancher l'éditeur** dans `CompetitionMessage` et `TextsCard`. Le formulaire porte `format`, et `CompetitionMessage` remonte l'éditeur après « Enregistrer » ou « Revenir au message de l’application ». L'aperçu reste en dessous, et il n'y en a pas dans les Réglages.

- [ ] **Step 7: Écrire le test e2e sur le rôle `serveur`.** Dans `tests/e2e/global-setup.ts` (Playwright l'exécute après le démarrage des serveurs), connecter une fois `orga@e2e.example` sur le port 3101 et enregistrer la session dans `tmp/e2e-serveur/session-orga.json` ; exporter ce chemin `SERVER_SESSION` depuis `tests/e2e/helpers.ts`. `tests/e2e/editeur-mail.spec.ts`, `baseURL` 3101, avec la session partagée créée au Step 7 de cette tâche : dans les Réglages, le message par défaut s'ouvre avec ses paragraphes ; sélectionner un mot, cliquer sur Gras, enregistrer, recharger. Assertions : le mot est toujours dans `strong`, et un message non touché ne change pas (`PATCH /api/app-settings` absent tant qu'on n'a pas enregistré). Run: `npx playwright test tests/e2e/editeur-mail.spec.ts`. Expected: PASS.

- [ ] **Step 8: Mettre à jour la spec** : migration `0029` (la 0028 est prise) et surlignage d'une seule couleur.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(mail): éditeur riche du message aux clubs (barre de Mantine), format html à côté de l'ancien texte"
```

### Task 2: Filtre et construction du mail

**Files:**
- Create: `src/server/mail-html.ts`
- Test: `tests/server/mail-html.test.ts`

**Interfaces:**
- Consumes: `MailValues` (`src/domain/mail-template.ts`).
- Produces:
  - `cleanMailHtml(html: string): { html: string; removed: string[]; text: string; imageIds: string[] }`, où `removed` contient des libellés lisibles sans doublon (`« script »`, `« table »`, `image externe`, `lien non autorisé`) ;
  - `class MailHtmlError extends Error { statusCode = 400 }` ;
  - `cleanTemplate(t: MailTemplate): MailTemplate`, qui lève `MailHtmlError` si le message est vide (`Le message est vide.`) ou a plus de 10 images (`Au plus 10 images par message.`) ; un message sans `format` est rendu tel quel ;
  - `renderMailHtml(html: string, values: MailValues, imageSrc?: (id: string) => string): { html: string; text: string }`.
  - `mailImageIdsIn(html: string): string[]` et `MAIL_IMAGE_LIMITS`, créés ici dans `src/domain/mail-images.ts` et complétés en tâche 3.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
const v = { club: 'A&B <b>"x"</b>', coach: 'Marie', competition: 'Coupe', date: '22/11/2026', lieu: 'Lyon', date_limite: '01/11/2026', lien: 'https://s.fr/inscription/abc' };
it('garde ce que permet l’éditeur et ne change pas un message déjà filtré', () => {
  const html = '<h1 style="text-align: center">T</h1><p><strong>g</strong> <em>i</em> <u>s</u> <span style="color: #c0392b">c</span> <mark>m</mark></p><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><p><a href="https://x.fr" target="_blank" rel="noopener noreferrer nofollow">l</a></p><p><img src="/api/mail-images/00000000-0000-4000-8000-000000000000" width="400" alt="a"></p>';
  const once = cleanMailHtml(html);
  expect(once.removed).toEqual([]);
  expect(cleanMailHtml(once.html).html).toBe(once.html);
  expect(once.html).toContain('text-align');
  expect(once.html).toContain('color');
  expect(once.imageIds).toEqual(['00000000-0000-4000-8000-000000000000']);
});
it('retire et signale ce qui n’est pas permis', () => {
  const r = cleanMailHtml('<script>x()</script><table><tr><td>t</td></tr></table><img src="https://e.fr/a.png"><img src="data:image/png;base64,AA"><a href="javascript:x()">j</a><p style="position:fixed;color:#000" onclick="x()">p</p><iframe src="https://e.fr"></iframe>');
  expect(r.html).not.toMatch(/script|<table|https:\/\/e\.fr|data:|javascript:|position|onclick|iframe/);
  expect(r.html).toContain('t');
  expect(r.removed).toEqual(expect.arrayContaining(['« script »', '« table »', 'image externe', 'lien non autorisé', '« iframe »']));
});
it('échappe les valeurs dans le texte et dans une adresse de lien', () => {
  const { html, text } = renderMailHtml('<p>{club}</p><p><a href="{lien}">ici</a></p>', v);
  expect(html).toContain('A&amp;B &lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  expect(html).not.toContain('<b>');
  expect(html).toContain('href="https://s.fr/inscription/abc"');
  expect(text).toContain('A&B <b>"x"</b>');
  expect(text).toContain('ici (https://s.fr/inscription/abc)');
});
it('{lien} donne toujours un lien valide, jamais un lien dans un lien', () => {
  const { html } = renderMailHtml('<p>{lien} et {lien}</p><p><a href="https://x.fr">{lien}</a></p>', v);
  expect((html.match(/<a /g) ?? []).length).toBe(3);
  expect(html).not.toMatch(/<a [^>]*>[^<]*<a /);
});
it('écrit les styles sur les éléments et garde les lignes vides', () => {
  const { html } = renderMailHtml('<h1>T</h1><p></p><blockquote><p>q</p></blockquote><p><mark>m</mark></p><p><img src="/api/mail-images/00000000-0000-4000-8000-000000000000" width="400" alt="a"></p>', v, (id) => `cid:${id}@shidokan`);
  expect(html).toMatch(/<h1 style="[^"]*font-size/);
  expect(html).toContain('<p>&nbsp;</p>');
  expect(html).toMatch(/<blockquote style="[^"]*border-left/);
  expect(html).toMatch(/<mark style="[^"]*background-color/);
  expect(html).toContain('src="cid:00000000-0000-4000-8000-000000000000@shidokan"');
  expect(html).toMatch(/<img [^>]*width="400"[^>]*style="[^"]*max-width: ?100%/);
});
it('donne une version texte lisible', () => {
  const { text } = renderMailHtml('<h2>T</h2><p>Bonjour {coach},</p><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><p><img src="/api/mail-images/00000000-0000-4000-8000-000000000000" alt="a"></p>', v);
  expect(text).toBe('T\n\nBonjour Marie,\n\n- a\n\n1. b\n\n> q');
});
it('refuse un message vide ou avec trop d’images', () => {
  expect(() => cleanTemplate({ subject: 'S', body: '<p></p>', format: 'html' })).toThrow('Le message est vide.');
  const imgs = Array.from({ length: 11 }, (_, i) => `<img src="/api/mail-images/00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}">`).join('');
  expect(() => cleanTemplate({ subject: 'S', body: imgs, format: 'html' })).toThrow('Au plus 10 images par message.');
});
```

- [ ] **Step 2: Vérifier l'échec.** Run: `npx vitest run tests/server/mail-html.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implémenter `src/server/mail-html.ts`.**
  - Éléments permis : `p br strong b em i u span mark a ul ol li blockquote h1 h2 h3 img`.
  - Attributs : `a` (`href target rel`) ; `img` (`src width alt`) ; `p h1 h2 h3` (`style`) ; `span` (`style`) ; `mark` (`style data-color`).
  - Styles : `text-align` (`left|center|right`), `color` et `background-color` (`#hex` ou `rgb()`), rien d'autre.
  - Sans cet ajout, `sanitize-html` laisse passer les adresses relatives : `exclusiveFilter` retire un `img` dont le `src` ne correspond pas à `^/api/mail-images/<uuid>$`, et `transformTags` retire le `href` d'un `a` s'il n'est ni `http`, ni `https`, ni `mailto`, ni exactement `{lien}`.
  - `removed` vient d'un premier passage `htmlparser2` sur l'entrée.
  - `renderMailHtml` filtre de nouveau, parcourt l'arbre et remplace les variables dans les nœuds texte et dans `href` ; un `{lien}` hors d'un `a` devient `<a href="url">url</a>`, et dans un `a` il devient le texte de l'adresse. Il ajoute ensuite les styles (`h1` 24 px, `h2` 20 px, `h3` 16 px, marges ; `blockquote` avec `border-left` ; `mark` jaune par défaut ; `img` avec `max-width: 100%; height: auto` ; `p` dans `li` sans marge), remplace les `p` vides par `<p>&nbsp;</p>` et écrit la version texte depuis le même arbre.

- [ ] **Step 4: Vérifier.** Run le même test. Expected: PASS.

- [ ] **Step 5: Filtrer à l'enregistrement.** Dans `PATCH /api/competitions/:id` et `PATCH /api/app-settings`, passer `invitationMail` par `cleanTemplate`. Test dans `tests/server/app-settings.test.ts` : un `PATCH` avec `<script>` enregistre le message sans script ; un `PATCH` vide répond 400 `Le message est vide.` Run: `npx vitest run tests/server/mail-html.test.ts tests/server/app-settings.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit** : `feat(mail): filtre du HTML et construction des versions HTML et texte du mail`.

### Task 3: Stockage et routes des images

**Files:**
- Create: `drizzle/0029_images_mails.sql` (générée), `src/server/repositories/mail-images.ts`, `src/server/routes/mail-images.ts`, `tests/server/mail-images.test.ts`
- Modify: `src/server/db/schema.ts`, `src/server/sync/package.ts`, `src/server/app.ts`, `src/server/repositories/retention.ts`, `src/domain/mail-images.ts`, `tests/server/permissions.test.ts`

**Interfaces:**
- Consumes: `mailImageIdsIn`, `MAIL_IMAGE_LIMITS`, `cleanMailHtml` (tâche 2).
- Produces, dans `src/domain/mail-images.ts` : `MAIL_IMAGE_LIMITS = { maxWidth: 1200, fileBytes: 2 * 1024 * 1024, perMessage: 10, widths: { small: 200, medium: 400, full: 600 } }` ; `mailImageUrl(id: string): string` ; `detectImageType(data: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | null` ; `reducedSize(width: number, height: number): { width: number; height: number }`.
- Produces, dans le dépôt : `addMailImage(db, data: Buffer): { id: string; url: string; size: number }` ; `readMailImage(db, id): { contentType: string; data: Buffer } | null` ; `referencedMailImageIds(db): Set<string>` ; `sweepMailImages(db, now?: Date): number`.
- Routes : `POST /api/mail-images` (corps brut), `GET /api/mail-images/:imageId`, `POST /api/mail-html/check` (`{ html }` → `{ html, removed }`).

- [ ] **Step 1: Écrire les tests qui échouent**
  - `detectImageType` reconnaît JPEG, PNG et GIF par leurs premiers octets, et refuse SVG, WebP et un texte renommé ; `reducedSize(4000, 2000)` donne `{ width: 1200, height: 600 }`, et `reducedSize(800, 600)` ne change rien.
  - `POST /api/mail-images` : refuse un fichier vide, un type inconnu (`Format d’image non accepté : JPEG, PNG ou GIF.`) et plus de 2 Mo (`Image trop lourde : 2 Mo au plus.`) ; un fichier correct revient par `GET`, avec `X-Content-Type-Options: nosniff`.
  - Permissions (`tests/server/permissions.test.ts`) : ces routes sont refusées aux comptes Table centrale et Zone, et sans session.
  - `sweepMailImages` : une image sans citation de moins de 24 h reste ; de plus de 24 h, elle est supprimée. Une image citée par le message de l'application ou par une seule compétition reste, y compris si la compétition est gérée ailleurs et après son retrait du message de l'application. Un message au format texte qui contient `/api/mail-images/<id>` ne compte pas.
  - `unclassifiedTables(db)` reste vide, et un paquet de compétition ne contient pas `mail_images`.
  - `POST /api/mail-html/check` avec `<script>` répond `removed: ['« script »']`.

- [ ] **Step 2: Vérifier l'échec.** Run: `npx vitest run tests/server/mail-images.test.ts tests/server/permissions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implémenter.** Table `mail_images` (`id`, `content_type`, `size`, `data` blob, `created_at`), sans `rowMeta()` : une image ne change jamais. Générer la migration avec l'outil habituel du projet. Ajouter la table à `LOCAL_ONLY_TABLES`. Appeler `sweepMailImages` dans le `run()` de `startRetention`, dans son propre `try`, pour qu'une panne ne bloque ni la purge ni le démarrage. Les routes passent par l'option `clubServices` de la tâche 6 : les enregistrer sans condition ici, la tâche 6 les déplacera.

- [ ] **Step 4: Vérifier.** Run le même test. Expected: PASS. Puis `npm test`, Expected: PASS.

- [ ] **Step 5: Commit** : `feat(mail): images du message dans la base, routes réservées à l'organisateur et nettoyage après 24 h`.

### Task 4: Envoi, aperçu et messagerie

**Files:**
- Modify: `src/server/mail.ts`, `src/server/routes/invitations.ts`, `src/web/api.ts`, `src/web/components/InvitationMail.tsx`, `src/web/components/OnlineEntryPanel.tsx`, `src/domain/mail-images.ts`
- Test: `tests/server/mail.test.ts`, `tests/server/google-mail.test.ts`

**Interfaces:**
- Consumes: `renderMailHtml` (tâche 2), `readMailImage` (tâche 3).
- Produces: `invitationMessage(db, competitionId, clubId, link, imageSrc?): Promise<{ subject: string; text: string; html: string }>` ; `MailAttachment.cid?: string` ; `GET .../invitations/preview` → `{ subject, body, html }`, où `body` reste le texte ; `MAIL_TOTAL_BYTES = 18 * 1024 * 1024`.

- [ ] **Step 1: Écrire les tests qui échouent** dans `tests/server/mail.test.ts`, avec le faux transport existant :
  - **Ancien message :** `text` égal au corps rendu et `html` égal à `textToHtml(corps)`, y compris avec `a < b`.
  - **Message `html` avec une image :** le mail a `html` contenant `cid:`, une pièce avec le même `cid`, `contentDisposition: 'inline'`, et `text` sans balise. Chaque club reçoit son propre lien.
  - **Image absente de la base :** `sendInvitations` rejette `Image introuvable`, aucun appel à `sendMail`, et `club_invitations` n'a aucun nouveau lien.
  - **Mail trop lourd :** images + pièces au-dessus de 18 Mo, rejet `Mail trop lourd`, aucun envoi et aucun lien.
  - **`mailtoInvitation` :** `body` est la version texte, sans balise ni image.
  - **Aperçu :** `html` garde `/api/mail-images/<id>` et échappe un club nommé `<b>x</b>`.
  - **`tests/server/google-mail.test.ts` :** le message brut envoyé à Gmail est en `multipart/related` et contient l'image.

- [ ] **Step 2: Vérifier l'échec.** Run: `npx vitest run tests/server/mail.test.ts tests/server/google-mail.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implémenter.** `invitationMessage` choisit selon `format` : ancien texte comme aujourd'hui, sinon `renderMailHtml`. Dans `sendInvitations`, charger les images du modèle une fois, avec `invitationAttachments` et **avant** `verify` et le premier `addInvitationLink`, vérifier la présence et le poids total, puis joindre les images à chaque mail avec `cid: image-<id>@shidokan`. Messages exacts : `Image introuvable dans le message : remettez-la dans l’éditeur.` et `Mail trop lourd (X Mo, 18 Mo au plus) : retirez une image ou une pièce jointe.`, où X vient de `formatBytes`.

- [ ] **Step 4: Vérifier.** Run le même test. Expected: PASS, et le reste de `tests/server/mail.test.ts` inchangé.

- [ ] **Step 5: Mettre à jour l'écran.** L'aperçu affiche `preview.data.html` (`dangerouslySetInnerHTML`, HTML filtré par le serveur) sur fond blanc. La fenêtre « Ouvrir dans ma messagerie » ajoute : `Votre messagerie recevra le texte seul : sans mise en forme ni image.` Quand `settings.managedHere` est faux, les boutons d'envoi et de messagerie sont désactivés et le panneau affiche `Rendez la main au serveur pour envoyer des mails.`

- [ ] **Step 6: Commit** : `feat(mail): envoi mis en forme avec images dans le texte, refus avant tout envoi, aperçu HTML`.

### Task 5: Images et code HTML dans l'éditeur

**Files:**
- Create: `src/web/components/mail-editor/images.ts`, `src/web/components/mail-editor/ImageControl.tsx`, `tests/web/mail-editor-images.test.ts`
- Modify: `src/web/components/mail-editor/MailMessageEditor.tsx`, `src/web/api.ts`, `src/web/components/InvitationMail.tsx`, `src/web/pages/AppSettingsPage.tsx`, `tests/e2e/editeur-mail.spec.ts`

**Interfaces:**
- Consumes: routes de la tâche 3, `MAIL_IMAGE_LIMITS`.
- Produces: `reducedOutputType(type: string, hasAlpha: boolean): 'image/jpeg' | 'image/png'` ; `prepareImage(file: File): Promise<Blob>`, qui lève une erreur en français ; `pastedLosses(html: string): string[]`, à partir d'expressions régulières (`<table`, `<img` dont le `src` ne commence pas par `/api/mail-images/`), comme simple signal puisque le filtrage réel reste dans l'éditeur et le serveur.

- [ ] **Step 1: Écrire les tests purs qui échouent**

```ts
expect(reducedOutputType('image/jpeg', false)).toBe('image/jpeg');
expect(reducedOutputType('image/png', true)).toBe('image/png');
expect(reducedOutputType('image/webp', false)).toBe('image/jpeg');
expect(reducedOutputType('image/webp', true)).toBe('image/png');
expect(pastedLosses('<p>x</p><img src="/api/mail-images/a">')).toEqual([]);
expect(pastedLosses('<table></table><img src="https://e.fr/a.png">')).toEqual(['tableau', 'image externe']);
```

- [ ] **Step 2: Vérifier l'échec, implémenter, vérifier.** Run: `npx vitest run tests/web/mail-editor-images.test.ts`. Expected: FAIL, puis PASS. `prepareImage` : GIF renvoyé tel quel, SVG et types inconnus refusés (`Format d’image non accepté : JPEG, PNG, WebP ou GIF.`), réduction par `canvas`, repli en JPEG si un PNG dépasse 2 Mo après réduction, puis refus `Image trop lourde : 2 Mo au plus.`

- [ ] **Step 3: Ajouter l'image à l'éditeur.**
  - `Image.extend` avec `inline: true`, `allowBase64: false`, attribut `width` et `parseHTML` limité à `img[src^="/api/mail-images/"]`.
  - `ImageControl` : un `RichTextEditor.Control` dans un `FileButton` (`data-testid="mail-editor-image"`). Refus à la 11e image, avec `Au plus 10 images par message.` Insertion en largeur moyenne (400).
  - `FileHandler` pour le collage et le dépôt de fichiers, par le même chemin.
  - `editorProps.transformPastedHTML` : notification si `pastedLosses` n'est pas vide.
  - Image sélectionnée (`useEditorState`) : une ligne sous la barre, `Taille de l’image :` Petite, Moyenne, Pleine largeur (`data-testid="mail-image-size-small|medium|full"`). Ce ne sont pas des boutons de barre.

- [ ] **Step 4: Tenir le mode code.** Avec `onSourceCodeTextSwitch` : pendant le mode code, garder le dernier `editor.getText()` dans une référence et remonter `onSourceModeChange(true)`. Les boutons « Enregistrer » sont désactivés avec le texte `Revenez à l’éditeur pour enregistrer.` À la sortie, appeler `POST /api/mail-html/check` avec le code gardé ; si `removed` n'est pas vide, afficher `Retiré du code : …` et poser `html` nettoyé dans l'éditeur.

- [ ] **Step 5: Écrire les parcours e2e** dans `tests/e2e/editeur-mail.spec.ts` (une seule session, un petit PNG et un petit WebP fabriqués dans le test) :
  - choisir une image : elle s'affiche dans l'éditeur (`naturalWidth > 0`) ;
  - cliquer sur Petite : `width="200"` ;
  - enregistrer et recharger : image et taille conservées ;
  - un WebP arrive en JPEG ou PNG ;
  - un SVG est refusé avec le message ;
  - personnaliser le message d'une compétition reprend l'image du message de l'application ;
  - mode code avec `<script>` et `<img src="https://e.fr/a.png">` : « Enregistrer » est désactivé pendant le mode, la notification apparaît à la sortie, et le corps enregistré ne contient ni `script` ni `e.fr`, et n'est pas du code affiché comme texte ;
  - coller un tableau : notification, pas de `table` dans le message.
  Run: `npx playwright test tests/e2e/editeur-mail.spec.ts`. Expected: PASS.

- [ ] **Step 6: Commit** : `feat(mail): images et mode code dans l'éditeur, avec signalement de ce qui est retiré`.

### Task 6: Refus côté serveur sur le PC

**Files:**
- Create: `tests/server/services-clubs.test.ts`
- Modify: `src/server/app.ts`, `src/server/routes/app-settings.ts`, les tests de `tests/server/` qui appellent ces routes en rôle local

**Interfaces:**
- Produces: `AppOptions.clubServices?: boolean` (par défaut `role === 'serveur'`, commentaire : forcé à `true` seulement dans les tests sans connexion) ; texte `SERVER_ONLY = 'Réservé au serveur en ligne : les mails et les inscriptions en ligne ne sont pas disponibles sur ce PC.'`.

- [ ] **Step 1: Écrire les tests qui échouent.** Sur `buildApp({ dbPath })` (rôle local), chacune de ces routes répond 403 avec `SERVER_ONLY` :
  - `GET` et `POST /api/competitions/:id/invitations` ; `POST .../invitations/send` ; `POST .../invitations/:clubId/mailto` ; `GET .../invitations/preview` ;
  - `GET .../mail-attachments` ; `GET .../club-entry` ;
  - `GET /api/inscription/abc` ;
  - `POST /api/mail-images` ; `POST /api/mail-html/check` ;
  - `POST /api/app-settings/test-mail` ; `GET /api/app-settings/google/start`, à ajuster sur le nom réel dans `src/server/routes/google.ts`.

  Et encore :
  - `PATCH /api/app-settings` avec `smtp`, `mailMode` ou `invitationMail` répond 403, et avec `privacyContact` seul répond 200 ;
  - `GET .../club-form.pdf` et `GET .../club-form.ods` restent à 200 ;
  - en rôle `serveur` connecté, `GET .../invitations` répond 200.

- [ ] **Step 2: Vérifier l'échec.** Run: `npx vitest run tests/server/services-clubs.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implémenter.** `clubServices` conditionne l'enregistrement de `invitationRoutes`, `clubEntryRoutes`, des routes d'images, de `googleRoutes`, de `googleContactsRoutes`, de la création du client Google et du maintien de la connexion Google. Sinon, enregistrer des routes de refus (tous les verbes, y compris les jokers `/*`) pour ces chemins. `appSettingsRoutes` reçoit `clubServices` pour le refus de `test-mail` et des champs de mail. Les réglages déjà enregistrés ne sont ni lus pour un envoi ni effacés.

- [ ] **Step 4: Adapter les tests existants.** Run: `npm test`. Pour chaque fichier qui échoue en 403 sur ces routes (à attendre parmi `invitations`, `club-entry`, `mail`, `events`, `mail-attachments-routes`, `mail-attachments-store`, `auth`, `sync-follow`, `sync-rescue`, `mirror`, `google-contacts`, `google-mail`, `google-routes`, `permissions`), ajouter `clubServices: true` au `buildApp` concerné, et rien d'autre. Expected: tout PASS.

- [ ] **Step 5: Commit** : `feat(pc): mails et inscriptions en ligne refusés côté serveur en dehors du serveur en ligne`.

### Task 7: Écrans du PC et déplacement des parcours e2e

**Files:**
- Modify: `src/web/pages/ClubFormPage.tsx`, `src/web/pages/AppSettingsPage.tsx`, `src/web/pages/ClubEntryPage.tsx`, `tests/e2e/inscription-en-ligne.spec.ts`, `tests/e2e/mise-en-page.spec.ts`, `tests/e2e/socle.spec.ts`
- Create: `tests/e2e/mise-en-page-serveur.spec.ts`

**Interfaces:**
- Consumes: `SERVER_SESSION` (tâche 1), avec `test.use({ baseURL: 'http://localhost:3101', storageState: SERVER_SESSION })`.

- [ ] **Step 1: Écrire le test e2e qui échoue** dans `tests/e2e/socle.spec.ts` (port 3100, rôle local) : sur Fiche club, pas de section « Inscriptions en ligne » ni de `send-invitations`, mais `paper-form-download` et `club-form-download` présents. Dans les Réglages, pas de « Envoi des mails » ni de champ d'objet du message ; la mention sur les données s'enregistre sans erreur. Run: `npx playwright test tests/e2e/socle.spec.ts`. Expected: FAIL.

- [ ] **Step 2: Implémenter.**
  - `ClubFormPage` : `OnlineEntryPanel` seulement si `useAuthMe` dit `serveur`.
  - `AppSettingsPage` : les liens de résumé et les cartes `MailCard` et la partie message de `TextsCard` seulement en rôle `serveur`, et sur le PC le `save` n'envoie plus `invitationMail`.
  - `ClubEntryPage` : le refus du PC affiche le message `SERVER_ONLY`.
  - Vérifier que rien d'autre ne parle de mails sur le PC : `grep -rn "Envoyer le lien\|Message aux clubs" src/web`, et la liste « Préparer le jour J ».

- [ ] **Step 3: Déplacer les parcours.** `inscription-en-ligne.spec.ts` et le test de `mise-en-page.spec.ts` qui utilise `invitation-url` passent en port 3101 avec `SERVER_SESSION`. Run: `npx playwright test tests/e2e/inscription-en-ligne.spec.ts tests/e2e/mise-en-page.spec.ts tests/e2e/mise-en-page-serveur.spec.ts tests/e2e/socle.spec.ts`. Expected: PASS.

- [ ] **Step 4: Écrire le test de la main.** Dans `tests/server/services-clubs.test.ts` : sur un serveur, un message avec image, compétition exportée puis marquée gérée ailleurs ; `POST .../invitations/send` est refusé, le message et l'image sont là. Après le retour du paquet, l'envoi fonctionne et le mail contient l'image. Run: `npx vitest run tests/server/services-clubs.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** : `feat(pc): section Inscriptions en ligne et réglages de mail retirés du PC ; parcours e2e déplacés sur le serveur`.

### Task 8: Aide, documentation, essai dans Chrome et bilan

**Files:**
- Modify: `src/web/help.ts`, `docs/guide-utilisateur.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`
- Create: `docs/verification-mail-boites-reelles.md`

- [ ] **Step 1: Mettre à jour l'aide et le guide.** Éditeur, images et limites, code HTML filtré, texte seul dans « Ouvrir dans ma messagerie », mails et inscriptions réservés au serveur, rendre la main pour envoyer. Corriger dans le guide la phrase périmée « Chaque envoi crée un nouveau lien et désactive le précédent » : le nouveau lien s'ajoute. Run: `npx vitest run tests/web/help.test.ts`. Expected: PASS.

- [ ] **Step 2: Écrire la liste de contrôle** `docs/verification-mail-boites-reelles.md`, à faire par l'organisateur après l'installation : club de test avec ses adresses (Gmail au moins, Outlook et Apple Mail si possible), envoi depuis le vrai compte, puis contrôle de : gras, souligné, couleur, surlignage, listes, citation, alignement, titres, image et trois tailles, lien personnel cliquable, lien derrière un mot, pièces jointes, image en double en pièce jointe ou non, version sans mise en forme.

- [ ] **Step 3: Lancer toutes les vérifications.** Run: `npm run typecheck && npm test && npm run test:e2e`. Expected: tout PASS. Noter les totaux pour le bilan.

- [ ] **Step 4: Essayer dans Chrome** avec l'extension Claude in Chrome (skill `anthropic-skills:chrome-browser`), par de vrais clics, sur une base temporaire en rôle `serveur` sur le port 3200 et un faux serveur SMTP local qui enregistre chaque message dans le scratchpad. Voir, dans les deux thèmes :
  - chaque bouton de la barre, couleurs et surlignage compris ;
  - image par bouton, collage et glisser-déposer ; trois tailles ;
  - mode code et notification ;
  - aperçu ;
  - envoi à deux clubs (partie HTML de chaque message captée, ouverte dans Chrome : liens différents, images affichées) ;
  - fenêtre de messagerie ;
  - bouton indisponible quand la main est ailleurs.
  Puis, sur une seconde base en rôle `local`, Fiche club et Réglages sans partie mail. Corriger ce qui ne va pas, et revérifier chaque correction dans Chrome.

- [ ] **Step 5: Écrire le bilan et la feuille de route.** Totaux des tests, écarts, ce qui n'a pas été vu. **Le rendu dans de vraies boîtes reste annoncé comme non vérifié** jusqu'à l'essai de l'organisateur.

- [ ] **Step 6: Commit** : `docs: étape 35, aide, guide, liste de contrôle des boîtes mail et bilan`.
