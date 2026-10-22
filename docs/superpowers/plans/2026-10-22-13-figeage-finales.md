# Étape 13 : Figer et imprimer une vague, rouvrir, finales sur une zone — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Figer et imprimer la vague » enregistre les zones et les numéros de passage de la vague, qui ne changent plus ; une vague lancée est fermée au recasement et ses tableaux ne se régénèrent plus sans confirmation ; « Rouvrir la vague » rend modifiables les catégories sans résultat, et refiger ne renumérote que les catégories modifiées, à la suite ; les finales (et, en option, les finales de kata) peuvent passer sur une zone choisie, à la fin de la vague.

**Architecture:** deux tables : `wave_launches` (état de lancement d'une vague, clé `''` pour la vague implicite d'une compétition sans vague) et `frozen_passages` (numéros figés). Le plan de passage (`planPassages`) reprend les numéros figés des vagues déjà lancées, signale les catégories « à numéroter » (nouvelles ou régénérées), et numérote en direct les vagues suivantes à la suite. Le lancement fixe aussi l'appartenance (choix individuel de vague) et la zone (épinglage) de chaque catégorie de la vague.

**Tech Stack:** TypeScript, Drizzle (SQLite), Fastify, React 19 + Mantine 8, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` §1.3 (états d'une vague, rouvrir), §1.5 (vague lancée fermée au recasement), §1.6 (contrainte impossible bloquante), §1.7 (« reprendre les numéros à 1 »), §1.8 (finales sur une zone), §1.9 (figeage). Hors de cette étape (étape 14) : déplacer une catégorie lancée vers une autre zone, mode « mélangés » (pour les déplacements comme pour refiger).

## Global Constraints
- **Clé de vague** : `waveKey(waveId) = waveId ?? ''` (vague implicite sans vague définie).
- **Lancer (« Figer et imprimer la vague »)** est refusé (400, messages en français, tous listés) si : une vague précédente n'a jamais été lancée (« Lancez d’abord la vague « Matin ». ») ; une catégorie à disputer de la vague n'a pas de zone (« Aucune zone n’accepte : Shido-boxing (1 catégorie). ») ; une catégorie à disputer n'est pas au moins prête (« 2 catégories ne sont pas prêtes : … ») ; la vague est déjà lancée. Option « Reprendre les numéros à 1 » : la numérotation de chaque zone repart de 1 pour cette vague.
- Au lancement : les numéros de la vague sont enregistrés (`frozen_passages`), chaque catégorie de la vague reçoit son choix individuel de vague (= la vague) et son épinglage de zone (= sa zone actuelle) ; la vague passe « lancée ».
- **Vague lancée** : ses catégories ne se régénèrent plus d'elles-mêmes (comme une catégorie lancée : tableau gardé, « Les inscrits ont changé » signalé) ; « Régénérer (renuméroté à la suite) », avec confirmation, régénère le tableau d'une catégorie non commencée et lui donne de nouveaux numéros à la suite. Fermée au recasement (ses catégories sont verrouillées pour le moteur). Choix de vague et zone de ses catégories non modifiables (« La vague est lancée : rouvrez-la pour … »). Une vague lancée au moins une fois ne peut plus être supprimée ; une compétition lancée sans vague ne peut plus recevoir de vagues ; une zone portant des numéros figés ne peut plus être supprimée.
- **Rouvrir** (confirmation « des tableaux déjà affichés pourront changer ») : la vague n'est plus « lancée » ; ses numéros figés restent ; les catégories sans résultat redeviennent modifiables (régénération, recasement) ; les catégories commencées restent verrouillées.
- **À numéroter** : catégorie d'une vague déjà lancée dont les combats (ou le bloc de kata) ne correspondent plus à ses numéros figés, ou qui n'en a pas (nouvelle) ; elle n'a pas de numéro, l'écran la signale. **Refiger / numéroter à la suite** : ces catégories reçoivent des numéros **après le dernier numéro figé de leur zone** (toutes vagues), dans l'ordre de passage habituel ; leurs anciens numéros deviennent des trous ; la vague (re)passe « lancée » ; chaque catégorie renumérotée garde l'heure (`numbers_updated_at`), imprimée « mis à jour à HH:MM ».
- **Numérotation** : une vague lancée garde ses numéros figés ; une vague non lancée est numérotée en direct après le plus grand numéro (figé ou non) de chaque zone, sauf « reprendre à 1 » choisi à son lancement.
- **Finales sur une zone** (réglages `finalsZoneId: string | null`, défaut `null` ; `kataFinalsOnFinalsZone: boolean`, défaut `false`) : le combat pour la 1re place de chaque catégorie de combat (`w<R>-0` en élimination et poules puis tableau, `gf` en double élimination, `m3` à trois avec repêchage, `w1-0` en combat unique, `s1`-`s3` au meilleur des trois ; aucun en poule unique) quitte sa zone et passe sur la zone des finales, **à la fin de la vague**, numéroté à la suite de cette zone, dans l'ordre des rangs. Option kata : la finale de kata forme un bloc `kata:finale` sur la zone des finales (le reste : bloc `kata:tour1` sur sa zone ; kata à 2 : seulement `kata:finale`). Sans l'option : bloc `kata` entier comme aujourd'hui. Zone des finales inconnue : ignorée.
- Copie : « Figer et imprimer la vague », « Rouvrir la vague », « Numéroter à la suite », « Régénérer (renuméroté à la suite) », « Reprendre les numéros à 1 », états « En préparation », « Lancée », « Rouverte », « Terminée » ; impression : « Zone des finales : Ring » sur une finale déplacée, « mis à jour à HH:MM ». Aides mises à jour.
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Absent tardif dans une vague lancée** (catégorie prête) : rien ne bouge sans confirmation ; après « Régénérer », seuls ses numéros changent, à la suite, les autres restent — test Task 3.
- **Rouvrir puis refiger sans rien changer** : aucun numéro ne change — test Task 2.
- **Vague suivante** après une vague figée : numérotée après les numéros figés (trous compris) ; « reprendre à 1 » repart de 1 — tests Task 1.
- **Finales sur une zone** : la finale d'une catégorie de 8 vient après tous les combats de la zone des finales pour la vague, et après la finale d'une catégorie de rang inférieur ; aucune finale déplacée quand le réglage est vide — tests Task 1.
- **Vague lancée et recasement** : aucun cas ni proposition vers ou depuis ses catégories ; rouverte : le recasement revient — test Task 3.

---

### Task 1 : Plan de passage figé, à la suite, finales sur une zone

**Files:**
- Modify: `src/domain/passages/order.ts` (`OrderCategory.kataBlock?: string | null` : `matchId` du bloc de kata émis, `null` = bloc entier), `src/domain/passages/plan.ts`, `src/domain/settings.ts` (`finalsZoneId`, `kataFinalsOnFinalsZone`)
- Create: `src/domain/passages/finals.ts` (`finalMatchIds(bracket: CombatBracket): string[]`)
- Test: `tests/domain/passages/frozen.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const waveKey = (waveId: string | null) => waveId ?? '';
  export interface FrozenPassage { waveKey: string; zoneId: string; number: number; categoryId: string; matchId: string | null; noRest: boolean }  // matchId null : bloc de kata entier ; 'kata:tour1' / 'kata:finale' : blocs séparés
  // planPassages : nouvelles entrées facultatives
  //   frozen?: FrozenPassage[]                 numéros des vagues lancées au moins une fois
  //   restart?: string[]                       clés des vagues (non figées) numérotées à partir de 1 (aperçu du lancement)
  //   finals?: { zoneId: string | null; kata: boolean }
  // PassagePlan : `pending: { waveId: string | null; categoryId: string }[]` (catégories à numéroter) ; `frozenWaves: string[]` (clés)
  /** Numéros à la suite pour les catégories `categoryIds` (à numéroter) d'une vague figée : après le dernier numéro figé de chaque zone. */
  export function appendPassages(input: PlanInput, wave: string | null, categoryIds: string[]): FrozenPassage[];
  ```
  (`PlanInput` = type de l'argument de `planPassages`.)

- [ ] **Step 1 : tests** (`frozen.test.ts`)
  - `vague figée : ses numéros repris tels quels (même si l'ordre calculé diffère), trous compris`.
  - `vague suivante numérotée après le plus grand numéro figé de chaque zone ; restart → à partir de 1`.
  - `à numéroter : catégorie nouvelle ou dont les combats ne correspondent plus → pending, sans passage ; les autres gardent leurs numéros`.
  - `appendPassages : numéros après le dernier numéro figé de la zone (toutes vagues), ordre de passage habituel`.
  - `finales sur le Ring : w3-0 d'une catégorie de 8 (Tatami 1) passe sur le Ring après tous les combats du Ring de la vague ; deux finales dans l'ordre des rangs ; meilleur des trois : s1-s3 ; poule unique : rien ne bouge ; finalsZoneId null ou inconnue : rien ne bouge`.
  - `kata : option off → bloc kata ; option on → kata:tour1 sur sa zone, kata:finale sur le Ring à la fin de la vague ; kata à 2 → seulement kata:finale`.
  - `réglages : finalsZoneId null et kataFinalsOnFinalsZone false par défaut`.
- [ ] **Step 2 :** `npx vitest run tests/domain/passages` → FAIL.
- [ ] **Step 3 :** implémenter (factoriser la numérotation d'une vague dans `plan.ts`, réutilisée par `planPassages` et `appendPassages`).
- [ ] **Step 4 :** `npx vitest run tests/domain && npm run typecheck` → PASS.
- [ ] **Step 5 : Commit** — `feat(domain): numéros figés, numérotation à la suite, finales sur une zone`

---

### Task 2 : Lancer, rouvrir, numéroter à la suite (serveur)

**Files:**
- Create: migration `drizzle/0013_*.sql` (via `npx drizzle-kit generate --name wave_launches`) : tables `wave_launches` (`competition_id` → competitions, cascade ; `wave_key` ; `launched` bool ; `restart_numbering` bool ; `launched_at` texte ; clé (competition_id, wave_key)), `frozen_passages` (`competition_id` cascade ; `wave_key`, `zone_id`, `number`, `category_id`, `match_id` texte non nul (`'kata'` pour le bloc entier), `no_rest` ; clé (competition_id, wave_key, category_id, match_id)) ; colonne `categories.numbers_updated_at` (texte, null)
- Create: `src/server/repositories/launches.ts`, `src/server/routes/launches.ts` (enregistrée dans `app.ts`)
- Modify: `src/server/db/schema.ts`, `src/server/repositories/passages.ts` (`passagePlan` lit `frozen_passages`, `restart`, réglages des finales)
- Test: `tests/server/launches.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // repositories/launches.ts
  export type WaveState = 'preparation' | 'launched' | 'reopened' | 'finished';
  export async function launchStatus(db: AppDb, competitionId: string, waveId: string | null): Promise<{ state: WaveState; blocking: string[]; pending: { categoryId: string; label: string }[]; zones: { zoneId: string; first: number | null; last: number | null }[] }>;
  export async function launchWave(db, competitionId, waveId: string | null, opts: { restart: boolean }): Promise<void>;   // 400 si blocking ; zones et numéros de l'aperçu (= status avec la même option)
  export async function reopenWave(db, competitionId, waveId: string | null): Promise<void>;
  export async function numberPending(db, competitionId, waveId: string | null, categoryIds?: string[]): Promise<{ changes: { categoryId: string; label: string; numbers: number[] }[] }>;   // aussi : vague → lancée
  export async function launchedCategoryIds(db, competitionId): Promise<Set<string>>;   // catégories des vagues actuellement lancées
  // routes : GET /api/competitions/:id/launch?vague=[&restart=1] → launchStatus ; POST /launch { waveId: string | null, restart?: boolean } ;
  //          POST /launch/reopen { waveId } ; POST /launch/number { waveId, categoryIds? } ; POST /launch/number/preview { waveId, categoryIds? } → changes sans rien écrire
  ```
  `state` : `finished` quand toutes les catégories à disputer de la vague sont terminées, sinon `launched` / `reopened` (lancée une fois puis rouverte) / `preparation`.

- [ ] **Step 1 : tests** (`launches.test.ts`)
  - `lancer : numéros enregistrés ; choix de vague et zones des catégories fixés ; GET /passages les rend à l'identique ; une nouvelle inscription dans une autre catégorie de la vague ne change aucun numéro`.
  - `blocages : vague précédente non lancée ; catégorie non prête ; discipline acceptée nulle part ; déjà lancée → 400 avec tous les messages`.
  - `reprendre à 1 : la 2e vague lancée avec restart commence à 1 sur chaque zone ; sans restart, elle suit`.
  - `rouvrir puis numéroter sans rien changer : aucun numéro ne change, vague de nouveau lancée`.
  - `nouvelle catégorie dans une vague lancée : à numéroter ; numberPending → numéros après le dernier numéro figé de sa zone, numbers_updated_at renseigné ; l'aperçu n'écrit rien`.
  - `vague implicite (sans vague) : lancer avec waveId null`.
- [ ] **Step 2 :** `npx vitest run tests/server/launches.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5 : Commit** — `feat(server): lancer, rouvrir et numéroter à la suite une vague`

---

### Task 3 : Verrous d'une vague lancée

**Files:**
- Modify: `src/server/repositories/categories.ts` (`syncCategories` : catégorie d'une vague lancée traitée comme lancée — tableau gardé, `stale` ; `updateCategory` : choix de vague et zone refusés ; `regenerateCategory(db, id, cid)`), `src/server/routes/categories.ts` (`POST /categories/:cid/regenerate` → régénère puis `numberPending` pour elle), `src/domain/replacement/types.ts` + `detect.ts` (`CategoryState.frozen: boolean`, `isLocked` vrai aussi pour `frozen`), `src/server/repositories/replacement.ts` (`loadState` : `frozen` = catégorie d'une vague lancée), `src/server/repositories/waves.ts` (suppression d'une vague lancée une fois refusée ; vagues refusées si la vague implicite a été lancée), `src/server/repositories/zones.ts` (zone portant des numéros figés non supprimable), `tests/domain/replacement/fixtures.ts` (`frozen: false`)
- Test: `tests/server/launches.test.ts` (`describe('vague lancée : verrous')`), `tests/domain/replacement/propose.test.ts`

**Interfaces:**
- Consumes: `launchedCategoryIds`, `numberPending` (Task 2).

- [ ] **Step 1 : tests**
  - `absent tardif dans une catégorie prête d'une vague lancée : tableau gardé, stale ; regenerate → nouveau tableau, numéros à la suite pour elle seule, les autres inchangés`.
  - `recasement : aucun cas d'une catégorie de la vague lancée, aucune proposition vers elle ; vague rouverte → les cas reviennent`.
  - `PATCH zoneId / waveOverride d'une catégorie d'une vague lancée → 409 ; rouverte → permis`.
  - `vague lancée une fois : suppression refusée (409) ; sans vague, compétition lancée : création de vagues refusée ; zone portant des numéros figés : suppression refusée`.
  - domaine (`propose.test.ts`) : `catégorie frozen : ni cas ni cible`.
- [ ] **Step 2 :** `npx vitest run tests/server/launches.test.ts tests/domain/replacement` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5 : Commit** — `feat(server): vague lancée verrouillée (régénération confirmée, recasement fermé)`

---

### Task 4 : Écrans (lancement, réouverture, finales, impression)

**Files:**
- Modify: `src/web/api.ts` (`useLaunchStatus(id, waveId, restart)`, `useLaunch`, `useReopen`, `useNumberPending`, `useNumberPreview`, `useRegenerate` ; invalidation de `categories`, `schedule`, `launch`), `src/web/pages/MatchesPage.tsx` (en tête de la vague : état ; « Figer et imprimer la vague… » (fenêtre : blocages, « Reprendre les numéros à 1 », numéros par zone, « Figer » puis lien « Imprimer la vague ») ; « Rouvrir la vague » (confirmation) ; « N catégorie(s) à numéroter » + « Numéroter à la suite… » (aperçu des numéros)), `src/web/pages/BracketsPage.tsx` (catégorie d'une vague lancée : « Régénérer (renuméroté à la suite) » avec confirmation quand ses inscrits ont changé), `src/web/pages/CompetitionSettingsPage.tsx` (« Finales sur la zone » : Aucune / zones enregistrées ; « Finales de kata aussi sur cette zone »), `src/web/pages/PrintPage.tsx` (`?vague=` : catégories de la vague ; « Zone des finales : Ring » sur la finale déplacée ; « mis à jour à HH:MM »), `src/web/components/BracketView.tsx` (zone d'un combat déplacé), `src/web/passages.ts`, `src/web/help.ts`, `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (13 ✅)
- Test: `tests/e2e/figeage.spec.ts`

- [ ] **Step 1 : test e2e** — sans vague ; Tatami 1 et Ring ; cadettes de 8 (prêtes) et une catégorie non prête. Réglages : « Finales sur la zone » Ring. Combats : « Figer et imprimer la vague… » → blocage « pas prêtes » ; marquer prête → figer → lien « Imprimer la vague » ; impression : la finale des cadettes porte « Zone des finales : Ring ». Marquer une cadette absente → Tableaux : « Les inscrits ont changé », « Régénérer (renuméroté à la suite) » → confirmer → impression « mis à jour à ». « Rouvrir la vague » → confirmer → état « Rouverte » ; « Numéroter à la suite » → « Lancée ».
- [ ] **Step 2 :** `npx playwright test tests/e2e/figeage.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5 :** bilan et feuille de route ; commit — `feat(web): figer et imprimer une vague, rouvrir, finales sur une zone ; bilan de l'étape 13`
