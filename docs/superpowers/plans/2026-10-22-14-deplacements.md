# Étape 14 : Déplacements en cours de compétition — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quand une zone prend du retard, l'organisateur déplace une catégorie (ou les combats qui lui restent, si elle est commencée) d'une vague lancée vers une autre zone, « à la suite » (défaut) ou « mélangés », avec un aperçu (ancien → nouveau numéro, tableaux à réimprimer) ; les tableaux renumérotés portent « mis à jour à HH:MM ». Refiger une vague rouverte propose les mêmes deux modes.

**Architecture:** deux fonctions pures dans `src/domain/passages/plan.ts` : `appendPassages` (déjà là) apprend à ne numéroter que les combats non joués et à viser une zone donnée ; `reshuffleZone` refait l'ordre de tous les combats non joués d'une zone (vagues figées de la même numérotation) à partir du numéro qui suit le plus grand numéro joué. Le serveur calcule les combats joués (résultat saisi ; kata : une note saisie), remplace les numéros figés concernés, épingle la catégorie sur sa nouvelle zone et horodate les catégories renumérotées.

**Tech Stack:** TypeScript, Fastify, React 19 + Mantine 8, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` §1.10 (déplacements), §1.3 (refiger : « à la suite » par défaut, « mélangés » au choix, avec aperçu).

## Global Constraints
- Un déplacement porte sur **une catégorie entière**, ou **les combats qui lui restent** si elle est commencée : jamais des combats isolés d'une même catégorie sur deux zones (hors finale sur la zone des finales, qui reste où elle est).
- **Joué** : combat avec un résultat saisi ; bloc de kata avec au moins une note (tour 1 ou finale selon le bloc). Un combat joué garde son numéro et sa zone.
- **À la suite** (défaut) : les combats déplacés prennent les numéros qui suivent le dernier numéro figé de la zone d'arrivée (même numérotation, depuis le dernier « reprendre à 1 ») ; aucun autre numéro ne change ; sur la zone de départ, les numéros partis deviennent des trous.
- **Mélangés** : tous les combats non joués de la zone d'arrivée (vagues figées de la même numérotation) et les combats déplacés sont renumérotés avec l'ordre de passage habituel (vague par vague, règle de repos), à partir du numéro qui suit le plus grand numéro **joué** sur cette zone (1 s'il n'y en a pas).
- Seule une catégorie d'une **vague lancée** (numéros figés) se déplace ainsi ; avant le lancement ou dans une vague rouverte, on choisit simplement sa zone (épinglage, puis « Refiger »). La zone d'arrivée doit accueillir la discipline (sinon 400 « Le Ring n’accueille pas le kata. »), être différente de la zone actuelle.
- **Aperçu** avant de valider : `changes` = combats renumérotés `{ categoryId, label, matchId, from: { zoneId, number } | null, to: { zoneId, number } }`, `reprint` = catégories à réimprimer (libellés). Valider = mêmes calculs, écrits.
- Chaque catégorie dont un numéro change reçoit `numbers_updated_at` = maintenant (« mis à jour à HH:MM » imprimé) ; la catégorie déplacée est épinglée sur la zone d'arrivée.
- **Refiger** (`numberPending`) : option `mode: 'append' | 'shuffle'` (défaut `'append'`) ; en « mélangés », chaque zone qui reçoit une catégorie à numéroter est refaite comme ci-dessus.
- Impression : un combat joué sur une autre zone que celle de sa catégorie porte « Joué sur : Tatami 1 » ; une finale sur la zone des finales garde « Zone des finales : Ring ».
- Copie : « Déplacer vers… », « À la suite (seuls les tableaux déplacés sont à réimprimer) », « Mélangés (toute la zone d’arrivée est renumérotée : réimprimez tous ses tableaux) », « Un combat en cours sur le tapis n’a pas encore de résultat : il serait renuméroté — préférez « À la suite ». ». Aides mises à jour.
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Catégorie commencée** déplacée : ses combats joués gardent numéro et zone ; ses combats restants (y compris pas encore jouables) partent — test Task 2.
- **Mélangés** : aucun numéro joué ne change ; les numéros non joués de la zone d'arrivée repartent du plus grand numéro joué + 1, sans doublon avec un numéro joué — tests Task 1 et Task 2.
- **Deux jours** (« reprendre à 1 ») : un déplacement le 2e jour ne numérote qu'après les numéros du 2e jour — test Task 1.
- **Zone qui n'accueille pas la discipline** ou zone identique : refus — test Task 2.
- **Aperçu** : n'écrit rien ; valider après un changement entre-temps recalcule (pas de numéros périmés) — test Task 2.

---

### Task 1 : Numéros à la suite et mélangés (domaine)

**Files:**
- Modify: `src/domain/passages/plan.ts`
- Test: `tests/domain/passages/moves.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RenumberOptions {
    /** Passages joués (clé `${categoryId}:${matchId ?? 'kata'}`) : jamais renumérotés. */
    played?: Set<string>;
    /** Zone imposée à des catégories (déplacement) ; sinon leur zone du plan. */
    zoneOf?: Record<string, string>;
  }
  export function appendPassages(input: PlanInput, waveId: string | null, categoryIds: string[], opts?: RenumberOptions): FrozenPassage[];   // passages non joués seulement
  /** Nouveaux numéros de tous les passages non joués de la zone (vagues figées de la même numérotation que `waveId`), catégories `extra` comprises (catégories à numéroter, catégorie déplacée). */
  export function reshuffleZone(input: PlanInput, zoneId: string, waveId: string | null, extra: string[], opts?: RenumberOptions): FrozenPassage[];
  ```
  Dans `reshuffleZone`, une catégorie de `extra` ne garde aucun de ses anciens numéros non joués ; les autres catégories de la zone gardent leurs passages joués et voient leurs passages non joués renumérotés.

- [ ] **Step 1 : tests** (`moves.test.ts`)
  - `à la suite, zone imposée et joués exclus : catégorie de 4 dont w1-0 est joué, déplacée sur le Ring → w1-1 et w2-0 après le dernier numéro du Ring`.
  - `mélangés : Ring avec X (6 passages, 1 et 2 joués) + catégorie déplacée → numéros 1 et 2 gardés, le reste renuméroté à partir de 3, ordre de passage habituel, aucun doublon`.
  - `mélangés : un passage joué au-delà d'un non joué (n° 5 joué, 3 non joué) → les non joués repartent de 6`.
  - `deux jours : vague 2 reprise à 1 → à la suite et mélangés ne comptent que les numéros de la vague 2`.
  - `kata déplacé : bloc entier ; bloc avec une note = joué`.
- [ ] **Step 2 :** `npx vitest run tests/domain/passages/moves.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter (réutiliser `orderWave` sur la seule zone, avec les nœuds non joués).
- [ ] **Step 4 :** `npx vitest run tests/domain && npm run typecheck` → PASS.
- [ ] **Step 5 : Commit** — `feat(domain): renumérotation à la suite (combats restants) et mélangée d'une zone`

---

### Task 2 : Déplacer une catégorie d'une vague lancée (serveur)

**Files:**
- Modify: `src/server/repositories/launches.ts` (`playedKeys(db, competitionId): Set<string>` ; `moveCategory(db, competitionId, categoryId, zoneId, mode, dryRun)` ; `numberPending(…, mode)`), `src/server/routes/launches.ts` (`POST /categories/:cid/move` et `/move/preview` `{ zoneId, mode }` ; `mode` sur `/launch/number` et son aperçu)
- Test: `tests/server/moves.test.ts`

**Interfaces:**
- Consumes: `appendPassages`, `reshuffleZone` (Task 1).
- Produces:
  ```ts
  export type RenumberMode = 'append' | 'shuffle';
  export interface MoveResult {
    changes: { categoryId: string; label: string; matchId: string | null; from: { zoneId: string; number: number } | null; to: { zoneId: string; number: number } }[];
    reprint: { categoryId: string; label: string }[];
  }
  export async function moveCategory(db, competitionId, categoryId: string, zoneId: string, mode: RenumberMode, dryRun = false): Promise<MoveResult>;
  // numberPending(db, competitionId, waveId, categoryIds?, dryRun = false, mode: RenumberMode = 'append') → { changes, blocking } (changes comme aujourd'hui)
  ```

- [ ] **Step 1 : tests** (`moves.test.ts`, vague implicite lancée, Tatami 1 et Tatami 2)
  - `à la suite : C (4, w1-0 joué) de Tatami 1 vers Tatami 2 → w1-1 et w2-0 après le dernier numéro de Tatami 2 ; w1-0 garde numéro et zone ; les catégories de Tatami 2 inchangées ; C épinglée sur Tatami 2, mis à jour ; reprint = [C]`.
  - `mélangés : les combats non joués de Tatami 2 sont renumérotés à partir du plus grand joué + 1 ; reprint = toutes les catégories de Tatami 2 touchées ; mises à jour`.
  - `aperçu : rien n'est écrit ; changes = ancien → nouveau`.
  - `refus : zone identique ; zone qui n'accueille pas la discipline ; vague non lancée (« choisissez simplement la zone »)`.
  - `refiger en mélangés : rouvrir, changer la zone d'une catégorie, numéroter avec mode shuffle → la zone d'arrivée est refaite`.
- [ ] **Step 2 :** `npx vitest run tests/server/moves.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5 : Commit** — `feat(server): déplacer une catégorie d'une vague lancée (à la suite ou mélangés)`

---

### Task 3 : Écrans (déplacer, refiger mélangé, impression)

**Files:**
- Modify: `src/web/api.ts` (`useMovePreview`, `useMoveCategory`, `mode` pour numéroter), `src/web/pages/MatchesPage.tsx` (catégorie numérotée dans une vague lancée : le choix de zone ouvre « Déplacer vers… » — mode À la suite / Mélangés, aperçu ancien → nouveau, tableaux à réimprimer, avertissement « combat en cours », « Déplacer »), `src/web/components/WaveLaunchPanel.tsx` (choix du mode dans « Refiger » / « Numéroter », aperçu selon le mode), `src/web/passages.ts` + `src/web/components/BracketView.tsx` (`matchZones` : libellé « Zone des finales : Ring » ou « Joué sur : Tatami 1 »), `src/web/help.ts` (`combats.categories`, `combats`), `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (14 ✅)
- Test: `tests/e2e/deplacements.spec.ts`

- [ ] **Step 1 : test e2e** — sans vague, Tatami 1 et Tatami 2 ; deux catégories de 4 (prêtes) sur Tatami 1, une sur Tatami 2 ; figer ; un résultat saisi dans la 1re. Combats : zone de la 1re → « Tatami 2 » ouvre « Déplacer vers… » ; aperçu « À la suite » : ses deux combats restants, ancien → nouveau ; « Mélangés » : la catégorie de Tatami 2 apparaît dans les tableaux à réimprimer ; valider en « À la suite » → la file de Tatami 2 contient ses combats ; impression : « mis à jour à » et « Joué sur : Tatami 1 » sur le combat joué.
- [ ] **Step 2 :** `npx playwright test tests/e2e/deplacements.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5 :** bilan et feuille de route ; commit — `feat(web): déplacer une catégorie en cours de compétition ; bilan de l'étape 14`
