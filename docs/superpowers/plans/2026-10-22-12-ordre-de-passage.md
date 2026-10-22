# Étape 12 : Répartition sur les zones et ordre de passage — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chaque catégorie d'une vague reçoit une zone (épinglée à la main, sinon répartie automatiquement en équilibrant les combats, dans le respect des zones autorisées par discipline) ; chaque zone a sa file numérotée (kata d'abord, puis les combats « tour par tour » ou « catégorie par catégorie »), avec le signal « pas de repos » ; les numéros sont imprimés sur les tableaux et l'onglet Combats montre, par zone, la file de la vague dans l'ordre des numéros.

**Architecture:** domaine pur `src/domain/passages/` (graphe des combats d'un tableau, répartition, ordre et numéros), sans rien stocker : comme la vague, la zone automatique et les numéros sont **calculés** à chaque lecture, tant que la vague n'est pas figée (étape 13). `categories.zone_id` garde son sens actuel de choix à la main (= épinglage) ; les disciplines acceptées sont portées par la zone. Le serveur expose le plan (`GET /passages`) et la file par zone (`GET /schedule`) ; l'écran lit les numéros dans le plan.

**Tech Stack:** TypeScript, Drizzle (SQLite, migration écrite à la main), Fastify, React 19 + Mantine 8, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` §1.6, §1.7, §1.9 (affichage et file), §1.11. Hors de cette étape : « Figer et imprimer la vague », lancement, « reprendre les numéros à 1 », blocage du lancement par une contrainte impossible, finales sur une zone, réouverture (étape 13) ; déplacements en cours de compétition (étape 14).

## Global Constraints
- **Zone d'une catégorie** = son épinglage (`categories.zone_id`, choisi à la main, prioritaire sur la règle de discipline) s'il existe, sinon la zone **automatique**. Les affectations existantes deviennent des épinglages (aucune migration de données).
- **Zones autorisées par discipline** : `zones.disciplines_json` (`null` = toutes les disciplines ; sinon la liste des disciplines accueillies). Défaut : toutes. Une discipline acceptée par aucune zone : ses catégories non épinglées restent sans zone, sans numéro, et l'écran le signale (« Aucune zone n'accepte : Shido-boxing (2 catégories) »).
- **Répartition automatique**, vague par vague (sans vague : une vague implicite avec toutes les catégories) : les épinglées comptent d'abord dans la charge de leur zone ; puis les autres, de la plus lourde à la plus légère (à poids égal : rang), vont sur la zone autorisée la moins chargée (à charge égale : la première dans l'ordre des zones). Poids : nombre de combats numérotés ; kata : nombre de katakas. Une catégorie sans vague alors qu'il y en a : pas de zone automatique, pas de numéro.
- **Une catégorie lancée garde sa zone** : à son premier résultat (statut « lancée »), sa zone automatique est enregistrée comme épinglage.
- **Rang des catégories** (ordre de la file en « catégorie par catégorie », ordre des blocs de kata et d'alternance en « tour par tour ») : « Ordre » saisi (`categories.sort_order`, croissant), puis ordre de la grille.
- **Numéros** : propres à chaque zone, à partir de 1, **continus d'une vague à l'autre** dans l'ordre des vagues. Dans chaque vague, sur chaque zone : les blocs de kata d'abord (un numéro par catégorie de kata, tour 1 et finale compris), puis les combats.
- **Combats numérotés** : ceux d'une catégorie à 2 inscrits actifs ou plus, hors **exemptions structurelles** (exemption connue sans aucun résultat : `resolveBracket(bracket, {})`) ; la 3e manche d'un meilleur des trois est numérotée. Un résultat saisi ne change jamais les numéros.
- **Distance à la fin** d'un combat : 0 s'il ne fournit aucun combattant à un autre combat numéroté ; sinon 1 + la plus grande distance des combats qu'il fournit. « Fournit » : vainqueur ou perdant (`winner` / `loser`) ; tous les combats de la poule pour `poolRank` ; les combats du tour `round` de la moitié `half` pour `beatenBy` ; entre deux combats d'une même poule ou d'un même meilleur des trois, la journée (manche) précédente qui partage un combattant.
- **Tour par tour** (défaut) : les combats de la zone, groupés par distance décroissante (les finales, distance 0, à la fin de la vague) ; dans un groupe, alternance des catégories (1er combat de chaque catégorie dans l'ordre des rangs, puis le 2e…), chaque catégorie dans l'ordre poule, série, perdants, repêchage, 3e place, tableau, grande finale, puis `order` du tableau. **Catégorie par catégorie** : chaque catégorie en entier, dans l'ordre des rangs, ses combats par distance décroissante puis dans le même ordre.
- **Repos** : parmi les combats du groupe en cours, on prend le premier qui ne partage de combattant avec aucun des **deux** derniers combats placés, sinon avec le dernier, sinon le premier ; dans ce dernier cas, le combat porte `noRest` (« pas de repos : prévoir une pause »). Deux combats partagent un combattant si l'un fournit l'autre (définition ci-dessus) ; deux catégories différentes ne partagent jamais.
- Réglage `passageOrder: 'rounds' | 'categories'` (défaut `'rounds'`) dans les réglages de la compétition ; libellés « Tour par tour » / « Catégorie par catégorie ».
- Vocabulaire et copie : « combat 31 », « n° 14 — Kata Benjamins F, 8 katakas », « pas de repos : prévoir une pause », « automatique ». Aides mises à jour (`src/web/help.ts`).
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Formats et exemptions** (5 inscrits, double élimination, repêchage, poules puis tableau, meilleur des trois) : distances cohérentes avec les dépendances, exemptions sans numéro — tests Task 1.
- **Résultats saisis** : un repêchage devenu exemption après les résultats garde son numéro ; aucun numéro ne bouge — test Task 4.
- **Catégorie seule sur sa zone** (4 combattants) : la finale suit la 2e demie → `noRest` ; deux catégories de 4 sur la même zone en tour par tour → aucun `noRest` — tests Task 3.
- **Discipline acceptée nulle part** (zone du ring supprimée ou décochée) : signalée, sans zone ni numéro, rien ne casse — tests Task 2 et Task 4.
- **Catégorie lancée** : garde sa zone quand une autre catégorie de la vague change de taille — test Task 4.

---

### Task 1 : Graphe des combats d'un tableau

**Files:**
- Create: `src/domain/passages/graph.ts`, `src/domain/passages/index.ts`
- Test: `tests/domain/passages/graph.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Combat numéroté d'un tableau. `feeds` : combats numérotés du même tableau joués avant lui et qui peuvent lui fournir un combattant. */
  export interface MatchNode { matchId: string; phase: MatchPhase; order: number; distance: number; feeds: string[] }
  export function matchNodes(bracket: CombatBracket): MatchNode[];   // exemptions structurelles exclues ; [] si moins de 2 inscrits
  ```

- [ ] **Step 1 : tests** (`graph.test.ts`, tableaux construits avec `generateBracket` et des inscrits `e1…en`)
  - `élimination directe à 8 : w1 → 2, w2 → 1, w3-0 → 0 ; w2-0.feeds = [w1-0, w1-1]`.
  - `5 inscrits : 4 combats numérotés (exemptions exclues), un seul au 1er tour`.
  - `3e place : third → 0, fournie par les deux demies (demies → 1)`.
  - `repêchage à 16 : rep<h>-1 → 1, rep<h>-2 → 0 ; rep0-1.feeds contient les combats des tours 1 et 2 de la moitié haute seulement`.
  - `double élimination à 4 : gf → 0 ; w1-0 a la plus grande distance`.
  - `poules puis tableau à 6 : chaque combat de poule a une distance > celle du 1er tour du tableau ; dans une poule, journée 1 > journée 2 > journée 3`.
  - `poule à 3 (round_robin) : journées à distance 2, 1, 0`.
  - `meilleur des trois : s1 → 2, s2 → 1, s3 → 0 (numérotée)` ; `combat unique : 0` ; `trois avec repêchage : m1 → 2, m2 → 1, m3 → 0`.
- [ ] **Step 2 :** `npx vitest run tests/domain/passages` → FAIL.
- [ ] **Step 3 :** implémenter `matchNodes` (exemptions : `resolveBracket(bracket, {}).matches` avec `bye` ; un combat exempt ne fournit rien et n'est pas suivi).
- [ ] **Step 4 :** `npx vitest run tests/domain/passages` → PASS.
- [ ] **Step 5 : Commit** — `feat(domain): graphe des combats (distance à la fin, combats qui se suivent)`

---

### Task 2 : Répartition sur les zones

**Files:**
- Create: `src/domain/passages/distribute.ts` (exporté par `index.ts`)
- Test: `tests/domain/passages/distribute.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ZoneSpec { id: string; order: number; disciplines: DisciplineId[] | null }
  export interface DistributionCategory { id: string; discipline: DisciplineId; pinnedZoneId: string | null; weight: number; rank: number }
  export function zonesFor(discipline: DisciplineId, zones: ZoneSpec[]): ZoneSpec[];
  /** zoneOf : zone de chaque catégorie (null : aucune zone n'accepte sa discipline) ; impossible : ces catégories-là. */
  export function distributeZones(cats: DistributionCategory[], zones: ZoneSpec[]): { zoneOf: Map<string, string | null>; impossible: string[] };
  ```

- [ ] **Step 1 : tests**
  - `équilibre : poids 7, 3, 3, 1 sur deux zones → 7 | 3+3+1, plus lourde d'abord`.
  - `égalité : la première zone dans l'ordre`.
  - `discipline limitée au Ring : shido-boxing toujours sur le Ring, les autres où ils veulent`.
  - `épinglée : reste sur sa zone même si la discipline n'y est pas acceptée, et compte dans la charge`.
  - `discipline acceptée nulle part : zone null, dans impossible` ; `épinglage vers une zone disparue : traité comme automatique`.
- [ ] **Step 2 :** `npx vitest run tests/domain/passages/distribute.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter (règles des Global Constraints).
- [ ] **Step 4 :** `npx vitest run tests/domain/passages` → PASS.
- [ ] **Step 5 : Commit** — `feat(domain): répartition des catégories sur les zones`

---

### Task 3 : Ordre de passage et numéros

**Files:**
- Create: `src/domain/passages/order.ts`, `src/domain/passages/plan.ts` (exportés par `index.ts`)
- Modify: `src/domain/settings.ts` (`passageOrder: z.enum(['rounds', 'categories'])`, défaut `'rounds'` ; `export type PassageOrderMode`)
- Test: `tests/domain/passages/order.test.ts`

**Interfaces:**
- Consumes: `matchNodes` (Task 1), `distributeZones`, `ZoneSpec` (Task 2).
- Produces:
  ```ts
  export interface OrderCategory { id: string; rank: number; kataEntrants: number | null; nodes: MatchNode[] }   // kataEntrants non null : bloc de kata
  export interface Passage { number: number; categoryId: string; matchId: string | null; noRest: boolean }       // matchId null : bloc de kata
  export function zoneOrder(cats: OrderCategory[], mode: PassageOrderMode, first: number): Passage[];
  export interface PlanCategory { id: string; waveId: string | null; discipline: DisciplineId; pinnedZoneId: string | null; rank: number; bracket: Bracket | null; playable: boolean }
  export interface PassagePlan {
    categories: Record<string, { zoneId: string | null; auto: boolean }>;
    zones: { zoneId: string; passages: (Passage & { waveId: string | null })[] }[];   // ordre des zones ; passages par numéro
    impossible: { categoryId: string; discipline: DisciplineId }[];
  }
  export function planPassages(input: { categories: PlanCategory[]; zones: ZoneSpec[]; waves: { id: string; order: number }[]; mode: PassageOrderMode }): PassagePlan;
  ```
  (`playable` = 2 inscrits actifs ou plus ; une catégorie non jouable a une zone mais aucun passage et un poids 0.)

- [ ] **Step 1 : tests** (`order.test.ts`)
  - `kata d'abord : bloc de kata n° 1, puis les combats à partir de 2 ; zone sans kata : combats dès 1`.
  - `tour par tour : deux catégories de 8 → les 8 quarts alternés, puis les 4 demies, puis les 2 finales ; une catégorie de 2 (combat unique) passe avec les finales`.
  - `tour par tour, deux catégories de 4 : aucun noRest`.
  - `catégorie seule de 4 : w1-0, w1-1, w2-0 ; w2-0 noRest`.
  - `catégorie par catégorie : la catégorie de rang 1 en entier (jusqu'à sa finale), puis la suivante`.
  - `planPassages : numéros continus d'une vague à l'autre sur une zone ; vague suivie de ses katas en tête ; catégorie sans vague (alors qu'il y en a) : zone null, aucun passage ; sans vague : une seule vague implicite`.
  - `planPassages : épinglée → auto false ; répartie → auto true ; impossible signalé avec sa discipline`.
  - `réglages : passageOrder par défaut « rounds », valeur stockée invalide → défaut` (`readStoredSettings`).
- [ ] **Step 2 :** `npx vitest run tests/domain/passages` → FAIL.
- [ ] **Step 3 :** implémenter (algorithme des Global Constraints : groupes par distance, alternance, choix du repos parmi le groupe en cours).
- [ ] **Step 4 :** `npx vitest run tests/domain && npm run typecheck` → PASS.
- [ ] **Step 5 : Commit** — `feat(domain): ordre de passage par zone (kata d'abord, tour par tour ou catégorie par catégorie, repos)`

---

### Task 4 : Plan et file par zone côté serveur

**Files:**
- Create: `drizzle/0012_zone_disciplines.sql` (`ALTER TABLE \`zones\` ADD \`disciplines_json\` text;`, entrée de journal comme 0011), `src/server/repositories/passages.ts`
- Modify: `src/server/db/schema.ts` (`zones.disciplinesJson`), `src/domain/zones.ts` (`Zone.disciplines`, `ZoneInput.disciplines?: DisciplineId[] | null` ; liste vide refusée : « La zone « Ring » n'accueille aucune discipline : cochez-en au moins une. »), `src/server/repositories/zones.ts`, `src/server/routes/zones.ts` (schéma), `src/server/repositories/results.ts` (`schedule(db, id, waveId?)` ; `refreshStatus` : à « lancée », zone automatique enregistrée ; export des résultats : colonne « Combat » = numéro de passage quand il existe), `src/server/routes/results.ts` (`GET /schedule?vague=` ; nouvelle route `GET /api/competitions/:id/passages`)
- Test: `tests/server/passages.test.ts`, `tests/server/zones.test.ts` (disciplines)

**Interfaces:**
- Consumes: `planPassages` (Task 3).
- Produces:
  ```ts
  export async function passagePlan(db: AppDb, competitionId: string): Promise<PassagePlan>;   // repositories/passages.ts
  // GET /api/competitions/:id/passages → PassagePlan
  // GET /api/competitions/:id/schedule[?vague=] → { zones: { zone: Zone; categories: ScheduleCategory[]; queue: QueueItem[] }[]; unassigned: ScheduleCategory[]; impossible: PassagePlan['impossible'] }
  interface QueueItem { number: number; categoryId: string; categoryLabel: string; matchId: string | null; a: string | null; b: string | null; katakas: number | null; noRest: boolean }
  ```
  `categories` d'une zone : celles dont la zone (épinglée ou automatique) est cette zone, triées par `order` comme aujourd'hui ; `queue` : passages de la vague (toutes sans `?vague=`), dans l'ordre des numéros, limités aux combats jouables sans résultat et aux blocs de kata non terminés, 6 au plus.

- [ ] **Step 1 : tests** (`passages.test.ts`)
  - `kata d'abord et numéros : kata de 3 et cadettes de 4 sur une zone → kata n° 1, combats 2 à 4`.
  - `zone limitée : Ring { disciplines: ['shido-boxing'] }, Tatami 1 le reste → la catégorie de boxe sur le Ring, auto true` ; `Ring décoché aussi → impossible, zone null, GET /schedule le renvoie dans impossible`.
  - `épinglage : PATCH zoneId → auto false ; zoneId null → retour à l'automatique`.
  - `résultats : saisir les demies d'une catégorie à repêchage ne change aucun numéro (plan identique avant/après)`.
  - `catégorie lancée : après un résultat, sa zone est enregistrée ; une inscription qui grossit une autre catégorie ne la déplace pas`.
  - `file : ?vague= limite aux passages de la vague ; combats joués retirés ; noRest renvoyé`.
  - `zones` (`zones.test.ts`) : `disciplines enregistrées et relues ; liste vide → 400 ; base antérieure (colonne absente) → toutes les disciplines`.
- [ ] **Step 2 :** `npx vitest run tests/server/passages.test.ts tests/server/zones.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter (`passagePlan` : `listCategories`, `listZones`, `listWaves`, réglages ; rang = `order` puis ordre de la grille de `listCategories`).
- [ ] **Step 4 :** `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5 : Commit** — `feat(server): zones par discipline, plan de passage, file par zone`

---

### Task 5 : Écrans (réglages, combats, tableaux, impression)

**Files:**
- Modify: `src/web/api.ts` (`usePassages(id)` avec la clé `['categories', id, 'passages']` ; `useSchedule(id, waveId)` ; types `Zone`/`ZoneInput` avec `disciplines` ; l'enregistrement des réglages invalide aussi `['categories', id]`), `src/web/useSelectedWave.ts` (option `prefer: 'weighIn' | 'running'` ; `'running'` = dernière vague dont la pesée est clôturée, sinon la première), `src/web/pages/CompetitionSettingsPage.tsx` (par zone : disciplines accueillies en cases à cocher, toutes cochées = `null` ; « Ordre de passage des combats » : Tour par tour / Catégorie par catégorie ; alerte des disciplines acceptées nulle part), `src/web/pages/MatchesPage.tsx` (zone : « Automatique (Tatami 2) » ou une zone épinglée ; choix de la vague (`prefer: 'running'`) ; par zone, la file : « n° 14 — Kata Benjamins F, 8 katakas » (`next-kata`) et « combat 31 » (`next-match`) avec le badge « pas de repos : prévoir une pause » ; alerte « Aucune zone n'accepte… »), `src/web/components/BracketView.tsx` (props `numbers?: Map<string, number>`, `noRest?: Set<string>` ; sans numéro de passage : numérotation actuelle), `src/web/pages/BracketsPage.tsx` (zone épinglée ou « (auto) » ; numéros), `src/web/pages/PrintPage.tsx` (zone effective ; kata : « Zone : Tatami 1 · passage n° 14 » ; numéros sur les combats), `src/web/components/ResultDialog.tsx` (numéro de passage), `src/web/help.ts` (`combats`, `combats.categories`, `combats.zone`, `reglages.zones`, nouveau `reglages.ordre`), `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (12 ✅)
- Test: `tests/e2e/ordre-de-passage.spec.ts` ; mise à jour de `tests/e2e/jour-j.spec.ts` si ses numéros changent

**Interfaces:**
- Consumes: `GET /passages`, `GET /schedule?vague=` (Task 4).

- [ ] **Step 1 : test e2e** — Tatami 1 et Ring ; kata de 3, cadettes de 4, deux shido-boxers seniors. Réglages : Ring n'accueille que le shido-boxing, Tatami 1 tout sauf le shido-boxing → Combats : Tatami 1 commence par « n° 1 — Kata », puis « combat 2 » ; le Ring a le combat de boxe ; impression des cadettes : « Zone : Tatami 1 » et « Combat 2 » ; « Catégorie par catégorie » dans les Réglages → l'ordre change sans erreur ; décocher la boxe sur le Ring → « Aucune zone n'accepte : Shido-boxing ». Épingler les cadettes sur le Ring dans Combats → leur zone n'est plus « Automatique ».
- [ ] **Step 2 :** `npx playwright test tests/e2e/ordre-de-passage.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5 :** bilan et feuille de route ; commit — `feat(web): ordre de passage par zone (réglages, file, numéros imprimés) ; bilan de l'étape 12`
