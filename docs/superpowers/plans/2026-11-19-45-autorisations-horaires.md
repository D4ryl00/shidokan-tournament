# Étape 45 — Autorisations des coachs, horaires estimés et confort du jour J : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** suivre les autorisations à demander aux coachs (calculées en direct, réponses enregistrées), appliquer le plan « en attente d'autorisation », estimer les horaires de la journée, et les améliorations Pesée / Historique / Tableaux / Inscriptions.

**Architecture:** un module de domaine pur calcule les demandes depuis le `State` de la réaffectation ; seule la réponse « Accordée » est enregistrée (table `authorization_answers`) avec la situation acceptée ; « Refusée » réutilise l'annulation de l'historique. Les horaires réutilisent `planPassages` (répartition en direct) et `buildTimeline` (étendu d'un plancher par zone). Le reste est de l'interface.

**Tech Stack:** TypeScript (TS 7 natif), React + Mantine 8, TanStack Query, Fastify, SQLite (better-sqlite3 + drizzle), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-autorisations-horaires-et-confort-design.md` (lire en entier avant toute tâche).

## Global Constraints

- Branche `etape-45-autorisations-horaires` depuis `main` ; commits conventionnels en français (`feat(reaffectation): …`).
- Interface en français ; composants de `src/web/components/ui/` ; jetons `--sk-*` ; clair et sombre ; largeur téléphone sans défilement horizontal (helper e2e `clipped()`).
- Seuil de poids de l'organisateur : l'écart est d'abord **arrondi au dixième selon la règle mathématique** (`Math.round(gap * 10) / 10` : 5,04 → 5,0 ; 5,05 → 5,1), puis comparé : **> 5 kg** demande un accord, **5 kg (arrondi) : rien**. Affichage sans « ,0 » inutile : 5,0 → « 5 kg », 7,25 → « 7,3 kg » (décision de l'organisateur, 2026-11-19).
- Le pré-accord du club et les choix de la fiche (autres disciplines, Shobu → Jiyu) **ne dispensent d'aucune demande**.
- Toute nouvelle route d'écriture : `src/server/journal/coverage.ts` (COVERED avec `recordJournal`, ou EXEMPT si c'est un calcul), `src/server/auth/permissions.ts` (Organisation et Table centrale, pas Zone), test `tests/server/journal-coverage.test.ts` vert.
- Nouvelle table : migration `drizzle/0039_*.sql` + snapshot/journal drizzle (`npm run db:generate`), `src/server/sync/package.ts` (liste des tables), sauvegardes (vérifier `tests/server/backups.test.ts`), versions de lignes automatiques (vérifier `tests/server/row-versions.test.ts`), test de migration `tests/server/migration-0039.test.ts`.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (mémoire projet) ; e2e et contrôles visuels sur une base temporaire ou une copie de sauvegarde.
- Chaque changement visible : aide à jour (`src/web/help.ts`, test `tests/web/help.test.ts`), puis contrôle sur Chrome (Claude in Chrome) en fin d'étape.
- Commandes : `npm test` (unitaires), `npx vitest run <fichier>`, `npm run typecheck`, `npx playwright test <spec>` (jamais deux lancements Playwright en même temps).

## Review Focus

1. **Écart près de 5 kg** : 5 et 5,04 (arrondi 5) → aucune demande ; 5,05 (arrondi 5,1) → demande affichée « 5,1 kg maximum ». Test dans la tâche 1.
2. **Combattant inscrit dans deux disciplines** : demandes par inscription, la discipline écrite dans chaque ligne ; pas de doublon par combattant. Test dans les tâches 1 et 4.
3. **Adversaire marqué absent après coup** (pesée, clôture) : la demande qu'il créait disparaît ; une réponse ancienne ne réapparaît pas en ⏳. Test dans la tâche 3.
4. **Accord donné puis pesée qui creuse l'écart** (7 kg accepté, 9 kg réel) : la demande redevient ⏳ avec 9 kg. Test dans la tâche 2.
5. **« Refusée » sur un déplacement d'une session lancée** : le motif de blocage s'affiche, rien n'est défait. Test dans la tâche 4.

---

### Task 1: Calcul des demandes d'autorisation (domaine pur)

**Files:**
- Create: `src/domain/authorizations.ts`
- Test: `tests/domain/authorizations.test.ts` (fixtures avec `tests/domain/replacement/fixtures.ts`)

**Interfaces:**
- Consumes: `State`, `Member` (`src/domain/replacement/types.ts`), `effectiveWeight`, `activeMembers` (`weights.ts`), `memberWave`, `keyWave` (`replacement/waves.ts`), `naturalKey`, `categoryLabel` (`categories.ts`).
- Produces:
```ts
export type AuthorizationKind = 'age' | 'weight' | 'missingWeight' | 'discipline' | 'mixite' | 'session';
export type AnswerableKind = Exclude<AuthorizationKind, 'missingWeight'>;
export type AuthorizationSituation =
  | { kind: 'age'; ownBand: string; strongerBands: string[] }
  | { kind: 'weight'; ownClassId: string; heaviestClassId: string; gapKg: number }
  | { kind: 'missingWeight'; ownClassId: string; heaviestClassId: string }
  | { kind: 'discipline'; from: { discipline: DisciplineId; ruleset: Ruleset | null }; to: { discipline: DisciplineId; ruleset: Ruleset | null } }
  | { kind: 'mixite' }
  | { kind: 'session'; from: string | null; to: string | null };
export interface BlameMove { entryId: string; seq: number; registrationIds: string[] }
export interface AuthorizationRequest {
  id: string;                 // `${kind}:${registrationId}`
  registrationId: string;
  clubId: string | null;
  categoryId: string;
  situation: AuthorizationSituation;
  current: string;            // « Karaté Jiyu · Benjamines −40 » (inscription d'origine)
  proposed: string;           // libellé du groupe actuel, ou « reste en … et reçoit … »
  bullet: string;             // phrase pour le coach (format de la skill)
  blame: string[];            // ids d'entrées d'historique, plus récente d'abord
}
export function authorizationRequests(state: State, moves: BlameMove[]): AuthorizationRequest[];
export function roundGap(gapKg: number): number;   // au dixième, demi vers le haut, utilisé pour comparer ET afficher ;
                                                   // calculer en centièmes entiers (poids saisis à 2 décimales) : Math.round(5.05*10) vaut 50 en flottant
export function gapText(gapKg: number): string;    // « 5 kg », « 7,3 kg »
```

Règles (décidées ici, à appliquer telles quelles) :
- Groupe = membres actifs (`activeMembers`) d'une catégorie ; catégorie à < 2 actifs : aucune demande.
- **Rang d'âge** (« plus fort ») : mineurs par `minAge` croissant ; tout adulte au-dessus de tout mineur ; parmi les adultes, Espoirs et Seniors (minAge < 35) au même rang, le plus haut ; puis Vétérans 1 > Vétérans 2 > … (`minAge` décroissant). Demande `age` pour un combattant face à au moins un adversaire de rang strictement plus fort ; `strongerBands` = codes de ces tranches, triés.
- **Catégorie de poids de référence** : `weighInClass(m, state)` si pesé, sinon `original?.weightClassId ?? weightClassId`. Rang : `maxKg` ; une catégorie ouverte (`maxKg === null`) est au-dessus de toute catégorie bornée ; deux ouvertes se comparent par leur seuil (le plus grand `maxKg` des catégories bornées de leur tranche et sexe). Même `maxKg` dans deux tranches = même rang.
- Face à des adversaires de catégorie de poids strictement supérieure : `gapKg` = `roundGap`(max(`effectiveWeight(adv)` − `effectiveWeight(m)`)) sur ces adversaires (valeur arrondie enregistrée et comparée). Si `m` n'a ni pesée ni poids déclaré → demande `missingWeight` ; en plus, `weight` si `gapKg > 5` (arrondi). Sinon `weight` si `gapKg > 5` (arrondi).
- `discipline` : discipline ou règlement actuels ≠ `original` (si `original` non nul).
- `mixite` : le groupe actif compte des F et des M → une demande pour **chaque** membre.
- `session` (seulement si `state.waves.length > 0`) : `keyWave(state, naturalKey(<valeurs d'origine>))` ≠ `memberWave(state, m)`.
- **Blâme** : dernière entrée active (plus grand `seq`) qui contient le combattant, union avec la dernière entrée de chaque adversaire **qui crée la demande** (plus fort en âge ; plus lourd avec écart > 5 kg pour `weight`, plus lourd tout court pour `missingWeight` ; autre sexe pour `mixite`) ; `discipline` et `session` : le combattant seul. Sans doublon, plus récente d'abord.
- Ordre de sortie : par club (nom), puis combattant (« NOM Prénom »), puis `kind` dans l'ordre `session, discipline, age, mixite, weight, missingWeight`.

- [ ] **Step 1: Écrire les tests (reprendre le tableau « Worked decision fixture » de `.agents/skills/shidokan-club-messages/references/data-and-examples.md`)**

```ts
test('5 kg pile : aucune demande ; poids déclaré égal à la limite utilisé', …)           // Alex/Bastien → []
test('poids manquant : seulement le plus léger, pas la limite comme poids', …)           // Chloé → missingWeight seul ; David → rien
test('même limite, tranches différentes : âge seulement', …)                             // Eva → age ; Farah → rien
test('changement de discipline : demande même si la fiche l’autorisait', …)              // Gaël (otherDisciplines contient la cible) → discipline
test('−60 déclaré 57 face à −67 déclaré 64 : poids 7 kg pour le plus léger seul', …)
test('Minime −50 sans poids reçoit une Benjamine +50 : missingWeight, pas d’âge', …)
test('vétéran avec des seniors : âge pour le vétéran, rien pour les seniors', …)
test('Espoir avec Seniors : pas de demande d’âge', …)
test('écart 5,04 kg : arrondi 5, aucune demande', …)
test('écart 5,05 kg : arrondi 5,1, demande « 5,1 kg »', …)
test('gapText : 5 → « 5 kg », 7,25 → « 7,3 kg »', …)
test('groupe mixte : une demande mixite par membre', …)
test('changement de session : session, du blâme du combattant seul', …)
test('adversaire absent : ignoré', …)
test('reste sur place et reçoit plus lourd : blame = entrée de l’adversaire', …)
test('deux inscriptions du même combattant : demandes par inscription', …)
```

- [ ] **Step 2:** `npx vitest run tests/domain/authorizations.test.ts` → FAIL (module absent).
- [ ] **Step 3:** Implémenter `authorizationRequests` `roundGap` et `gapText` dans `src/domain/authorizations.ts` ; textes `current` / `proposed` / `bullet` en français dans l'esprit de la skill (« Passage des benjamines à un groupe commun Benjamines–Minimes en karaté. », « Écart de poids estimé avec ses adversaires : 7 kg maximum. », « Merci d'indiquer son poids en kg pour vérifier que l'écart réel ne dépasse pas 5 kg. », « Groupe mixte filles et garçons. », « Passage de la session Matin à la session Après-midi. »). Tester au moins une phrase par type.
- [ ] **Step 4:** `npx vitest run tests/domain/authorizations.test.ts` → PASS ; `npm run typecheck` → 0 erreur.
- [ ] **Step 5:** Commit `feat(autorisations): calcul des demandes aux coachs (domaine)`.

### Task 2: Réponses enregistrées et leur portée

**Files:**
- Modify: `src/domain/authorizations.ts` (ajout)
- Modify: `src/server/db/schema.ts`, `src/server/sync/package.ts`
- Create: `drizzle/0039_autorisations.sql` (+ meta via `npm run db:generate`), `src/server/repositories/authorizations.ts`
- Test: `tests/domain/authorizations.test.ts`, `tests/server/migration-0039.test.ts`, `tests/server/authorizations.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
```ts
// domaine
export interface StoredAnswer { registrationId: string; kind: AnswerableKind; situation: AuthorizationSituation; answeredAt: string }
export function answerCovers(answer: AuthorizationSituation, request: AuthorizationSituation, grid: CategoryGrid): boolean;
export type RequestStatus = 'pending' | 'granted' | 'info'; // info = missingWeight
export function withStatus(requests: AuthorizationRequest[], answers: StoredAnswer[], grid: CategoryGrid): (AuthorizationRequest & { status: RequestStatus; answeredAt: string | null })[];
// serveur
export function listAnswers(db: AppDb, competitionId: string): StoredAnswer[];
export function grantAnswer(db: AppDb, competitionId: string, registrationId: string, kind: AnswerableKind, situation: AuthorizationSituation): void; // upsert
export function removeAnswer(db: AppDb, competitionId: string, registrationId: string, kind: AnswerableKind): void;
```
Table `authorization_answers` : `competition_id` (FK competitions, cascade), `registration_id` (FK registrations, cascade), `kind`, `situation_json`, `answered_at`, `rowMeta()` ; clé primaire `(competition_id, registration_id, kind)`.

Portée (`answerCovers`) : `age` → `strongerBands` de la demande ⊆ ceux acceptés ; `weight` → `gapKg` ≤ accepté **et** rang de `heaviestClassId` ≤ accepté ; `discipline` → même `to` ; `mixite` → toujours ; `session` → même `to`.

- [ ] **Step 1: Tests** : `answerCovers` (accord 7 kg couvre 6 kg, pas 9 kg ; accord âge [minime] ne couvre pas [minime, cadet] ; session autre `to` → non) ; `withStatus` ; migration 0039 (table créée, clé primaire, cascade à la suppression de l'inscription) ; repo (upsert remplace la situation ; `removeAnswer`).
- [ ] **Step 2:** lancer ces fichiers → FAIL.
- [ ] **Step 3:** implémenter domaine, schéma, migration, repo ; ajouter `authorization_answers` à la liste des tables de `package.ts` (après `set_aside_cases`).
- [ ] **Step 4:** `npx vitest run tests/domain/authorizations.test.ts tests/server/migration-0039.test.ts tests/server/authorizations.test.ts tests/server/sync-package.test.ts tests/server/row-versions.test.ts tests/server/backups.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(autorisations): réponses enregistrées (table authorization_answers)`.

### Task 3: Routes des autorisations et « Repartir de zéro »

**Files:**
- Modify: `src/server/routes/replacement.ts`, `src/server/repositories/authorizations.ts`, `src/server/repositories/replacement.ts` (`resetReplacement`), `src/server/journal/coverage.ts`, `src/server/auth/permissions.ts`, `src/web/api.ts`
- Test: `tests/server/authorizations.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 ; `loadState`, `knownWave`, `memberWave` ; `loadEntries` (`repositories/history.ts`) pour bâtir `BlameMove[]` à partir des entrées actives de types `plan`, `reaffectation`, `manual`, `exchange` (`summary.registrationIds`).
- Produces:
  - `GET /api/competitions/:id/authorizations?vague=` → `{ clubs: { clubId: string | null; name: string; preApproval: boolean; requests: AuthorizationRow[] }[]; pending: number }` où `AuthorizationRow = AuthorizationRequest & { status; answeredAt; label: string /* NOM Prénom */; blocked: string | null /* motif si le blâme ne peut pas être annulé */ }`. Filtre de session : la session du combattant (`memberWave`).
  - `POST /api/competitions/:id/authorizations/grant` `{ registrationId, kind }` : recalcule la demande actuelle, 409 si elle n'existe plus, enregistre sa situation ; journal `recordJournal` (type `autorisation`, action `accordee`, données : combattant, type, texte).
  - `POST /api/competitions/:id/authorizations/ungrant` `{ registrationId, kind }` : journal action `retiree`.
  - Web : `useAuthorizations(id, waveId)`, `useGrantAuthorization(id)`, `useUngrantAuthorization(id)` ; invalidation aussi après toute action de réaffectation et après `history/undo` (comme `['replacement', id]`).
  - `resetReplacement` supprime les réponses des inscriptions de sa portée.

- [ ] **Step 1: Tests** : GET liste une demande créée par un déplacement manuel, avec `blame` = l'entrée de ce déplacement ; grant → `status: 'granted'` ; pesée qui creuse l'écart → `pending` ; marquer l'adversaire absent → demande disparue (Review Focus 3) ; grant sur une demande inexistante → 409 ; Repartir de zéro → réponses supprimées ; Zone → 403 ; Table centrale → 200.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** implémenter ; `blocked` = premier motif `blocked` des entrées de `blame` (même calcul que `listHistory`).
- [ ] **Step 4:** `npx vitest run tests/server/authorizations.test.ts tests/server/journal-coverage.test.ts tests/server/permissions.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(autorisations): routes, journal et remise à zéro`.

### Task 4: Section « ③ Autorisations à demander » (Réaffectation)

**Files:**
- Create: `src/web/components/authorizations/AuthorizationsSection.tsx`, `src/domain/authorizations-text.ts`
- Modify: `src/web/pages/ReplacementPage.tsx` (entre « ② Cas un par un » et l'historique), `src/web/help.ts`
- Test: `tests/domain/authorizations-text.test.ts`, `tests/e2e/autorisations.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`useAuthorizations`, `useGrantAuthorization`, `useUngrantAuthorization`) ; `useUndoDialog().requestUndoDialog(ids)` (`components/history/undo-dialog-context.tsx`).
- Produces: `clubMessage(club: { name: string }, rows: { label: string; bullets: string[] }[]): string` et `allClubsMessage(...)` dans `authorizations-text.ts` (salutation courte, combattants numérotés, puces, demande des accords et des poids manquants ; seules les demandes `pending` et `info`).

Affichage (voir le croquis du spec §7.4) : un bloc par club (`data-testid="auth-club"`), mention « pré-accord coché sur la fiche » si `preApproval` ; un bloc par combattant numéroté ; une ligne par demande (`data-testid="auth-request"`, `data-status`) : icône ⏳ / ✓ / ⚖, type, `current → proposed`, écart ; boutons « Accordée » (`auth-grant`), « Refusée… » (`auth-refuse`, ouvre `requestUndoDialog(blame)` ; désactivé avec `blocked` en infobulle si bloqué) ; sans `blame` : lien « Déplacer à la main ↗ » vers `/tableaux?vue=liste&categorie=<categoryId>&combattant=<registrationId>` (tâche 9 ; le lien est ajouté dans la tâche 9, ici un `Anchor` vers cette adresse) et la phrase « Aucun déplacement à défaire : ce groupe existait déjà. » ; accordée : « accordée HH:MM · annuler » (`auth-ungrant`). « 📋 Copier pour le club » (`auth-copy`), « Copier tout » (`auth-copy-all`), case « Seulement en attente » cochée par défaut (`auth-only-pending`). Compteur ⏳ dans le titre.

- [ ] **Step 1: Tests unitaires du texte** : deux combattants d'un club, une demande accordée exclue, un poids manquant inclus ; numérotation ; pas de nom de club absent.
- [ ] **Step 2: e2e `autorisations.spec.ts`** : déplacement manuel d'une benjamine vers un groupe minimes → la section affiche ⏳ Âge ; « Accordée » → ✓ et compteur −1 ; « Refusée… » → fenêtre d'annulation → la demande disparaît et la combattante revient ; combattant inscrit en deux disciplines → deux lignes (Review Focus 2) ; session lancée → « Refusée… » désactivé avec le motif (Review Focus 5) ; largeur 390 px sans `clipped()`.
- [ ] **Step 3:** → FAIL. **Step 4:** implémenter. **Step 5:** `npx vitest run tests/domain/authorizations-text.test.ts tests/web/help.test.ts` et `npx playwright test tests/e2e/autorisations.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(reaffectation): autorisations à demander, suivi des réponses`.

### Task 5: Appliquer le plan avec les déplacements à valider

**Files:**
- Modify: `src/server/routes/replacement.ts` (corps de `plan/apply`), `src/server/repositories/replacement.ts` (`applyPlan`), `src/server/plan/runner.ts` si besoin, `src/web/components/replacement/PlanView.tsx`, `src/web/api.ts`, `src/web/help.ts`
- Test: `tests/server/plan-apply-anchor.test.ts` (ou nouveau `tests/server/plan-apply-all.test.ts`), `tests/e2e/plan-d-ensemble.spec.ts`

**Interfaces:**
- Consumes: `runPlanJob`, `planPayload` (`src/server/plan/compute.ts`), `writePlanMove`.
- Produces: corps `plan/apply` + `withToValidate?: boolean`. Vrai : le serveur recalcule le **plan affiché** (`forApply: false`, même ligne de coupure, mêmes choix et coche), compare `hash` à celui du plan affiché (envoyé par le client), puis écrit **tous** ses déplacements dans l'ordre (un seul `groupId`, entrées `plan`). Faux / absent : comportement actuel inchangé.

Fenêtre « Appliquer le plan » : case `plan-apply-all` « Appliquer aussi les déplacements à valider (ils attendront l'autorisation des clubs) », décochée par défaut. Cochée : la liste montre tout le plan affiché ; ceux avec `manual && !validated` dans un bloc « Attendront l'autorisation des clubs » (`plan-apply-pending`) ; plus de bloc « non appliqués ». Après succès, les choix sont vidés sauf les refus (comme aujourd'hui).

- [ ] **Step 1: Tests serveur** : avec `withToValidate`, un plan contenant un déplacement à valider l'applique (recasement + entrée `plan`) ; hash du plan à appliquer (forApply) refusé (409) ; sans le drapeau, rien ne change (test existant vert).
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** tests serveur + `npx playwright test tests/e2e/plan-d-ensemble.spec.ts` (ajouter un cas : case cochée → la section ③ montre les demandes) → PASS.
- [ ] **Step 5:** Commit `feat(plan): appliquer aussi les déplacements à valider, en attente d'autorisation`.

### Task 6: Pastilles ⏳ sur la planche, la galaxie et la liste

**Files:**
- Modify: `src/web/pages/BracketsPage.tsx`, `src/web/components/planche/FighterChip.tsx`, `src/web/components/planche/CategoryCard.tsx`, `src/web/components/galaxy/GalaxyView.tsx`, `src/web/components/BracketView.tsx`, `src/web/help.ts`
- Test: `tests/e2e/autorisations.spec.ts` (ajout)

**Interfaces:**
- Consumes: `useAuthorizations(id, null)` (une seule requête par page), dérivé en `Map<registrationId, string[] /* textes en attente */>` passée comme `pendingAuth` aux mêmes endroits que `badges`.
- Produces: pastille `data-testid="auth-pending"` « ⏳ » (titre = textes) sur le combattant ; sur la carte de catégorie « n autorisation(s) en attente » (`auth-pending-count`). Rien sur un poste de Zone.

- [ ] **Step 1: e2e** : après un déplacement qui crée une demande, la puce du combattant porte ⏳ sur la planche et dans la liste ; « Accordée » → ⏳ disparaît.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** PASS. **Step 5:** Commit `feat(tableaux): pastille des autorisations en attente`.

### Task 7: Historique avec les cartes de déplacement

**Files:**
- Modify: `src/domain/history/types.ts` (`HistorySummary.view?: MoveView`), `src/server/repositories/replacement.ts` (`proposalEntry` reçoit la vue ; `applyProposalById` → `moveView(state, p)` ; `writePlanMove` → `move.view` ; `manualMove` → `moveView(state, p)` de la proposition manuelle), `src/web/components/history/HistoryEntryCard.tsx`
- Test: `tests/server/history.test.ts`, `tests/e2e/historique.spec.ts`

**Interfaces:**
- Consumes: `MoveView`, `moveView` (`src/domain/replacement/view.ts`), `MoveBlocks` (`src/web/components/replacement/MoveBlocks.tsx`, props `{ view, grid, rules, costRule }`).
- Produces: `HistoryEntryCard` affiche `MoveBlocks` quand `entry.summary.view` existe (Pourquoi · De ➜ Vers · pastilles), avec un « Détails » repliable (`history-details`) qui montre la situation **enregistrée** : adversaires (`view.opponents`), écart (`view.gap`), restants au départ (`view.fromRemaining`/`fromCount`) — jamais recalculée ; sans `view`, l'affichage actuel. Heure, type, Voir, Annuler… inchangés.

- [ ] **Step 1: Tests** : une validation de carte, un plan et un déplacement manuel écrivent `summary.view` (avec `why`, `from`, `to`) ; une entrée ancienne sans `view` se lit toujours ; e2e : la carte d'historique montre « Pourquoi » et « ➜ ».
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** `npx vitest run tests/server/history.test.ts tests/domain/history-text.test.ts` + `npx playwright test tests/e2e/historique.spec.ts` → PASS.
- [ ] **Step 5:** Commit `feat(historique): cartes de déplacement comme les propositions`.

### Task 8: Pesée — ordre par club, règlement, poids déclaré

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`weighInList` : chaque inscription gagne `ruleset: Ruleset | null` et `approxWeightKg: number | null`), `src/web/api.ts` (`WeighInFighter`), `src/web/pages/WeighInPage.tsx`, `src/web/help.ts`
- Test: `tests/server/replacement.test.ts` (ou le test de la pesée existant), `tests/e2e/jour-j.spec.ts` ou nouveau `tests/e2e/pesee.spec.ts`

**Interfaces:**
- Produces: contrôle `weighin-order` « Ordre : Club | Nom » (Club par défaut — c'est l'ordre actuel du serveur ; mémorisé dans `localStorage` clé `pesee-ordre`, lecture/écriture sous try/catch) ; en ordre Club, une ligne d'en-tête par club (`weighin-club-header`, nom du club et nombre de combattants) ; colonne Inscriptions : `Karaté Jiyu −40 · déclaré 38 kg` (règlement via `rulesetShort`, poids déclaré seulement s'il existe, inscriptions de combat). La navigation Entrée → champ suivant suit l'ordre affiché.

- [ ] **Step 1: Tests** : l'API renvoie `ruleset` et `approxWeightKg` ; e2e : ordre Nom trie par nom, ordre Club affiche les en-têtes ; « Jiyu » et « déclaré » visibles ; Entrée passe au combattant suivant affiché.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** PASS. **Step 5:** Commit `feat(pesee): ordre par club, règlement et poids déclaré`.

### Task 9: « Voir le tableau » (cartes, Inscriptions)

**Files:**
- Modify: `src/web/components/replacement/CategoryColumn.tsx`, `src/web/pages/BracketsPage.tsx` (lire `?categorie=` aussi en vue `liste`), `src/web/pages/RegistrationsPage.tsx`, `src/domain/registration.ts` / route des inscriptions si `categoryId` manque à `RegistrationRow`, `src/web/help.ts`
- Test: `tests/e2e/details-reaffectation.spec.ts`, `tests/e2e/inscriptions.spec.ts`

**Interfaces:**
- Produces: lien `details-bracket` « ▦ Voir le tableau ↗ » à côté de `details-galaxy` (nouvel onglet, `withSession('/competitions/:id/tableaux?vue=liste&categorie=<id>', waveId)`) ; `BracketsPage` : `?vue=liste&categorie=<id>` choisit la catégorie (portée « Toutes » si hors session), et `&combattant=<registrationId>` sélectionne ce combattant (`setSwapFrom`) pour ouvrir son `MoveEntrantPanel` ; Inscriptions : colonne avec bouton `registration-bracket` « Tableau », même lien sans nouvel onglet, désactivé (infobulle « Pas encore de catégorie ») sans `categoryId`.

- [ ] **Step 1: e2e** : depuis « Détails » d'une carte, « Voir le tableau » ouvre la vue Liste sur la bonne catégorie ; depuis Inscriptions, « Tableau » aussi.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** PASS. **Step 5:** Commit `feat(tableaux): Voir le tableau depuis les cartes et les inscriptions`.

### Task 10: Tableaux — barre épinglée et recherche qui défile

**Files:**
- Create: `src/web/components/planche/searchCycle.ts`
- Modify: `src/web/components/planche/model.ts` (`plancheFilter` ne filtre plus par `query` ; nouveau `plancheMatches`), `src/web/components/planche/Planche.tsx`, `src/web/components/planche/PlancheToolbar.tsx`, `src/web/components/galaxy/GalaxyView.tsx`, `src/web/pages/BracketsPage.tsx` (vue Liste), `src/web/app.css`, `src/web/help.ts`
- Test: `tests/web/planche-model.test.ts`, `tests/web/search-cycle.test.ts`, `tests/e2e/planche.spec.ts`, `tests/e2e/tableaux.spec.ts`, `tests/e2e/galaxie.spec.ts`

**Interfaces:**
- Produces:
```ts
export function plancheMatches(categories: Category[], opts: { query: string; names: Map<string, string> }): string[]; // ids, ordre d'affichage
export function cycleIndex(current: number, delta: 1 | -1, total: number): number; // boucle
```
- Barre (toolbar + `JumpLinks` des groupes) dans un bloc `position: sticky; top: var(--sk-bar-h)` fond `var(--sk-bg)`, ombre quand la page a défilé ; cartes et groupes `scroll-margin-top: calc(var(--sk-bar-h) + <hauteur du bloc>)` (hauteur publiée dans `--sk-planche-bar-h` par un `ResizeObserver`, comme `--sk-bar-h`). Téléphone : pastilles sur une ligne défilante.
- Recherche : aucun filtrage ; cartes trouvées `data-match="current|other"` (contour) ; compteur `planche-search-count` « 2 / 5 », boutons `planche-search-prev` / `planche-search-next` ; Entrée / ↓ suivant, Maj+Entrée / ↑ précédent, Échap vide ; la courante défile sous la barre. « Seulement à traiter » reste un filtre.
- Vue Liste : la recherche choisit la catégorie courante (son tableau s'affiche) et la liste défile jusqu'à elle ; même compteur et mêmes touches.
- Galaxie : suivant / précédent centrent l'étoile suivante (réutiliser la sélection existante des résultats).

- [ ] **Step 1: Tests** : `cycleIndex` (boucle aux deux bouts, total 0) ; `plancheMatches` (catégorie par libellé, par nom de combattant, ordre d'affichage) ; e2e : après défilement la barre et les pastilles restent visibles ; recherche d'un nom présent dans deux catégories → « 1 / 2 », ↓ → « 2 / 2 » et la 2e carte est sous la barre, non masquée ; rien n'est caché ; vue Liste idem ; 390 px sans `clipped()`.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** PASS (`planche.spec`, `tableaux.spec`, `galaxie.spec`, `mise-en-page.spec`). **Step 5:** Commit `feat(tableaux): barre épinglée, recherche qui défile et passe d'un résultat à l'autre`.

### Task 11: Horaires estimés (domaine + serveur)

**Files:**
- Modify: `src/domain/schedule/timeline.ts` (`TimelineInput.waves[]` + `zoneFloors?: Record<string, number>` : le curseur d'une zone part de `max(begin, zoneFloors[zone])`)
- Create: `src/domain/schedule/estimate.ts`, `src/server/repositories/estimate.ts`
- Modify: `src/server/routes/results.ts` (route GET), `src/server/journal/coverage.ts` si nécessaire (GET : rien), `src/web/api.ts`
- Test: `tests/domain/schedule-timeline.test.ts` (non-régression + plancher), `tests/domain/schedule-estimate.test.ts`, `tests/server/estimate.test.ts`

**Interfaces:**
- Produces:
```ts
export interface EstimateInput {
  changeoverSec: number;
  shift: boolean;
  waves: { key: string; plannedStart: number | null; finalsZoneId: string | null }[]; // ordre des sessions
  zones: { zoneId: string; items: { key: string; waveKey: string; durationSec: number /* sans changement */; finals: FinalsWhen | null; waitsFor?: string[] }[] }[];
}
export interface DayEstimate {
  relative: boolean; // aucune heure de début connue : secondes depuis le début
  waves: { key: string; start: number; end: number; finalsStart: number | null;
           zones: { zoneId: string; start: number; end: number; passages: number }[];
           overlap: { zoneId: string; minutes: number }[] }[];
  end: number;
}
export function estimateDay(input: EstimateInput): DayEstimate;
```
Règles : début d'une session = `plannedStart`, sinon fin estimée de la précédente (+ changement), sinon 0 et `relative: true`. `overlap` : par zone, minutes (arrondies au supérieur) où le début prévu tombe avant la fin estimée de la session précédente sur cette zone ; calculé dans les deux cas. `shift: true` → `zoneFloors` = fin précédente de la zone + changement. Résultats saisis ignorés (estimation de planification, `now` = null, `endedAt` = null).
- Serveur : `estimateFor(db, competitionId, shift): Promise<DayEstimate & { zones: { id: string; name: string }[]; waves: { key; name }[] }>` à partir de `passagePlan` (toutes les sessions, figées ou en direct), `planInput(...).durationSec` **moins** `settings.schedule.changeoverSec` (il l'inclut), débuts prévus de `wave_schedules`, zones des finales de `wave_finals`. Route `GET /api/competitions/:id/schedule/estimate?decaler=1|0` (défaut 1). Web : `useDayEstimate(id, shift)` (invalidée avec `['schedule', id]`).

- [ ] **Step 1: Tests** : timeline inchangée sans `zoneFloors` (tests existants) ; plancher respecté ; `estimateDay` : deux sessions sur une zone, la 2e prévue avant la fin de la 1re → `overlap` 25 min, `shift` décale la fin de journée de 25 min, sans `shift` non ; zone la plus chargée décide la fin ; aucune heure → `relative` ; finales « Fin de session » placées après les autres passages de la zone des finales ; serveur : une session non lancée est estimée.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** `npx vitest run tests/domain/schedule-*.test.ts tests/server/estimate.test.ts tests/domain/public-times.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(horaires): estimation de la journée, sessions lancées ou non`.

### Task 12: Horaires estimés (écran Sessions)

**Files:**
- Create: `src/web/components/DayEstimateCard.tsx`, `src/web/components/ScheduleDurationsFields.tsx` (extrait du bloc des durées de `CompetitionSettingsPage.tsx`, réutilisé aux deux endroits)
- Modify: `src/web/pages/WavesPage.tsx`, `src/web/pages/CompetitionSettingsPage.tsx`, `src/web/help.ts`
- Test: `tests/e2e/horaires-estimes.spec.ts`, `tests/e2e/duree-des-finales.spec.ts` (non-régression des réglages)

**Interfaces:**
- Consumes: Task 11 (`useDayEstimate`), mise à jour des réglages existante.
- Produces: section « Horaires estimés » (`day-estimate`) : en tête « Fin estimée de la journée : 17:40 » (`day-estimate-end`) ou « + 9 h 10 » si `relative` ; case `day-estimate-shift` « Décaler une session qui commence avant la fin de la précédente » cochée par défaut (`localStorage` `horaires-decaler`, try/catch) ; par session : début, fin, finales, alerte `day-estimate-overlap` « Chevauche la session précédente de 25 min (Zone 2) » ; par zone : début, fin, nombre de passages, barre proportionnelle à la durée (la plus longue = 100 %) ; au-dessus, `ScheduleDurationsFields` (durées par groupe d'âge, changement, kata) enregistrés comme dans Réglages ; « n catégories ont leur propre durée » avec lien vers Tableaux. Mise à jour en direct (SSE déjà branché sur `['schedule', id]`).

- [ ] **Step 1: e2e** : deux sessions et deux zones → fin estimée affichée ; raccourcir la durée des adultes fait avancer la fin ; décocher le décalage avec un chevauchement change la fin et garde l'alerte ; 390 px sans `clipped()`.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** PASS. **Step 5:** Commit `feat(sessions): horaires estimés et durées modifiables sur place`.

### Task 13: Fin d'étape

- [ ] `npm run typecheck`, `npm test`, `npx playwright test` → tout vert (noter les nombres).
- [ ] Contrôle visuel Claude in Chrome sur une copie de sauvegarde (port 3200) : Pesée, Réaffectation ③, plan avec la case, Historique, Tableaux (barre, recherche, ⏳, Voir le tableau), Inscriptions, Sessions ; clair, sombre, 390 px. Corriger ce qui est vu.
- [ ] Mettre à jour `docs/superpowers/plans/2026-10-21-99-bilan.md` et `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 45) ; spec : statut « approuvé, réalisé ».
- [ ] Revue finale de la branche (superpowers:requesting-code-review), corrections, puis superpowers:finishing-a-development-branch.
