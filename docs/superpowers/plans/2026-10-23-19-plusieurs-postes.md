# Étape 19 (étape A du spec) : plusieurs postes sur une même base — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** plusieurs navigateurs travaillent sur la même compétition, sur le réseau local ou en ligne :
- les écrans se mettent à jour tout seuls en quelques secondes ;
- une modification faite sur une donnée périmée est refusée (409) au lieu d'écraser celle d'un autre poste ;
- chaque navigateur choisit son **poste** (Organisation, Table centrale, Zone…), ce qui simplifie son écran ;
- un second PC peut garder une **copie de secours** du PC principal ;
- une fiche « Préparer le jour J » explique l'installation en réseau.

**Architecture :**
- **Révisions** : chaque donnée modifiable renvoie une révision `rev`, une chaîne tirée des `version` de ses lignes, de l'étape 15. Le navigateur la renvoie dans l'en-tête `If-Match` ; `If-Match: none` signifie « il n'y en avait pas ». Le serveur compare et répond 409 si elle a changé. Sans en-tête, rien n'est contrôlé, ce qui garde la compatibilité.
- **Événements** : `GET /api/competitions/:id/events` (Server-Sent Events). Après chaque écriture réussie sur une compétition, le serveur envoie `change`. Le navigateur relit alors ses données, mais attend qu'il n'y ait plus de saisie non enregistrée à l'écran.
- **Postes** : un réglage propre à chaque navigateur, gardé dans `localStorage` et par compétition. Le serveur n'est pas concerné (§7.3 : « pas à protéger »).
- **Copie de secours** : réglage de l'application en rôle local (`mirror: { url, intervalMin }`) et tâche de fond qui télécharge `url/api/backup.sqlite` vers `sauvegardes/copies/`. Ces copies sont listées et restaurables dans la section Sauvegardes.

**Tech Stack :** TypeScript, Fastify 5, React 19 + Mantine 8, react-query, Vitest, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §7.1 à §7.5. Hors de cette étape : les comptes par rôle en ligne (étape E).

## Global Constraints
- **409 périmé** (copie exacte) : « Modifié entre-temps par un autre poste : l'écran a été rechargé. » Le navigateur relit alors toutes ses données et affiche ce message.
- **Données protégées par une révision**, avec la valeur de `rev` :
  - résultat d'un combat (`PUT` et `DELETE …/results/:matchId`) : la `version` de la ligne `match_results`, ou `none` ;
  - notes de kata (`PUT …/kata/:rid/:round`) : la `version` de la ligne `kata_scores`, ou `none` ;
  - départage (`PUT …/tie-break`, selon la portée) : la `version` de la ligne `tie_breaks`, ou `none` ;
  - inscription (`PUT` et `DELETE …/registrations/:rid`) : `<version de l'inscription>:<version du combattant>` ;
  - catégorie (`PATCH …/categories/:cid`, ainsi que `move`, `swap`, `redraw` et `regenerate`) : la `version` de la ligne `categories` ;
  - sessions (`PUT …/waves`) et zones (`PUT …/zones`) : l'empreinte de la liste, c'est-à-dire les `id:version` triés et joints par `|`.
- **Où se trouve `rev`** dans les réponses existantes, comme champ en plus :
  - `results.records[].rev` ;
  - `results.kataRevs` (`{ [registrationId]: { round1?: string, final?: string } }`) ;
  - `results.tieBreakRevs` (`{ [scope]: string }`) ;
  - lignes d'inscription `rev` ;
  - catégories `rev` ;
  - `GET …/waves` et `GET …/zones` : en-tête de réponse `ETag` (la liste ne change pas de forme).
- **Événements** :
  - `text/event-stream`, avec `event: change` et `data: {}`, plus un commentaire `: ping` toutes les 25 s ;
  - envoyés après toute requête qui n'est pas un GET, qui réussit (moins de 400) et dont la route commence par `/api/competitions/:id`, ainsi qu'après les écritures de la page d'un club et les réceptions de paquets (`importPackage`) ;
  - en rôle serveur, la route demande une session, comme les autres.
- **Postes** (`localStorage` `poste:<competitionId>` = `{ kind: 'organisation' | 'table' | 'zone', zoneId?: string }`, `organisation` par défaut) :
  - **Organisation** : tous les onglets ;
  - **Table centrale** : Inscriptions, Clubs, Pesée, Réaffectation, Tableaux, Combats, Podiums ;
  - **Zone** : Combats et Tableaux, avec l'onglet Combats limité à cette zone (son choix de zone est verrouillé).
  - Le choix se fait par une liste « Poste » dans l'en-tête de la compétition. Un onglet masqué ouvert par son adresse redirige vers le premier onglet du poste.
- **Copie de secours** (rôle local) :
  - réglage `mirror = { url: string, intervalMin: number (1 à 60, 5 par défaut) } | null` ;
  - les fichiers vont dans `sauvegardes/copies/copie-<AAAAMMJJ-HHMMSS>.sqlite`, et on garde les 100 dernières ;
  - dernier état gardé en mémoire et renvoyé par `GET /api/mirror` : `{ url, intervalMin, lastSuccessAt, lastError }` ;
  - liste des copies : `GET /api/mirror/copies` ; restauration d'une copie : `POST /api/mirror/copies/:name/restore`. Elle passe par `restoreFrom`, donc la main revient à cette installation (§3.3).
- **Fiche « Préparer le jour J »** (Réglages de l'application) :
  - la liste du §7.5 ;
  - l'adresse à ouvrir sur les autres postes, en grand : `window.location.origin` si on n'est pas sur `localhost`. Sinon, la phrase « Ouvrez l'application depuis l'adresse du PC sur le réseau (dans Windows : `ipconfig`, ligne « Adresse IPv4 ») : http://<adresse>:3000 ».
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Deux zones saisissent le même combat**, ou une zone et la table centrale : le second enregistrement est refusé (409), et le premier reste. Test Task 1 et e2e Task 6.
- **Une mise à jour automatique arrive pendant une saisie** (formulaire de réglages, grille, sessions) : rien n'est effacé à l'écran ; les données sont relues une fois la saisie enregistrée ou abandonnée. Test Task 3, avec la fonction d'attente.
- **Poste « Zone »** : il ne voit que sa zone, même après un rechargement ou une adresse tapée à la main. e2e Task 6.
- **Copie de secours** quand le PC principal est éteint : erreur notée et réessai au tour suivant. Une copie à moitié téléchargée n'est jamais gardée (nom provisoire, puis renommage). Test Task 4.
- **Connexion d'événements coupée**, quand le serveur redémarre : le navigateur se reconnecte tout seul, puis relit ses données. Test Task 3.

---

### Task 1 : Révisions et refus des écritures périmées (serveur)

**Files:** Create `src/server/revisions.ts` ; Modify les repositories et les routes des données listées (results, registrations, categories, waves, zones) ; Test `tests/server/revisions.test.ts`.

**Interfaces:**
```ts
export class StaleWriteError extends Error { statusCode: 409 }   // message des Global Constraints
/** Compare la révision envoyée (en-tête If-Match ; absent = pas de contrôle). `current` null = la donnée n'existe pas. */
export function checkRev(ifMatch: string | string[] | undefined, current: string | null): void;
export const rowRev: (version: number | null | undefined) => string;              // String(version ?? 0)
export function listRev(rows: { id: string; version: number | null }[]): string; // id:version triés
```
- [ ] **Step 1 : tests** (`revisions.test.ts`, via `inject`) :
  - `résultat : PUT avec If-Match none puis un second PUT avec none → 409 ; avec la rev lue → 200 ; DELETE avec une rev périmée → 409 ; sans If-Match → accepté` ;
  - `notes de kata et départage : idem` ;
  - `inscription : PUT et DELETE avec une rev périmée (combattant modifié par une autre inscription) → 409` ;
  - `catégorie : move et regenerate avec une rev périmée → 409` ;
  - `sessions et zones : PUT avec un ETag périmé → 409 ; GET renvoie l'ETag` ;
  - `les réponses portent rev (résultats, kata, départages, inscriptions, catégories)`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer. **Step 3 : écrire le code.** **Step 4 : lancer les tests**, qui doivent passer : `npx vitest run tests/server && npm run typecheck`. **Step 5 : commit** : `feat(plusieurs postes): révisions — une écriture sur une donnée périmée est refusée`.

### Task 2 : Événements « la compétition a changé » (serveur)

**Files:** Create `src/server/events.ts` ; Modify `src/server/app.ts` (crochet `onResponse` et route), `src/server/routes/club-entry.ts`, `src/server/sync/package.ts` (`importPackage` prévient) ; Test `tests/server/events.test.ts`.

**Interfaces:**
```ts
export function competitionChanged(competitionId: string): void;
export function onCompetitionChange(competitionId: string, listener: () => void): () => void;   // désabonnement
// GET /api/competitions/:id/events (réponse « hijack », en-têtes text/event-stream, no-cache, X-Accel-Buffering: no)
```
- [ ] **Step 1 : tests** (le serveur écoute sur un port libre ; un client `fetch` lit le flux) :
  - `une écriture réussie sur la compétition → event: change reçu` ;
  - `une écriture refusée (400) → rien` ;
  - `une autre compétition → rien` ;
  - `écriture depuis la page du club → change` ;
  - `réception d'un paquet → change` ;
  - `rôle serveur sans session → 401`.
- [ ] **Step 2 à 5**, comme la Task 1. Commit : `feat(plusieurs postes): événements de changement d'une compétition`.

### Task 3 : Navigateur — révisions envoyées, écrans mis à jour tout seuls

**Files:** Modify :
- `src/web/api.ts` : `api(method, url, body, { rev })` envoie l'en-tête `If-Match` ; les hooks des données listées en Global Constraints prennent la `rev` ;
- les écrans qui écrivent ces données (`ResultDialog`, `KataScoring`, `TieBreakDialog`, `RegistrationForm` et `RegistrationsPage`, `MoveDialog` et `BracketView`, `WavesPage`, `CompetitionSettingsPage` pour les zones) ;
- `src/web/main.tsx` : un 409 avec le message « périmé » → `invalidateQueries()` et une notification ;
- `src/web/unsaved.ts` : `whenSaved(callback)` attend qu'il n'y ait plus de saisie en cours ;
- `src/web/components/CompetitionLayout.tsx` : `useCompetitionEvents(id)` avec `EventSource`, relecture regroupée sur 300 ms et reportée par `whenSaved`, reconnexion avec relecture.

Créer `src/web/liveUpdates.ts` (le hook). Test `tests/web/unsaved.test.ts`, une fonction pure : `whenSaved` appelle tout de suite s'il n'y a pas de saisie en cours, sinon quand la dernière est enregistrée.

- [ ] **Step 1 : test unitaire de `whenSaved`.** Il doit échouer. **Step 2 : écrire le code.** **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/web`. **Step 4 : commit** : `feat(plusieurs postes): les écrans se mettent à jour tout seuls ; les écritures envoient leur révision`.

### Task 4 : Copie de secours d'un autre PC (rôle local)

**Files:** Create `src/server/mirror.ts`, `src/server/routes/mirror.ts` ; Modify `src/domain/app-settings.ts` (`mirror`), `src/server/app.ts` (tâche de fond arrêtée par `onClose`), `src/web/pages/PodiumsPage.tsx` ou la section Sauvegardes (copies, avec Restaurer), `src/web/pages/AppSettingsPage.tsx` (réglage) ; Test `tests/server/mirror.test.ts`.

**Interfaces:**
```ts
export function mirrorOnce(db: AppDb, dbPath: string, now?: Date): Promise<{ file: string } | { error: string }>;
export function startMirror(db: AppDb, dbPath: string): () => void;   // relit le réglage à chaque tour
// GET|PUT /api/mirror ; GET /api/mirror/copies ; POST /api/mirror/copies/:name/restore
```
- [ ] **Step 1 : tests** (PC principal = une application qui écoute sur un port libre) :
  - `mirrorOnce : copie écrite sous sauvegardes/copies, lisible (c'est une base de l'application)` ;
  - `PC principal éteint → { error }, aucun fichier, lastError noté` ;
  - `100 copies au plus` ;
  - `restaurer une copie : les compétitions du PC principal arrivent, gérées ici` ;
  - `nom de copie inconnu ou avec ../ → 404` ;
  - `réglage refusé en rôle serveur`.
- [ ] **Step 2 à 5**, comme la Task 1. Commit : `feat(plusieurs postes): copie de secours régulière d'un autre PC, restaurable`.

### Task 5 : Postes, et fiche « Préparer le jour J »

**Files:** Create `src/web/poste.ts` (`usePoste(competitionId)`, onglets du poste), `src/web/components/PosteSelect.tsx`, `src/web/components/DayChecklist.tsx` ; Modify `src/web/components/CompetitionLayout.tsx` (liste « Poste », onglets filtrés, redirection), `src/web/pages/MatchesPage.tsx` (zone verrouillée pour un poste Zone), `src/web/pages/AppSettingsPage.tsx` (fiche « Préparer le jour J »), `src/web/help.ts` (sujets `postes` et `jour-j`) ; Test `tests/web/poste.test.ts`, des fonctions pures : onglets de chaque poste, onglet par défaut, redirection.

- [ ] **Step 1 : tests.** Ils doivent échouer. **Step 2 : écrire le code.** **Step 3 : vérifier** : `npm run typecheck && npx vitest run tests/web`. **Step 4 : commit** : `feat(plusieurs postes): postes (Organisation, Table centrale, Zone) et fiche « Préparer le jour J »`.

### Task 6 : Parcours e2e à deux postes

**Files:** Create `tests/e2e/plusieurs-postes.spec.ts`.
- [ ] **Step 1 : e2e** :
  - `deux postes : un résultat saisi sur l'un apparaît sur l'autre sans recharger ; le même combat saisi sur l'autre avec l'écran d'avant → « Modifié entre-temps… »` ;
  - `poste Zone : seulement Combats et Tableaux, sa zone seulement, même après un rechargement et une adresse tapée`.
- [ ] **Step 2 : lancer toute la suite**, qui doit passer. **Step 3 : commit** : `test(e2e): plusieurs postes`.

### Task 7 : Documents

Feuille de route (étape 19), bilan, conception (§7 : choix faits), README (réseau local). Commit : `docs: étape 19 — plusieurs postes`.
