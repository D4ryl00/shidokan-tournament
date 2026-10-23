# Étape 18 (étape D du spec) : passage de main entre le serveur et le PC — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une compétition passe d'une installation à l'autre sans écraser les autres compétitions.
- Le PC relié au serveur (adresse + jeton de synchronisation) peut :
  - **récupérer une copie** en lecture seule ;
  - **prendre la main**, ce qui fige les inscriptions en ligne et met la compétition en lecture seule en ligne ;
  - **envoyer une copie** pendant la journée, que le serveur garde ;
  - **rendre la main**, ce qui remplace la version du serveur.
- Sans internet, le même paquet passe **par fichier**.
- Le serveur peut **reprendre la main** d'autorité, à partir de sa version ou de la dernière copie reçue.
- Chaque écran de compétition dit **où est la main**.

**Architecture :**
- Un **paquet** JSON contient :
  - les lignes de toutes les tables de la compétition (règle de garde §3.5), sauf `uploads`, `club_invitations` et `mail_log` ;
  - les fiches d'annuaire de ses clubs ;
  - l'expéditeur (identité de l'installation), le nombre de migrations et la version de l'application.
- **Recevoir** un paquet, dans une seule transaction et après une sauvegarde :
  - pour chaque table, met à jour les lignes du paquet par leur clé primaire, ajoute les nouvelles et supprime celles de la compétition qui n'y sont plus ;
  - ne supprime jamais un club par remplacement, pour que les liens et le journal des mails du serveur restent ;
  - `age_links` est entièrement renumérotée.
- Une compétition dont la main est ailleurs refuse toute écriture de l'organisateur (409).
- Les échanges réseau passent par des routes `/api/sync/*` du serveur, ouvertes par un jeton de synchronisation (`Authorization: Bearer`). Le PC les appelle avec `fetch`.

**Tech Stack :** TypeScript, Fastify 5, Drizzle (SQLite), React 19 + Mantine 8, Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §9 (et §3.3, §3.5, §3.6, §3.2 pour l'annuaire). Simplifications de cette étape, à reporter dans la conception (Task 7) :
- la reprise par un second PC passe par un fichier importé sur le serveur par un organisateur, avec confirmation ;
- recevoir un paquet ne supprime pas les liens ni le journal des mails du serveur.

## Global Constraints
- **Paquet** (`SyncPackage`, JSON, `format: 'shidokan-competition'`, `formatVersion: 1`) :
  ```ts
  { format, formatVersion, migrations: number, appVersion: string, exportedAt: string,
    from: { instanceId: string; instanceName: string; role: 'serveur' | 'local' },
    handOver: boolean,                 // vrai : le destinataire prend la main (prise de main, retour, fichier « donner la main »)
    competitionId: string,
    tables: Record<string, Record<string, unknown>[]>,   // lignes brutes (noms de colonnes SQL)
    directory: Record<string, unknown>[] }               // fiches d'annuaire reliées aux clubs
  ```
- **Refus** (400, messages exacts) :
  - autre format : « Ce fichier n'est pas une compétition exportée par l'application. » ;
  - `migrations` plus grand que celui de l'installation : « Ce paquet vient d'une version plus récente de l'application : mettez cette installation à jour. » ;
  - une ligne dont la clé primaire appartient déjà à **une autre compétition** : « Paquet invalide : des données appartiennent à une autre compétition. »
- **Main** (`competitions.owner_instance_id`, `owner_name`, `owner_since`, ces deux derniers ajoutés par la migration) :
  - vide = « Gérée ici » ;
  - sinon, toute écriture d'organisateur sur `/api/competitions/:id/*` ou `PATCH /api/competitions/:id` → **409** « Compétition gérée par <owner_name> depuis le <JJ/MM/AAAA> : lecture seule ici. » ;
  - routes exemptées : celles de `/api/sync/*`, et l'export de la compétition par fichier ;
  - la page du club applique déjà la règle (étape 16).
- **Sur le serveur, prise de main par le PC** : `owner` = le PC (id, nom), `owner_since` = maintenant, inscriptions en ligne figées (`club_entry_status = 'frozen'`), et `last_sync_at`.
- **Sur le PC, copie reçue en lecture seule** : `owner` = le serveur (son id et le nom « le serveur en ligne »), et `last_sync_at`. **Copie reçue avec la main** : `owner` vide.
- **Rendre la main** : accepté seulement si `owner_instance_id` = l'installation qui envoie, sinon 409 « Ce PC n'a pas la main sur cette compétition : exportez-la en fichier et demandez à un organisateur de l'importer en ligne. » Une fois rendu, le serveur a de nouveau la main et le PC a une copie en lecture seule.
- **Copies reçues** (geste 3) : table `received_copies` (id, competition_id FK cascade, from_instance_id, from_name, received_at, package_json). On garde les 5 dernières par compétition. Le PC doit avoir la main, sinon 409.
- **Reprise forcée** (serveur, organisateur connecté, confirmation) : « Reprendre la main » avec `source: 'server' | 'lastCopy'`. La main revient au serveur ; avec `lastCopy`, la compétition est remplacée par la dernière copie reçue.
- **Fichier** :
  - « Exporter la compétition (fichier) » donne un paquet `handOver: false`. Sur le serveur, l'option « et donner la main au PC qui l'importera » met `handOver: true`, `owner` = `file`, et le nom « un PC (par fichier) » ;
  - « Importer une compétition (fichier) » :
    - compétition absente : créée ;
    - compétition présente et gérée ici : confirmation « remplacer » (`replace: true`) ;
    - compétition gérée ailleurs : confirmation « reprendre la main avec ce fichier » (`takeOver: true`) ;
    - sans ces confirmations → 409 avec le message à afficher.
- **Jetons de synchronisation** (serveur) :
  - table `sync_tokens` (id, name, token_hash unique, created_at, last_used_at, revoked_at), propre à l'installation : jamais restaurée, et vidée dans les sauvegardes ;
  - jeton de 32 octets en base64url, montré une seule fois, révocable ;
  - routes `/api/sync/remote/*` : `Authorization: Bearer <jeton>` obligatoire, sinon **401** « Jeton de synchronisation invalide. » Elles sont publiques au sens de la protection par session ;
  - limite : 120 requêtes par 10 minutes et par IP.
- **Réglages du PC** : `app_settings.syncServer = { url, token }`. Le jeton n'est jamais renvoyé (`hasToken`) et il est retiré des sauvegardes, comme le mot de passe SMTP.
- **Bandeau** (chaque écran de compétition) :
  - « Gérée ici » ;
  - « Gérée par <nom> depuis le <date> — lecture seule » ;
  - « Copie du serveur — synchronisé le <date heure> — lecture seule ».
- Textes des boutons (copie exacte) : « Récupérer une copie », « Prendre la main », « Envoyer une copie au serveur », « Rendre la main au serveur », « Reprendre la main », « Exporter la compétition (fichier) », « Importer une compétition (fichier) ».
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e` (le test e2e instable connu « pesée puis réaffectation » mis à part).

## Review Focus
- **Paquet piégé** (reçu par jeton ou par fichier) qui viserait les lignes d'une autre compétition, par exemple une inscription portant l'`id` d'une inscription d'une autre compétition : refus, et rien n'est écrit. Test Task 1.
- **Retour de la compétition sur le serveur** pendant que d'autres compétitions sont en inscription en ligne : leurs inscriptions, liens et mails ne bougent pas. Les liens de la compétition revenue restent présents, figés. Test Task 1.
- **Écriture de l'organisateur sur une compétition gérée ailleurs**, par n'importe quelle route : 409. Test Task 2, qui parcourt les routes.
- **Le PC rend la main après une reprise forcée du serveur** : refus clair, et le PC peut encore exporter son fichier. Test Task 4.
- **Jeton de synchronisation volé ou révoqué** : 401, sans lecture ni écriture possible. Test Task 3.

---

### Task 1 : Paquet d'une compétition (construire, recevoir)

**Files:** Create `src/server/sync/package.ts` ; Modify `src/server/db/schema.ts` (`competitions.ownerName`, `ownerSince` ; tables `syncTokens`, `receivedCopies`), migration `drizzle/0017_passage_de_main.sql` (générée), `src/server/repositories/backups.ts` (`INSTALLATION_TABLES` + `sync_tokens` ; `stripSecrets` vide `sync_tokens` et retire `token` de `syncServer`), `tests/server/row-versions.test.ts` (tables globales : `sync_tokens` ; `received_copies` versionnée et listée) ; Test `tests/server/sync-package.test.ts`.

**Interfaces:**
```ts
export interface SyncPackage { /* Global Constraints */ }
export const PACKAGE_TABLES: string[];   // tables de la compétition qui voyagent (calculées comme versionedTables, sans uploads, club_invitations, mail_log, received_copies)
export function buildPackage(db: AppDb, competitionId: string, opts: { handOver: boolean; role: InstanceRole }): SyncPackage;
export class PackageError extends Error { statusCode: 400 }
/** Remplace (ou crée) la compétition du paquet ; sauvegarde avant ; ne touche à aucune autre compétition. */
export async function importPackage(db: AppDb, dbPath: string, pkg: unknown, owner: { id: string; name: string } | null, now?: Date): Promise<{ competitionId: string; created: boolean }>;
```
- Réception, dans l'ordre : contrôles (format, version, appartenance des clés), sauvegarde (`backupNow`), puis transaction avec `defer_foreign_keys` :
  1. pour chaque table de `PACKAGE_TABLES` (sauf `age_links`) : `INSERT … ON CONFLICT(<clé primaire>) DO UPDATE SET <colonnes du paquet présentes localement>` ;
  2. suppression des lignes de la compétition absentes du paquet. Pour `clubs`, un club absent n'est supprimé que s'il n'a ni combattant ni lien ; sinon il est gardé ;
  3. `age_links` : on supprime les lignes de la compétition, puis on insère sans `id` ;
  4. annuaire : rapprochement (par `id`, puis règle du §3.2 par numéro et par nom) et `clubs.directory_club_id` reliés aux fiches locales, sans écraser une fiche existante ;
  5. `competitions.owner_*` et `last_sync_at` selon `owner`.

- [ ] **Step 1 : tests** (`sync-package.test.ts`, deux bases `openDb` distinctes, A et B) :
  - `aller-retour : une compétition complète (clubs, combattants, inscriptions, catégories et tableaux, résultats, kata, sessions, zones, lancements, numéros figés, réaffectation, grille, passages d'âge) construite en A, reçue en B → mêmes données (comparaison par table, hors version/updated_at)` ;
  - `recevoir de nouveau après des changements en A (une inscription supprimée, un résultat ajouté) → B identique à A` ;
  - `une autre compétition de B n'est pas touchée ; ses age_links gardent leurs id` ;
  - `retour sur une installation qui a des liens et des mails pour cette compétition : ils restent ; un club absent du paquet mais avec un lien reste`;
  - `paquet piégé (une inscription avec l'id d'une inscription d'une autre compétition de B) → 400 « Paquet invalide… », rien n'est écrit` ;
  - `format inconnu → 400 ; migrations supérieures → 400 « … mettez cette installation à jour. »` ;
  - `annuaire : fiche reçue de même numéro qu'une fiche locale → club relié à la fiche locale, non écrasée ; fiche inconnue → ajoutée` ;
  - `une sauvegarde est faite avant la réception` ;
  - `owner : null → gérée ici ; { id, name } → owner_name, owner_since, last_sync_at`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/sync-package.test.ts`.
- [ ] **Step 3 : écrire le schéma et la migration** (`npx drizzle-kit generate --name passage_de_main`), puis `package.ts` et les changements des sauvegardes.
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server && npm run typecheck`.
- [ ] **Step 5 : commit** : `feat(synchronisation): paquet d'une compétition — construire, recevoir sans toucher aux autres compétitions`

### Task 2 : Lecture seule quand la main est ailleurs ; état de la main

**Files:** Create `src/server/sync/ownership.ts` ; Modify `src/server/app.ts` (crochet `preHandler`), `src/server/routes/*` si besoin ; Test `tests/server/ownership.test.ts`.

**Interfaces:**
```ts
export interface Management { managedHere: boolean; ownerName: string | null; ownerSince: string | null; lastSyncAt: string | null; copyOfServer: boolean }
export function getManagement(db: AppDb, competitionId: string): Management;   // GET /api/competitions/:id/management
export function registerReadOnlyGuard(app: FastifyInstance, db: AppDb): void;   // preHandler : écritures refusées (Global Constraints)
```
- [ ] **Step 1 : tests** :
  - `compétition gérée ailleurs : toutes les routes d'écriture /api/competitions/:id/* → 409 avec le message exact`. Parcourir les routes enregistrées, comme le test des routes protégées de l'étape 17 ;
  - `lecture (GET) : 200` ;
  - `gérée ici : écritures acceptées` ;
  - `GET management : les trois états`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer.
- [ ] **Step 3 : écrire le code.**
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server`.
- [ ] **Step 5 : commit** : `feat(synchronisation): compétition en lecture seule quand la main est ailleurs ; état de la main`

### Task 3 : Serveur — jetons de synchronisation et routes distantes

**Files:** Create `src/server/sync/tokens.ts`, `src/server/routes/sync-remote.ts` ; Modify `src/server/auth/guard.ts` (`/api/sync/remote/*` hors session, limite de requêtes), `src/server/app.ts` ; Test `tests/server/sync-remote.test.ts`.

**Interfaces:**
```ts
export function createSyncToken(db: AppDb, name: string): { id: string; name: string; token: string };
export function listSyncTokens(db: AppDb): { id: string; name: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }[];
export function revokeSyncToken(db: AppDb, id: string): void;
export function checkSyncToken(db: AppDb, bearer: string | undefined): boolean;   // met à jour last_used_at
// Organisateur : GET|POST /api/sync/tokens, DELETE /api/sync/tokens/:tokenId
// Distant (jeton) : GET  /api/sync/remote/competitions → { id, name, date, managedHere, ownerName }[]
//                   GET  /api/sync/remote/competitions/:cid/package → SyncPackage (handOver false)
//                   POST /api/sync/remote/competitions/:cid/take { instanceId, instanceName } → SyncPackage (handOver true) ; déjà prise par un autre → 409
//                   POST /api/sync/remote/competitions/:cid/copy (SyncPackage) → 204 ; le PC n'a pas la main → 409
//                   POST /api/sync/remote/competitions/:cid/return (SyncPackage) → 204 ; le PC n'a pas la main → 409 (message exact)
// Organisateur : POST /api/competitions/:id/take-back { source: 'server' | 'lastCopy' } ; GET /api/competitions/:id/received-copies
```
- [ ] **Step 1 : tests** (application en rôle serveur, avec `inject`) :
  - `jeton : créé et montré une fois, liste sans jeton, révoqué → 401 ; sans en-tête → 401` ;
  - `copie : paquet sans changer la main` ;
  - `prise de main : owner = le PC, inscriptions figées, écritures de l'organisateur → 409, page du club en lecture seule` ;
  - `deuxième PC qui prend la main d'une compétition déjà prise → 409` ;
  - `copie envoyée : gardée (5 au plus), sans rien remplacer` ;
  - `retour : compétition remplacée, main revenue au serveur ; autre PC → 409 avec le message exact` ;
  - `reprise forcée : source server → main ici, données du serveur ; source lastCopy → données de la dernière copie` ;
  - `routes distantes : sans connexion organisateur mais avec le jeton → 200 ; la limite de 120 requêtes par 10 minutes s'applique`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer.
- [ ] **Step 3 : écrire le code.**
- [ ] **Step 4 : lancer les tests**, qui doivent passer.
- [ ] **Step 5 : commit** : `feat(synchronisation): serveur — jetons, copie, prise de main, copie de la journée, retour, reprise forcée`

### Task 4 : PC — relier au serveur, gestes, fichiers

**Files:** Create `src/server/sync/client.ts`, `src/server/routes/sync-local.ts` ; Modify `src/domain/app-settings.ts` (`syncServer`), `src/server/repositories/app-settings.ts` (jeton jamais renvoyé : `hasToken`) ; Test `tests/server/sync-local.test.ts`.

**Interfaces:**
```ts
// PC :  GET|PATCH /api/sync/settings → { url: string | null; hasToken: boolean }
//       GET  /api/sync/server-competitions → liste du serveur (passe par fetch)
//       POST /api/sync/pull { competitionId, take: boolean } → { competitionId } (copie en lecture seule, ou avec la main)
//       POST /api/competitions/:id/sync/copy → { sentAt }
//       POST /api/competitions/:id/sync/return → 204 (la copie locale passe en lecture seule)
// Les deux rôles :
//       GET  /api/competitions/:id/export.json?handOver=1 (handOver seulement en rôle serveur : owner = file)
//       POST /api/competitions/import (corps : paquet ; ?replace=1 ou ?takeOver=1) → { competitionId, created }
// Erreurs réseau : 502 « Serveur injoignable : <détail>. » ; réponse d'erreur du serveur : son code et son message relayés.
export async function remote<T>(db: AppDb, method: string, path: string, body?: unknown): Promise<T>;   // fetch(url + path, Authorization: Bearer)
```
- [ ] **Step 1 : tests** (deux applications : le serveur écoute sur un port libre avec `app.listen({ port: 0 })`, le PC utilise `inject`) :
  - `réglages : jeton jamais renvoyé` ;
  - `liste des compétitions du serveur` ;
  - `récupérer une copie → compétition en lecture seule sur le PC (copyOfServer)` ;
  - `prendre la main → modifiable sur le PC ; lecture seule sur le serveur` ;
  - `résultat saisi sur le PC, copie envoyée → le serveur l'a gardée ; rendre la main → le serveur a le résultat et la main, le PC une copie en lecture seule` ;
  - `après une reprise forcée du serveur : rendre la main → 409 relayé avec son message ; export en fichier toujours possible` ;
  - `fichier : export puis import sur une autre base ; présente et gérée ici sans replace → 409 ; avec replace → remplacée ; gérée ailleurs sans takeOver → 409 ; avec takeOver → gérée ici` ;
  - `serveur injoignable → 502`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer.
- [ ] **Step 3 : écrire le code.**
- [ ] **Step 4 : lancer les tests**, qui doivent passer.
- [ ] **Step 5 : commit** : `feat(synchronisation): PC — relier au serveur, récupérer, prendre la main, copie, rendre la main ; échange par fichier`

### Task 5 : Écrans

**Files:** Create `src/web/components/ManagementBanner.tsx`, `src/web/components/SyncPanel.tsx` ; Modify `src/web/components/CompetitionLayout.tsx` (bandeau), `src/web/pages/CompetitionSettingsPage.tsx` (section « Échanges avec le serveur » : gestes, export et import par fichier), `src/web/pages/CompetitionsPage.tsx` (« Récupérer depuis le serveur » sur le PC, « Importer une compétition (fichier) »), `src/web/pages/AppSettingsPage.tsx` (« Synchronisation » : sur le PC, adresse et jeton ; sur le serveur, les jetons), `src/web/api.ts`, `src/web/help.ts` (sujets `synchronisation`, `reglages.echanges`) ; Test `tests/web/help.test.ts`.

- [ ] **Step 1 : test d'aide** : `synchronisation : l'aide explique les quatre gestes et le fichier`. Il doit échouer.
- [ ] **Step 2 : écrire les écrans.** Le bandeau et les gestes suivent les Global Constraints. Chaque geste qui change la main demande une confirmation, dont le texte dit ce qui va se passer.
- [ ] **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/web`.
- [ ] **Step 4 : commit** : `feat(synchronisation): écrans — bandeau de la main, gestes, fichiers, jetons`

### Task 6 : Parcours e2e entre les deux serveurs de test

**Files:** Create `tests/e2e/synchronisation.spec.ts`.
- [ ] **Step 1 : e2e** `passage de main : jeton en ligne → PC relié → copie → prise de main (lecture seule en ligne) → résultat sur le PC → rendre la main → résultat en ligne` : le serveur de test (3101, compte `orga@e2e.example`) et le PC (3100). Le PC s'adresse à `http://localhost:3101`.
- [ ] **Step 2 : lancer toute la suite**, qui doit passer.
- [ ] **Step 3 : commit** : `test(e2e): passage de main entre le serveur et le PC`

### Task 7 : Documents

**Files:** Modify `docs/installation-serveur.md` (« Le jour J » réécrit avec la synchronisation, et le fichier en secours), `docs/superpowers/specs/…` (§9 : les simplifications), feuille de route, bilan.
- [ ] **Step 1 : rédiger.**
- [ ] **Step 2 : commit** : `docs: étape 18 — passage de main`
