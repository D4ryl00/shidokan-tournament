# Étape 16 (étape B du spec) : annuaire des clubs et inscription en ligne par le club — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** quatre choses, sur le réseau local pour l'instant (la mise en ligne est l'étape C) :
- les organisateurs tiennent un **annuaire des clubs** indépendant des compétitions ;
- dans une compétition, ils **invitent** des clubs de l'annuaire, ce qui donne à chacun un **lien personnel** ;
- ils **ouvrent** puis **figent** les inscriptions en ligne ;
- chaque coach, avec son lien, **voit et modifie tous les combattants de son club**, un formulaire par combattant, chaque combattant enregistré seul.

**Architecture :**
- Une migration ajoute `club_invitations`. Le jeton n'est gardé que sous forme d'empreinte SHA-256.
- Le domaine sait reconstruire une ligne de fiche (`ClubFormLine`) à partir d'un combattant et de ses inscriptions, l'inverse de `lineToRows`.
- La page du club passe par des routes publiques `/api/inscription/:token`. Elles réutilisent la validation des fiches (`lineToRows`) et la mise à jour d'inscriptions de l'import de fiche, extraite en une fonction commune.
- La version d'une ligne est la plus grande `version` du combattant et de ses inscriptions. Une modification faite sur une version périmée est refusée (409).

**Tech Stack:** TypeScript, Drizzle (SQLite), Fastify, React 19 + Mantine 8, react-query, Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §4 (annuaire), §5 (lien personnel, page du club, ouverture et gel), §3.2 (règle de rapprochement), §7.2 (protection contre les écrasements, ici limitée aux lignes du club). Hors de cette étape : mails (C), comptes et mise en ligne (C), transfert (D).

## Global Constraints
- **Lien** : `/inscription/<jeton>`. Jeton = `randomBytes(24).toString('base64url')`. En base, seulement `sha256(jeton)` en hexadécimal (`token_hash`, unique). Un lien par club **et** par compétition. « Régénérer » révoque l'ancien. Un jeton n'est montré qu'au moment où il est créé ou régénéré.
- **Page modifiable** si et seulement si : `club_entry_status = 'open'`, `owner_instance_id` vide et invitation non révoquée. Sinon, lecture seule. Une écriture est alors refusée en **403** : « Les inscriptions sont closes : contactez l'organisateur. »
- **Lien inconnu ou révoqué** → **404** : « Lien inconnu ou expiré. »
- **Combattants affichés** : tous les combattants du club dans la compétition, quelle que soit l'origine des inscriptions (✅). Les inscriptions créées par la page ont l'origine `online`. Une inscription existante garde son origine.
- **Une ligne = un combattant**. Une ligne combat + kata donne deux inscriptions. Un combattant inscrit dans **deux disciplines de combat** s'affiche en lecture seule : « Inscrit dans deux disciplines de combat : contactez l'organisateur pour le modifier. »
- **Version d'une ligne** = plus grande `version` du combattant et de ses inscriptions. Écrire avec une version périmée → **409** : « Ce combattant a été modifié entre-temps : la liste a été rechargée. »
- **Verrou** : un combattant dont une inscription est dans une catégorie commencée ou terminée ne se modifie ni ne se supprime depuis la page. Réutiliser `RegistrationLockedError`.
- **Validation** : celle de `lineToRows`, avec la grille et la tolérance de la compétition. Messages d'erreur renvoyés en **400** `issues`. Un nouveau combattant de même nom et même sexe qu'un combattant du club → 400 : « <NOM Prénom> est déjà dans la liste. »
- **En-tête du club** (coach, téléphone, e-mail, pré-accord, N° d'affiliation) :
  - il met à jour le club de la compétition **et** l'annuaire : les coordonnées non vides remplacent celles de l'annuaire ;
  - N° d'affiliation : uniquement des chiffres. S'il est libre, il est donné à l'entrée. S'il est tenu par une autre entrée, le club est relié à celle-ci. Si l'entrée a déjà un **autre** numéro → 400 : « Ce club a déjà le numéro d'affiliation <n> : contactez l'organisateur. »
- Après toute écriture de la page du club : `syncCategories(db, competitionId)`.
- **Annuaire** : le N° d'affiliation est fait de chiffres et unique. En cas de doublon → **409** : « Ce numéro d'affiliation est déjà celui de « <nom> ». » Une fusion relie les clubs de l'entrée fusionnée à l'entrée gardée, complète les champs vides de celle-ci, puis supprime l'autre.
- Textes (copie exacte) :
  - onglet et page : « Annuaire des clubs » ;
  - section de l'onglet Fiche club : « Inscriptions en ligne » ;
  - boutons : « Ouvrir les inscriptions », « Figer les inscriptions », « Rouvrir les inscriptions », « Inviter les clubs cochés », « Copier le lien », « Régénérer le lien », « Révoquer », « Ajouter un combattant », « Modifier », « Enregistrer », « Annuler », « Supprimer », « Enregistrer les coordonnées » ;
  - états : « Inscriptions ouvertes jusqu'au <date> », « Inscriptions ouvertes », « Inscriptions closes : contactez l'organisateur. ».
- Les réponses d'API des écrans existants ne changent pas (test « API inchangée » de l'étape 15).
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Combattant importé de l'export FFK, corrigé par le coach** : sa catégorie de poids FFK et son origine `ffk` sont gardées, comme au réimport d'une fiche. Test Task 4.
- **L'organisateur modifie une inscription pendant que le coach a le formulaire ouvert** : l'enregistrement du coach est refusé (409) et rien n'est écrasé. Test Task 4.
- **Le coach change la discipline de combat** (karaté → boxing) : l'ancienne inscription disparaît, il n'y a pas de doublon, et les catégories sont recalculées. Test Task 4.
- **Inscriptions figées pendant que le coach a la page ouverte** : son enregistrement est refusé (403) avec un message clair, et la page repasse en lecture seule. Tests Task 4 et e2e Task 8.
- **Combattant dans une catégorie commencée** : impossible à modifier ou supprimer depuis la page (409), et la ligne s'affiche verrouillée. Test Task 4.

---

### Task 1 : Ligne de fiche reconstruite depuis les inscriptions (domaine)

**Files:**
- Create: `src/domain/club-line.ts`
- Test: `tests/domain/club-line.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LineRegistration {
    discipline: DisciplineId; ruleset: Ruleset | null; approxWeightKg: number | null;
    otherDisciplines: DisciplineId[]; acceptsJiyuFirst: boolean | null; originalJson: string | null;
  }
  export interface LineFighter { lastName: string; firstName: string; sex: Sex; ageBandCode: string; grade: string | null }
  /** Ligne de fiche d'un combattant. Une inscription réaffectée est montrée avec ses valeurs d'origine (discipline, règlement), celles du coach. */
  export function registrationsToLine(fighter: LineFighter, regs: LineRegistration[]): { line: ClubFormLine; editable: boolean; reason: string | null };
  export const TWO_COMBATS_REASON = 'Inscrit dans deux disciplines de combat : contactez l’organisateur pour le modifier.';
  ```
- Correspondances :
  - combat : `discipline` d'origine, ainsi que `ruleset` et `approxWeightKg` → `weightKg`. Si absent, le poids vient de l'inscription de kata ;
  - `otherDisciplines[i]` → `prefs[d] = i + 1`, pour `karate`, `shido-boxing` et `shido-mix` seulement ;
  - `acceptsJiyuFirst` : `true` → `shobuKeep: 'discipline'`, `false` → `'ruleset'`, `null` → `null` ; seulement en shobu ;
  - kata : `kata: true`, et `grade` vient du combattant.

- [ ] **Step 1 : tests**
  - `aller-retour : une ligne combat + kata (prefs, shobu, poids, grade) → lineToRows → registrationsToLine redonne la même ligne`. Construire les `LineRegistration` à partir des `input` produits.
  - `combat seul, kata seul : idem`.
  - `inscription réaffectée (originalJson) → discipline et règlement d'origine`.
  - `deux inscriptions de combat → editable false, reason = TWO_COMBATS_REASON`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/domain/club-line.test.ts`. Attendu : FAIL (module absent).
- [ ] **Step 3 : écrire `club-line.ts`.**
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/domain/club-line.test.ts`.
- [ ] **Step 5 : commit** : `feat(inscription en ligne): ligne de fiche reconstruite depuis les inscriptions d'un combattant`

### Task 2 : Annuaire des clubs (API)

**Files:**
- Create: `src/server/repositories/directory.ts`, `src/server/routes/directory.ts`
- Modify: `src/server/app.ts` (enregistrer les routes ; `DirectoryConflictError` → 409 dans le gestionnaire d'erreurs), `src/domain/registration.ts` (types `DirectoryEntry`, `DirectoryInput`)
- Test: `tests/server/directory.test.ts`

**Interfaces:**
- Consumes: `clubDirectory`, `clubs.directoryClubId`, `affiliationNumber` (`src/server/db/club-directory.ts`).
- Produces:
  ```ts
  export interface DirectoryInput { name: string; affiliationNumber: string | null; coachName: string | null; coachPhone: string | null; coachEmail: string | null; notes: string | null }
  export interface DirectoryEntry extends DirectoryInput { id: string; ffkEntity: string | null; archived: boolean; createdAt: string; competitions: number } // competitions = nombre de clubs de compétition reliés
  export class DirectoryConflictError extends Error {}
  export function listDirectory(db: AppDb): DirectoryEntry[];                       // triés par name_key
  export function createDirectoryEntry(db: AppDb, input: DirectoryInput): DirectoryEntry;
  export function updateDirectoryEntry(db: AppDb, id: string, patch: Partial<DirectoryInput> & { archived?: boolean }): DirectoryEntry;  // name → name_key recalculé
  export function mergeDirectoryEntries(db: AppDb, keepId: string, mergeId: string): DirectoryEntry;
  // Routes : GET /api/club-directory ; POST /api/club-directory ; PATCH /api/club-directory/:entryId ; POST /api/club-directory/merge { keepId, mergeId }
  // zod : name 1..120 ; affiliationNumber /^\d{1,12}$/ ou null ; coach* et notes : texte court ou null
  ```

- [ ] **Step 1 : tests** (`directory.test.ts`, via `buildApp` et `inject`) :
  - `création, liste triée, modification (nom → recherche par nom), archivage`.
  - `numéro d'affiliation en double → 409 « Ce numéro d'affiliation est déjà celui de « Tani Dojo ». »` ; `numéro non numérique → 400`.
  - `fusion : clubs de compétition de l'entrée fusionnée reliés à l'entrée gardée, champs vides complétés, entrée fusionnée supprimée, competitions = 2`.
  - `entrée inconnue → 404`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/directory.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : écrire le repository et les routes**, puis enregistrer les routes dans `app.ts`.
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server/directory.test.ts && npm run typecheck`.
- [ ] **Step 5 : commit** : `feat(annuaire): API de l'annuaire des clubs — création, modification, archivage, fusion`

### Task 3 : Invitations, liens personnels, ouverture et gel

**Files:**
- Modify: `src/server/db/schema.ts` (table `clubInvitations`), `src/server/routes/registrations.ts` ou nouveau `src/server/routes/invitations.ts`, `src/server/app.ts`
- Create: `drizzle/0015_club_invitations.sql` (généré, nom `club_invitations`), `src/server/repositories/invitations.ts`
- Test: `tests/server/invitations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // schéma : clubInvitations = sqliteTable('club_invitations', { id (pk), competitionId (FK competitions, cascade), clubId (FK clubs, cascade),
  //   tokenHash: text('token_hash').notNull().unique(), createdAt (défaut), sentAt, revokedAt, lastUsedAt (text, nullables), ...rowMeta() })
  export const newToken: () => string;            // randomBytes(24).toString('base64url')
  export const hashToken: (token: string) => string; // sha256 hex
  export interface InvitationLink { clubId: string; clubName: string; token: string }
  export interface ClubInvitationRow { clubId: string; clubName: string; directoryClubId: string | null; coachEmail: string | null; invited: boolean; invitedAt: string | null; lastUsedAt: string | null; fighters: number }
  export interface ClubEntrySettings { status: 'closed' | 'open' | 'frozen'; deadline: string | null; managedHere: boolean }
  export function listInvitations(db: AppDb, competitionId: string): ClubInvitationRow[];             // tous les clubs de la compétition
  export function inviteClubs(db: AppDb, competitionId: string, directoryIds: string[]): InvitationLink[]; // crée/relie le club de compétition (copie des coordonnées de l'entrée, lien directory_club_id = l'entrée) ; un club qui a déjà un lien actif n'en reçoit pas d'autre (absent du résultat)
  export function regenerateInvitation(db: AppDb, competitionId: string, clubId: string): InvitationLink;
  export function revokeInvitation(db: AppDb, competitionId: string, clubId: string): void;
  export function resolveInvitation(db: AppDb, token: string): { competitionId: string; clubId: string } | null; // lien actif seulement ; met à jour last_used_at
  export function getClubEntrySettings(db: AppDb, competitionId: string): ClubEntrySettings;
  export function updateClubEntrySettings(db: AppDb, competitionId: string, patch: { status?: 'open' | 'frozen'; deadline?: string | null }): ClubEntrySettings; // refusé (409) si managedHere est faux
  // Routes : GET /api/competitions/:id/invitations ; POST /api/competitions/:id/invitations { directoryIds } → InvitationLink[] ;
  //   POST /api/competitions/:id/invitations/:clubId/regenerate → InvitationLink ; DELETE /api/competitions/:id/invitations/:clubId ;
  //   GET|PATCH /api/competitions/:id/club-entry
  ```

- [ ] **Step 1 : tests** (`invitations.test.ts`) :
  - `inviter deux entrées : deux clubs de compétition créés, reliés, coordonnées copiées ; deux liens ; réinviter → aucun nouveau lien`.
  - `inviter une entrée dont le club existe déjà dans la compétition (même nom) → ce club est réutilisé et relié`.
  - `le jeton n'est pas stocké en clair : token_hash = sha256(jeton), aucune colonne ne contient le jeton`.
  - `régénérer : l'ancien jeton ne se résout plus, le nouveau oui ; révoquer : plus aucun`.
  - `ouverture et gel : closed → open (avec date limite) → frozen → open ; refusé (409) si owner_instance_id est renseigné`.
  - `la règle de garde et les déclencheurs de l'étape 15 couvrent club_invitations` (`versionedTables` la contient).
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/invitations.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : modifier le schéma**, lancer `npx drizzle-kit generate --name club_invitations`, puis relire le SQL généré (clés étrangères `ON DELETE cascade`). Mettre à jour la liste exacte du test `versionedTables` de `tests/server/row-versions.test.ts` (ajout de `club_invitations`).
- [ ] **Step 4 : écrire le repository et les routes.**
- [ ] **Step 5 : lancer les tests**, qui doivent passer : `npx vitest run tests/server && npm run typecheck`.
- [ ] **Step 6 : commit** : `feat(inscription en ligne): invitations des clubs (liens personnels hachés), ouverture et gel des inscriptions`

### Task 4 : Page du club côté serveur (routes publiques)

**Files:**
- Create: `src/server/repositories/club-entry.ts`, `src/server/routes/club-entry.ts`
- Modify:
  - `src/server/repositories/registrations.ts` : extraire de `importClubForm` la mise à jour d'une inscription d'un combattant pour une discipline (voir Interfaces) ; `importClubForm` l'utilise, à comportement identique ;
  - `src/server/db/club-directory.ts` : `assignAffiliationNumber` ;
  - `src/server/routes/registrations.ts` : exporter `clubFormLineSchema` (le schéma zod d'une ligne de `paperEntrySchema`) ;
  - `src/server/app.ts` : `ClubEntryClosedError` → 403, `StaleLineError` → 409.
- Test: `tests/server/club-entry.test.ts`

**Interfaces:**
- Consumes: `registrationsToLine` (Task 1), `resolveInvitation` et `getClubEntrySettings` (Task 3), `lineToRows`, `syncCategories`.
- Produces:
  ```ts
  // registrations.ts
  /** Crée ou met à jour l'inscription du combattant pour la discipline (d'origine) de `input`, comme l'import d'une fiche :
   *  une inscription confirmée FFK garde sa catégorie de poids, une autre origine que club_form est gardée, une inscription réaffectée
   *  ne voit changer que ses valeurs d'origine. `exclude` : ids déjà traités. Renvoie l'id de l'inscription. */
  export function upsertFighterRegistration(t: AppDb, competitionId: string, fighterId: string, input: RegistrationInput, exclude: Set<string>): string;
  // db/club-directory.ts
  /** N° d'affiliation donné par le club : voir Global Constraints. Lève AffiliationConflictError (400) si l'entrée a déjà un autre numéro. */
  export function assignAffiliationNumber(db: AppDb, clubId: string, number: string): void;
  // club-entry.ts
  export interface ClubAccess { competitionId: string; clubId: string }
  export interface ClubLine { fighterId: string; version: number; line: ClubFormLine; editable: boolean; reason: string | null }
  export interface ClubEntryHeader { coachName: string | null; coachPhone: string | null; coachEmail: string | null; preApproval: boolean; affiliationNumber: string | null }
  export interface ClubEntryView {
    competition: { name: string; date: string; location: string | null; deadline: string | null; status: 'closed' | 'open' | 'frozen' };
    editable: boolean;
    club: ClubEntryHeader & { name: string };
    ageBands: { code: string; label: string }[];   // tranches proposées sur la fiche, dans l'ordre de la grille
    lines: ClubLine[];                              // triées par nom puis prénom
  }
  export class ClubEntryClosedError extends Error {}  // 403, message des Global Constraints
  export class StaleLineError extends Error {}        // 409
  export function getClubEntry(db: AppDb, access: ClubAccess): ClubEntryView;
  export function updateClubEntryHeader(db: AppDb, access: ClubAccess, header: ClubEntryHeader): ClubEntryView['club'];
  export function saveClubLine(db: AppDb, access: ClubAccess, fighterId: string | null, line: ClubFormLine, expectedVersion: number | null): ClubLine;
  export function deleteClubLine(db: AppDb, access: ClubAccess, fighterId: string, expectedVersion: number): void;
  // Routes (src/server/routes/club-entry.ts), le jeton résolu dans un preHandler (404 sinon) :
  //   GET /api/inscription/:token ; PATCH /api/inscription/:token/club ; POST /api/inscription/:token/lines { line } ;
  //   PUT /api/inscription/:token/lines/:fighterId { line, version } ; DELETE /api/inscription/:token/lines/:fighterId?version=N
  //   après chaque écriture réussie : await syncCategories(db, competitionId)
  ```
- `saveClubLine` :
  - Validation par `lineToRows` (source forcée à `online`).
  - Combattant existant : il doit appartenir au club. Ses champs suivent la ligne : nom, prénom, sexe, âge, et grade si kata.
  - Chaque inscription produite passe par `upsertFighterRegistration`. Les autres inscriptions du combattant (discipline retirée ou changée) sont supprimées.
  - Nouveau combattant : contrôle de doublon, création avec `clubId`.
  - Le tout dans une transaction.

- [ ] **Step 1 : tests** (`club-entry.test.ts`, via `buildApp` et `inject`, avec un club invité et des inscriptions ouvertes) :
  - `GET : compétition, en-tête du club, tranches proposées, lignes de tous les combattants du club (fiche + FFK + saisie), d'aucun autre club`.
  - `lien inconnu ou révoqué → 404 « Lien inconnu ou expiré. »`.
  - `ajouter une ligne combat + kata → deux inscriptions « online », catégorie de poids déduite du poids ; GET la renvoie identique`.
  - `ligne invalide → 400 avec les messages de lineToRows ; doublon de nom → 400 « MARTIN Léa est déjà dans la liste. »`.
  - `changer karaté → boxing : l'inscription karaté disparaît, une seule inscription de combat, catégories recalculées`.
  - `retirer le kata d'une ligne combat + kata → l'inscription kata est supprimée, le combattant reste`.
  - `combattant FFK corrigé (règlement, préférences) → origine « ffk » et catégorie de poids FFK gardées`.
  - `version périmée (l'organisateur a modifié l'inscription entre-temps) → 409, rien n'est écrit`.
  - `supprimer une ligne → inscriptions et combattant supprimés ; version périmée → 409`.
  - `catégorie commencée → modifier et supprimer refusés (409) ; la ligne est editable false`.
  - `deux disciplines de combat → ligne en lecture seule (editable false, reason)`.
  - `inscriptions figées (ou closed, ou owner_instance_id renseigné) → GET editable false ; toute écriture → 403 avec le message exact`.
  - `en-tête : club de compétition et annuaire mis à jour ; N° d'affiliation libre → donné à l'entrée ; tenu par une autre entrée → club relié à celle-ci ; entrée avec un autre numéro → 400`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/club-entry.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : extraire `upsertFighterRegistration`** de `importClubForm`, puis lancer `npx vitest run tests/server`. Attendu : tout ce qui passait passe encore.
- [ ] **Step 4 : écrire `assignAffiliationNumber`, `club-entry.ts` et les routes**, puis brancher les erreurs dans `app.ts`.
- [ ] **Step 5 : lancer les tests**, qui doivent passer : `npx vitest run tests/server && npm run typecheck`.
- [ ] **Step 6 : commit** : `feat(inscription en ligne): page du club côté serveur — tous les combattants du club, une ligne par combattant, versions, verrous, gel`

### Task 5 : Écran « Annuaire des clubs »

**Files:**
- Create: `src/web/pages/DirectoryPage.tsx`
- Modify: `src/web/App.tsx` (route `/annuaire` dans `MainShell`), `src/web/components/AppHeader.tsx` (lien « Annuaire des clubs »), `src/web/api.ts` (`useDirectory`, `useCreateDirectoryEntry`, `useUpdateDirectoryEntry`, `useMergeDirectoryEntries`), `src/web/help.ts` (sujet `annuaire`)
- Test: `tests/web/help.test.ts` (sujet présent), e2e en Task 8

**Interfaces:**
- Consumes: routes de Task 2.
- L'écran :
  - recherche par nom ou numéro ; case « Afficher les clubs archivés » ;
  - un tableau : Club, N° d'affiliation, Coach, Téléphone, E-mail, Compétitions, avec les actions « Modifier », « Archiver » ou « Désarchiver », « Fusionner avec… » ;
  - « Ajouter un club » ouvre une fenêtre de saisie (Nom requis, N° d'affiliation, Coach, Téléphone, E-mail, Notes) ;
  - « Fusionner avec… » ouvre une fenêtre où l'on choisit l'entrée à garder, avec une phrase de confirmation : « Les compétitions de « X » passeront à « Y », puis « X » sera supprimé. » ;
  - les erreurs passent par `ApiErrorAlert`.

- [ ] **Step 1 : test** : dans `tests/web/help.test.ts`, ajouter `annuaire : aide présente, elle parle du numéro d'affiliation et de la fusion` (`all('annuaire')` contient « affiliation » et « Fusionner »). Le test doit échouer : `npx vitest run tests/web/help.test.ts`.
- [ ] **Step 2 : écrire l'écran, la route, le lien et les hooks.**
- [ ] **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/web`. Puis contrôle visuel avec `npm run dev`, sur l'adresse `/annuaire` (création, recherche, fusion).
- [ ] **Step 4 : commit** : `feat(annuaire): écran « Annuaire des clubs »`

### Task 6 : Onglet Fiche club, section « Inscriptions en ligne »

**Files:**
- Create: `src/web/components/OnlineEntryPanel.tsx`
- Modify: `src/web/pages/ClubFormPage.tsx` (la section vient en tête), `src/web/api.ts` (`useInvitations`, `useInviteClubs`, `useRegenerateInvitation`, `useRevokeInvitation`, `useClubEntrySettings`, `useUpdateClubEntrySettings`), `src/web/help.ts` (sujet `fiche-club.en-ligne`)
- Test: `tests/web/help.test.ts`, e2e en Task 8

**Interfaces:**
- Consumes: routes de Task 3.
- La section :
  - **État** : « Inscriptions ouvertes jusqu'au … », « Inscriptions ouvertes », ou « Inscriptions closes ». On y trouve aussi la date limite (DateInput) et le bouton « Ouvrir les inscriptions », « Figer les inscriptions » ou « Rouvrir les inscriptions » selon l'état. Ce bouton est désactivé avec une explication si `managedHere` est faux.
  - **Tableau des clubs de l'annuaire non archivés**, avec une case à cocher, Club, Invité (date), Dernière visite, Combattants, et les actions « Régénérer le lien » et « Révoquer ».
  - « Inviter les clubs cochés » puis, après « Régénérer le lien », une **fenêtre « Liens créés »** : une ligne par club, avec le lien complet (`${location.origin}/inscription/<jeton>`), « Copier le lien », et la phrase : « Copiez ces liens maintenant : pour des raisons de sécurité, ils ne seront plus affichés. »

- [ ] **Step 1 : test** : dans `tests/web/help.test.ts`, ajouter `inscriptions en ligne : l'aide dit que les liens ne s'affichent qu'une fois et que figer rend la page du club en lecture seule` (`all('fiche-club.en-ligne')` contient « une seule fois » et « lecture seule »). Le test doit échouer.
- [ ] **Step 2 : écrire la section et les hooks.** Après chaque mutation, invalider `['invitations', id]`, `['club-entry', id]` et `['clubs', id]`.
- [ ] **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/web`, puis contrôle visuel avec `npm run dev`.
- [ ] **Step 4 : commit** : `feat(inscription en ligne): section « Inscriptions en ligne » de l'onglet Fiche club`

### Task 7 : Page du club `/inscription/:token`

**Files:**
- Create: `src/web/pages/ClubEntryPage.tsx`, `src/web/components/ClubLineForm.tsx`
- Modify: `src/web/App.tsx` (route `/inscription/:token` **hors** de `MainShell`, comme les impressions), `src/web/api.ts` (`useClubEntry(token)`, `useSaveClubHeader`, `useSaveClubLine`, `useDeleteClubLine` ; un 409 déclenche le rechargement de `['club-entry', token]`)

**Interfaces:**
- Consumes: routes de Task 4, type `ClubEntryView`.
- La page :
  - **En-tête** : logo, nom, date et lieu de la compétition, et l'état (Global Constraints) ;
  - **Bloc « Votre club »** : nom en lecture seule ; Coach, Téléphone, E-mail, N° d'affiliation FFK (facultatif) ; case « Le coach accepte d'avance les reclassements de ses combattants » ; bouton « Enregistrer les coordonnées » ;
  - **Liste**, une carte par combattant : « NOM Prénom », « F · Cadets · 54 kg », « Karaté (jiyu) + Kata », et « Modifier ». Si `editable` est faux, la carte porte un badge « Verrouillé » et sa raison ;
  - « Ajouter un combattant » ;
  - **Formulaire `ClubLineForm`** dans une fenêtre, plein écran sous 600 px :
    - Nom, Prénom, Sexe (F/M), Catégorie d'âge (liste des tranches proposées), Poids actuel (kg) ;
    - Combat (Karaté, Boxing, Mix, Triathlon, un seul choix) et Kata (case) ;
    - Règlement (Jiyu ou Shobu), Grade (si kata) ;
    - « Si reclassement » : Karaté, Boxing et Mix, à numéroter 1 ou 2 ;
    - « Shobu : garder en priorité » (les règles shobu, ou la discipline) ;
    - boutons « Enregistrer », « Annuler », « Supprimer » (pour un combattant existant, avec confirmation) ;
    - les erreurs 400 s'affichent dans le formulaire ;
  - **Lecture seule** (`editable` faux) : aucun bouton d'écriture.
- Mêmes libellés que la saisie papier : réutiliser `ageBandAbbreviations` et les listes de `PaperEntryTable.tsx`. Si utile, exporter les listes `COMBATS` et `PREFS` depuis ce composant.

- [ ] **Step 1 : écrire la page et le formulaire.**
- [ ] **Step 2 : vérifier** : `npm run typecheck`, puis contrôle visuel avec `npm run dev`, dans une fenêtre de 390 px de large. Points à contrôler : ajout, modification, suppression, rechargement, lecture seule après « Figer ».
- [ ] **Step 3 : commit** : `feat(inscription en ligne): page du club (liste et formulaire d'un combattant, lisible sur téléphone)`

### Task 8 : Parcours complet (e2e), documents

**Files:**
- Create: `tests/e2e/inscription-en-ligne.spec.ts`
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 16), `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1 : e2e** `inscription en ligne : annuaire → invitation → le coach inscrit, modifie, supprime → l'organisateur voit « En ligne » → figé : lecture seule` :
  1. Créer « Tani Dojo » dans l'Annuaire des clubs, puis créer une compétition.
  2. Fiche club : « Ouvrir les inscriptions », cocher Tani Dojo, « Inviter les clubs cochés ». Lire le lien dans la fenêtre « Liens créés ».
  3. Ouvrir le lien dans une nouvelle page, en 390×844. « Ajouter un combattant » : MARTIN Léa, F, Cadets, 54 kg, Karaté, Jiyu, Kata, grade. Enregistrer, recharger : la carte est là, avec « Karaté (jiyu) + Kata ».
  4. Modifier : Boxing à la place de Karaté. Ajouter un second combattant, puis le supprimer.
  5. Onglet Inscriptions de l'organisateur : deux inscriptions MARTIN, d'origine « En ligne », en shido-boxing et en kata.
  6. « Figer les inscriptions », puis recharger la page du club : « Inscriptions closes : contactez l'organisateur. », et aucun bouton « Ajouter un combattant ».
- [ ] **Step 2 : lancer toute la suite**, qui doit passer : `npm run typecheck && npm test && npm run test:e2e`.
- [ ] **Step 3 : documents.** Ajouter l'étape 16 à la feuille de route. Dans le bilan : les décisions (rulings) et le décompte des tests.
- [ ] **Step 4 : commit** : `test(e2e): inscription en ligne de bout en bout ; docs : étape 16`
