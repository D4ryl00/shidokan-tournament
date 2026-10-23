# Étape 21 (étape F du spec) : PC de zone autonomes — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** si le réseau local tombe en pleine journée, chaque zone continue sur son PC portable, puis ses saisies rejoignent le PC principal sans rien écraser.
- Avant la coupure, le portable suit le PC principal, dans les secondes qui suivent chaque changement.
- Pendant la coupure, « Continuer sans réseau » : seules les saisies de sa zone, dans les sessions lancées, sont possibles, et chacune est notée dans un journal.
- Au retour, « Repasser en ligne » (ou un fichier sur clé USB) : le PC principal rejoue le journal et montre les conflits en cartes « À trancher ».
- Pour les finales : (a) elles attendent ; (b) « Jouer ici les finales de mes catégories » ; (c) recevoir une copie plus récente sans perdre ses saisies.

**Architecture :**
- **Portable** (rôle local), réglage `app_settings.zoneLink` : il suit le PC principal (flux d'événements + export de la compétition), et garde la compétition en lecture seule, avec la main au « PC principal ».
- **Zone autonome** : dans la garde de lecture seule (`registerReadOnlyGuard`), une exception pour les quatre saisies de la zone (résultat, effacement, notes de kata, départage). Un `preHandler` prépare l'entrée de journal (révision lue, combattants), et un `onResponse` réussi l'enregistre dans `zone_journal`.
- **PC principal** : `POST /api/competitions/:id/zone-journal` reçoit un journal, le rejoue (`src/server/zone/replay.ts`) et garde chaque entrée reçue dans `zone_entries` avec son état. Les conflits sont des cartes.
- **Rebase (c)** : le même moteur de rejeu, en mode local, réapplique les saisies non envoyées du portable sur une copie plus récente.

**Tech Stack :** TypeScript, Fastify 5, Drizzle (SQLite), React 19 + Mantine 8, react-query, Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-23-zones-autonomes-design.md` (qui précise §10 de `2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md`).

## Global Constraints
- Rôle **local** seulement : les routes `zone-link` et `zone-journal` ne sont enregistrées qu'en rôle local (le PC principal et les portables sont des installations locales).
- **Réglage du portable** :
  - `app_settings.zoneLink = { mainUrl: string, competitionId: string, zoneId: string, mainInstanceId?: string, autonomous: { since: string, finals: boolean } | null } | null` ;
  - `mainUrl` : `http://` ou `https://`, sans `/` final.
- **Copie du PC principal** :
  - `GET <mainUrl>/api/competitions/:id/export.json`, qui porte désormais `fingerprint` ;
  - importée avec la main au PC principal (`owner = { id: pkg.from.instanceId, name: 'le PC principal' }`), sans sauvegarde quand elle remplace une copie, et pas du tout si l'empreinte n'a pas changé (`server_fingerprint`) ;
  - déclenchée par chaque `event: change` du flux `GET <mainUrl>/api/competitions/:id/events` (regroupé : 1 s ; jamais deux copies à la fois ; reconnexion du flux après 5 s), et chaque minute par sécurité ;
  - **jamais** pendant la zone autonome, ni si la compétition n'est plus une copie du PC principal (contrôle avant **et** après l'échange réseau, comme `pullCopy`).
- **Bandeaux (copie exacte)** :
  - `Management.copyOfMain` : « Copie du PC principal — à jour à <HH:MM:SS> — lecture seule » ;
  - en zone autonome : « Zone autonome <nom de zone> depuis <HH:MM> — <n> saisie(s) à renvoyer ».
- **Zone autonome** :
  - écritures permises : `PUT`/`DELETE …/categories/:cid/results/:matchId`, `PUT …/kata/:rid/:round`, `PUT …/tie-break` ;
  - conditions : la zone de la saisie (`entryZones`, étape 20) contient la zone du portable (avec `finals`, ou la zone de la catégorie pour une finale ou une finale de kata), **et** la catégorie est dans une session lancée sur la copie (`launchedCategoryIds`) ;
  - refus (409, copie exacte) :
    - autre écriture : « Zone autonome : seules les saisies de la zone <nom> sont possibles sur ce PC. » ;
    - autre zone : « Ce combat ne se joue pas sur la zone <nom>. » ;
    - session non lancée : « Session suivante pas encore lancée sur cette copie. »
- **Entrée de journal** (`ZoneEntry`, JSON) :
  ```ts
  { id: string; seq: number; kind: 'result' | 'delete' | 'kata' | 'tie-break'; categoryId: string;
    matchId?: string; registrationId?: string; round?: 'round1' | 'final'; scope?: string;
    data: { winner: 'a' | 'b'; method: string; score: string | null } | { notes: number[] } | { order: string[] } | null;
    entrants: [string, string] | null;   // combat : les deux combattants au moment de la saisie
    baseRev: string;                     // révision lue avant (resultRev / kataRev / tieBreakRev), 'none' si rien
    categoryVersion: number | null;      // affichage seulement
    zoneId: string; at: string }
  ```
  Clé de cible : `match:<matchId>`, `kata:<registrationId>:<round>`, `tb:<scope>` (avec la catégorie).
- **Journal envoyé ou fichier** (`ZoneJournalFile`) : `{ format: 'shidokan-zone-journal', formatVersion: 1, competitionId, zoneId, zoneName, from: { instanceId, instanceName }, entries: ZoneEntry[] }`. Fichier : `journal-<zone>-<AAAAMMJJ-HHMMSS>.json`.
- **Rejeu sur le PC principal** (par entrée, dans l'ordre de `seq`) :
  - entrée déjà reçue (même `id`) : ignorée (`alreadyReceived`) ;
  - une entrée antérieure du même journal, sur la même catégorie, est `conflict` ou `waiting` : `waiting` ;
  - les combattants actuels du combat diffèrent de `entrants` : `conflict`, raison « Les combattants de ce combat ont changé. » ;
  - l'état actuel est identique à la saisie : `present` ;
  - la révision actuelle vaut `baseRev`, ou vaut `applied_rev` de la dernière entrée de ce journal sur la même cible (correction par la zone de sa propre saisie) : appliquée par les fonctions habituelles (`putResult`, `deleteResult`, `putKataNotes`, `putTieBreak`) → `applied`, avec `applied_rev` = la révision après ;
  - sinon : `conflict`, raison « Une autre saisie a été faite sur le PC principal. » ;
  - une fonction habituelle refuse : `conflict`, avec son message.
- **Compte rendu** : `{ received, applied, present, conflicts, waiting, alreadyReceived }`. Texte : « <n> saisies reçues de <zone> : <a> appliquées, <p> déjà présentes, <c> à trancher ».
- **Cartes « À trancher »** : `GET …/zone-cards` liste les entrées `conflict` et `waiting`, avec l'état actuel sur le PC principal. `POST …/zone-cards/:entryId` `{ keep: 'zone' | 'pc' }` :
  - `zone` applique la saisie sans contrôle de révision, mais avec les mêmes combattants, sinon 409 « Les combattants de ce combat ont changé : impossible de garder la saisie de la zone. » ;
  - ensuite, les entrées `waiting` de la catégorie sont réexaminées dans l'ordre.
- **File de la zone sur le PC principal** : `schedule` marque `held: true` les passages des catégories qui ont une carte ouverte. Ils s'affichent « En attente d'une décision à la table centrale », sans bouton « Saisir ».
- Textes des boutons (copie exacte) : « Continuer sans réseau (zone <nom>) », « Repasser en ligne », « Exporter le journal (fichier) », « Arrêter la zone autonome », « Jouer ici les finales de mes catégories », « Recevoir une copie plus récente », « Importer un journal de zone (fichier) », « Garder celui de la zone », « Garder celui du PC ».
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Une copie du PC principal qui arrive juste après « Continuer sans réseau »** n'écrase rien de la zone autonome. Test Task 2, avec les réponses retenues (comme `sync-follow.test.ts`).
- **Le même journal reçu deux fois** (réseau puis fichier, ou bouton pressé deux fois) : rien n'est appliqué deux fois, et pas de carte en double. Test Task 4.
- **La table centrale a saisi un autre résultat pour le même combat**, ou une réaffectation a changé les combattants : carte, rien d'écrasé ; et les combats suivants de la catégorie attendent. Test Task 4.
- **« Repasser en ligne » qui échoue** (PC principal injoignable, réponse coupée) : la zone reste autonome et le journal reste à renvoyer. Un renvoi après une réponse perdue ne double rien. Test Task 5.
- **Rebase (c)** : une saisie de la zone déjà présente sur la nouvelle copie n'est pas doublée, une saisie en conflit n'écrase pas la copie, et toutes les saisies restent à renvoyer. Test Task 7.

---

### Task 1 : Données, réglage du portable et copie du PC principal

**Files:** Modify `src/server/db/schema.ts` (tables `zoneJournal`, `zoneEntries`, avec `rowMeta()`), migration `drizzle/0020_zones_autonomes.sql` (générée), `src/server/sync/package.ts` (`LOCAL_ONLY_TABLES` + `zone_journal`, `zone_entries`), `src/server/routes/sync-local.ts` (`export.json` porte `fingerprint`), `src/server/sync/ownership.ts` (`copyOfMain`), Create `src/server/zone/link.ts`, `src/server/routes/zone-link.ts`, Modify `src/server/app.ts` (rôle local : routes + `startZoneFollow`), `src/web/api.ts`, `src/web/components/SyncPanel.tsx` (`managementText`), Create `src/web/components/ZoneLinkCard.tsx` (Réglages de l'application) ; Test `tests/server/zone-link.test.ts`.

**Interfaces:**
```ts
// zone/link.ts
export interface ZoneLink { mainUrl: string; competitionId: string; zoneId: string; mainInstanceId?: string; autonomous: { since: string; finals: boolean } | null }
export function getZoneLink(db: AppDb): ZoneLink | null;
export function setZoneLink(db: AppDb, v: ZoneLink | null): void;
export function zoneLinkStatus(dbPath: string): { lastCopyAt: string | null; lastError: string | null };
export async function copyFromMain(db: AppDb, dbPath: string): Promise<{ ok: true } | { error: string }>;
export function startZoneFollow(db: AppDb, dbPath: string, onError: (e: unknown) => void, fetchImpl?: typeof fetch): () => void; // flux + minute
// Tables
zone_journal(id pk, competition_id fk cascade, zone_id, seq int, kind, category_id, target_key, entry_json, created_at, sent_at null)
zone_entries(id pk, competition_id fk cascade, from_instance_id, zone_id, zone_name, seq, kind, category_id, target_key, entry_json,
             status 'applied'|'present'|'conflict'|'waiting'|'kept-zone'|'kept-pc', reason null, applied_rev null, received_at, decided_at null)
```
- Routes du portable : `GET /api/zone-link` (réglage + état + `pending` : nombre d'entrées non envoyées), `PUT /api/zone-link` (`{ mainUrl, competitionId, zoneId } | null` ; changer de compétition ou de zone est refusé (409) pendant la zone autonome), `POST /api/zone-link/probe` `{ mainUrl }` → `{ competitions: { id, name, zones: { id, name }[] }[] }` (lu sur le PC principal, pour remplir les listes).
- `ZoneLinkCard` : adresse du PC principal, « Chercher », listes compétition et zone, état « Copie à jour à HH:MM:SS » ou l'erreur.

- [ ] **Step 1 : tests** (`zone-link.test.ts` : deux applications locales qui écoutent, `main` et `laptop`) :
  - `probe : compétitions et zones du PC principal` ;
  - `copyFromMain : copie en lecture seule, main au PC principal ; Management.copyOfMain ; une seconde copie inchangée n'importe rien` (aucune sauvegarde de plus) ;
  - `suivi : une inscription sur le PC principal arrive sur le portable en moins de 3 s` (attente active, flux réel) ;
  - `PC principal arrêté : lastError rempli, la copie reste lisible` ;
  - `pas de copie si la compétition n'est plus une copie du PC principal (prise par fichier, par exemple)` ;
  - `règle de garde : zone_journal et zone_entries classées (unclassifiedTables vide), versionnées`.
- [ ] **Step 2 :** `npx vitest run tests/server/zone-link.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run tests/server/zone-link.test.ts tests/server/sync-package.test.ts tests/server/row-versions.test.ts tests/server/ownership.test.ts` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(zones autonomes): le portable de zone suit le PC principal`.

### Task 2 : Zone autonome sur le portable (garde et journal)

**Files:** Create `src/server/zone/autonomous.ts`, Modify `src/server/sync/ownership.ts` (exception de la garde de lecture seule), `src/server/repositories/results.ts` (exporter `matchEntrants`), `src/server/routes/zone-link.ts` (`POST /api/zone-link/autonomous`), `src/server/zone/link.ts` (aucune copie pendant la zone autonome, contrôle après l'échange réseau) ; Test `tests/server/zone-autonomous.test.ts`.

**Interfaces:**
```ts
export async function matchEntrants(db: AppDb, competitionId: string, categoryId: string, matchId: string): Promise<[string, string] | null>; // results.ts
/** Décision de la garde en zone autonome : null = permis, sinon le message de refus. */
export async function autonomousRefusal(db: AppDb, link: ZoneLink, method: string, route: string, params: Record<string, string>): Promise<string | null>;
/** Prépare l'entrée (révision lue, combattants) avant l'écriture ; l'enregistre si l'écriture a réussi. */
export function registerZoneJournal(app: FastifyInstance, db: AppDb): void;
export function pendingEntries(db: AppDb, competitionId: string): ZoneEntry[];
```
- `POST /api/zone-link/autonomous` : seulement si la compétition est une copie du PC principal (sinon 409 « Seule une copie du PC principal peut passer en zone autonome. ») ; `autonomous = { since: maintenant, finals: false }`.

- [ ] **Step 1 : tests** (`zone-autonomous.test.ts`, mêmes deux applications ; compétition lancée avec deux zones, -54 et kata sur Tatami 1, -61 sur Tatami 2 — même jeu que `permissions.test.ts`) :
  - `avant : toute écriture sur le portable → 409 (lecture seule)` ;
  - `zone autonome Tatami 1 : résultat d'un combat de -54 → 200 et une entrée de journal (entrants, baseRev 'none', seq 1) ; correction du même combat → seq 2, baseRev = la version locale` ;
  - `résultat d'un combat de -61 → 409 « Ce combat ne se joue pas sur la zone Tatami 1. » ; PATCH d'une catégorie → 409 « Zone autonome : seules les saisies… » ; rien dans le journal` ;
  - `catégorie d'une session non lancée → 409 « Session suivante pas encore lancée sur cette copie. »` ;
  - `notes de kata et départage de sa zone → journal (kind kata, tie-break)` ;
  - `une copie du PC principal en cours quand la zone devient autonome : la réponse arrivée après n'écrase rien` (réponses retenues, comme `sync-follow.test.ts`) ;
  - `bandeau : GET /api/zone-link donne autonomous.since et pending = 3`.
- [ ] **Step 2 :** `npx vitest run tests/server/zone-autonomous.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run tests/server/zone-autonomous.test.ts tests/server/zone-link.test.ts tests/server/ownership.test.ts tests/server/results.test.ts` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(zones autonomes): zone autonome sur le portable, avec son journal`.

### Task 3 : Moteur de rejeu et réception sur le PC principal

**Files:** Create `src/server/zone/replay.ts`, `src/server/routes/zone-journal.ts` (rôle local) ; Test `tests/server/zone-replay.test.ts`.

**Interfaces:**
```ts
export type EntryStatus = 'applied' | 'present' | 'conflict' | 'waiting';
/** Une entrée contre l'état actuel (règles des Global Constraints) ; `apply` : l'écrire si possible. */
export async function evaluateEntry(db: AppDb, competitionId: string, e: ZoneEntry, ctx: { blockedCategories: Set<string>; lastAppliedRev: (e: ZoneEntry) => string | null; apply: boolean }):
  Promise<{ status: EntryStatus; reason: string | null; appliedRev: string | null }>;
export async function receiveJournal(db: AppDb, journal: ZoneJournalFile): Promise<{ received: number; applied: number; present: number; conflicts: number; waiting: number; alreadyReceived: number }>;
```
- `POST /api/competitions/:id/zone-journal` (corps : le journal ; `competitionId` différent → 400 « Ce journal est celui d'une autre compétition. » ; format inconnu → 400 « Ce fichier n'est pas un journal de zone. ») → le compte rendu. Le corps est validé par zod, et une entrée mal formée refuse tout le journal.

- [ ] **Step 1 : tests** (`zone-replay.test.ts`, une application ; les journaux sont construits à la main, avec `entrants` et `baseRev` lus sur l'application) :
  - `combat vide, mêmes combattants → applied, le résultat est là` ;
  - `résultat identique déjà présent → present` ;
  - `autre résultat saisi entre-temps → conflict « Une autre saisie a été faite sur le PC principal. », rien n'a changé` ;
  - `combattants changés (réaffectation ou régénération) → conflict « Les combattants de ce combat ont changé. »` ;
  - `après un conflit, l'entrée suivante de la même catégorie → waiting ; celle d'une autre catégorie → applied` ;
  - `correction par la zone de sa propre saisie (seq 1 puis seq 2 sur le même combat) → les deux applied, le résultat final est celui de seq 2` ;
  - `effacement, notes de kata, départage : applied / present / conflict` ;
  - `journal reçu deux fois → alreadyReceived = n, rien de plus` ;
  - `autre compétition → 400 ; format inconnu → 400`.
- [ ] **Step 2 :** `npx vitest run tests/server/zone-replay.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run tests/server/zone-replay.test.ts` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(zones autonomes): le PC principal rejoue le journal d'une zone`.

### Task 4 : Cartes « À trancher », file de la zone, import par fichier

**Files:** Modify `src/server/routes/zone-journal.ts` (`GET …/zone-cards`, `POST …/zone-cards/:entryId`), `src/server/zone/replay.ts` (`decideCard`, réexamen des `waiting`), `src/server/repositories/results.ts` (`schedule` : `held`), `src/web/api.ts`, Create `src/web/components/ZoneCards.tsx` (section « À trancher » de l'onglet Combats, postes Organisation et Table centrale, avec « Importer un journal de zone (fichier) »), Modify `src/web/pages/MatchesPage.tsx` ; Test `tests/server/zone-cards.test.ts`.

**Interfaces:**
```ts
export async function decideCard(db: AppDb, competitionId: string, entryId: string, keep: 'zone' | 'pc'): Promise<void>;
// GET …/zone-cards → { id, zoneName, at, categoryId, categoryLabel, kind, target: string, zone: string, pc: string, status: 'conflict' | 'waiting', reason: string | null }[]
//   `zone` et `pc` : textes lisibles (« DURAND Léa gagne par KO », « notes 8 · 8 · 7 », « aucun résultat »).
```

- [ ] **Step 1 : tests** (`zone-cards.test.ts`) :
  - `cartes : conflit et entrée en attente, avec les deux états lisibles` ;
  - `garder celui de la zone → appliqué ; l'entrée en attente de la catégorie s'applique toute seule` ;
  - `garder celui du PC → rien ne change ; l'entrée en attente devient un conflit (combattants changés)` ;
  - `garder celui de la zone quand les combattants ont changé → 409 avec le message exact` ;
  - `schedule : held sur les passages d'une catégorie qui a une carte ouverte ; plus après la décision` ;
  - `même journal reçu deux fois : pas de carte en double`.
- [ ] **Step 2 :** `npx vitest run tests/server/zone-cards.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter (serveur, puis `ZoneCards` et l'affichage `held` dans la file : « En attente d'une décision à la table centrale », sans « Saisir », `data-testid` `zone-card-item`, `zone-keep-zone`, `zone-keep-pc`, `zone-journal-import`, `queue-held`).
- [ ] **Step 4 :** `npx vitest run tests/server/zone-cards.test.ts tests/server/results.test.ts tests/web` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(zones autonomes): cartes « À trancher » et file de la zone en attente`.

### Task 5 : « Repasser en ligne », export du journal, écran du portable

**Files:** Modify `src/server/routes/zone-link.ts` (`POST /api/zone-link/online`, `GET /api/zone-link/journal.json`, `POST /api/zone-link/stop`), `src/web/api.ts`, `src/web/poste.ts` (poste imposé en zone autonome), Create `src/web/components/ZoneAutonomyBar.tsx` (en haut de l'écran d'une compétition sur le portable), Modify `src/web/components/CompetitionLayout.tsx`, `src/web/pages/MatchesPage.tsx` (« <n> combats en attente des résultats des autres zones » en zone autonome), `playwright.config.ts` (troisième serveur local, port 3102 : le portable), Create `tests/e2e/zones-autonomes.spec.ts` ; Test `tests/server/zone-online.test.ts`.

**Interfaces:**
- `POST /api/zone-link/online` : envoie les entrées non envoyées (`sent_at` vide) à `<mainUrl>/api/competitions/:id/zone-journal`. Si l'envoi réussit : `sent_at` rempli, `autonomous = null`, copie immédiate du PC principal, et la réponse est le compte rendu. Sinon : 502 relayé (« PC principal injoignable : … »), et rien ne change.
- `GET /api/zone-link/journal.json` : le fichier du journal (entrées non envoyées), qui ne change rien.
- `POST /api/zone-link/stop` `{ exported: true }` : marque les entrées non envoyées comme envoyées (par fichier) et arrête la zone autonome. Sans `exported: true` → 400 « Exportez d'abord le journal (fichier). »
- Poste : en zone autonome, `{ kind: 'zone', zoneId }` est imposé sur la compétition du portable (même mécanique que `accountPoste`).

- [ ] **Step 1 : tests** (`zone-online.test.ts`) :
  - `repasser en ligne : saisies appliquées sur le PC principal, compte rendu, zone autonome arrêtée, copie reprise` ;
  - `PC principal arrêté → 502, la zone reste autonome, pending inchangé` ;
  - `réponse perdue après réception (réponses retenues puis coupées) : un second envoi → alreadyReceived, rien en double` ;
  - `journal.json puis stop exported → plus autonome ; le fichier importé sur le PC principal applique les saisies`.
- [ ] **Step 2 :** `npx vitest run tests/server/zone-online.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter (serveur, puis écran : bandeau, « Continuer sans réseau (zone <nom>) » avec confirmation, « Repasser en ligne », « Exporter le journal (fichier) », « Arrêter la zone autonome » confirmé ; après « Repasser en ligne », lien « Ouvrir le PC principal » vers `mainUrl`).
- [ ] **Step 4 : e2e** (`zones-autonomes.spec.ts`, PC principal 3100 et portable 3102) : `relier le portable, zone autonome, saisir un combat, la table centrale saisit un autre combat de la même catégorie sur le PC principal, repasser en ligne, trancher la carte`. Puis `npx vitest run tests/server/zone-online.test.ts && npx playwright test tests/e2e/zones-autonomes.spec.ts` → PASS.
- [ ] **Step 5 :** commit `feat(zones autonomes): repasser en ligne, journal par fichier, écran du portable`.

### Task 6 : Finales de ses catégories (b)

**Files:** Modify `src/server/zone/autonomous.ts`, `src/server/routes/zone-link.ts` (`POST /api/zone-link/finals`), `src/web/components/ZoneAutonomyBar.tsx` ; Test `tests/server/zone-autonomous.test.ts` (compléter).

- Une finale (`finalMatchIds` de la catégorie, ou le bloc `kata:finale`) d'une catégorie dont la zone (`plan.categories[cid].zoneId`) est celle du portable devient permise quand `autonomous.finals` est vrai.
- [ ] **Step 1 : tests** : `zone des finales réglée sur Tatami 2 : la finale de -54 refusée au portable Tatami 1 ; après « finals », permise et journalisée ; une finale d'une catégorie de Tatami 2 reste refusée` ; `au rejeu, une finale déjà jouée sur la zone des finales → carte` (dans `zone-replay.test.ts`).
- [ ] **Step 2 :** `npx vitest run tests/server/zone-autonomous.test.ts tests/server/zone-replay.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter (bouton « Jouer ici les finales de mes catégories », confirmé par : « Les finales de vos catégories se joueront ici, même si une zone des finales est prévue. Si elle les joue aussi, la table centrale tranchera. »).
- [ ] **Step 4 :** mêmes commandes → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(zones autonomes): jouer ici les finales de ses catégories`.

### Task 7 : Recevoir une copie plus récente pendant la coupure (c)

**Files:** Create `src/server/zone/rebase.ts`, Modify `src/server/routes/zone-link.ts` (`POST /api/zone-link/refresh` : par le réseau, ou avec un fichier de compétition en corps), `src/web/components/ZoneAutonomyBar.tsx` ; Test `tests/server/zone-rebase.test.ts`.

**Interfaces:**
```ts
/** Remplace la copie par `pkg` (sauvegarde d'abord), puis réapplique localement les entrées non envoyées avec evaluateEntry (apply: true,
 *  sans rien écrire dans zone_entries ni dans le journal) ; les entrées restent à renvoyer. */
export async function rebaseOnto(db: AppDb, dbPath: string, pkg: SyncPackage): Promise<{ reapplied: number; present: number; conflicts: number }>;
```
- La zone reste autonome. Une entrée en conflit n'écrase pas la nouvelle copie ; elle reste dans le journal (le PC principal en fera une carte). Message : « Nouvelle copie prise : <r> saisies réappliquées, <p> déjà présentes, <c> en conflit (elles seront tranchées à la table centrale). »
- [ ] **Step 1 : tests** (`zone-rebase.test.ts`) :
  - `copie plus récente avec le résultat d'une demi-finale d'une autre zone : la finale devient jouable sur le portable` ;
  - `saisie de la zone déjà présente sur la nouvelle copie → present, pas de doublon` ;
  - `saisie en conflit → la nouvelle copie garde sa valeur ; l'entrée reste à renvoyer` ;
  - `toutes les entrées restent non envoyées ; « Repasser en ligne » ensuite → compte rendu cohérent` ;
  - `fichier d'une autre compétition → 400`.
- [ ] **Step 2 :** `npx vitest run tests/server/zone-rebase.test.ts` → échecs attendus.
- [ ] **Step 3 :** implémenter (bouton « Recevoir une copie plus récente » : par le réseau, ou avec un fichier).
- [ ] **Step 4 :** `npx vitest run tests/server/zone-rebase.test.ts tests/server/zone-online.test.ts` → PASS ; `npm run typecheck`.
- [ ] **Step 5 :** commit `feat(zones autonomes): recevoir une copie plus récente sans perdre ses saisies`.

### Task 8 : Aide et documents

**Files:** `src/web/help.ts` (topic `zones-autonomes` ; aide des Réglages et de l'onglet Combats), `src/web/components/DayChecklist.tsx` (une ligne : portables de zone reliés au PC principal ; que faire si le réseau tombe), conception `2026-10-23-zones-autonomes-design.md` (*construit*, et les écarts), `2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §10 et §11 (renvoi, étape F construite), feuille de route (ligne 21), bilan.

- [ ] **Step 1 :** textes et documents.
- [ ] **Step 2 :** `npm run typecheck && npm test && npm run test:e2e` → tout PASS.
- [ ] **Step 3 :** commit `docs: étape 21 — zones autonomes`.
