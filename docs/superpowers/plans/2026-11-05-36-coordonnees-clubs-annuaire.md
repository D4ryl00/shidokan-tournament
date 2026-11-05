# Étape 36 — Coordonnées des clubs entre annuaire et compétitions : plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plus aucune écriture silencieuse entre un club de compétition et sa fiche d'annuaire : chaque différence est signalée, puis décidée par l'organisateur, dans les deux sens.

**Architecture:** Une table `club_changes` garde, par club de compétition, les valeurs à examiner, leur origine et l'état « ignoré » ; la différence avec la fiche est recalculée à chaque lecture. La logique de comparaison est pure (`src/domain/club-changes.ts`), l'enregistrement et les décisions sont dans `src/server/repositories/club-changes.ts`. Les écrans s'appuient sur une fenêtre de comparaison et une fenêtre « compétitions à venir ».

**Tech Stack:** TypeScript, Fastify, drizzle, SQLite, React, Mantine, Vitest (`node`), Playwright sur Chrome.

**Spec:** `docs/superpowers/specs/2026-11-05-coordonnees-clubs-annuaire-design.md`

## Global Constraints

- Branche `coordonnees-clubs-annuaire`. Interface, messages et commentaires en français. Commits conventionnels.
- Champs comparés, partout : nom du club, nom du coach, téléphone, adresses e-mail, numéro d'affiliation.
- Un champ effacé est une modification proposée ; l'annuaire n'est vidé que si l'organisateur choisit cette valeur. Le nom du club ne peut pas être vide.
- « À venir » : date de la compétition supérieure ou égale à la date du jour.
- Migration `0031` : table `club_changes` et colonne `clubs.affiliation_number`, sans perte.
- Seules la page en ligne d'un club et l'onglet Clubs créent un changement. Google, l'import d'une fiche et l'import FFK n'en créent pas.
- Jamais de modification d'une compétition gérée ailleurs. Un coach n'est jamais bloqué par un changement en attente.
- Bandeaux avec les jetons `--sk-*`, lisibles dans les deux thèmes.
- e2e serveur (port 3101) : `SERVER_SESSION`, pas de nouvelle connexion. Noms de compétition uniques. Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte. Pas de données réelles.
- Commandes : `npx vitest run <fichier>`, `npm test`, `npm run typecheck`, `npx playwright test <fichier>`, `npm run test:e2e`.

## Review Focus

1. Un coach réenregistre sa fiche sans rien changer après un « Ignorer » : aucune nouvelle alerte → test en tâche 2.
2. Un coach efface son téléphone, ses adresses ou son numéro : la compétition les perd, l'annuaire les garde, la différence est proposée, et sa page n'affiche pas de nouveau la valeur effacée → test en tâche 2.
3. Le passage de main, aller et retour, garde le changement et le numéro du club → test en tâche 1.
4. Deux compétitions ont un changement sur la même fiche ; une décision sur l'une rend l'autre identique : l'autre disparaît, sinon elle reste → test en tâche 3.
5. Modification de la fiche pendant que la fenêtre de comparaison est ouverte, ou compétition passée sous la main d'un PC entre l'ouverture et l'enregistrement : refus clair, rien d'écrit à moitié → test en tâche 3.

---

### Task 1: Logique de comparaison, table et colonne

**Files:**
- Create: `src/domain/club-changes.ts`, `tests/domain/club-changes.test.ts`, `drizzle/0031_*.sql` (générée : `npx drizzle-kit generate --name coordonnees_clubs`), `tests/server/migration-0031.test.ts`
- Modify: `src/server/db/schema.ts`, `src/server/sync/package.ts`, `src/server/repositories/retention.ts`, `src/server/repositories/directory.ts`, `tests/server/row-versions.test.ts` si besoin

**Interfaces:**
- Produces, dans `src/domain/club-changes.ts` :
  - `CLUB_FIELDS = ['name', 'coachName', 'coachPhone', 'coachEmails', 'affiliationNumber'] as const`, `type ClubField` ;
  - `interface ClubValues { name: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; affiliationNumber: string | null }` ;
  - `differingFields(a: ClubValues, b: ClubValues): ClubField[]` : les e-mails se comparent sans casse et sans ordre (`sameEmail`) ;
  - `defaultChoice(field: ClubField, competition: ClubValues): 'competition' | 'directory'` : `directory` si la valeur de la compétition est vide ;
  - `emailChoices(directory: string[], competition: string[]): { email: string; origin: 'both' | 'competition' | 'directory'; checked: boolean }[]` : celles de la compétition d'abord, dans leur ordre, cochées ;
  - `resolvedValues(directory: ClubValues, competition: ClubValues, choices: Partial<Record<ClubField, 'competition' | 'directory'>>, emails: string[]): ClubValues` ;
  - `propagationKind(field: ClubField, club: ClubValues, before: ClubValues): 'apply' | 'conflict'` : `apply` seulement si le club avait exactement la valeur d'avant ;
  - `isUpcoming(competitionDate: string, today: string): boolean`.
- Produces, dans le schéma : `clubs.affiliationNumber` (`affiliation_number`, texte ; `''` = effacé par le club, `null` = jamais saisi) ; table `clubChanges` (`club_changes`) : `clubId` clé primaire, cascade sur `clubs` ; `competitionId`, cascade ; `directoryId`, cascade sur `club_directory` ; `origin: 'club' | 'competition'` ; `valuesJson` ; `changedAt` ; `ignored` booléen. Sans `rowMeta()`.

- [ ] **Step 1: Écrire les tests purs qui échouent**

```ts
const a: ClubValues = { name: 'Dojo', coachName: 'Marie', coachPhone: '06', coachEmails: ['a@x.fr', 'b@x.fr'], affiliationNumber: null };
expect(differingFields(a, { ...a, coachEmails: ['B@x.fr', 'a@x.fr'] })).toEqual([]);
expect(differingFields(a, { ...a, name: 'Dojo 2', coachPhone: null })).toEqual(['name', 'coachPhone']);
expect(defaultChoice('coachPhone', { ...a, coachPhone: '07' })).toBe('competition');
expect(defaultChoice('coachPhone', { ...a, coachPhone: null })).toBe('directory');
expect(emailChoices(['a@x.fr', 'old@x.fr'], ['new@x.fr', 'A@x.fr'])).toEqual([
  { email: 'new@x.fr', origin: 'competition', checked: true },
  { email: 'A@x.fr', origin: 'both', checked: true },
  { email: 'old@x.fr', origin: 'directory', checked: false },
]);
expect(resolvedValues(a, { ...a, name: 'Autre', coachName: null }, { name: 'competition', coachName: 'directory' }, ['b@x.fr'])).toEqual({ ...a, name: 'Autre', coachEmails: ['b@x.fr'] });
expect(propagationKind('coachPhone', { ...a, coachPhone: '06' }, a)).toBe('apply');
expect(propagationKind('coachPhone', { ...a, coachPhone: '09' }, a)).toBe('conflict');
expect(isUpcoming('2026-11-05', '2026-11-05')).toBe(true);
expect(isUpcoming('2026-11-04', '2026-11-05')).toBe(false);
```

- [ ] **Step 2: Vérifier l'échec, implémenter, vérifier.** Run: `npx vitest run tests/domain/club-changes.test.ts`. Expected: FAIL puis PASS.

- [ ] **Step 3: Écrire les tests de base qui échouent.** `migration-0031.test.ts` (avec `olderDb(30)`) : clubs intacts, `affiliation_number` nul, `club_changes` vide. Dans le même fichier : une ligne `club_changes` disparaît avec son club et avec sa fiche ; `mergeDirectoryEntries` déplace le `directory_id` vers la fiche gardée ; `purgeExpiredData` supprime les lignes des compétitions purgées ; `unclassifiedTables(db)` reste vide ; un paquet ne contient pas `club_changes` mais contient `clubs.affiliation_number` ; un paquet repris puis rendu (`take`, `return` comme dans `tests/server/services-clubs.test.ts`) garde la ligne et le numéro du club.

- [ ] **Step 4: Implémenter.** Colonne et table dans le schéma, migration générée, `club_changes` dans `LOCAL_ONLY_TABLES` et dans la liste de suppression de `purgeExpiredData`, déplacement dans `mergeDirectoryEntries`. Si le retour d'un paquet supprime les clubs, faire en sorte que la ligne survive tant que le club existe. Run les deux fichiers et `tests/server/row-versions.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** : `feat(clubs): comparaison annuaire-compétition, table des changements et numéro propre au club`.

### Task 2: Enregistrer les changements, sans plus écrire dans l'annuaire

**Files:**
- Create: `src/server/repositories/club-changes.ts`, `tests/server/club-changes.test.ts`
- Modify: `src/server/repositories/club-entry.ts`, `src/server/repositories/registrations.ts`, `tests/server/club-entry.test.ts`

**Interfaces:**
- Consumes: `ClubValues`, `differingFields`.
- Produces: `clubValues(club): ClubValues` (numéro : `''` → `null`, sinon le numéro du club, sinon celui de la fiche) ; `directoryValues(entry): ClubValues` ; `recordClubChange(db: AppDb, clubId: string, origin: 'club' | 'competition'): void`.

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/server/club-changes.test.ts`, sur l'API avec `buildApp({ dbPath, clubServices: true })`) :
  - **page du club :** `PATCH /api/inscription/:token/club` change le club ; la fiche d'annuaire **ne change pas** (coach, téléphone, e-mails, numéro) ; une ligne `club_changes` d'origine `club` existe ;
  - **sans différence :** réenregistrer les valeurs de la fiche supprime la ligne ;
  - **ignoré :** avec `ignored = 1` et les mêmes valeurs, un nouvel enregistrement laisse `ignored = 1` ; une valeur différente repasse `ignored = 0` ;
  - **effacement :** téléphone nul et `coachEmails: []` donnent une différence ; la fiche garde ses valeurs ; `GET /api/inscription/:token` renvoie le téléphone nul et aucune adresse ;
  - **numéro :** un numéro libre sur une fiche sans numéro n'est pas écrit dans la fiche, et `GET /api/inscription/:token` le renvoie ; un numéro effacé alors que la fiche en a un renvoie `null` et crée une différence ; les refus restent : numéro d'une autre fiche, autre numéro que celui de la fiche (mêmes messages qu'aujourd'hui) ;
  - **onglet Clubs :** `PATCH /api/competitions/:id/clubs/:clubId` avec un nouveau nom et un téléphone crée une ligne d'origine `competition` et ne change pas la fiche, même si le champ de la fiche est vide ;
  - **autres chemins :** l'import d'une fiche et l'ajout d'un combattant ne créent pas de ligne ;
  - **club sans fiche :** une fiche créée par `linkClub` prend les valeurs du club, sans ligne.

- [ ] **Step 2: Vérifier l'échec.** Run: `npx vitest run tests/server/club-changes.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implémenter.**
  - `updateClubEntryHeader` : met à jour le club (numéro compris : valeur, ou `''` si effacé), garde `linkClub` si le club n'a pas de fiche, contrôle le numéro avec les refus de `assignAffiliationNumber` sans écrire dans la fiche, puis `recordClubChange(…, 'club')`.
  - `headerOf` : le numéro vient de `clubValues`.
  - `updateClub` : `linkClub` seulement si le club n'a pas de fiche, car il complète aujourd'hui les champs vides de la fiche ; puis `recordClubChange(…, 'competition')`, seulement si `name`, `coachName`, `coachPhone` ou `coachEmails` figurent dans le patch.
  - `recordClubChange` : sans fiche, rien ; sans différence, supprime la ligne ; ligne ignorée aux mêmes valeurs, inchangée ; sinon, écrit la ligne, `ignored = 0`.

- [ ] **Step 4: Vérifier.** Adapter `tests/server/club-entry.test.ts` à la nouvelle règle (l'annuaire ne suit plus). Run: `npx vitest run tests/server/club-changes.test.ts tests/server/club-entry.test.ts`, puis `npm test`. Expected: PASS ; corriger tout test qui supposait une écriture dans l'annuaire, sans rien affaiblir d'autre.

- [ ] **Step 5: Commit** : `feat(clubs): la page d'un club et l'onglet Clubs n'écrivent plus dans l'annuaire ; changements à examiner enregistrés`.

### Task 3: Décisions côté serveur

**Files:**
- Create: `src/server/routes/club-changes.ts`
- Modify: `src/server/repositories/club-changes.ts`, `src/server/routes/directory.ts`, `src/server/app.ts`, `tests/server/club-changes.test.ts`, `tests/server/permissions.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2, `updateDirectoryEntry`, `getManagement`.
- Produces, en dépôt et en route :
  - `listClubChanges(db, competitionId?): ClubChangeView[]`, `GET /api/club-changes?competitionId=` ; `ClubChangeView = { clubId; competitionId; competitionName; competitionDate; managedHere; ownerName; upcoming: boolean; directoryId; directoryVersion: number; origin; changedAt; values: ClubValues; directory: ClubValues; fields: ClubField[] }`. Exclut les lignes ignorées et les fiches archivées. Supprime les lignes sans différence.
  - `resolveClubChange(db, clubId, { directoryVersion: number; values: ClubValues; applyToClub: boolean }): void`, `POST /api/club-changes/:clubId/resolve`.
  - `ignoreClubChange(db, clubId): void`, `POST /api/club-changes/:clubId/ignore` : `ignored = 1`, réponse 204.
  - `upcomingDifferences(db, entryId, before: ClubValues): UpcomingLine[]` ; `UpcomingLine = { clubId; competitionId; competitionName; competitionDate; managedHere; ownerName; field: ClubField; kind: 'apply' | 'conflict'; clubValue; directoryValue }`.
  - `PATCH /api/club-directory/:entryId` répond `{ ...entry, upcoming: UpcomingLine[] }`.
  - `applyDirectoryToClubs(db, entryId, items: { clubId: string; fields: ClubField[] }[]): { competitionName: string; status: 'applied' | 'refused'; message: string | null }[]`, `POST /api/club-directory/:entryId/apply-to-clubs`.

- [ ] **Step 1: Écrire les tests qui échouent.**
  - `GET` : ignoré et archivé absents ; désarchiver fait revenir ; filtre `competitionId` ; une ligne devenue identique disparaît.
  - `resolve` : la fiche prend `values` ; avec `applyToClub`, le club les prend aussi ; sans, il garde les siennes ; ligne supprimée ; effacement choisi : la fiche est vidée ; autre changement sur la même fiche : supprimé s'il devient identique, gardé sinon.
  - `resolve`, refus (rien d'écrit) : `directoryVersion` périmée en 409, `Cette fiche vient de changer : rouvrez la comparaison.` ; numéro d'une autre fiche, avec le message de `checkNumber` ; `applyToClub` sur une compétition gérée ailleurs ou passée en 409, fiche inchangée.
  - `PATCH` d'une fiche : `upcoming` vide s'il n'y a aucun club à venir qui diffère ; compétition passée absente ; club à l'ancienne valeur, `kind: 'apply'` ; club à une autre valeur, `kind: 'conflict'` ; compétition gérée ailleurs présente avec `managedHere: false` ; la fiche est enregistrée quoi qu'il arrive.
  - `apply-to-clubs` : champs choisis appliqués, y compris une valeur vide ; un nom déjà pris dans la compétition rend `refused` pour elle, et les autres passent ; compétition gérée ailleurs `refused` ; une ligne devenue identique disparaît.
  - Permissions (`tests/server/permissions.test.ts`) : Table centrale et Zone refusées sur ces routes ; une modification faite par Table centrale dans l'onglet Clubs crée quand même la ligne.

- [ ] **Step 2: Vérifier l'échec, implémenter, vérifier.** Run: `npx vitest run tests/server/club-changes.test.ts tests/server/permissions.test.ts`. Expected: FAIL puis PASS. Chaque écriture dans une transaction. Une route refusée sur un autre club d'une compétition passe par `getManagement`, car ces routes ne sont pas sous `/api/competitions/:id`. Enregistrer les routes dans tous les rôles.

- [ ] **Step 3: Commit** : `feat(clubs): décisions sur les changements et report de l'annuaire vers les compétitions à venir`.

### Task 4: Bandeaux et fenêtre de comparaison

**Files:**
- Create: `src/web/components/club-changes/ClubChangeModal.tsx`, `src/web/components/club-changes/ClubChangeBanners.tsx`, `tests/e2e/coordonnees-clubs.spec.ts`
- Modify: `src/web/api.ts`, `src/web/pages/DirectoryPage.tsx`, `src/web/pages/ClubFormPage.tsx`, `src/web/components/OnlineEntryPanel.tsx`, `src/web/pages/ClubsPage.tsx`

**Interfaces:**
- Consumes: routes de la tâche 3, `defaultChoice`, `emailChoices`, `resolvedValues`.
- Produces: `useClubChanges(competitionId?)`, `useResolveClubChange()`, `useIgnoreClubChange()` (clé `['club-changes']`, activées pour l'organisateur seulement) ; `<ClubChangeModal change onClose onDone />` ; `<DirectoryChangesBanner onOpen />` ; `<CompetitionChangesBanner competitionId onOpen />` ; `<ClubChangePill origin />`.

- [ ] **Step 1: Écrire le parcours e2e qui échoue** (`tests/e2e/coordonnees-clubs.spec.ts`, port 3101, `SERVER_SESSION`). Fiche à trois adresses, club invité, lien créé par `inviteWithLink`. Le coach modifie son téléphone et retire une adresse par `PATCH /api/inscription/:token/club`. Puis :
  - **Annuaire :** bandeau `1 club diffère de l'annuaire après une modification dans une compétition.`, pastille `Modifié par le club` ; « Voir les changements » ouvre la fenêtre ; téléphone du club choisi par défaut ; case `(seulement dans l'annuaire)` décochée.
  - **Fiche club :** bandeau `<Club> a été modifié le <date> par le club : il diffère de l'annuaire.` et pastille sur la ligne.
  - « Plus tard » : rien ne change, le bandeau reste.
  - « Ignorer ce changement » : le bandeau disparaît ; un nouvel enregistrement identique ne le fait pas revenir ; un autre téléphone le fait revenir.
  - « Enregistrer dans l'annuaire » : la fiche a les choix ; le bandeau disparaît.
  - **Onglet Clubs :** modifier le nom du club affiche la notification `<Club> diffère de l'annuaire.` avec « Comparer », qui ouvre la fenêtre ; pastille `Modifié dans la compétition`.
  - **Effacement :** téléphone vide affiché `(vide)`, annuaire choisi par défaut.
  - **Compte Table centrale :** ne voit ni bandeau ni pastille (réutiliser le compte de `tests/e2e/roles.spec.ts` si cela reste sans nouvelle connexion, sinon couvrir par les permissions de la tâche 3 et le dire dans le rapport).

- [ ] **Step 2: Vérifier l'échec.** Run: `npx playwright test tests/e2e/coordonnees-clubs.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implémenter.**
  - Fenêtre : titre `<Club> : garder quelles informations ?`, sous-titre avec compétition et date ; `Radio` par champ (`Annuaire`, `Compétition`), champ identique sans choix, valeur vide `(vide)` ; cases e-mails d'après `emailChoices`, avec les libellés `dans les deux`, `ajoutée dans la compétition`, `seulement dans l'annuaire` ; case `Appliquer aussi au club dans <compétition>`, cochée, désactivée avec `Gérée par <nom> : à appliquer après le retour de la main.`, absente si `upcoming` est faux. Boutons `Plus tard`, `Ignorer ce changement`, `Enregistrer dans l'annuaire`. Refus du serveur affiché dans la fenêtre.
  - « Voir les changements » : ouvre le premier, puis le suivant après chaque décision.
  - Fiche club : bandeau en tête de `ClubFormPage`, hors du panneau en ligne ; au-delà de 3 clubs, un seul bandeau `N clubs diffèrent de l'annuaire.` Annuaire : bandeau, pastille et bouton « Comparer ».
  - Onglet Clubs : notification Mantine avec le bouton « Comparer » après une modification créant un changement, et pastille sur la ligne.

- [ ] **Step 4: Vérifier.** Run: `npx playwright test tests/e2e/coordonnees-clubs.spec.ts`, `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** : `feat(clubs): bandeaux et fenêtre de comparaison entre annuaire et compétition`.

### Task 5: Fenêtre « Appliquer aux compétitions à venir »

**Files:**
- Create: `src/web/components/club-changes/ApplyToClubsModal.tsx`
- Modify: `src/web/api.ts`, `src/web/pages/DirectoryPage.tsx`, `tests/e2e/coordonnees-clubs.spec.ts`

**Interfaces:**
- Consumes: `upcoming` et `apply-to-clubs` de la tâche 3.
- Produces: `useApplyDirectoryToClubs()` ; `<ApplyToClubsModal entryId lines onClose />`.

- [ ] **Step 1: Écrire le parcours e2e qui échoue.** Une fiche reliée à une compétition à venir où le club a l'ancienne valeur, à une autre où le coach a saisi un autre téléphone, à une passée, et à une gérée ailleurs. Modifier téléphone et e-mails de la fiche. Assertions : la fenêtre `Appliquer aux compétitions à venir ?` s'ouvre ; la première ligne est cochée ; la seconde affiche `Conflit` avec `Garder le club` choisi ; la passée est absente ; la gérée ailleurs affiche `Gérée par <nom> : à appliquer après le retour de la main.` sans choix. « Appliquer » : la première compétition change, la seconde garde sa valeur, le résultat est dit par compétition. « Ne rien appliquer » laisse les clubs, et la fiche reste enregistrée. Une fiche sans différence n'ouvre aucune fenêtre.

- [ ] **Step 2: Vérifier l'échec, implémenter, vérifier.** Run: `npx playwright test tests/e2e/coordonnees-clubs.spec.ts`. Expected: FAIL puis PASS. Lignes groupées par compétition, date affichée ; e-mails résumés (`retire ancien@…`, `ajoute nouveau@…`) ; valeur vide `(vide)`. `EntryModal` ferme sa fenêtre, puis la page ouvre celle-ci si `upcoming` n'est pas vide.

- [ ] **Step 3: Commit** : `feat(clubs): reporter une fiche d'annuaire vers les compétitions à venir, avec les conflits`.

### Task 6: Aide, guide et vérifications

**Files:**
- Modify: `src/web/help.ts`, `docs/guide-utilisateur.md`, `src/web/pages/ClubEntryPage.tsx` si un texte promet une mise à jour de l'annuaire, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`

- [ ] **Step 1: Mettre à jour l'aide et le guide.** Copie à l'invitation, bandeaux, comparaison, « Ignorer » jusqu'à la prochaine modification, champ effacé, compétitions à venir, Google sans fenêtre. Corriger tout texte qui dirait que l'annuaire suit la page du club (`grep -rn "annuaire" src/web/help.ts docs/guide-utilisateur.md`). Run: `npx vitest run tests/web/help.test.ts`. Expected: PASS.

- [ ] **Step 2: Lancer toutes les vérifications.** Run: `npm run typecheck && npm test && npm run test:e2e`. Expected: tout PASS. Noter les totaux.

- [ ] **Step 3: Commit** : `docs: étape 36, aide et guide sur les coordonnées des clubs`.

L'essai dans Chrome avec l'extension et le bilan se font après la relecture finale, par le contrôleur : chaque correction doit y être revue.
