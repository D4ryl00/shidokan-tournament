# Coachs synchronisés avec Google Contacts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** depuis l'Annuaire, « Synchroniser avec Google » lit les contacts du compte Google déjà connecté (un libellé ou tous). L'écran montre les différences avec l'annuaire, et permet de lier les nouveaux contacts à des clubs, d'en créer, ou de les laisser en attente. Rien ne change avant « Appliquer ».

**Architecture :**
- Un calcul pur (`src/domain/google-contacts.ts`) compare les contacts aux fiches de l'annuaire. Il est utilisé par le serveur (aperçu) et par la page (différences au moment de lier).
- Le client Google gagne l'autorisation `contacts.readonly` et deux lectures de l'API People, avec `fetch` seulement.
- Deux routes réservées à l'organisateur :
  - `POST /api/club-directory/google/preview` lit Google et rend l'aperçu ;
  - `POST /api/club-directory/google/apply` applique, en une transaction, les valeurs que la page a montrées, après vérification des versions de ligne.
- Le lien club ↔ contact est une colonne `club_directory.google_contact_id` (migration 0023).
- Le compte des liens, le dernier libellé et la liste « en attente » sont une clé `googleContacts` de `app_settings`.

**Tech Stack:** TypeScript 7 natif, Fastify 5, Drizzle + better-sqlite3, React 19 + Mantine 8 + TanStack Query v5, Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-10-26-contacts-google-design.md`

## Global Constraints

- Aucune dépendance nouvelle (pas de `googleapis`). Une seule migration : `drizzle/0023_*.sql`, générée par `npm run db:generate` après la modification de `schema.ts`, qui ajoute `google_contact_id text` à `club_directory`.
- Autorisations demandées, exactement et dans cet ordre : `openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/contacts.readonly`. Jamais d'autorisation d'écriture sur les contacts.
- Adresses de l'API People :
  - `https://people.googleapis.com/v1/contactGroups?groupFields=name,groupType&pageSize=1000` (+ `&pageToken=`) ;
  - `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,memberships&pageSize=1000` (+ `&pageToken=`).
- Libellés gardés : `groupType === 'USER_CONTACT_GROUP'` seulement.
- Valeur prise pour un contact : l'entrée marquée `metadata.primary`, sinon la première. Le nom est `names[].displayName`, l'organisation `organizations[].name`. Les libellés viennent de `memberships[].contactGroupMembership.contactGroupResourceName`.
- Synchronisation disponible seulement si le mode Google est disponible (`googleAvailable`) **et** un compte Google est connecté. Le mode d'envoi (`mailMode`) n'a pas d'importance.
- Routes nouvelles sous `/api/club-directory/…` : elles sont réservées à l'organisateur par `routeAccess` sans rien ajouter (`src/server/auth/permissions.ts`).
- Textes exacts (constantes exportées par `src/domain/google-contacts.ts`) :
  - `CONTACTS_NOT_GRANTED` = « Le droit de lire les contacts n’a pas été accordé à l’application. Reconnectez-vous avec Google et laissez la case « contacts » cochée. »
  - `DIRECTORY_CHANGED` = « L’annuaire a changé entre-temps : la page a été rechargée, vérifiez puis appliquez de nouveau. »
  - `RECONNECT_OTHER_ACCOUNT` = « Se reconnecter avec un autre compte Google efface les liens entre l’annuaire et les contacts Google. »
- Textes de l'écran :
  - bouton « Synchroniser avec Google » ; titre « Synchroniser les coachs avec Google » ;
  - « Libellé » avec l'option « Tous les contacts » ;
  - sections « Différences avec l’annuaire », « Nouveaux contacts », « En attente d’un rattachement », « Contacts déjà liés » ;
  - choix « Lier à un club », « Nouveau club », « Plus tard » ; « + Lier aussi à un autre club » ;
  - « Peut-être : {club} ? » ; « Un club porte déjà ce nom : le lier plutôt ? » ;
  - bouton « Appliquer : … » (§5.6 de la spec) ; « Annuaire mis à jour. » ;
  - menu de l'annuaire « Ne plus synchroniser avec Google » ;
  - Réglages « Contacts : accès accordé » / « Contacts : non accordé — reconnectez-vous ».
- Interface en français, apostrophe typographique ’ dans les textes affichés, couleurs par les jetons `--sk-*`, pièces communes de `src/web/components/ui/`.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (les tests utilisent `tmpDbPath()`). Ne pas pousser, ne pas fusionner, ne pas reconstruire Docker.
- Le serveur e2e (port 3101) limite les connexions à 10 par adresse en 15 minutes : l'e2e de cette étape tourne sur le serveur local habituel, en simulant les réponses de l'API de l'application avec `page.route`.
- Vérifications : `npm run typecheck`, `npm test`, `npx playwright test`.

## Review Focus

- Un contact Google sans nom, sans mail ni téléphone (seulement un nom, ou seulement un numéro) : affiché avec ce qu'il a. Il ne casse ni les suggestions ni les différences, et un nouveau club créé ne reçoit que les champs remplis (tests en Task 1 et Task 4).
- Deux contacts Google avec le même mail : une suggestion exacte peut viser le même club pour les deux. Appliquer deux liens vers le même club garde le dernier, sans erreur (test en Task 4).
- Plus de 1000 contacts ou libellés : toutes les pages de résultats (`nextPageToken`) sont lues (test en Task 3).
- Un contact choisi « Plus tard », puis retiré du libellé, puis remis : il revient « en attente », pas en nouveau contact (test en Task 1).
- Le même contact proposé à la fois en lien et en « Plus tard » dans un même envoi (page ancienne ou requête forgée) : le lien l'emporte et le contact sort de la liste « en attente » (test en Task 4).

---

### Task 1: Calcul de la synchronisation (domaine, pur)

**Files:**
- Create: `src/domain/google-contacts.ts`
- Test: `tests/domain/google-contacts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GoogleContact { resourceName: string; name: string | null; email: string | null; phone: string | null; organization: string | null; groups: string[] }
  export interface ContactLabel { resourceName: string; name: string }
  export type CoachField = 'coachName' | 'coachPhone' | 'coachEmail';
  export interface SyncClub { id: string; name: string; coachName: string | null; coachPhone: string | null; coachEmail: string | null; googleContactId: string | null; version: number | null }
  export interface FieldDiff { field: CoachField; directory: string | null; google: string }
  export interface ClubDiff { clubId: string; clubName: string; version: number | null; contact: GoogleContact; fields: FieldDiff[] }
  export interface ContactChoice { contact: GoogleContact; exact: { clubId: string; reason: 'email' | 'phone' } | null; maybe: string[] /* clubIds */ }
  export interface SyncPreview {
    diffs: ClubDiff[];          // clubs liés dont le contact (présent dans `contacts`) diffère, triés par nom de club
    newContacts: ContactChoice[]; // contacts liés à aucun club et pas en attente, triés par nom
    pending: ContactChoice[];   // contacts en attente présents dans `contacts`
    linked: { contact: GoogleContact; clubIds: string[] }[];
    clubs: SyncClub[];          // fiches non archivées, triées par nom (pour les listes « Lier à »)
  }
  export function normalizePhone(p: string): string;
  export function fieldDiffs(contact: GoogleContact, club: Pick<SyncClub, CoachField>): FieldDiff[];
  export function syncPreview(contacts: GoogleContact[], clubs: (SyncClub & { archived: boolean })[], pending: string[]): SyncPreview;
  export const CONTACTS_NOT_GRANTED: string, DIRECTORY_CHANGED: string, RECONNECT_OTHER_ACCOUNT: string; // Global Constraints
  ```
- Règles :
  - `normalizePhone` garde les chiffres. `0033…` et `33…` à 11 chiffres deviennent `0…`.
  - Mails comparés sans casse ni espaces autour ; noms comparés par `normalizeName` (`src/domain/names.ts`).
  - `fieldDiffs` : un champ Google vide n'est jamais une différence. Un champ de l'annuaire vide et rempli dans Google en est une. `google` est la valeur Google telle qu'écrite.
  - `exact` : le premier club (par nom) dont le mail concorde, sinon le téléphone.
  - `maybe` : les clubs sans concordance exacte dont `normalizeName(coachName) === normalizeName(contact.name)` ou `normalizeName(club.name) === normalizeName(contact.organization)`.
  - Les clubs archivés ne servent nulle part : ni différences, ni suggestions, ni `clubs`.

- [ ] **Step 1: Write the failing tests**

  Tests nommés, avec ces assertions :
  - `téléphones équivalents` : `normalizePhone('+33 6 12 34 56 78') === normalizePhone('06.12.34.56.78')` et `normalizePhone('0033612345678') === '0612345678'`.
  - `différences : vide Google ignoré, vide annuaire comblé, écritures équivalentes ignorées` : pour le contact `{ name: 'Julie Petit', email: 'JULIE@ex.fr', phone: '+33 6 11 22 33 44' }` et le club `{ coachName: 'J. Petit', coachPhone: '06 11 22 33 44', coachEmail: null }`, `fieldDiffs` rend exactement `[{ field: 'coachName', directory: 'J. Petit', google: 'Julie Petit' }, { field: 'coachEmail', directory: null, google: 'JULIE@ex.fr' }]`. Avec le contact `{ name: null, email: null, phone: null }`, elle rend `[]`.
  - `aperçu : club lié → différences ; club archivé ignoré` : un club lié à `people/c1` dont le téléphone diffère apparaît dans `diffs`. Le même club archivé n'apparaît ni dans `diffs` ni dans `clubs`, et `people/c1` passe dans `newContacts`.
  - `suggestion exacte par mail puis téléphone, ressemblance seulement proposée` : mail identique (casse différente) → `exact.reason === 'email'`. Seulement le téléphone → `'phone'`. Seulement le nom du coach normalisé égal → `exact === null` et `maybe` contient le club. Organisation « Dojo des Lilas » et club « DOJO des lilas » → `maybe`.
  - `en attente : séparé des nouveaux, même retiré puis remis` : `pending = ['people/c2']` → `people/c2` est dans `pending` et pas dans `newContacts`. Absent de `contacts`, il n'apparaît nulle part, sans erreur.
  - `contact lié à deux clubs` : deux clubs avec `googleContactId = 'people/c3'` → `linked` contient `{ contact: c3, clubIds: [les deux] }`, et chacun a sa propre entrée dans `diffs` s'il diffère.
  - `contact incomplet` : le contact `{ name: null, email: null, phone: '0612345678' }` est dans `newContacts` avec une suggestion exacte par téléphone si un club a ce numéro, `maybe: []` sinon.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run tests/domain/google-contacts.test.ts`
  Expected: FAIL (module introuvable).

- [ ] **Step 3: Implement `src/domain/google-contacts.ts`** with the interfaces and rules above. Aucune dépendance au serveur, car la page l'importe aussi.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run tests/domain/google-contacts.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/domain/google-contacts.ts tests/domain/google-contacts.test.ts
  git commit -m "feat(contacts): calcul des différences et des suggestions avec Google Contacts"
  ```

### Task 2: Stockage — lien club ↔ contact, archivage, fusion, réglages

**Files:**
- Modify: `src/server/db/schema.ts` (`clubDirectory.googleContactId: text('google_contact_id')`)
- Create: `drizzle/0023_*.sql` + `drizzle/meta/*` (par `npm run db:generate`)
- Modify: `src/domain/registration.ts` (`DirectoryEntry.googleContactId: string | null`)
- Modify: `src/server/repositories/directory.ts` (`toEntry`, `updateDirectoryEntry`, `mergeDirectoryEntries`)
- Modify: `src/server/routes/directory.ts` (PATCH accepte `googleContactId: z.null()`)
- Modify: `src/server/repositories/retention.ts`
- Modify: `src/domain/app-settings.ts`, `src/server/repositories/app-settings.ts`
- Test: `tests/server/directory.test.ts`, `tests/server/retention.test.ts`, `tests/server/app-settings.test.ts`

**Interfaces:**
- Produces (domaine, `app-settings.ts`) :
  ```ts
  // GoogleSender gagne : scopes?: string[]  (absent = connexion d'avant cette version = ['gmail.send'] seulement)
  export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
  export const hasContactsScope = (g: { scopes?: string[] } | null): boolean;
  export interface GoogleContactsState { account: string | null; label: string | null; pending: string[] }
  // AppSettings gagne : googleContacts: GoogleContactsState (défaut { account: null, label: null, pending: [] })
  // appSettingsPatchSchema ne l'accepte PAS (seules les routes de synchronisation l'écrivent)
  ```
  `publicAppSettings` retire `googleContacts` (seule la page de synchronisation en a besoin, par sa route).
- Produces (dépôt, `app-settings.ts`) : `setGoogleContactsState(db: AppDb, patch: Partial<GoogleContactsState>): void`.
- Produces (dépôt, `directory.ts`) :
  - `updateDirectoryEntry(db, id, patch & { archived?: boolean; googleContactId?: null })`. `archived: true` met aussi `googleContactId` à null.
  - `mergeDirectoryEntries` reprend `googleContactId` de la fiche fusionnée si la fiche gardée n'en a pas.
- Rétention : la requête d'archivage efface aussi `google_contact_id` et ajoute `or google_contact_id is not null` à sa condition.

- [ ] **Step 1: Write the failing tests**
  - `directory.test.ts › lien Google : retiré à la main, effacé à l'archivage, gardé à la fusion` :
    - une fiche créée puis reliée directement en base (`db.update(clubDirectory).set({ googleContactId: 'people/c1' })`) renvoie `googleContactId: 'people/c1'` dans `GET /api/club-directory` ;
    - `PATCH { googleContactId: null }` → null ;
    - après un nouveau lien, `PATCH { archived: true }` → null ;
    - fusion d'une fiche liée dans une fiche non liée → la fiche gardée a le lien. `PATCH { googleContactId: 'people/x' }` → 400.
  - `retention.test.ts › archivage RGPD efface le lien Google` : une fiche inactive liée → après `purgeExpiredData`, `archived = 1` et `google_contact_id` null. Une fiche déjà archivée sans coordonnées mais encore liée est aussi nettoyée.
  - `app-settings.test.ts › état des contacts Google : défaut, jamais envoyé à l'écran, refusé en modification` :
    - `getAppSettings(db).googleContacts` vaut `{ account: null, label: null, pending: [] }` ;
    - `GET /api/app-settings` ne contient pas `googleContacts` ;
    - `PATCH /api/app-settings` avec `googleContacts` → 400 (schéma strict) ;
    - `hasContactsScope(null) === false`, `hasContactsScope({}) === false`, `hasContactsScope({ scopes: [CONTACTS_SCOPE] }) === true`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run tests/server/directory.test.ts tests/server/retention.test.ts tests/server/app-settings.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** : schéma, `npm run db:generate` (vérifier que le SQL produit n'est qu'un `ALTER TABLE club_directory ADD google_contact_id text`), dépôts, route, rétention, réglages.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run tests/server/directory.test.ts tests/server/retention.test.ts tests/server/app-settings.test.ts tests/server/row-versions.test.ts tests/server/sync-package.test.ts && npm run typecheck`
  Expected: PASS. `row-versions` et `sync-package` confirment que la nouvelle colonne ne casse ni les versions ni les paquets vers le PC.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/db/schema.ts drizzle src/domain src/server/repositories src/server/routes/directory.ts tests/server
  git commit -m "feat(contacts): lien entre un club de l’annuaire et un contact Google"
  ```

### Task 3: Connexion Google — droit sur les contacts, lecture de l'API People, changement de compte

**Files:**
- Modify: `src/server/google/client.ts`
- Modify: `src/server/routes/google.ts`
- Modify: `tests/helpers/fake-google.ts`
- Modify: `docs/installation-serveur.md` (section console Google Cloud : activer l'**API People**, ajouter `contacts.readonly` à l'écran de consentement)
- Test: `tests/server/google-client.test.ts`, `tests/server/google-routes.test.ts`

**Interfaces:**
- Consumes: `CONTACTS_SCOPE`, `GoogleContactsState`, `setGoogleContactsState` (Task 2) ; `GoogleContact`, `ContactLabel` (Task 1).
- Produces (`client.ts`) :
  ```ts
  export const GOOGLE_SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE, CONTACTS_SCOPE] as const;
  export class ContactsScopeMissingError extends Error {}   // People répond 403 (droit absent)
  // GoogleClient gagne :
  listContactLabels(refreshToken: string): Promise<ContactLabel[]>;  // libellés USER_CONTACT_GROUP, triés par nom
  listContacts(refreshToken: string): Promise<GoogleContact[]>;      // toutes les pages
  ```
  Les deux lectures partagent la logique de `sendRaw` : 401 → un renouvellement forcé puis un second essai ; `invalid_grant` → `GoogleAccessRevokedError` ; 403 → `ContactsScopeMissingError` ; autre erreur → `Error` en français avec le statut et le message de Google.
- Produces (`fake-google.ts`) : `FakeGoogle` gagne `contacts: GoogleContact[]` et `labels: ContactLabel[]`. Ses réponses suivent le format People (`connections`, `contactGroups`, `nextPageToken`) avec des pages de 2 éléments, pour éprouver la pagination. Il renvoie 403 si `grantedScopes` n'a pas `CONTACTS_SCOPE`. `grantedScopes` contient par défaut aussi `CONTACTS_SCOPE`.
- Retour de Google (`routes/google.ts`), en plus de l'existant :
  - `GoogleSender.scopes = granted.scopes`.
  - Mode d'envoi : `current.google ? current.mailMode : 'google'`.
  - Si `googleContacts.account` n'est pas null et diffère de `granted.email`, alors `update club_directory set google_contact_id = null` et `pending = []`. Dans tous les cas, `googleContacts.account = granted.email`.

- [ ] **Step 1: Write the failing tests**
  - `google-client.test.ts` :
    - `autorisation : contacts en lecture seule demandés` : `authUrl` contient `contacts.readonly` et aucun `auth/contacts` sans `.readonly`.
    - `contacts : toutes les pages, principal choisi, libellés` : avec 5 contacts dont l'un a deux mails (le second `metadata.primary`), `listContacts` rend 5 contacts, ce mail principal, et `groups` rempli.
    - `libellés : seulement ceux de l'utilisateur` : avec un libellé `SYSTEM_CONTACT_GROUP` (« myContacts ») et 3 `USER_CONTACT_GROUP`, `listContactLabels` en rend 3, triés par nom.
    - `contacts : droit absent → ContactsScopeMissingError ; accès retiré → GoogleAccessRevokedError ; 401 → renouvelé une fois`.
  - `google-routes.test.ts` :
    - `connexion : droits accordés retenus ; contacts décochés → connecté quand même` : avec `grantedScopes` sans contacts, le retour mène à `google=connecte`, et `getAppSettings(db).google.scopes` n'a pas `CONTACTS_SCOPE`.
    - `reconnexion : mode d'envoi gardé` : connexion, `PATCH mailMode: 'smtp'` (SMTP réglé), reconnexion → `mailMode === 'smtp'`. Première connexion après « Déconnecter » → `'google'`.
    - `reconnexion avec un autre compte : liens et attente effacés ; même compte : rien ne change` : fiche liée + `pending: ['people/c9']`, reconnexion même compte → inchangés. Puis `fake.email = 'autre@gmail.com'` et reconnexion → `google_contact_id` null partout, `pending: []`, `account: 'autre@gmail.com'`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run tests/server/google-client.test.ts tests/server/google-routes.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** client, faux Google, retour. Mettre à jour la doc d'installation (étape 2 « activer l'API Gmail » devient « activer l'API Gmail et l'API People » ; étape 3 ajoute `contacts.readonly`).

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run tests/server/google-client.test.ts tests/server/google-routes.test.ts tests/server/google-mail.test.ts tests/server/google-keepalive.test.ts`
  Expected: PASS. Les tests d'envoi existants restent verts.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/google tests/helpers/fake-google.ts src/server/routes/google.ts docs/installation-serveur.md tests/server
  git commit -m "feat(contacts): connexion Google avec lecture des contacts, changement de compte"
  ```

### Task 4: Routes d'aperçu et d'application

**Files:**
- Create: `src/server/repositories/google-contacts.ts`
- Create: `src/server/routes/google-contacts.ts`
- Modify: `src/server/app.ts` (enregistrement si `google` existe, avec `{ db, google }`)
- Test: `tests/server/google-contacts.test.ts`

**Interfaces:**
- Consumes: Tasks 1 à 3.
- Produces (types partagés, à mettre dans `src/domain/google-contacts.ts`) :
  ```ts
  export type GoogleContactsView =
    | { state: 'no-scope'; account: string }
    | { state: 'ok'; account: string; labels: ContactLabel[]; label: string | null; total: number; preview: SyncPreview };
  export interface SyncApply {
    updates: { clubId: string; version: number | null; set: Partial<Record<CoachField, string>> }[];
    links: { clubId: string; version: number | null; contact: string; set: Partial<Record<CoachField, string>> }[];
    creates: { contact: string; name: string; coachName: string | null; coachPhone: string | null; coachEmail: string | null }[];
    later: string[];   // contacts choisis « Plus tard » cette fois
  }
  ```
- Routes :
  - `POST /api/club-directory/google/preview` `{ label?: string | null }` → `GoogleContactsView`.
    - Pas de compte connecté → 409 `GOOGLE_CONNECT_FIRST`.
    - `hasContactsScope` faux → `{ state: 'no-scope' }`, sans appel à Google.
    - Sinon : lire les libellés et les contacts. Le libellé vient de `label` s'il est fourni (et il est alors enregistré dans `googleContacts.label`), sinon du libellé enregistré. Un libellé enregistré qui n'existe plus chez Google vaut « Tous les contacts ». `total` = nombre de contacts retenus.
    - `GoogleAccessRevokedError` → `markGoogleRevoked` puis 409 `GOOGLE_RECONNECT`. `ContactsScopeMissingError` → `{ state: 'no-scope' }`.
  - `POST /api/club-directory/google/apply` `SyncApply` (zod strict ; valeurs ≤ 120/40/200 caractères comme `directorySchema`, mails valides) → `{ updated: number; linked: number; created: number }`. Une seule transaction :
    1. Pour chaque `updates[]` et `links[]`, si la version de la fiche ≠ `version`, ou si la fiche est absente ou archivée → 409 `DIRECTORY_CHANGED`, rien n'est écrit.
    2. Écrire `set`. Pour un lien, `googleContactId = contact` (remplace un lien existant).
    3. Pour chaque création, `createDirectoryEntry` avec les coordonnées non nulles, puis `googleContactId = contact`.
    4. `pending = (pending ∪ later) \ (contacts liés ou créés)`.
    - Pas de version de ligne à vérifier pour une création.

- [ ] **Step 1: Write the failing tests** (`buildApp` avec le faux Google et `connectGoogle`, comme `google-routes.test.ts`)
  - `aperçu : libellé choisi retenu, libellé disparu → tous ; total` : `labels = [Coachs]`, 3 contacts dont 2 dans Coachs. `preview { label: 'contactGroups/coachs' }` → `total: 2`. Un nouvel aperçu sans `label` garde `contactGroups/coachs`. Libellé retiré du faux → `label: null`, `total: 3`.
  - `aperçu : sans droit contacts → no-scope sans appel ; sans compte → 409 ; accès retiré → 409 et état « à reconnecter »`.
  - `appliquer : différences, lien, création, plus tard` :
    - fiche liée « Dojo des Lilas » (téléphone différent), fiche « Shidokan Est » non liée, contacts c1 (lié), c2, c3, c4 ;
    - apply avec `updates: [{ Lilas, version, set: { coachPhone } }]`, `links: [{ Est, version, contact: 'people/c2', set: {} }]`, `creates: [{ contact: 'people/c3', name: 'Kyokushin Sud', coachName: 'Sophie Leroy', coachPhone: null, coachEmail: 's@ex.fr' }]`, `later: ['people/c4']` ;
    - `GET /api/club-directory` montre le nouveau téléphone, Est lié à c2, et une fiche « Kyokushin Sud » liée à c3 avec `coachPhone: null`. `pending` vaut `['people/c4']`. Le nouvel aperçu n'a plus de différence pour Lilas et a c4 dans `pending`.
  - `appliquer : ligne décochée → valeur gardée, différence reproposée` : apply sans `updates` → le prochain aperçu a toujours la différence.
  - `appliquer : annuaire modifié entre-temps → 409, rien d'écrit` : `PATCH` de la fiche après l'aperçu, puis apply avec l'ancienne version → 409 `DIRECTORY_CHANGED`, et la création demandée dans le même envoi n'existe pas.
  - `appliquer : contact à la fois lié et plus tard → lié, pas en attente` ; `deux liens vers le même club → le dernier gagne`.
  - `appliquer : réservé à l'organisateur` : un compte Table centrale reçoit 403 sur `preview` et `apply`. Écrire ce test dans `tests/server/permissions.test.ts` avec `routeAccess`, sans connexion supplémentaire.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run tests/server/google-contacts.test.ts tests/server/permissions.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** le dépôt (`googleContactsPreview(db, google, label)`, `applyGoogleContacts(db, input: SyncApply)`) et les routes.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run tests/server && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server src/domain/google-contacts.ts tests/server
  git commit -m "feat(contacts): aperçu et application de la synchronisation avec Google"
  ```

### Task 5: Écrans — synchronisation, annuaire, réglages, aide

**Files:**
- Create: `src/web/pages/DirectorySyncPage.tsx`
- Modify: `src/web/App.tsx` (route `/annuaire/google`)
- Modify: `src/web/api.ts` (`useGoogleContactsPreview`, `useApplyGoogleContacts`, `DirectoryEntry.googleContactId`)
- Modify: `src/web/pages/DirectoryPage.tsx` (bouton « Synchroniser avec Google » si `googleAvailable && google` ; menu « Ne plus synchroniser avec Google » sur une fiche liée ; petite marque « Google » à côté du nom d'une fiche liée)
- Modify: `src/web/pages/AppSettingsPage.tsx` (ligne « Contacts : … » sous « Connecté : … » ; `RECONNECT_OTHER_ACCOUNT` sous les boutons)
- Modify: `src/web/help.ts` (clé `annuaire` complétée ; nouvelle clé `synchro-google`)
- Test: `tests/e2e/contacts-google.spec.ts`

**Interfaces:**
- Consumes: `GoogleContactsView`, `SyncApply`, `fieldDiffs`, `CONTACTS_NOT_GRANTED`, `DIRECTORY_CHANGED` (Tasks 1 et 4) ; `hasContactsScope` (Task 2) ; `PublicGoogleSender.scopes`.
- Comportement de la page (spec §5, maquette « tout sur une page ») :
  - En haut, `Select` « Libellé » (« Tous les contacts » + libellés). Changer de libellé relance l'aperçu avec `label`. À côté : compte et `plural(total, 'contact')`.
  - `state: 'no-scope'` → `Alert` avec `CONTACTS_NOT_GRANTED`, avec un lien « Réglages de l’application » vers `/parametres#mails`, et rien d'autre.
  - « Différences avec l’annuaire » : tableau case / Club / Champ / Annuaire / Google. Toutes les cases sont cochées au départ. Libellés de champ : Coach, Téléphone, E-mail.
  - « Nouveaux contacts » : une carte par contact. Choix par défaut « Lier à un club » avec le club `exact` présélectionné (raison « même mail » / « même téléphone ») s'il existe, sinon « Plus tard ». Les clubs `maybe` sont proposés en « Peut-être : {club} ? » (un clic choisit Lier + ce club).
    - Un club de la liste déjà lié à un autre contact porte « lié à {nom} ».
    - Sous un club choisi, `fieldDiffs(contact, club)` en cases cochées.
    - « Nouveau club » : `TextInput` pré-rempli avec `organization`, avec l'avertissement « Un club porte déjà ce nom : le lier plutôt ? » si `normalizeName` concorde avec une fiche de `preview.clubs`.
    - « + Lier aussi à un autre club » ajoute une seconde liste.
  - « En attente d’un rattachement (n) » et « Contacts déjà liés (n) » sont repliés. Les attentes ont les mêmes choix, avec « Plus tard » par défaut. Les déjà liés n'ont que « Lier aussi à un autre club ».
  - Bouton : `Appliquer : ${plural(d,'différence')}, ${plural(l,'lien')}, ${plural(c,'nouveau club','nouveaux clubs')}`, suivi de `, ${plural(k,'gardée')}` si des cases sont décochées. Les éléments à zéro sont omis ; s'il ne reste rien, le bouton est désactivé et dit « Rien à appliquer ».
    - Un « Nouveau club » sans nom désactive le bouton.
    - Construire `SyncApply` : `set` d'une mise à jour ou d'un lien = champs cochés (valeur `google`) + champs vides de la fiche que Google remplit. `later` = contacts nouveaux laissés « Plus tard ».
  - Succès → notification « Annuaire mis à jour. », invalidation de `club-directory` et nouvel aperçu. 409 `DIRECTORY_CHANGED` → l'aperçu est rechargé et le message reste affiché.

- [ ] **Step 1: Write the failing e2e test** (`tests/e2e/contacts-google.spec.ts`, serveur local habituel)

  `page.route` simule `GET /api/app-settings` (réponse réelle + `googleAvailable: true`, `google: { email: 'orga@gmail.com', fromName: 'Shidokan France', status: 'ok', lastRefreshAt: null, scopes: [..., CONTACTS_SCOPE] }`). Il simule aussi `POST /api/club-directory/google/preview` (une différence, un nouveau contact avec suggestion exacte, un sans correspondance, un en attente) et capture le corps de `POST /api/club-directory/google/apply`.
  - `annuaire : synchroniser avec Google — différences, lien suggéré, nouveau club, plus tard` :
    - « Synchroniser avec Google » est visible sur l'Annuaire et mène à `/annuaire/google` ;
    - le bouton dit `Appliquer : 1 différence, 1 lien` ;
    - décocher la différence ajoute « 1 gardée » ;
    - choisir « Nouveau club » sans nom désactive le bouton, et le nom saisi le réactive ;
    - après le clic, le corps capturé a `updates: []`, un `links` vers le club suggéré, un `creates` avec le nom saisi, et `later: []` ;
    - « Annuaire mis à jour. » est visible.
  - `annuaire : sans droit sur les contacts` : l'aperçu simulé `{ state: 'no-scope' }` affiche `CONTACTS_NOT_GRANTED` et le lien vers les Réglages.
  - `annuaire : sans compte Google, pas de bouton` : avec les vrais réglages (Google indisponible), « Synchroniser avec Google » est absent.
  - Ajouter `/annuaire/google` (avec l'aperçu simulé) aux pages vérifiées par `clipped()` dans `tests/e2e/mise-en-page.spec.ts`.

- [ ] **Step 2: Run to verify it fails**

  Run: `npx playwright test tests/e2e/contacts-google.spec.ts`
  Expected: FAIL (bouton absent).

- [ ] **Step 3: Implement** les écrans, les crochets d'API, la ligne « Contacts » des Réglages (`hasContactsScope(g)` → « Contacts : accès accordé », sinon « Contacts : non accordé — reconnectez-vous » en orange) et l'aide :
  - `annuaire.details` : une phrase sur « Synchroniser avec Google » et « Ne plus synchroniser avec Google » ;
  - `synchro-google` : Google l'emporte, décocher pour garder, une case décochée revient la fois suivante, « Plus tard », nouveau club, compte qui change.

- [ ] **Step 4: Run all checks**

  Run: `npm run typecheck && npm test && npx playwright test`
  Expected: tout PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/web tests/e2e
  git commit -m "feat(contacts): écran de synchronisation des coachs avec Google"
  ```
