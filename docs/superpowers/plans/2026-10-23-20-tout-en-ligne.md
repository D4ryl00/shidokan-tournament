# Étape 20 (étape E du spec) : tout en ligne le jour J — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le jour J peut se dérouler entièrement sur le serveur en ligne :
- chaque compte a un **rôle** : Organisateur, Table centrale, ou Zone (attaché à **une zone d'une compétition**) ;
- le serveur **refuse** ce que le rôle ne permet pas, et l'écran se règle tout seul sur le poste du compte ;
- le PC de la salle garde une **copie à jour** de la compétition. Si internet tombe, il **prend la main en secours** sans le serveur, puis le **prévient** quand internet revient.

**Architecture :**
- **Comptes** : `users.role` accepte `organisateur | table | zone` ; un compte Zone porte `competition_id` et `zone_id` (choix de l'organisateur, 2026-10-23 : un compte Zone est attaché à la zone d'une compétition précise, à refaire à chaque compétition). Le rôle est relu à chaque requête (jointure de la session) : un changement vaut tout de suite.
- **Droits** : `src/server/auth/permissions.ts`, un `preHandler` en rôle serveur, après la protection par session. Il décide sur le motif de route de Fastify (`req.routeOptions.url`) et la méthode. Par défaut, seul l'organisateur passe. Pour un compte Zone, on vérifie en plus que le combat (ou le bloc de kata) se joue sur sa zone, d'après le plan de passage.
- **Écran** : `usePoste` impose le poste du compte (Table centrale, ou Zone de sa compétition) et cache la liste « Poste » ; les menus de l'organisateur sont cachés aux autres rôles.
- **Copie à jour** (PC relié) : réglage `syncFollow` et tâche de fond calquée sur `startMirror`, qui refait « Récupérer une copie » toutes les N minutes tant que la compétition est une copie du serveur. Chaque copie retient l'**empreinte** de la version du serveur.
- **Secours** : « Prendre la main en secours » (PC, sans réseau) rend la copie modifiable et note `rescue_since`. « Prévenir le serveur » envoie la compétition et l'empreinte de départ. Si le serveur n'a pas changé depuis, le PC a la main, comme après « Prendre la main ». Sinon, refus avec un message, puis remplacement de la version en ligne sur confirmation (la version en ligne reste dans la sauvegarde automatique faite avant toute réception de paquet).

**Tech Stack :** TypeScript, Fastify 5, Drizzle (SQLite), React 19 + Mantine 8, react-query, Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §7.3 (rôles), §8.2 (comptes), §9.5 (reprise), §11 (étape E). Choix de l'organisateur du 2026-10-23, à reporter dans la conception (Task 6) : compte Zone attaché à la zone d'une compétition ; copie tenue à jour + prise de main en secours (§12 ne l'interdit pas : l'échange se fait dans un seul sens, et la main ne change que par un geste).

## Global Constraints
- **Rôles** (libellés exacts) : `organisateur` « Organisateur », `table` « Table centrale », `zone` « Zone ». Un compte `zone` a `competitionId` et `zoneId` non vides, et la zone appartient à la compétition. Les deux autres rôles les ont à `null`. Sinon 400 « Choisissez une zone de cette compétition. »
- `add-user` (ligne de commande) crée toujours un Organisateur. `list-users` affiche le rôle.
- On ne change pas le rôle de son propre compte : 400 « Vous ne pouvez pas changer le rôle de votre propre compte. » (avec l'interdiction existante de supprimer son propre compte, il reste toujours un organisateur).
- **Refus 403** (messages exacts) :
  - action que le rôle ne permet pas : « Votre compte ne permet pas cette action. » ;
  - compte Zone sur une autre compétition : « Votre compte donne accès à une autre compétition. » ;
  - compte Zone sur un combat d'une autre zone : « Ce combat ne se joue pas sur votre zone. »
- **Ce que chaque rôle peut faire** (rôle serveur seulement ; en rôle local, rien ne change) :
  - **Organisateur** : tout.
  - **Table centrale et Zone, hors compétition** : `GET /api/competitions` (pour un compte Zone, sa compétition seulement), `POST /api/auth/logout`, `PUT /api/users/me/password` (les routes publiques restent publiques).
  - **Lecture d'une compétition** (`GET /api/competitions/:id` et `GET /api/competitions/:id/*`) : permise, sauf `…/invitations`, `…/invitations/preview`, `…/received-copies`, `…/export.json`.
  - **Écritures de la Table centrale** (motifs exacts, tous sous `/api/competitions/:id`) :
    - `POST /registrations`, `PUT` et `DELETE /registrations/:rid`, `POST /clubs`, `PATCH /clubs/:clubId` ;
    - `PUT /weigh-in/:fighterId`, `POST /weigh-in/close` ;
    - `POST /replacement/preview`, `/apply`, `/bulk`, `/refuse`, `/unrefuse`, `/undo`, `/move` ;
    - `PATCH /categories/:cid`, `POST /categories/:cid/redraw`, `/swap`, `/move`, `/move/preview`, `/regenerate` ;
    - `POST /launch`, `/launch/reopen`, `/launch/number`, `/launch/number/preview` ;
    - `PUT` et `DELETE /categories/:cid/results/:matchId`, `PUT /categories/:cid/kata/:rid/:round`, `PUT /categories/:cid/tie-break`.
  - **Écritures d'un compte Zone** : les quatre dernières (résultats, notes de kata, départage), sur sa compétition et sur sa zone.
- **Zone d'une saisie** (plan de passage `passagePlan`, celui des écrans) :
  - un combat : la zone du passage de ce `matchId` s'il en a un, sinon la zone de la catégorie ;
  - des notes de kata : la zone du bloc `kata:tour1` (round `round1`) ou `kata:final` (round `final`), sinon celle du bloc entier (`matchId` null), sinon celle de la catégorie ;
  - un départage : la zone de la catégorie, ou une zone qui a un passage de la catégorie.
- **`/api/auth/me`** en rôle serveur : `{ role: 'serveur', user: { email, role, competitionId, zoneId } }`.
- **Écran selon le rôle** :
  - Table centrale : poste `{ kind: 'table' }` imposé ;
  - Zone : poste `{ kind: 'zone', zoneId }` imposé, sur sa compétition seulement ; à l'accueil, il va directement à `/competitions/<id>/combats` ;
  - pour ces deux rôles, la liste « Poste » est cachée, ainsi que les menus Annuaire, Réglages de l'application, Comptes, « Nouvelle compétition », « Importer une compétition (fichier) », les sauvegardes de l'onglet Podiums et le panneau des inscriptions en ligne de l'onglet Clubs ;
  - compte Zone dont la compétition ou la zone n'existe plus : « La zone de ce compte n’existe plus : demandez à un organisateur. »
- **Empreinte d'une compétition** : sha256 (hexadécimal) du JSON des lignes du paquet (`buildPackage(...).tables`), lignes triées par clé primaire dans chaque table, colonnes de la main (`OWNER_COLUMNS`) et `club_entry_status` exclues (la prise de main fige les inscriptions). Le paquet servi par `GET /api/sync/remote/competitions/:cid/package` porte `fingerprint`.
- **Copie à jour** (PC) :
  - `app_settings.syncFollow = { competitionId: string, intervalMin: number (1 à 60, 5 par défaut) } | null` ;
  - état en mémoire, renvoyé par `GET /api/sync/follow` : `{ competitionId, intervalMin, lastSuccessAt, lastError }` ; réglage par `PUT /api/sync/follow` (corps : le réglage, ou `null`) ;
  - à chaque tour (vérification chaque minute, comme `startMirror`) : si la compétition est une copie du serveur (`copyOfServer`), refaire la récupération d'une copie (même code que `POST /api/sync/pull` avec `take: false`). Sinon (main ici, en secours ou non), ne rien faire et noter `lastError` = « Ce PC a la main : la copie n’est plus mise à jour. » ;
  - chaque récupération (manuelle ou automatique) enregistre l'empreinte reçue dans `competitions.server_fingerprint`.
- **Prise de main en secours** (PC) : `POST /api/competitions/:id/sync/rescue` ; seulement sur une copie du serveur (sinon 409 « Seule une copie du serveur peut être prise en secours. »). Effet : la main est ici (`owner_*` vides), `rescue_since` = maintenant, `server_fingerprint` gardée. Aucune requête réseau.
- **Prévenir le serveur** (PC) : `POST /api/competitions/:id/sync/rescue/notify`, corps `{ replace: boolean }`. Le PC envoie au serveur `POST /api/sync/remote/competitions/:cid/rescue` avec `{ instanceId, instanceName, migrations, baseFingerprint, replace, package }` (paquet `handOver: false`). Côté serveur :
  - si un **autre** PC (ou un fichier) a la main : 409 « Cette compétition est gérée par <nom> : demandez à un organisateur de reprendre la main en ligne. » ;
  - si l'empreinte du serveur est égale à `baseFingerprint`, si ce PC a déjà la main, ou si `replace` est vrai : la compétition est remplacée par le paquet (`importPackage`, donc après une sauvegarde automatique). Ensuite, comme pour une prise de main (`take`) : la main est au PC, liée au jeton, et les inscriptions sont figées. Le paquet est gardé comme copie reçue. Réponse `{ instanceId }` ;
  - sinon : 409 « Des modifications ont été faites en ligne après la dernière copie de ce PC. Confirmez pour remplacer la version en ligne par celle de ce PC (la version en ligne est gardée dans une sauvegarde du serveur). » avec `code: 'RESCUE_DIVERGED'`.

  Une fois le serveur prévenu, le PC efface `rescue_since` et met à jour `last_sync_at`. La suite est le cas habituel : envoyer une copie, rendre la main.
- **Bandeau** pendant le secours : « Gérée ici en secours depuis le <JJ/MM/AAAA HH:MM> — le serveur n’est pas encore prévenu ».
- Textes des boutons (copie exacte) : « Garder cette copie à jour », « Prendre la main en secours », « Prévenir le serveur », « Remplacer la version en ligne ».
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Un compte Zone tape à la main l'adresse d'une écriture** d'une autre zone, d'une autre compétition, ou d'une route de l'organisateur : 403, rien n'est écrit. Test Task 2, qui parcourt toutes les routes enregistrées pour chaque rôle.
- **Un écran du poste Table centrale ou Zone appelle une route interdite** (panneau des invitations, sauvegardes, annuaire…) : l'écran afficherait une erreur. e2e Task 3, qui ouvre chaque onglet du poste et vérifie qu'aucune réponse n'est 403.
- **Une catégorie déplacée pendant la journée** (`move`) : le compte de la nouvelle zone peut saisir les combats qui restent ; celui de l'ancienne zone ne peut plus saisir que les combats déjà joués chez lui (leur passage figé y reste). Test Task 2.
- **Internet revient alors que des saisies ont été faites en ligne pendant le secours** : le serveur refuse sans rien écrire, et le PC montre le message avec « Remplacer la version en ligne ». Rien n'est perdu sans confirmation. Test Task 5.
- **La copie à jour tourne pendant le secours, ou pendant une prise de main normale** : elle n'écrase jamais le travail du PC. Test Task 4.

---

### Task 1 : Comptes par rôle (base, gestion, `/api/auth/me`)

**Files:** Modify `src/server/db/schema.ts` (`users.role` enum, `competitionId`, `zoneId` ; `competitions.serverFingerprint`, `rescueSince` pour les Tasks 4 et 5), migration `drizzle/0019_roles_et_secours.sql` (générée par `npx drizzle-kit generate`), `src/server/auth/sessions.ts`, `src/server/routes/auth.ts`, `src/server/cli.ts` ; Test `tests/server/accounts.test.ts`.

**Interfaces:**
```ts
export type UserRole = 'organisateur' | 'table' | 'zone';
export interface SessionUser { id: string; email: string; role: UserRole; competitionId: string | null; zoneId: string | null }
export interface AccountRole { role: UserRole; competitionId: string | null; zoneId: string | null }
export function createUser(db: AppDb, email: string, password: string, access?: AccountRole): SessionUser; // organisateur par défaut
export function setUserRole(db: AppDb, userId: string, access: AccountRole): void;
export function listUsers(db: AppDb): { id; email; createdAt; role: UserRole; competitionId: string | null; zoneId: string | null; competitionName: string | null; zoneName: string | null }[];
```
- `competitions.server_fingerprint` et `rescue_since` s'ajoutent à `OWNER_COLUMNS` de `package.ts` : ils ne voyagent pas et ne sont pas écrasés par une réception.
- Routes : `POST /api/users` accepte en plus `role`, `competitionId`, `zoneId` ; nouvelle route `PATCH /api/users/:userId` `{ role, competitionId, zoneId }` → 204.

- [ ] **Step 1 : tests** (`accounts.test.ts`, application en rôle serveur comme `auth.test.ts`) :
  - `créer un compte Table centrale et un compte Zone ; la liste donne rôle, compétition et zone (noms compris)` ;
  - `compte Zone sans zone, ou avec une zone d'une autre compétition → 400 « Choisissez une zone de cette compétition. »` ;
  - `PATCH change le rôle ; la session déjà ouverte du compte voit le nouveau rôle dans /api/auth/me sans se reconnecter` ;
  - `changer son propre rôle → 400 « Vous ne pouvez pas changer le rôle de votre propre compte. »` ;
  - `compétition ou zone supprimée : la liste montre competitionName / zoneName à null, sans erreur` ;
  - `migration : une base 0018 avec un compte garde ce compte en organisateur` (comme `migration-0014.test.ts`).
- [ ] **Step 2 :** `npx vitest run tests/server/accounts.test.ts` → échecs attendus.
- [ ] **Step 3 :** schéma, migration, `sessions.ts`, `auth.ts`, `cli.ts` (`list-users` : `email  Table centrale  (créé le …)`).
- [ ] **Step 4 :** `npx vitest run tests/server/accounts.test.ts tests/server/auth.test.ts tests/server/row-versions.test.ts` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(tout en ligne): comptes par rôle (organisateur, table centrale, zone d'une compétition)`.

### Task 2 : Droits par rôle sur le serveur

**Files:** Create `src/server/auth/permissions.ts` ; Modify `src/server/app.ts` (enregistrement après `registerGuard`), `GET /api/competitions` (filtrée pour un compte Zone) ; Test `tests/server/permissions.test.ts`.

**Interfaces:**
```ts
export class ForbiddenError extends Error { readonly statusCode = 403 }
/** Décision sans base de données : la route est-elle permise à ce rôle ? ('zone-check' : permise si la saisie est sur sa zone). */
export function routeAccess(user: SessionUser, method: string, route: string): 'allow' | 'deny' | 'zone-check';
/** Zone(s) où se joue la saisie visée par la route (voir Global Constraints), via passagePlan. */
export async function entryZones(db: AppDb, competitionId: string, categoryId: string, target: { matchId: string } | { kataRound: 'round1' | 'final' } | 'tie-break'): Promise<Set<string>>;
export function registerPermissions(app: FastifyInstance, db: AppDb, role: InstanceRole): void; // ne fait rien en rôle local
```
- Ordre des contrôles dans le `preHandler` : pas de `req.user` (route publique) → rien ; organisateur → rien ; route de compétition et compte Zone sur une autre compétition → 403 autre compétition ; `routeAccess` `deny` → 403 ; `zone-check` → `entryZones` doit contenir `user.zoneId`, sinon 403 zone.

- [ ] **Step 1 : tests** (`permissions.test.ts`, rôle serveur, trois comptes connectés, une compétition avec deux zones et des catégories réparties ; le jeu de données peut reprendre l'aide de `tests/server/results.test.ts` / `moves.test.ts`) :
  - `routeAccess : chaque route enregistrée (registeredRoutes) a la décision attendue pour table et zone` : tableau des motifs permis des Global Constraints. Toute autre route renvoie `deny`, et le test échoue si une nouvelle route n'est pas classée (même garde que `unclassifiedTables`) ;
  - `table : PUT d'une inscription → 200 ; PUT /zones, PATCH /competitions/:id, GET /api/club-directory, GET /api/backup.sqlite, GET …/invitations → 403 « Votre compte ne permet pas cette action. »` ;
  - `zone : résultat d'un combat de sa zone → 200 ; d'un combat de l'autre zone → 403 « Ce combat ne se joue pas sur votre zone. » ; notes de kata et départage idem` ;
  - `zone : toute route d'une autre compétition → 403 « Votre compte donne accès à une autre compétition. » ; GET /api/competitions ne liste que la sienne` ;
  - `catégorie déplacée (move à la suite) : la nouvelle zone saisit un combat restant ; l'ancienne zone ne le peut plus, mais peut corriger un combat déjà joué chez elle` ;
  - `rôle local : aucun contrôle (une écriture sans session passe)`.
- [ ] **Step 2 :** `npx vitest run tests/server/permissions.test.ts` → échecs attendus.
- [ ] **Step 3 :** `permissions.ts`, enregistrement dans `app.ts`, filtre de la liste des compétitions.
- [ ] **Step 4 :** `npx vitest run tests/server` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(tout en ligne): le serveur refuse ce que le rôle du compte ne permet pas`.

### Task 3 : Écrans selon le rôle (comptes, poste imposé, menus)

**Files:** Modify `src/web/api.ts` (`AuthMe`, `UserRow`, `useCreateUser`, `useUpdateUserRole`), `src/web/pages/AccountsPage.tsx`, `src/web/poste.ts`, `src/web/components/CompetitionLayout.tsx`, `src/web/components/AppHeader.tsx`, `src/web/App.tsx` (accueil d'un compte Zone), `src/web/pages/CompetitionsPage.tsx`, `src/web/pages/ClubsPage.tsx`, `src/web/pages/PodiumsPage.tsx`, `src/web/help.ts` (topic `comptes`) ; Test `tests/web/poste.test.ts` (existant, à compléter), `tests/e2e/roles.spec.ts` (sur le serveur de test du port 3101).

**Interfaces:**
```ts
/** Poste imposé par le compte connecté (rôle serveur), ou null (organisateur, ou rôle local). */
export function accountPoste(me: AuthMe | undefined, competitionId: string): Poste | null;
export function usePoste(competitionId: string): [Poste, (p: Poste) => void, boolean /* imposé par le compte */];
```
- Écran Comptes : colonne « Rôle » (« Zone Tatami 1 — Coupe 2026 », ou « Zone (n’existe plus) ») ; à l'ajout, un `Select` « Rôle ». Pour une Zone, on choisit d'abord la compétition, puis la zone (liste des zones de la compétition choisie). Par ligne, « Changer le rôle », qui ouvre les mêmes champs, sauf pour son propre compte.
- `data-testid` : `account-role`, `account-competition`, `account-zone`, `account-row-role`, `account-change-role`.

- [ ] **Step 1 : tests unitaires** (`poste.test.ts`) : `accountPoste : table → { kind: 'table' } ; zone de cette compétition → { kind: 'zone', zoneId } ; zone d'une autre compétition → poste zone avec un zoneId vide (rien de permis) ; organisateur ou rôle local → null`.
- [ ] **Step 2 : e2e** (`roles.spec.ts`, `baseURL` 3101) :
  - `l’organisateur crée une compétition avec deux zones, un compte Table centrale et un compte Zone (Tatami 2)` ;
  - `compte Table centrale : pas de liste « Poste », onglets du poste Table, aucun menu de l'organisateur ; chaque onglet s'ouvre sans aucune réponse 403 (page.on('response'))` ;
  - `compte Zone : arrive directement sur Combats de sa compétition, ne voit que sa zone ; Combats et Tableaux s'ouvrent sans réponse 403 ; il saisit un résultat de sa zone`.
- [ ] **Step 3 :** implémenter (le `ManagementBanner` et le `SyncPanel` ne changent pas ; Réglages n'est de toute façon pas un onglet de ces postes).
- [ ] **Step 4 :** `npx vitest run tests/web && npm run typecheck && npx playwright test tests/e2e/roles.spec.ts tests/e2e/serveur.spec.ts tests/e2e/plusieurs-postes.spec.ts` → PASS.
- [ ] **Step 5 :** commit `feat(tout en ligne): écran réglé sur le rôle du compte ; comptes Table centrale et Zone`.

### Task 4 : Copie tenue à jour sur le PC (empreinte)

**Files:** Modify `src/server/sync/package.ts` (`competitionFingerprint`), `src/server/routes/sync-remote.ts` (`fingerprint` dans `…/package` et `…/take`), `src/server/routes/sync-local.ts` (empreinte retenue au `pull` ; routes `GET`/`PUT /api/sync/follow`), Create `src/server/sync/follow.ts` (calqué sur `src/server/mirror.ts`), Modify `src/server/app.ts` (démarrage en rôle local, comme `startMirror`), `src/web/api.ts`, `src/web/components/SyncPanel.tsx` ; Test `tests/server/sync-follow.test.ts`.

**Interfaces:**
```ts
export function competitionFingerprint(db: AppDb, competitionId: string): string;   // package.ts
export interface SyncFollow { competitionId: string; intervalMin: number }
export function getFollow(db: AppDb): SyncFollow | null;
export function setFollow(db: AppDb, v: SyncFollow | null): void;
export function followStatus(dbPath: string): { lastSuccessAt: string | null; lastError: string | null };
export async function followOnce(db: AppDb, dbPath: string): Promise<{ ok: true } | { error: string }>;
export function startFollow(db: AppDb, dbPath: string, onError: (e: unknown) => void): () => void;
/** Récupération d'une copie, partagée par POST /api/sync/pull et followOnce. */
export async function pullCopy(db: AppDb, dbPath: string, competitionId: string, take: boolean): Promise<{ competitionId: string; created: boolean }>; // sync-local.ts, exportée
```
- `SyncPanel`, quand le PC est relié et que la compétition est une copie du serveur : case « Garder cette copie à jour » + `NumberInput` « toutes les … minutes » + « Dernière mise à jour : <heure> » ou l'erreur (`data-testid` `sync-follow`, `sync-follow-status`).

- [ ] **Step 1 : tests** (`sync-follow.test.ts`, serveur + PC comme `sync-local.test.ts`) :
  - `empreinte : stable à la relecture ; change après une écriture (une inscription) ; ne change pas quand la main change (take)` ;
  - `pull : competitions.server_fingerprint = l'empreinte du serveur` ;
  - `followOnce : une écriture faite en ligne arrive dans la copie du PC ; lastSuccessAt rempli` ;
  - `followOnce quand le PC a la main (prise normale, ou secours) : rien n'est récupéré, le travail du PC reste, lastError = « Ce PC a la main : la copie n’est plus mise à jour. »` ;
  - `serveur injoignable : lastError rempli, la copie reste lisible` ;
  - `PUT /api/sync/follow : intervalMin hors de 1 à 60 → 400 ; null arrête`.
- [ ] **Step 2 :** `npx vitest run tests/server/sync-follow.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run tests/server/sync-follow.test.ts tests/server/sync-local.test.ts tests/server/sync-remote.test.ts tests/server/sync-package.test.ts` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(tout en ligne): le PC garde une copie à jour de la compétition du serveur`.

### Task 5 : Prise de main en secours et retour vers le serveur

**Files:** Modify `src/server/sync/ownership.ts` (`Management.rescueSince`), `src/server/routes/sync-local.ts` (`…/sync/rescue`, `…/sync/rescue/notify`), `src/server/routes/sync-remote.ts` (`POST /api/sync/remote/competitions/:cid/rescue`), `src/server/sync/client.ts` si `remote` doit relayer `code` dans l'erreur 409, `src/web/api.ts` (`useRescue`, `useRescueNotify`), `src/web/components/SyncPanel.tsx` (`managementText` et boutons), `src/web/help.ts` (topic `synchronisation`) ; Test `tests/server/sync-rescue.test.ts`, `tests/e2e/synchronisation.spec.ts` (nouveau parcours).

**Interfaces:**
```ts
export interface Management { /* … */ rescueSince: string | null }
// PC
POST /api/competitions/:id/sync/rescue          → 204
POST /api/competitions/:id/sync/rescue/notify   { replace: boolean } → 204 | 409 { error, code?: 'RESCUE_DIVERGED' }
// Serveur (jeton)
POST /api/sync/remote/competitions/:cid/rescue  { instanceId, instanceName, migrations, baseFingerprint, replace, package } → { instanceId }
```
- `SyncPanel` :
  - copie du serveur : bouton rouge « Prendre la main en secours », confirmé par « À utiliser seulement si le serveur est injoignable (internet coupé). Ce PC devient modifiable tout de suite, sans prévenir le serveur : faites passer toutes les saisies sur ce réseau. Quand internet revient, cliquez « Prévenir le serveur ». » ;
  - en secours : « Prévenir le serveur ». Sur `RESCUE_DIVERGED`, le message est affiché avec le bouton confirmé « Remplacer la version en ligne » (`replace: true`).
- `data-testid` : `sync-rescue`, `sync-rescue-notify`, `sync-rescue-replace`.

- [ ] **Step 1 : tests** (`sync-rescue.test.ts`) :
  - `secours sur une copie du serveur : modifiable tout de suite, sans réseau (serveur arrêté) ; le bandeau donne rescueSince` ;
  - `secours sur une compétition gérée ici, ou sur une copie par fichier non reliée → 409` ;
  - `prévenir, serveur inchangé : la version du PC est en ligne, la main est au PC (lecture seule en ligne, inscriptions figées), rescueSince effacé ; ensuite « Rendre la main » marche` ;
  - `prévenir, une inscription modifiée en ligne entre-temps : 409 RESCUE_DIVERGED, rien n'a changé en ligne ; avec replace → version du PC en ligne, une sauvegarde du serveur faite juste avant contient la modification en ligne` ;
  - `un autre PC a pris la main entre-temps → 409 « Cette compétition est gérée par … »` ;
  - `jeton révoqué → 401 relayé, le PC garde la main en secours`.
- [ ] **Step 2 :** `npx vitest run tests/server/sync-rescue.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 : e2e** (`synchronisation.spec.ts`) : `secours : copie du serveur → « Prendre la main en secours » → saisie sur le PC → « Prévenir le serveur » → la saisie est en ligne, en lecture seule`. Puis `npx vitest run tests/server && npx playwright test tests/e2e/synchronisation.spec.ts` → PASS.
- [ ] **Step 5 :** commit `feat(tout en ligne): prise de main en secours par le PC, puis retour vers le serveur`.

### Task 6 : Mise en ligne, aide et documents

**Files:** Modify `deploy/Caddyfile` (pas de compression sur `/api/competitions/*/events`, pour que les événements arrivent tout de suite), `docs/installation-serveur.md` (comptes par rôle ; jour J en ligne ; procédure de secours en 5 lignes), `src/web/components/DayChecklist.tsx` (une section « Jour J en ligne » : comptes Zone créés pour la compétition, PC relié avec « Garder cette copie à jour », que faire si internet tombe), la conception (§7.3, §8.2, §9.5, §11 : *Construit, 2026-10-23*), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (ligne 20), `docs/superpowers/plans/2026-10-21-99-bilan.md`.

- [ ] **Step 1 :** Caddyfile :
  ```
  @compresse not path /api/competitions/*/events
  encode @compresse gzip
  ```
  Vérification : `docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile" caddy:2 caddy validate --config /etc/caddy/Caddyfile` → « Valid configuration » (si Docker est là ; sinon le noter dans le bilan).
- [ ] **Step 2 :** documents et aide (fiche jour J), sans nouveau test au-delà de ceux de `tests/web` sur les aides s'ils vérifient les topics.
- [ ] **Step 3 :** `npm run typecheck && npm test && npm run test:e2e` → tout PASS.
- [ ] **Step 4 :** commit `docs: étape 20 — tout en ligne le jour J`.
