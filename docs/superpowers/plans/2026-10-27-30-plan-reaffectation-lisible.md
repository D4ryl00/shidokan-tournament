# Réaffectation lisible — plan de réalisation (étape 30)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagramme des règles en tableau « casés · restent seuls », ligne de départ « corrections imposées », page en deux blocs, refus du plan gardés dans le plan (« Recommencer le plan »), coche « Tenir compte des décisions prises sur les cartes ».

**Architecture:** Côté serveur, une fonction pure du domaine prépare l'état donné au calcul (refus du plan, coche) ; `planInput` et `applyPlan` l'utilisent tous les deux, l'algorithme du plan ne change pas. Côté web, le découpage des barres est une fonction pure testée ; `RuleLadder` devient un tableau ; `PlanView` gère les refus comme des choix du poste ; `ReplacementPage` se réorganise en deux blocs.

**Tech Stack:** TypeScript 7 (natif), React + Mantine, TanStack Query, Fastify + zod, vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-10-27-plan-reaffectation-lisible-design.md` (et, pour le contexte, `docs/superpowers/specs/2026-10-25-plan-d-ensemble-reaffectation-design.md`).

## Global Constraints

- Textes de l'interface en français, exactement : « Au départ, corrections imposées » / « Au départ, corrections imposées et vos choix », « Tenir compte des décisions prises sur les cartes », « Recommencer le plan », « Annuler le refus », « ① Plan automatique », « ② Cas un par un : ce que le plan ne règle pas ».
- En-têtes du tableau : « N° », « Règle », « Coût », « Active », « Combattants : casés · restent seuls », « Déplacements ».
- Couleurs : jetons existants `--sk-cost0..4` (casés), jeton de danger existant pour les hachures « restent seuls » ; lisibles en clair et en sombre.
- Largeur d'un téléphone : aucun défilement horizontal de la page (règle de la refonte UI, `tests/e2e/mise-en-page.spec.ts`, helper `clipped()`).
- `replacementRules.order` garde `return` en tête : aucun changement des réglages enregistrés ni de migration.
- Limite des choix : 500 (zod), refus du plan compris.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte.
- Commits conventionnels en français (`feat(réaffectation): …`), Node 22.23.2 (`.tool-versions`).

## Review Focus

- Refus du plan sur un déplacement qui n'existe qu'au milieu du plan (cas créé par un déplacement précédent du plan) : il doit rester refusé, pas être retiré comme « plus possible » (test tâche 1).
- Coche décochée puis « Appliquer le plan » : le plan appliqué est celui affiché (même coche envoyée, sinon 409) (test tâche 1).
- Barres pendant un calcul (lignes `alone: null`) ou règle désactivée entre deux règles actives : le découpage saute ces lignes sans casser la suite (test tâche 2).
- `D = 0` : aucune barre, « Aucun combattant seul » (test tâche 2 + rendu tâche 3).
- Après « Appliquer le plan » : les refus du plan restent, Valider/Modifier appliqués partent (test e2e tâche 4).

---

### Task 1: Entrées du plan — refus du plan et coche, côté domaine et serveur

**Files:**
- Create: `src/domain/replacement/plan-inputs.ts`
- Modify: `src/domain/replacement/plan.ts` (type `PlanChoice`, `LadderRow.start`, remplissage dans `planLadder`)
- Modify: `src/domain/replacement/index.ts` (exports)
- Modify: `src/server/plan/compute.ts` (`PlanInput.stale`, `planPayload` : `dropped` + suppression de `plan.refused`)
- Modify: `src/server/repositories/replacement.ts` (`planInput`, `planResponse`, `applyPlan`)
- Modify: `src/server/routes/replacement.ts` (schémas zod)
- Test: `tests/domain/replacement/plan-inputs.test.ts`, `tests/domain/replacement/ladder.test.ts`, `tests/server/replacement.test.ts`

**Interfaces:**
- Produces:
  - `PlanChoice` gagne `| { kind: 'refuse'; proposalId: string; registrationId: string; reason: string }` (`registrationId` et `reason` servent à afficher la liste « Refusés » sans le serveur).
  - `preparePlanState(state: State, choices: PlanChoice[], cardDecisions: boolean, waveId: string | null): { state: State; choices: PlanChoice[]; stale: PlanChoice[] }` dans `plan-inputs.ts`. Renvoie l'état où `refused` = (cochée ? `state.refused` : `[]`) ∪ ids des refus du plan, `setAside` = (cochée ? `state.setAside` : `[]`) ; `choices` = les choix sans les `refuse` ; `stale` = les `refuse` dont l'inscription n'est plus un membre actif de la session `waveId` (absente, retirée, supprimée, autre session). Choix du plan : « la proposition n'existe plus » se juge ainsi, et non sur les propositions de l'état réel, car un déplacement du plan peut venir d'un cas qui n'existe qu'au milieu du plan.
  - `LadderRow.start?: { returns: number; weights: number; choices: number }`, rempli seulement sur la ligne `rule === 'return'` : déplacements de type `R`, déplacements dont `caseId` commence par `weight_out:`, déplacements `validated` (un déplacement validé n'est compté que dans `choices`).
  - Corps des routes `POST /replacement/plan` et `POST /replacement/plan/apply` : `cardDecisions?: boolean` (absent = `true`).
  - `PlanResponse.plan.refused` disparaît ; `plan.dropped` contient en plus les refus `stale`.

- [ ] **Step 1: Tests du domaine (échouent)** — `tests/domain/replacement/plan-inputs.test.ts` :
  - `preparePlanState : refus du plan ajoutés aux refus des cartes quand la coche est cochée` → `refused` contient les deux, `choices` sans `refuse`.
  - `coche décochée : refus des cartes et mises de côté ignorés` → `refused` = refus du plan seuls, `setAside` = `[]`.
  - `refus d'un combattant absent ou retiré : stale` → `stale` contient ce choix ; un refus dont l'inscription est active mais dont le cas n'existe qu'au milieu du plan n'est **pas** stale.
  - Dans `ladder.test.ts` : `ligne « return » : détail des corrections imposées et des choix` → avec un état qui a un retour et une correction de poids, `rows.find((r) => r.rule === 'return')!.start` vaut `{ returns: 1, weights: 1, choices: 0 }` ; avec un choix validé, `choices: 1`.

  Utiliser `tests/domain/replacement/fixtures.ts` pour l'état.

- [ ] **Step 2: Lancer** `npx vitest run tests/domain/replacement/plan-inputs.test.ts tests/domain/replacement/ladder.test.ts` → FAIL (fonction absente, `start` indéfini).

- [ ] **Step 3: Implémenter** `preparePlanState` et `LadderRow.start` (dans `planLadder`, après le calcul de la ligne `return`, compter sur `r.moves`). `solvePlan` ne reçoit jamais de choix `refuse` (ils sont retirés avant).

- [ ] **Step 4: Tests serveur (échouent)** dans `tests/server/replacement.test.ts` (adapter les types `Choice`, `PlanBody`, `PlanOut` du fichier ; retirer `refused` des attentes existantes, réécrire `plan : les propositions refusées des cas ouverts sont listées`) :
  - `plan : un refus du plan écarte la proposition sans rien enregistrer` → plan avec `{ kind: 'refuse', proposalId: pid, registrationId: a.id, reason: 'x' }` : `pid` absent de `plan.moves` ; `GET /replacement` : la proposition n'est pas `refused`.
  - `plan : coche décochée, un refus de carte et une mise de côté sont ignorés` → après `POST /replacement/refuse` et une mise de côté, `plan({ cardDecisions: false })` contient le déplacement refusé et traite le cas mis de côté ; `plan()` ne les contient pas.
  - `appliquer avec une autre coche que l'affichage : 409` → hash pris coche décochée, application avec `cardDecisions: true` → 409, rien d'appliqué.
  - `plan : refus d'un combattant absent → dans dropped`.
  - Choix `refuse` aux champs inconnus → 400 (schéma `.strict()`).

- [ ] **Step 5: Lancer** `npx vitest run tests/server/replacement.test.ts` → FAIL.

- [ ] **Step 6: Implémenter le serveur** : zod `z.object({ kind: z.literal('refuse'), proposalId: z.string(), registrationId: z.string(), reason: z.string().max(500) }).strict()` dans l'union ; `cardDecisions: z.boolean().optional()` dans les deux corps ; `planInput` appelle `preparePlanState` après `planWave` et `loadState`, met `stale` dans `PlanInput` ; `planPayload` ajoute `input.stale` à `dropped` ; `applyPlan` prépare l'état de la même façon avant `runPlanJob` (les vérifications d'empreinte restent sur l'état réel).

- [ ] **Step 7: Lancer** `npm test` et `npm run typecheck` → PASS (corriger les appelants de `plan.refused` côté web : la liste sera refaite à la tâche 4 ; en attendant, la retirer de `PlanView`).

- [ ] **Step 8: Commit** `feat(réaffectation): refus du plan et coche des décisions des cartes dans les entrées du calcul`

---

### Task 2: Numérotation sans « Retour » et découpage des barres

**Files:**
- Modify: `src/domain/replacement/rules.ts`
- Create: `src/web/components/replacement/ladderBars.ts`
- Test: `tests/domain/replacement/rules.test.ts`, `tests/web/ladder-bars.test.ts`

**Interfaces:**
- Produces:
  - `ruleNumber(order: RuleId[], rule: RuleId): number | null` dans `rules.ts` : `null` pour `return`, sinon l'index dans `order` sans `return`, à partir de 1.
  - Dans `ladderBars.ts` :
    ```ts
    export interface BarSegment { band: CostBand; count: number }
    export interface LadderBar { placed: BarSegment[]; alone: number; total: number }
    export function ladderBars(start: number, rows: { rule: RuleId; alone: number | null; band: CostBand }[]): Map<RuleId, LadderBar>
    ```
    `start` = `D` (seuls de la ligne `return`) ; `rows` = les règles après `return`, dans l'ordre, désactivées et pas calculées comprises (`alone: null`, absentes de la Map, sautées sans casser la suite). Pour chaque ligne calculée k : apport `max(0, S(précédente calculée ou D) − S(k))` dans la couleur de la ligne k ; morceaux voisins de même couleur fusionnés ; morceaux à 0 omis ; `alone = S(k)` ; `total = max(D, somme des casés + alone)`.

- [ ] **Step 1: Tests (échouent)** :
  - `ruleNumber` : `ruleNumber(['return','weight','split'], 'return') === null`, `'weight' → 1`, `'split' → 2`.
  - `ladderBars : 6 → 4 → 4 → 2` (bandes 0, 0, 1) → ligne 1 `{ placed: [{band:0,count:2}], alone: 4, total: 6 }` ; ligne 3 `placed: [{band:0,count:2},{band:1,count:2}]`.
  - `une règle qui ne case personne ne peint rien` → règle de bande 4 après la ligne 3 : mêmes morceaux que la ligne 3, aucun morceau de bande 4.
  - `lignes non calculées ou désactivées sautées` → `alone: null` au milieu : absente de la Map ; la ligne suivante compare à la dernière ligne calculée.
  - `remontée (garde-fou) comptée 0` → `S` passe de 2 à 3 : aucun morceau ajouté, `total` = `max(D, …)`.
  - `D = 0` → toutes les barres `{ placed: [], alone: 0, total: 0 }`.

- [ ] **Step 2: Lancer** `npx vitest run tests/web/ladder-bars.test.ts tests/domain/replacement/rules.test.ts` → FAIL.
- [ ] **Step 3: Implémenter** `ruleNumber` et `ladderBars`.
- [ ] **Step 4: Lancer** les mêmes tests → PASS.
- [ ] **Step 5: Commit** `feat(réaffectation): numéros des règles sans « Retour » et découpage des barres casés · seuls`

---

### Task 3: Le tableau des règles (`RuleLadder`) et la numérotation dans le plan

**Files:**
- Modify: `src/web/components/replacement/RuleLadder.tsx`
- Modify: `src/web/components/replacement/PlanView.tsx` (fonction `number`, titres des groupes, pastilles)
- Modify: `src/web/pages/ReplacementPage.tsx` (texte du bouton « Voir le plan… »)
- Test: `tests/e2e/plan-d-ensemble.spec.ts`

**Interfaces:**
- Consumes: `ruleNumber`, `ladderBars` (tâche 2) ; `LadderRow.start` (tâche 1).
- Produces (identifiants de test) : `ladder-header` ; `ladder-start` (la ligne `return`, cliquable pour y mettre la coupure) avec `ladder-start-title` et `ladder-start-detail` ; dans chaque barre `ladder-bar` portant `data-placed` et `data-alone` (nombres), ses morceaux `ladder-segment` (`data-band`) et `ladder-alone` (texte « 4 seuls ») ; `ladder-legend`.

- [ ] **Step 1: Adapter les e2e (échouent)** dans `plan-d-ensemble.spec.ts` : `le diagramme baisse règle par règle…` lit `ladder-bar` (`data-alone`) au lieu du texte nu, vérifie `ladder-start-detail` (« 1 poids hors catégorie » ou ce que `seedPlan` produit ; le lire une fois et l'écrire exactement), `ladder-header` visible avec « Combattants : casés · restent seuls », et le bouton « Voir le plan jusqu’à la règle 7 (…) » (8 → 7, 5 → 4 : un de moins partout). Nouveau test `coupure sous la ligne de départ : seulement les corrections imposées` → clic sur `ladder-start` : la ligne « je m’arrête ici » suit la ligne de départ et le bouton dit « Voir le plan des corrections imposées (N déplacements, M seuls) ». Mettre à jour les numéros attendus dans les titres de groupes (« règles 1–3 » → « règles 1–2 », etc.).

- [ ] **Step 2: Lancer** `npx playwright test tests/e2e/plan-d-ensemble.spec.ts` → FAIL.

- [ ] **Step 3: Réécrire `RuleLadder`** en grille CSS (une ligne d'en-tête, puis la ligne de départ grisée, puis les règles), colonnes de la spec §3.1 ; sur écran étroit, lignes empilées comme aujourd'hui, l'en-tête réduit à la légende. Ligne de départ : titre « Au départ, corrections imposées » (+ « et vos choix » si `start.choices > 0`), détail « 1 retour · 1 poids hors catégorie · 2 choix du plan » (sortes à 0 omises ; « aucune correction » si tout est à 0), barre entièrement hachurée « 6 seuls », ou « Aucun combattant seul » si `D = 0`. Barre : morceaux colorés `BAND_COLOR[band]` avec leur nombre s'il tient, partie hachurée avec « N seuls » ; infobulle (`title`) « 2 casés par les règles 1–2 · 2 par la règle 4 · 2 seuls ». Colonne Déplacements : « 3 » ou « 3 · **1 à valider** ». Le reste (glisser, ↑ ↓, interrupteur, lignes grisées pendant le calcul, « … pas encore calculée ») ne change pas.

- [ ] **Step 4: Numérotation** : `PlanView.number` et les titres de groupes utilisent `ruleNumber` (pastille sans numéro pour `return`) ; dans `RulesPanel`, `k = ruleNumber(order, cutAfter)` et, si `null`, le texte « Voir le plan des corrections imposées (…) ».

- [ ] **Step 5: Lancer** `npx playwright test tests/e2e/plan-d-ensemble.spec.ts tests/e2e/mise-en-page.spec.ts` et `npm run typecheck` → PASS (le test « la liste des règles tient dans un écran de téléphone, barres comprises » doit rester vert).

- [ ] **Step 6: Commit** `feat(réaffectation): diagramme en tableau, barres casés · seuls, ligne de départ des corrections imposées`

---

### Task 4: Décisions du plan gardées dans le plan, « Recommencer le plan », coche

**Files:**
- Modify: `src/web/usePlanChoices.ts`
- Modify: `src/web/api.ts` (`planBody`, `usePlan`, `usePlanForApply`, `useApplyPlan`)
- Modify: `src/web/components/replacement/PlanView.tsx`
- Modify: `src/web/pages/ReplacementPage.tsx` (`RulesPanel`, `sameChoice`, `choiceRegistrations`)
- Test: `tests/e2e/plan-d-ensemble.spec.ts`

**Interfaces:**
- Consumes: `PlanChoice` avec `refuse`, `cardDecisions` des routes, `plan.dropped` (tâche 1).
- Produces:
  - `usePlanCardDecisions(competitionId: string, waveId: string | null): [boolean, (v: boolean) => void]` (clé `plan-card-decisions:${id}:${wave}` en `sessionStorage`, `true` si absente ou illisible).
  - `usePlan(id, waveId, choices, cardDecisions, enabled)` : `cardDecisions` dans la clé de requête et le corps ; `usePlanForApply` et `useApplyPlan` le reçoivent et l'envoient.
  - Identifiants de test : `plan-card-decisions` (la coche), `plan-restart-choices` (« Recommencer le plan »), `plan-unrefuse` (inchangé).

- [ ] **Step 1: e2e (échouent)** :
  - Réécrire `refuser puis annuler le refus` : après « Refuser », la carte de VETE n'a **pas** de `replacement-proposal-refused` ; recharger la page : le refus est toujours dans « Refusés » (poste) ; « Annuler le refus » le remet.
  - `refus du plan gardé après « Appliquer le plan »` → refuser VETE, valider un autre déplacement, appliquer : « Refusés » contient toujours VETE, le déplacement validé n'est plus un choix.
  - `« Recommencer le plan » efface validations, modifications et refus du plan` → après un Valider, un Modifier et un Refuser : clic, plus aucun choix, plan recalculé ; les réaffectations déjà appliquées et la coche ne changent pas ; bouton désactivé sans choix.
  - `coche décochée : le plan reprend une proposition refusée sur la carte et une carte mise de côté` → refus sur la carte + mise de côté, puis décocher `plan-card-decisions` : les deux combattants reviennent dans le plan ; la carte reste refusée et mise de côté ; recocher : ils repartent.

- [ ] **Step 2: Lancer** `npx playwright test tests/e2e/plan-d-ensemble.spec.ts` → FAIL.

- [ ] **Step 3: Implémenter** : `isChoice` accepte `refuse` ; `sameChoice` et `choiceRegistrations` traitent `refuse` ; `PlanView` : « Refuser » ajoute `{ kind: 'refuse', proposalId: m.id, registrationId: m.registrationId, reason: m.reason }` (et retire l'épingle ou le choix du même déplacement, comme aujourd'hui), plus d'appel à `useRefuseProposal`/`useUnrefuseProposal` ; la section « Refusés » se construit à partir des choix `refuse` (nom via `fighter`, raison barrée) ; après une application réussie, `onChoices([...toApply.plan.waiting, ...choices.filter((c) => c.kind === 'refuse')])`. `RulesPanel` : la coche (Mantine `Checkbox`, cochée par défaut) au-dessus de `RuleLadder`, passée à `usePlan`/`PlanView` ; « Recommencer le plan » à côté de « Voir le plan… », `onClick={() => choose([])}`, désactivé si `choices.length === 0`, sans confirmation. `clearPlanChoices` reste inchangé (les refus sont des choix, ils partent avec « Repartir de zéro »).

- [ ] **Step 4: Lancer** `npx playwright test tests/e2e/plan-d-ensemble.spec.ts` et `npm test` → PASS.

- [ ] **Step 5: Commit** `feat(réaffectation): refus du plan gardés sur le poste, « Recommencer le plan », coche des décisions des cartes`

---

### Task 5: La page en deux blocs, compteurs en haut

**Files:**
- Modify: `src/web/pages/ReplacementPage.tsx`
- Test: `tests/e2e/plan-d-ensemble.spec.ts` (ou le fichier e2e de la réaffectation qui vérifie déjà la page), `tests/e2e/mise-en-page.spec.ts`

**Interfaces:**
- Produces (identifiants de test) : `replacement-step-plan` (bloc ①), `replacement-step-cards` (bloc ②) ; `replacement-summary` inchangé.

- [ ] **Step 1: e2e (échoue)** `la page : compteurs, puis ① Plan automatique, puis ② Cas un par un` → l'ordre vertical (`boundingBox().y`) est `replacement-summary` < `replacement-step-plan` < `replacement-step-cards` ; ① contient `rule-ladder` et `plan-card-decisions` ; ② contient les cartes (`replacement-case`) et `set-aside-section` ; l'historique (`replacement-reset`) est sous ② et hors des deux blocs ; textes des titres exacts (Global Constraints). Ajouter la page à la vérification `clipped()` à la largeur d'un téléphone si elle n'y est pas.

- [ ] **Step 2: Lancer** → FAIL.

- [ ] **Step 3: Implémenter** : dans `ReplacementPage`, `SimpleGrid` des compteurs juste après le choix de session ; `RulesPanel` devient le bloc ① (`SectionCard` titrée « ① Plan automatique », bordure accent, phrase « Le cas général : choisissez jusqu’où vont les règles, vérifiez le plan, puis appliquez-le. ») ; filtres + cartes + `EmptyState` + « Mises de côté » dans le bloc ② (titre « ② Cas un par un : ce que le plan ne règle pas », bordure d'attention douce, phrase « Une fois le plan appliqué, les combattants encore seuls sont ici, carte par carte. ») ; le message des sessions et l'`ApiErrorAlert` des cartes passent dans ② ; l'historique reste dessous.

- [ ] **Step 4: Lancer** `npx playwright test` (toute la suite) et `npm test` → PASS.

- [ ] **Step 5: Commit** `feat(réaffectation): page en deux blocs, compteurs au-dessus des règles`

---

### Task 6: Documents

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-plan-d-ensemble-reaffectation-design.md` (§4 liste des règles, §5.3 barres : renvoi vers la nouvelle conception)
- Modify: `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (section Réaffectation, si elle décrit le diagramme ou les refus du plan)
- Modify: `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 30)
- Modify: aide à l'écran de la réaffectation si elle décrit le diagramme ou « Refuser » dans le plan (`grep -rn "Sans rien changer\|refus" src/web/help*` ou équivalent)

- [ ] **Step 1:** Mettre à jour ces textes (ce qui change, avec renvoi vers `2026-10-27-plan-reaffectation-lisible-design.md`).
- [ ] **Step 2:** `npm test` → PASS (les tests d'aide/textes vérifient les liens).
- [ ] **Step 3: Commit** `docs(réaffectation): diagramme casés · seuls, deux blocs, refus du plan — conception, bilan et feuille de route (étape 30)`
