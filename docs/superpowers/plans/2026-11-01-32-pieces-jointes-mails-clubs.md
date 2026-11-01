# Pièces jointes des mails aux clubs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** l'organisateur gère, dans « Message aux clubs de cette compétition », les pièces jointes du mail aux clubs : fiches club
(PDF, .ods) décochables, fichiers ajoutés (affiche, règlement…) cochables, téléchargeables, supprimables ; réglage enregistré avec la
compétition.

**Architecture :** règles pures (nom, type, tailles) dans `src/domain/mail-attachments.ts`, partagées par le serveur et l'écran.
Métadonnées dans une table locale `mail_attachments` (non transmise par le paquet), contenu dans le dossier `pieces-jointes/` à côté de
la base. Cases des fiches club dans le réglage de compétition `clubFormAttachments`. `sendInvitations` joint ce qui est coché.

**Tech Stack :** TypeScript 7, Fastify 5, better-sqlite3 + drizzle (migration via `npm run db:generate`), zod, React + Mantine 8,
TanStack Query, Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-11-01-pieces-jointes-mails-clubs-design.md` (à lire avant chaque tâche).

## Global Constraints

- Interface et messages en français, avec les apostrophes typographiques (’) comme le reste de l'application.
- Extensions acceptées : pdf, jpg, jpeg, png, gif, webp, doc, docx, odt, xls, xlsx, ods, ppt, pptx, odp, txt, csv (casse ignorée).
- Limites : 10 fichiers ajoutés par compétition ; 10 Mo (10 × 1024 × 1024 octets) par fichier ; 15 Mo (15 × 1024 × 1024) pour tous les
  fichiers ajoutés, cochés ou non. Les fiches club ne comptent pas.
- Messages exacts : « Type de fichier non accepté : .xyz (acceptés : PDF, images, documents, tableurs, présentations, texte) »
  (`.xyz` = l'extension reçue en minuscules, ou « (aucune) » sans extension) ; « Au plus 10 pièces jointes. » ; « Fichier trop gros : 10 Mo au
  plus. » ; « Pièces jointes trop lourdes : 15 Mo au plus en tout. » ; « Une pièce jointe porte déjà ce nom. » ; « Fichier vide. »
  (choix du concepteur) ; « Pièce jointe introuvable : <nom>. Supprimez-la ou ajoutez-la de nouveau. » ; « Si le texte du message cite
  les pièces jointes, pensez à l’adapter. »
- Nom : dernier segment après `/` ou `\`, caractères de contrôle (U+0000–U+001F, U+007F) retirés, espaces autour retirés, 150 caractères
  au plus en gardant l'extension.
- Le texte du message n'est jamais modifié automatiquement ; pas de nouvelle variable.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (base Docker en service).
- e2e : le nom d'une nouvelle compétition ne doit pas contenir le nom d'une autre ni y être contenu (`createCompetition` cherche par
  sous-chaîne).

## Review Focus

1. Nom de fichier avec accents, espaces, guillemets (« Règlement "2026".pdf ») : stocké tel quel, téléchargé sous ce nom
   (`filename*`), arrivé dans le mail sous ce nom → test dans la tâche 3 (en-tête de téléchargement + `attachments[].filename`).
2. Même nom à la casse près qu'un fichier existant ou que `fiche-club-<date>.pdf` → refusé → test dans la tâche 1 (`checkNewAttachment`).
3. Pièce cochée dont le fichier a disparu → envoi refusé avant tout mail, aucun lien changé ; pièce **décochée** manquante → envoi
   normal → tests dans la tâche 3.
4. Compétition supprimée, purgée, ou base restaurée → fichiers orphelins effacés du dossier → tests dans la tâche 2.
5. Compte Table centrale, ou compétition gérée ailleurs → écritures refusées (403 / 409), même pour le PATCH de la case → tests dans la
   tâche 3.

---

### Task 1 : règles des pièces jointes (domaine)

**Files :**
- Create : `src/domain/mail-attachments.ts`
- Test : `tests/domain/mail-attachments.test.ts`

**Interfaces :**
- Produces :
  - `MAIL_ATTACHMENT_LIMITS = { count: 10, fileBytes: 10 * 1024 * 1024, totalBytes: 15 * 1024 * 1024, nameLength: 150 } as const`
  - `attachmentContentType(fileName: string): string | null` — type MIME selon l'extension, null si non acceptée. Table : pdf
    `application/pdf` ; jpg/jpeg `image/jpeg` ; png `image/png` ; gif `image/gif` ; webp `image/webp` ; doc `application/msword` ;
    docx `application/vnd.openxmlformats-officedocument.wordprocessingml.document` ; odt `application/vnd.oasis.opendocument.text` ;
    xls `application/vnd.ms-excel` ; xlsx `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` ; ods
    `application/vnd.oasis.opendocument.spreadsheet` ; ppt `application/vnd.ms-powerpoint` ; pptx
    `application/vnd.openxmlformats-officedocument.presentationml.presentation` ; odp `application/vnd.oasis.opendocument.presentation` ;
    txt `text/plain` ; csv `text/csv`.
  - `cleanAttachmentName(raw: string): string`
  - `checkNewAttachment(file: { fileName: string; size: number }, existing: { fileName: string; size: number }[], reserved: string[]): string | null`
    — `fileName` déjà nettoyé ; renvoie le premier message d'erreur dans l'ordre : vide, type, taille du fichier, nombre, total, nom pris
    (casse ignorée, parmi `existing` et `reserved`) ; null si accepté.
  - `clubFormFileNames(date: string): { pdf: string; ods: string }` → `fiche-club-<date>.pdf` / `.ods` (remplace les chaînes écrites en dur dans
    `src/server/mail.ts`, `src/server/routes/registrations.ts` et `InvitationMail.tsx`).
  - `formatBytes(n: number): string` → « 900 o », « 12 Ko », « 3,4 Mo » (format libre, français).

- [ ] **Step 1 : écrire les tests** — `attachmentContentType('Affiche.PDF') === 'application/pdf'`, `('a.exe') === null`, `('sans') === null` ;
  `cleanAttachmentName('C:\\Users\\x\\Règlement.pdf') === 'Règlement.pdf'`, `('  a\u0007b.pdf ') === 'ab.pdf'`, un nom de 200 caractères
  finissant par `.pdf` → longueur 150 et finit par `.pdf` ; `checkNewAttachment` : taille 0 → « Fichier vide. » ; `x.exe` → message de
  type avec `.exe` ; 10 Mo + 1 → « Fichier trop gros : 10 Mo au plus. » ; 10 existants → « Au plus 10 pièces jointes. » ; existants
  14 Mo + nouveau 2 Mo → message du total ; `AFFICHE.pdf` face à `affiche.pdf` existant → « Une pièce jointe porte déjà ce nom. » ;
  `Fiche-Club-2026-11-22.PDF` face à `reserved = ['fiche-club-2026-11-22.pdf']` → même message ; cas valide → null ;
  `clubFormFileNames('2026-11-22').ods === 'fiche-club-2026-11-22.ods'`.
- [ ] **Step 2 : lancer** `npx vitest run tests/domain/mail-attachments.test.ts` → échec (module absent).
- [ ] **Step 3 : écrire le module** (pur, sans dépendance serveur ou navigateur).
- [ ] **Step 4 : relancer** → tout passe ; `npm run typecheck` → sans erreur.
- [ ] **Step 5 : commit** `feat(pieces-jointes): règles des pièces jointes des mails aux clubs (types, tailles, noms)`.

### Task 2 : stockage (table, dossier, réglage des fiches, balayage)

**Files :**
- Modify : `src/server/db/schema.ts` (table `mailAttachments`), `drizzle/` (migration 0027 générée), `src/domain/settings.ts`
  (`clubFormAttachments`), `src/server/sync/package.ts` (`LOCAL_ONLY_TABLES`), `src/server/repositories/retention.ts`,
  `src/server/app.ts` (balayage au démarrage et après suppression d'une compétition), `src/server/routes/backups.ts` (après restauration)
- Create : `src/server/repositories/mail-attachments.ts`
- Test : `tests/server/mail-attachments-store.test.ts`, `tests/domain/settings.test.ts` (défaut), `tests/server/retention.test.ts`

**Interfaces :**
- Consumes : tâche 1 (`cleanAttachmentName`, `checkNewAttachment`, `attachmentContentType`, `clubFormFileNames`).
- Produces :
  - table `mail_attachments` : `id` text pk, `competition_id` text not null → `competitions.id` on delete cascade, `file_name` text not null,
    `content_type` text not null, `size` integer not null, `included` integer (booléen) not null default 1, `created_at` text not null
    default maintenant (même expression que les autres tables), `...rowMeta()`.
  - réglage `clubFormAttachments: { pdf: boolean; ods: boolean }` (objet `.strict()`), défaut `{ pdf: true, ods: true }`.
  - `export interface MailAttachmentInfo { id: string; fileName: string; contentType: string; size: number; included: boolean; createdAt: string; missing: boolean }`
  - `export class AttachmentError extends Error { readonly statusCode = 400 }`
  - `attachmentDir(dbPath: string): string` → `path.join(path.dirname(path.resolve(dbPath)), 'pieces-jointes')`
  - `listMailAttachments(db: AppDb, dbPath: string, competitionId: string): MailAttachmentInfo[]` — ordre d'ajout (`created_at`, puis `rowid`) ;
    `missing` = le fichier `<dir>/<id>` n'existe pas.
  - `addMailAttachment(db: AppDb, dbPath: string, competitionId: string, rawName: string, data: Buffer): Promise<MailAttachmentInfo>` — nettoie
    le nom, vérifie (`reserved` = les deux noms de `clubFormFileNames(date de la compétition)`), lève `AttachmentError(message)` ; écrit
    `<dir>/<id>.tmp` puis renomme en `<dir>/<id>` (dossier créé au besoin), puis insère la ligne.
  - `readMailAttachment(db: AppDb, dbPath: string, competitionId: string, id: string): { info: MailAttachmentInfo; data: Buffer }` —
    `NotFoundError('Pièce jointe introuvable')` (celle de `repositories/registrations.ts`) si la ligne n'existe pas pour cette compétition
    ou si le fichier manque.
  - `setMailAttachmentIncluded(db: AppDb, competitionId: string, id: string, included: boolean): void` — `NotFoundError` si absente.
  - `deleteMailAttachment(db: AppDb, dbPath: string, competitionId: string, id: string): void` — ligne puis fichier (fichier absent toléré) ;
    `NotFoundError` si la ligne est absente.
  - `sweepAttachmentFiles(db: AppDb, dbPath: string): number` — efface du dossier tout fichier (y compris `*.tmp`) dont le nom n'est pas un
    `id` de la table ; dossier absent : 0.

- [ ] **Step 1 : tests du dépôt** (`tests/server/mail-attachments-store.test.ts`, base via `tmpDbPath()` + `buildApp` ou `openDb`, une
  compétition créée par l'API) : ajouter « Règlement "2026".pdf » → info avec `included: true`, `missing: false`, fichier présent sous
  `attachmentDir/<id>` avec le même contenu ; liste dans l'ordre d'ajout ; refus `x.exe` → `AttachmentError` avec le message de type ;
  ajouter `fiche-club-2026-11-22.pdf` → refus de nom ; `setMailAttachmentIncluded(false)` reflété dans la liste ; fichier effacé à la
  main → `missing: true` et `readMailAttachment` → `NotFoundError` ; `deleteMailAttachment` → ligne et fichier partis ; id d'une autre
  compétition → `NotFoundError` ; `sweepAttachmentFiles` efface un fichier `orphelin` et un `x.tmp` déposés à la main, garde les autres,
  renvoie 2.
- [ ] **Step 2 : tests de câblage** (même fichier) : `DELETE /api/competitions/:id` (avec `{ name }`) → le fichier de la pièce n'est plus
  dans le dossier ; `POST /api/restore` d'une copie (`GET /api/backup.sqlite`) prise avant l'ajout → fichier orphelin effacé ; `buildApp`
  sur une base dont le dossier contient un orphelin → effacé au démarrage ; `unclassifiedTables(db)` vide ; le paquet
  (`buildPackage(db, id, { handOver: false, role: 'local' })`) n'a pas de clé `mail_attachments`.
  Dans `tests/server/retention.test.ts` : ajouter `mail_attachments` aux tables vidées par la purge, et vérifier que le fichier est effacé.
  Dans `tests/domain/settings.test.ts` : `defaultSettings().clubFormAttachments` vaut `{ pdf: true, ods: true }` ; `readStoredSettings({})`
  donne la même chose (compétitions existantes).
- [ ] **Step 3 : lancer** ces tests → échec.
- [ ] **Step 4 : implémenter** : table dans `schema.ts` (commentaire : métadonnées seulement, contenu dans `pieces-jointes/`), puis
  `npm run db:generate` et renommer la migration en `0027_pieces_jointes_mails.sql` (mettre à jour le `tag` du journal) ; réglage dans
  `competitionSettingsSchema` + `defaultSettings()` ; dépôt ; `'mail_attachments'` dans `LOCAL_ONLY_TABLES` (et dans la liste du
  commentaire) ; purge : ajoutée à la liste des tables vidées, puis `sweepAttachmentFiles(db, dbPath)` après la transaction ; balayage
  dans `buildApp` après `openDb`, après `deleteCompetition` dans la route DELETE, après `restoreFrom` dans `/api/restore`.
- [ ] **Step 5 : relancer** les tests de la tâche, puis `npm test` en entier → tout passe ; `npm run typecheck` → sans erreur.
- [ ] **Step 6 : commit** `feat(pieces-jointes): table locale et dossier des pièces jointes, réglage des fiches club, balayage des fichiers orphelins (migration 0027)`.

### Task 3 : routes et envoi

**Files :**
- Modify : `src/server/routes/invitations.ts` (routes + option `dbPath`), `src/server/app.ts` (passer `dbPath` à `invitationRoutes`),
  `src/server/auth/permissions.ts` (`ORGANISER_GETS`), `src/server/mail.ts` (`sendInvitations`, pièces jointes),
  `src/server/routes/registrations.ts` (noms via `clubFormFileNames`)
- Test : `tests/server/mail-attachments-routes.test.ts`, `tests/server/mail.test.ts`

**Interfaces :**
- Consumes : tâche 2 (dépôt, `clubFormAttachments`), tâche 1 (`clubFormFileNames`).
- Produces (sous `/api/competitions/:id`) :
  - `GET /mail-attachments` → `MailAttachmentInfo[]`
  - `POST /mail-attachments` — corps `application/octet-stream`, en-tête `X-File-Name` (décodé par `decodeURIComponent` ; absent → 400
    « Nom de fichier manquant. ») ; `bodyLimit` de la route : `MAIL_ATTACHMENT_LIMITS.fileBytes + 1024 * 1024` (au-delà, refus Fastify
    « Fichier trop volumineux ») ; → 201 `MailAttachmentInfo`
  - `GET /mail-attachments/:attachmentId` → le contenu, `Content-Type` stocké, `Content-Disposition: attachment; filename="<ascii>";
    filename*=UTF-8''<encodeURIComponent(nom)>` (`<ascii>` : nom avec tout caractère hors ASCII imprimable, `"` et `\` remplacés par `_`),
    `X-Content-Type-Options: nosniff`
  - `PATCH /mail-attachments/:attachmentId` — `{ included: boolean }` strict → 204
  - `DELETE /mail-attachments/:attachmentId` → 204
  - `ORGANISER_GETS` reçoit `/mail-attachments` et `/mail-attachments/:attachmentId`.
  - `src/server/mail.ts` : `clubFormAttachments(db, competitionId)` devient
    `invitationAttachments(db: AppDb, dbPath: string, competitionId: string): Promise<MailAttachment[]>` — fiches cochées
    (`settings.clubFormAttachments`, PDF puis .ods), puis fichiers ajoutés cochés dans l'ordre de la liste ; une pièce cochée qui manque →
    `MailError` « Pièce jointe introuvable : <nom>. Supprimez-la ou ajoutez-la de nouveau. »
  - `sendInvitations(db, dbPath, transport, competitionId, targets, baseUrl, pauseMs)` (nouveau 2e paramètre) — appelle
    `invitationAttachments` **avant** `verify()` ; un mail sans pièce cochée part avec `attachments: []`.

- [ ] **Step 1 : tests des routes** (`tests/server/mail-attachments-routes.test.ts`) : POST avec `X-File-Name: encodeURIComponent('Règlement "2026".pdf')`
  → 201 et `fileName` exact ; GET liste ; GET fichier → corps identique, `content-disposition` contient
  `filename*=UTF-8''R%C3%A8glement%20%222026%22.pdf` et `filename="R_glement _2026_.pdf"`, `x-content-type-options: nosniff` ; PATCH
  `{ included: false }` → 204 puis liste à jour ; PATCH `{ included: 'non' }` → 400 ; DELETE → 204 puis GET fichier → 404 ; POST sans
  `X-File-Name` → 400 ; POST `.exe` → 400 avec le message de type ; POST de 12 Mo → 413 ; compétition inconnue → 404.
  Rôle serveur (même fichier, préparation comme dans `tests/server/permissions.test.ts` : compte `table`) : GET liste → 403, POST → 403,
  PATCH → 403. Compétition gérée ailleurs (préparation comme dans `tests/server/ownership.test.ts`) : POST, PATCH,
  DELETE → 409 ; GET liste → 200.
- [ ] **Step 2 : tests de l'envoi** (`tests/server/mail.test.ts`) : adapter le test existant des pièces jointes ; nouveaux tests : ajout de
  `affiche.png` puis `reglement.pdf` → `attachments.map(a => a.filename)` vaut
  `['fiche-club-2026-11-22.pdf', 'fiche-club-2026-11-22.ods', 'affiche.png', 'reglement.pdf']` avec `contentType` `image/png` pour l'affiche
  et le contenu exact ; PATCH de compétition `{ settings: { clubFormAttachments: { pdf: false } } }` + `affiche.png` décochée →
  `['fiche-club-2026-11-22.ods', 'reglement.pdf']` ; tout décoché → `attachments` vide et mail envoyé ; fichier coché effacé à la main →
  400 avec le message « Pièce jointe introuvable : reglement.pdf. … », `sent` vide, et l'ancien lien du club fonctionne toujours ; fichier
  **décoché** effacé → envoi normal ; le mail d'essai n'a pas de pièce jointe.
- [ ] **Step 3 : lancer** les deux fichiers → échec.
- [ ] **Step 4 : implémenter** routes, permissions et envoi ; remplacer les noms `fiche-club-…` écrits en dur par `clubFormFileNames`.
- [ ] **Step 5 : relancer** les deux fichiers, puis `npm test` → tout passe ; `npm run typecheck` → sans erreur.
- [ ] **Step 6 : commit** `feat(pieces-jointes): routes des pièces jointes et envoi des pièces cochées aux clubs`.

### Task 4 : écran, aide, e2e

**Files :**
- Modify : `src/web/api.ts` (hooks), `src/web/components/InvitationMail.tsx` (partie « Pièces jointes » dans l'accordéon, ligne d'aperçu),
  `src/web/components/OnlineEntryPanel.tsx` (fenêtre « Ouvrir dans ma messagerie »), `src/web/help.ts`
- Create : `src/web/components/MailAttachments.tsx`
- Test : `tests/e2e/inscription-en-ligne.spec.ts`

**Interfaces :**
- Consumes : routes de la tâche 3, `MailAttachmentInfo` (type importé du dépôt serveur ou redéclaré dans `api.ts` comme les autres types
  de réponse), tâche 1 (`checkNewAttachment`, `cleanAttachmentName`, `formatBytes`, `clubFormFileNames`, `MAIL_ATTACHMENT_LIMITS`).
- Produces :
  - `useMailAttachments(id)` (clé `['mail-attachments', id]`), `useAddMailAttachment(id)` (mutation sur un `File`, en-têtes comme
    `useUploadFfk`, plus `X-Poste-Id`), `useSetMailAttachmentIncluded(id)`, `useDeleteMailAttachment(id)` ; chacune invalide
    `['mail-attachments', id]`.
  - `MailAttachments({ competitionId })` : la liste de la spec (fiche PDF, tableur, fichiers ajoutés), chaque ligne avec une case
    « Joindre » (`aria-label` « Joindre <nom> »), un lien de téléchargement, la taille pour les fichiers ajoutés, « Supprimer »
    (`aria-label` « Supprimer <nom> ») pour les fichiers ajoutés ; « Fichier manquant » en rouge (case désactivée, pas de lien) ; bouton
    « Ajouter un fichier » (`FileButton` Mantine, `multiple`) : chaque fichier vérifié par `checkNewAttachment` avant l'envoi (message
    affiché avec le nom du fichier, les autres continuent), puis envoyé un par un ; erreurs du serveur affichées de même ; le rappel
    « Si le texte du message cite les pièces jointes, pensez à l’adapter. » ; cases des fiches via `useUpdateCompetition`
    (`{ settings: { clubFormAttachments: { pdf } } }`), enregistrées au clic. Conteneur `data-testid="mail-attachments"`. Contrôles
    désactivés quand la compétition est en lecture seule ici (`useManagement(id).data?.managedHere === false`).
  - Ligne d'aperçu `data-testid="invitation-attachments"` : « Pièces jointes : <noms cochés et présents séparés par « , »> » ou
    « Pièces jointes : aucune ».
  - Fenêtre messagerie `data-testid="mailto-attachments"` : liens de téléchargement des seules pièces cochées (fiches et fichiers
    ajoutés) ; aucune → la phrase n'est pas affichée.

- [ ] **Step 1 : test e2e** (nouveau test dans `tests/e2e/inscription-en-ligne.spec.ts`, compétition « Coupe pièces jointes », un club
  invité par l'API comme le test « envoi du lien … plusieurs adresses ») : ouvrir « Message aux clubs de cette compétition » ; ajouter
  `affiche.png` (`setInputFiles` avec un tampon) → visible dans `mail-attachments` ; ajouter `virus.exe` → message « Type de fichier non
  accepté : .exe … » ; cocher le club → l'aperçu contient « affiche.png » ; décocher « Joindre fiche-club-<date>.pdf » → après
  rechargement de la page, toujours décochée, et l'aperçu ne cite plus le PDF ; la fenêtre « Ouvrir dans ma messagerie » propose
  `affiche.png` et pas le PDF ; « Supprimer affiche.png » → disparue.
- [ ] **Step 2 : lancer** `npx playwright test tests/e2e/inscription-en-ligne.spec.ts -g "pièces jointes"` → échec.
- [ ] **Step 3 : implémenter** hooks, composant, aperçu, fenêtre messagerie ; aide : remplacer la phrase « Les mails envoyés par
  l’application portent aussi en pièces jointes … » par une phrase qui dit : les pièces jointes se gèrent dans « Message aux clubs »
  (fiches décochables, fichiers ajoutés, 10 fichiers / 10 Mo / 15 Mo) ; le texte du message ne s'adapte pas tout seul ; « Ouvrir dans ma
  messagerie » ne joint rien (les pièces cochées sont proposées au téléchargement) ; les fichiers ajoutés restent sur cette installation
  (ni dans les sauvegardes, ni dans le passage de main).
- [ ] **Step 4 : relancer** le test e2e, puis `npx playwright test tests/e2e/inscription-en-ligne.spec.ts tests/e2e/mise-en-page.spec.ts`
  → tout passe ; `npm run typecheck` et `npm test` → sans erreur.
- [ ] **Step 5 : vérifier dans Chrome** (Claude in Chrome, base de démonstration copiée dans `tmp/`, port 3200 comme les étapes
  précédentes) : ajout, décochage, suppression, aperçu ; en clair et en sombre ; pas de contenu coupé à largeur téléphone.
- [ ] **Step 6 : commit** `feat(pieces-jointes): gérer les pièces jointes dans « Message aux clubs » (fiches décochables, fichiers ajoutés)`.
- [ ] **Step 7 : bilan** — ajouter l'étape 32 à `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` et ses décisions à
  `docs/superpowers/plans/2026-10-21-99-bilan.md` ; commit `docs: étape 32, pièces jointes des mails aux clubs`.
