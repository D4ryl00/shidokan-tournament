# Cartes lisibles, split élargi, remise à zéro par session — plan de réalisation (étape 31)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une proposition (carte ou ligne du plan) se lit en un coup d'œil (Pourquoi, De ➜ Vers surligné, pastilles) ; le split fait venir un combattant de n'importe quelle catégorie dans les règles actives ; « Repartir de zéro » est rouge et ne défait que les actions décidées depuis la session sélectionnée.

**Architecture:** Domaine : `pullProposals` évalue chaque candidat avec `evaluate` (règles du déplacement + « split ») et `plan-search` élargit sa zone atteignable en conséquence ; une fonction pure `moveView` donne les données structurées d'une proposition, jointes par le serveur aux propositions des cartes et aux lignes du plan. Web : une fonction pure découpe deux clés en morceaux (changé / pareil) et un composant commun `MoveBlocks` rend Pourquoi + De ➜ Vers + pastilles. Serveur : chaque action enregistre sa session (`wave_id`, migration 0025) ; `resetPreview` / `resetReplacement` travaillent par session et laissent en place ce qui touche une session lancée ou une catégorie commencée.

**Tech Stack:** TypeScript 7 (natif), React + Mantine, TanStack Query, Fastify + zod, drizzle (SQLite), vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-10-28-cartes-lisibles-split-elargi-design.md`

## Global Constraints

- Textes exacts : « POURQUOI », « DE », « VERS » (petites capitales) ; « vide : il y sera seul, à réaffecter ensuite » / « vide : elle y sera seule, à réaffecter ensuite » ; « Correction de pesée · imposée » ; « Retour · imposé » ; « Split (autre catégorie) » (nouveau `RULE_LABELS.split`) ; texte sous la coche : « Décochée : le plan ignore vos refus et vos mises de côté sur les cartes, et peut donc vous reproposer ces déplacements (les cartes, elles, restent telles quelles). »
- Pourquoi : « Pesé à 41 kg : trop lourd pour -40 kg (tolérance 0,5 kg) » (accord au féminin : « Pesée », « trop lourde ») ; « Seul dans sa catégorie » / « Seule… » ; « Donner un adversaire à ROUSSEAU Tom, seul en Minimes M · -50 kg » (« une poule » pour deux venus) ; « Retour dans sa catégorie d’origine (elle a de nouveau des combattants) » ; « Inscrit dans une catégorie fermée » / « Inscrite… » ; « Choisi à la main ».
- Split : seulement disciplines avec poids (`DISCIPLINES[d].hasWeight`), jamais le kata.
- Bouton « Repartir de zéro (session <nom>) » rouge ; sans sessions : « Repartir de zéro ».
- Nombres en français (virgule), comme `kg()` existant.
- Jetons `--sk-*`, lisible en clair et en sombre ; largeur d'un téléphone : pas de défilement horizontal (`tests/e2e/mise-en-page.spec.ts`, `clipped()`).
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte.
- Commits conventionnels en français (`feat(réaffectation): …`), Node 22.23.2.

## Review Focus

- Split d'un candidat dont la seule voie passe par une règle désactivée ou sous la ligne de coupure : aucune proposition, et jamais dans le plan (test tâche 1).
- Split qui viderait la catégorie de départ à un seul actif (absents non comptés) : refusé (test tâche 1).
- Remise à zéro d'une session dont un combattant a été réaffecté ensuite depuis une autre session : refus en entier, message avec le nom (test tâche 5).
- Lignes d'historique d'avant la migration (`wave_id` nul) : rangées dans la session de leur catégorie de départ, même si cette catégorie a disparu depuis (test tâche 4).
- Carte d'une proposition vers une nouvelle catégorie (`newKey`) et ligne de plan « Choisi à la main » (type M) : la vue existe, sans planter (test tâche 2).

---

### Task 1: Split élargi (domaine)

**Files:**
- Modify: `src/domain/replacement/propose.ts` (`pullProposals`, `ruleProfile`, construction dans `proposalsFor`)
- Modify: `src/domain/replacement/plan-search.ts` (`reachable`, `opensOption`)
- Modify: `src/domain/replacement/rules.ts` (`RULE_LABELS.split`)
- Modify: `src/domain/replacement/types.ts` (commentaire de `alsoMoved` ; champ `pulledRules`)
- Test: `tests/domain/replacement/propose.test.ts`, `tests/domain/replacement/plan.test.ts`

**Interfaces:**
- Produces: `Proposal.pulledRules?: RuleId[]` — règles du déplacement des combattants venus (sans « split » ni « weight ») ; `ruleProfile` d'un split rend `['split', ...pulledRules]`.

- [ ] **Step 1: Tests qui échouent** (dans `describe('split…')`, renommé « split : le combattant seul reçoit un combattant d'une autre catégorie ») :
  - `test('démo : GARNIER Sacha (benjamin 40) rejoint ROUSSEAU Tom (minime 45)')` : ROUSSEAU minime M -50 pesé 45 seul ; Benjamins M -40 avec 40, 39, 39 présents ; règles par défaut (`ageUp` actif). Attendu : une proposition `registrationId` = GARNIER, cible = catégorie de ROUSSEAU, `rules` = `['split', 'ageUp']`, `manual: true`.
  - `test('règle du déplacement désactivée : pas de split')` : même état, `replacementRules.off = ['ageUp']` → aucune proposition pour GARNIER.
  - `test('écart sur toute la catégorie d’arrivée')` : seul à 46 → aucune proposition (46 − 40 = 6 > 5).
  - `test('il reste au moins deux actifs au départ')` : Benjamins -40 avec 40, 39 présents + un absent → aucune.
  - `test('descente permise')` : seul minime M -50 pesé 41 ; candidat minime M -55 pesé 44 (catégorie de 3) → proposé (`['split']`).
  - `test('candidats classés par coût puis poids le plus proche')` : deux candidats même source, l'un plus proche mais `ageUp`, l'autre même tranche ; le moins coûteux d'abord ; à coût égal, le plus proche.
  - `test('poule : les deux plus proches, de la même source')`.
  - `test('kata : jamais de split')`.
  - `test('combattant au placement verrouillé : jamais pris')`.
  - `plan.test.ts` : `test('le plan trouve le split de la démo à la ligne ageUp, pas avant')` : `plan(s, { level: 'split' })` laisse ROUSSEAU seul ; `plan(s, { level: 'ageUp' })` le case avec GARNIER.
  - Adapter le test existant « poule de 3 d’abord… » à l'ordre coût → proximité (les propositions à un seul venu sont maintenant une par candidat permis).

- [ ] **Step 2:** `npx vitest run tests/domain/replacement/propose.test.ts tests/domain/replacement/plan.test.ts` → les nouveaux tests échouent.

- [ ] **Step 3: Implémenter.**
  - `pullProposals(state, m)` : `m` seul, discipline avec poids, catégorie non verrouillée. Pour chaque catégorie source non verrouillée ≠ celle de `m` : candidats = actifs non verrouillés (`!placementLocked`), discipline avec poids, pour lesquels `evaluate(state, y, t)` ≠ null (t = catégorie de `m`) ; si `active.length − k < 2` on saute. Singles : un par candidat. Poule (k = 2) : les deux candidats les plus proches en poids (`effectiveWeight`) de la même source, à `changes` identiques (sinon pas de poule), évalués l'un après l'autre comme aujourd'hui (`applyProposal` sur un état courant). `type` = le plus loin dans `order(m)` parmi les types évalués ; `pulledRules` = union des règles de `ruleProfile` de chaque déplacement venu, sans `weight` ; `checks` = ceux de la catégorie fusionnée (écart, seuil) et l'union des drapeaux d'âge / mixité ; `changes` = ceux du (des) venu(s).
  - Tri : `sortKey` = `[order(m).indexOf(type), coût (rang max de ses règles), k > 1 ? 2 : 3, |poids venu − poids seul| en centièmes, nom]`.
  - `ruleProfile` : branche « split » → `{ rules: ['split', ...(p.pulledRules ?? [])] + 'weightGap' si dépassement et absent, forced: false }`.
  - `proposalsFor` : texte `reason` inchangé dans sa forme (« X : De → Vers, pour donner un adversaire à Y »).
  - `plan-search.ts` `reachable(s, r)` : pour un cas `alone`, ajouter les catégories dont un membre est `near` de la clé de la catégorie de `m` (`near(y, mCat.key)`), pour que `proposalsFor` y rende les mêmes propositions que sur l'état entier. `opensOption` : remplacer le test « catégorie du dessous » par « un actif non verrouillé `z` de `t` (catégorie de 3 actifs ou plus) a `rulesForMove(withY, z, catégorie de y)` permis avec `split` ».
  - `RULE_LABELS.split = 'Split (autre catégorie)'`.

- [ ] **Step 4:** `npx vitest run tests/domain/replacement` → tout passe (y compris `ladder.test.ts` qui compare au glouton de référence ; si `greedy-reference.ts` reproduit l'ancien split, l'aligner).

- [ ] **Step 5: Durée.** `npm run test:perf` → passe (500 inscriptions < 4 s et `proven`, 150 < 2 s). Sinon : garder par catégorie source les 2 candidats les plus proches en poids (constante `SPLIT_CANDIDATES_PER_SOURCE = 2` dans `propose.ts`), relancer, et noter le choix dans la conception (§3) et le bilan.

- [ ] **Step 6: Commit** `feat(réaffectation): split depuis n'importe quelle catégorie, dans les règles actives`

### Task 2: Vue structurée d'une proposition (domaine + serveur)

**Files:**
- Create: `src/domain/replacement/view.ts`
- Modify: `src/domain/replacement/plan.ts` (export de `detailsOf` ; `PlanMove.view`)
- Modify: `src/domain/replacement/index.ts`
- Modify: `src/server/routes/replacement.ts` (GET `/replacement` : `view` sur chaque proposition affichée)
- Modify: `src/web/api.ts` (types)
- Test: `tests/domain/replacement/view.test.ts`

**Interfaces:**
- Produces (dans `view.ts`) :
  ```ts
  export type MoveWhy =
    | { kind: 'weight_out'; weighInKg: number; limitLabel: string; toleranceKg: number }
    | { kind: 'alone' }
    | { kind: 'split'; forLabel: string; forCategoryLabel: string; count: 1 | 2 }
    | { kind: 'return' }
    | { kind: 'closed' }
    | { kind: 'manual' };
  export interface MoveView {
    why: MoveWhy;
    sex: 'F' | 'M';                  // du combattant (accords)
    from: CategoryKey | null;        // catégorie de départ du (premier) combattant qui bouge
    to: CategoryKey;                 // arrivée après déplacement (comme arrivalKey)
    fromCount: number;               // actifs au départ, avant
    fromRemaining: number;           // actifs au départ, après
    opponents: string[];             // libellés des actifs à l'arrivée, hors ceux qui bougent
    gap: { kg: number; max: number } | null;  // null : discipline sans poids
    details: { rule: RuleId; detail: string }[];
  }
  export function moveView(before: State, p: Proposal): MoveView;
  ```
- `arrivalKey` (propose.ts) exportée pour `view.ts`.
- `PlanMove.view: MoveView` ; `Proposal` côté API des cartes : `view: MoveView` ajouté par la route (pas dans `proposalsFor` : le calcul du plan appelle `proposalsFor` des milliers de fois).

- [ ] **Step 1: Tests qui échouent** `tests/domain/replacement/view.test.ts` :
  - pesée hors catégorie vers une nouvelle catégorie (`newKey`) : `why = { kind: 'weight_out', weighInKg: 41, limitLabel: '-40', toleranceKg: 0.5 }`, `opponents = []`, `fromRemaining = fromCount − 1` ;
  - split de la démo (tâche 1) : `why.kind = 'split'`, `forLabel = 'ROUSSEAU Tom'`, `count = 1`, `from` = clé Benjamins -40, `fromCount 3 → fromRemaining 2`, `opponents = ['ROUSSEAU Tom']`, `gap = { kg: 5, max: 5 }` ;
  - type M (`manualProposal`) : `why.kind = 'manual'` ;
  - retour (type R) : `why.kind = 'return'` ; catégorie fermée : `'closed'` ;
  - kata : `gap = null`.

- [ ] **Step 2:** `npx vitest run tests/domain/replacement/view.test.ts` → échec.

- [ ] **Step 3: Implémenter** `moveView` (cas d'après le préfixe de `p.caseId` ; `caseId === 'manual'` ou type M → `manual` ; un cas `alone` dont le combattant n'est pas `p.registrationId` → `split`), `detailsOf` réutilisé pour `details` (écart mesuré sur `applyAll(before, p)`). Dans `planMove`, `view: moveView(before, p)`. Dans la route GET, `proposals` = `shown` avec `view` ajouté à chaque proposition.

- [ ] **Step 4:** `npx vitest run tests/domain tests/server/replacement.test.ts` et `npm run typecheck` → passent.

- [ ] **Step 5: Commit** `feat(réaffectation): vue structurée des propositions (pourquoi, départ, arrivée)`

### Task 3: Présentation « Pourquoi · De ➜ Vers · pastilles » (web)

**Files:**
- Create: `src/web/components/replacement/keyDiff.ts`
- Create: `src/web/components/replacement/MoveBlocks.tsx`
- Create: `src/web/components/replacement/RulePills.tsx` (pastilles sorties de `PlanView.tsx` : `pillStyle`, `numberStyle`, couleur par bande)
- Modify: `src/web/components/replacement/PlanView.tsx` (`moveRow` utilise `MoveBlocks`)
- Modify: `src/web/pages/ReplacementPage.tsx` (`caseCard` : proposition non refusée rendue par `MoveBlocks` ; coche : nouveau texte)
- Modify: `src/web/help.ts` (texte de la coche, règle split)
- Test: `tests/web/key-diff.test.ts`, `tests/e2e/recasement.spec.ts`, `tests/e2e/plan-d-ensemble.spec.ts`

**Interfaces:**
- Consumes: `MoveView` (tâche 2).
- Produces:
  ```ts
  export interface KeyPart { text: string; changed: boolean }
  /** Morceaux du libellé de `key` (comme `categoryLabel` : discipline · règlement · tranches sexe · poids kg), `changed` = diffère de `other`. */
  export function keyParts(key: CategoryKey, other: CategoryKey | null, grid: CategoryGrid): KeyPart[];
  export function whyText(why: MoveWhy, sex: 'F' | 'M'): string;
  export function MoveBlocks(props: { view: MoveView; grid: CategoryGrid; rules: RulesView; costRule: RuleId | null; forced: boolean }): JSX.Element;
  export function RulePills(props: { details: MoveView['details']; rules: RulesView; costRule: RuleId | null }): JSX.Element;
  ```
  (`RulesView` = la liste des règles déjà chargée par la page ; `RulePills` calcule couleur et numéro comme `PlanView` aujourd'hui : `applyRulesView(defaultSettings(), rules)`, `costBand`, `ruleNumber`. `forced` : correction de pesée ou retour, pastille neutre.)

- [ ] **Step 1: Tests qui échouent** `tests/web/key-diff.test.ts` :
  - `keyParts(minimesF45, minimesF40)` → `[Karaté, Jiyu, Minimes F, -45 kg]` avec seulement `-45 kg` `changed` ; joint par « · », égal à `categoryLabel` ;
  - Benjamins M -40 vs Minimes M -50 : tranche et poids changés ;
  - `other = null` : rien de changé ;
  - `whyText` : les six textes exacts des Global Constraints, au masculin et au féminin.

- [ ] **Step 2:** `npx vitest run tests/web/key-diff.test.ts` → échec.

- [ ] **Step 3: Implémenter** `keyParts` / `whyText`, puis `MoveBlocks` (maquette A2 : étiquette POURQUOI + texte taille `sm` non grisé ; deux blocs `DE` / `VERS`, flèche accent, morceaux `changed` sur fond accent en gras, sous DE « N combattants → il en restera M », sous VERS « avec … » (au-delà de deux noms : « N adversaires ») + « écart X kg (max Y) » ou le texte « vide : … » en couleur d'attention ; blocs en `flex-wrap` : l'un sous l'autre sur écran étroit ; pastilles `RulePills`, pastille neutre « Correction de pesée · imposée » / « Retour · imposé » quand la proposition s'impose sans règle). Brancher dans la carte (avant les boutons Aperçu / Valider / Refuser ; badges pré-accord et session sous les pastilles) et dans `moveRow` du plan. Une proposition refusée garde sa ligne barrée courte.

- [ ] **Step 4:** `npx vitest run tests/web` → passe ; `npm run typecheck`.

- [ ] **Step 5: e2e.** Dans `recasement.spec.ts`, ajouter `test('carte : pourquoi, de et vers lisibles')` : une carte de pesée hors catégorie montre « POURQUOI », « DE », « VERS », le morceau de poids d'arrivée est marqué (`data-changed="true"`), et la pastille « Correction de pesée · imposée ». Adapter les sélecteurs existants qui lisaient la ligne `reason`. `npx playwright test tests/e2e/recasement.spec.ts tests/e2e/plan-d-ensemble.spec.ts tests/e2e/mise-en-page.spec.ts` → passe.

- [ ] **Step 6: Commit** `feat(réaffectation): cartes et plan lisibles (pourquoi, de ➜ vers, pastilles)`

### Task 4: Session de chaque action (serveur)

**Files:**
- Create: `drizzle/0025_session_des_actions.sql` (via `npm run db:generate`, puis vérifier)
- Modify: `src/server/db/schema.ts` (`wave_id` texte nullable sur `recasements`, `refusals`, `set_aside_cases`)
- Modify: `src/server/repositories/replacement.ts` (`persist` opts `waveId`, `withdrawRegistration`, `refuseProposal`, `setAsideCase`, `applyPlan`)
- Modify: `src/server/sync/package.ts` seulement si les colonnes y sont listées à la main
- Test: `tests/server/replacement.test.ts`, `tests/server/migration-0025.test.ts`

**Interfaces:**
- Produces: `function actionWave(before: State, caseId: string, registrationId: string): string | null` dans `replacement.ts` — session du combattant du cas (suffixe de `caseId`, sinon `registrationId`) dans `before`, via `memberWave`. Application du plan : `body.waveId ?? null`. Refus : session du cas de la proposition (`findProposal(...).caseId`). Mise de côté : session du combattant du cas.

- [ ] **Step 1: Tests qui échouent** : valider une carte enregistre `wave_id` = session de la carte ; split validé depuis la session du seul → `wave_id` de cette session même si le venu était ailleurs ; plan appliqué avec `waveId` ; refus et mise de côté portent la session ; `migration-0025.test.ts` (modèle : `migration-0024.test.ts`) : base d'avant (helper `tests/helpers/older-db.ts`), lignes gardées, `wave_id` nul.

- [ ] **Step 2:** `npx vitest run tests/server/replacement.test.ts tests/server/migration-0025.test.ts` → échec.

- [ ] **Step 3: Implémenter** (colonnes nullables, aucune réécriture des lignes anciennes : la session des lignes nulles se déduit à la remise à zéro, tâche 5).

- [ ] **Step 4:** `npx vitest run tests/server` → passe (sync, sauvegardes, révisions compris).

- [ ] **Step 5: Commit** `feat(réaffectation): chaque action garde la session d'où elle est décidée`

### Task 5: Remise à zéro par session (serveur)

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`resetPreview`, `resetReplacement`, `hasReplacementTrace` retirée ou réécrite)
- Modify: `src/server/routes/replacement.ts` (POST `/replacement/reset` body `{ waveId?: string }` strict ; GET `/replacement` : `reset` à la place de `resettable`)
- Test: `tests/server/replacement.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ResetPreview {
    undo: number;                                     // réaffectations annulées
    kept: { name: string; toLabel: string; why: 'frozen' | 'started' }[];
    blockedBy: string | null;                         // nom du combattant qui bloque (refus en entier)
    clears: number;                                   // refus + mises de côté effacés
    locked: boolean;                                  // session sélectionnée lancée
  }
  export async function resetPreview(db: AppDb, competitionId: string, waveId: string | null): Promise<ResetPreview>;
  export async function resetReplacement(db: AppDb, competitionId: string, waveId: string | null): Promise<{ undone: number; kept: ResetPreview['kept'] }>;
  ```
- Session d'une ligne : `wave_id`, sinon session de `snapshot.registration.categoryId` (catégorie actuelle si disparue) ; refus : session du combattant de la proposition ; mise de côté : session du combattant du cas. `waveId` nul (compétition sans sessions) : tout.

- [ ] **Step 1: Tests qui échouent** :
  - deux sessions, une validation dans chacune : remise à zéro de la première n'annule que la sienne ; historique, refus et mises de côté de l'autre gardés ;
  - combattant de la session A placé dans une catégorie de la session B lancée : gardé (`kept[0].why = 'frozen'`), le reste annulé ;
  - annulation qui toucherait une catégorie commencée : gardée (`'started'`) ; ses lignes plus anciennes du même combattant gardées aussi ;
  - combattant réaffecté depuis A puis de nouveau depuis B (plus récent, non annulé) : `blockedBy` = son nom, `resetReplacement` lève `StaleProposalError` avec ce nom, rien n'a changé ;
  - session sélectionnée lancée : `locked: true`, `resetReplacement` lève `CategoryLockedError` ;
  - ligne ancienne (`wave_id` nul) rangée par sa catégorie de départ ;
  - sans sessions : comportement d'avant.

- [ ] **Step 2:** `npx vitest run tests/server/replacement.test.ts` → échec.

- [ ] **Step 3: Implémenter.** Une seule fonction calcule le tri (à annuler / gardé / bloquant) pour `resetPreview` et `resetReplacement` ; l'annulation rejoue `restoreSnapshot` du plus récent au plus ancien dans une transaction, supprime les lignes annulées de l'historique, les refus et mises de côté de la session ; `recomputeKeys` sur les catégories touchées. Permissions inchangées (Table centrale autorisée).

- [ ] **Step 4:** `npx vitest run tests/server` → passe.

- [ ] **Step 5: Commit** `feat(réaffectation): repartir de zéro dans la session choisie seulement`

### Task 6: Bouton rouge et fenêtre de confirmation (web)

**Files:**
- Modify: `src/web/pages/ReplacementPage.tsx` (bouton, fenêtre)
- Modify: `src/web/api.ts` (`ReplacementData.reset: ResetPreview`, `useResetReplacement` body `{ waveId?: string }`)
- Modify: `src/web/usePlanChoices.ts` (`clearPlanChoices(competitionId, waveId)` : seulement la clé de cette session, et la coche de cette session)
- Modify: `src/web/help.ts` (`recasement.valides` : remise à zéro par session)
- Test: `tests/e2e/recasement.spec.ts`

- [ ] **Step 1: e2e qui échoue** `test('repartir de zéro : session choisie seulement, en rouge')` : deux sessions, une validation dans chacune ; le bouton s'appelle « Repartir de zéro (session <nom>) » et sa couleur calculée est rouge (`getComputedStyle(...).color` ou fond, comparé au rouge Mantine du thème) ; la fenêtre annonce « 1 réaffectation annulée » ; après confirmation, l'historique de l'autre session est toujours là. Adapter les deux tests existants (lignes ~148 et ~170) au nouveau texte.

- [ ] **Step 2:** `npx playwright test tests/e2e/recasement.spec.ts` → échec.

- [ ] **Step 3: Implémenter.** Bouton `color="red"` `variant="light"` (visible rouge en clair et en sombre ; vérifier à l'écran), grisé avec une phrase quand `reset.locked` (« La session est lancée : rouvrez-la pour repartir de zéro. ») ou rien à défaire (`undo + clears === 0`). Fenêtre : nombre annulé, liste `kept` (« NOM reste en <toLabel> : la session est lancée » / « : sa catégorie a commencé »), `blockedBy` en erreur avec le bouton de confirmation désactivé ; bouton de confirmation rouge « Tout annuler dans cette session » (sans sessions : « Tout annuler »). Envoi `{ waveId }`.

- [ ] **Step 4:** `npx playwright test tests/e2e/recasement.spec.ts tests/e2e/plan-d-ensemble.spec.ts` → passe.

- [ ] **Step 5: Commit** `feat(réaffectation): bouton « Repartir de zéro » rouge, limité à la session`

### Task 7: Documentation et vérification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (split, remise à zéro par session)
- Modify: `docs/superpowers/plans/2026-10-21-99-bilan.md` (étape 31 : choix et écarts)
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (ligne 31)

- [ ] **Step 1:** Mettre à jour les trois documents (écarts faits pendant la réalisation compris, notamment une éventuelle limite `SPLIT_CANDIDATES_PER_SOURCE`).
- [ ] **Step 2:** `npm run typecheck && npm test && npm run test:perf && npx playwright test` → tout passe.
- [ ] **Step 3:** Vérifier à l'écran (Claude in Chrome, base temporaire sur un autre port, jamais la base réelle) la démo : la carte de ROUSSEAU Tom propose GARNIER Sacha ; les cartes et le plan en De ➜ Vers ; le bouton rouge ; clair, sombre, largeur téléphone.
- [ ] **Step 4: Commit** `docs(réaffectation): bilan et feuille de route de l'étape 31`
