# Plan d'ensemble — calcul à part, progression, annulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le calcul du plan d'ensemble ne bloque plus le serveur (fil `worker_threads`), chaque ligne du diagramme a son propre budget (fin de l'« affamement » de la ligne de coupure), l'écran montre la progression et permet d'annuler.

**Architecture:** le domaine (`planLadder`) perd la limite commune et gagne un rappel de progression. Côté serveur, un module pur calcule la réponse du plan à partir de l'état chargé ; un fil de calcul l'exécute, un « runner » lance un fil par demande, relaie la progression et l'arrête sur annulation. La route du plan répond en NDJSON quand le client le demande (`Accept: application/x-ndjson`), en JSON sinon (contrat actuel inchangé). Le client lit le flux, affiche la progression, annule via `AbortSignal`.

**Tech Stack:** TypeScript 7 natif, Node 22 `worker_threads`, Fastify 5, React 19 + Mantine 8 + TanStack Query v5, Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-10-25-plan-d-ensemble-reaffectation-design.md` — §4.1 (dernière puce), §5.4 (limite par ligne), §5.5 (calcul à part).

## Global Constraints

- Aucune dépendance nouvelle (`worker_threads` est dans Node ; `tsx` est déjà en devDependencies).
- Même entrée → même plan, dans le fil comme hors du fil (le `hash` vérifié par `POST /replacement/plan/apply` doit rester valable).
- La limite reste un nombre de nœuds (`DEFAULT_NODE_BUDGET` par groupe), jamais un temps ; plus aucune limite commune à plusieurs lignes.
- Le fil de calcul n'importe ni la base ni Fastify : il reçoit un `State` (données simples, clonables) et rend la réponse.
- Interface en français, apostrophe typographique ’ dans les textes affichés ; couleurs par les jetons `--sk-*`.
- Textes exacts : « Calcul du plan… », « Calcul du plan : ligne {k} sur {n} », « Annuler le calcul », « Calcul annulé : le plan affiché ne tient pas compte de votre dernier changement. », « Relancer le calcul ».
- La barre de progression n'apparaît qu'après 500 ms de calcul.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte. Ne pas pousser, ne pas fusionner, ne pas reconstruire Docker.
- Vérifications : `npm run typecheck`, `npm test`, `npx playwright test` (e2e, serveur compilé dans `dist/`).

## Review Focus

- Un client qui annule (ou change de choix) pendant un calcul : le fil est arrêté, aucun résultat périmé n'arrive à l'écran, le serveur ne garde aucun fil.
- Un calcul lourd (500 inscriptions, toutes les règles) : `GET /api/health` répond pendant le calcul (le serveur n'est pas bloqué).
- Le plan affiché, puis le plan à appliquer, puis l'application : même `hash` qu'avant le passage au fil (pas de « Le plan a changé » sans raison).
- Fermeture du serveur (`app.close()`) pendant un calcul : le fil est arrêté, les tests ne restent pas pendus.
- Flux NDJSON coupé en morceaux arbitraires (ligne à cheval sur deux morceaux) : le client lit chaque ligne une fois, entière.

---

### Task 1: Domaine — un budget par ligne et la progression

**Files:**
- Modify: `src/domain/replacement/plan.ts` (`planLadder`, `SolveExtra`, `LADDER_NODE_BUDGET`)
- Modify: `src/domain/replacement/plan-groups.ts`, `src/domain/replacement/plan-search.ts` (retirer le paramètre `pool`)
- Test: `tests/domain/replacement/ladder.test.ts`

**Interfaces:**
- Produces: `planLadder(state: State, opts: { waveId: string | null; choices: PlanChoice[]; nodeBudget?: number }, onProgress?: (p: LadderProgress) => void): { rows: LadderRow[]; plan: PlanResult }` et `export interface LadderProgress { done: number; total: number; rows: LadderRow[] }` (exporté de `plan.ts`). `rows` = les lignes déjà connues, dans l'ordre (ligne de départ et lignes désactivées comprises). `total` = nombre de calculs (`solvePlan`) de la demande ; `onProgress` est appelé une fois après chacun, `done` de 1 à `total`.
- `LADDER_NODE_BUDGET` disparaît ; `nodeBudget` de `planLadder` est le budget **par groupe et par ligne** (défaut `DEFAULT_NODE_BUDGET`).

- [ ] **Step 1: Tests qui échouent** dans `ladder.test.ts` :
  - `la ligne de coupure n'est jamais moins bonne que le plan calculé seul` : pour `randomState(seed, 250)` avec `seed` ∈ {4, 6, 8} (réglages par défaut, coupure `discipline`), `planLadder(s, …).plan.aloneAfter.length` ≤ `computePlan(s, { waveId: null, level: s.settings.replacementRules.cutAfter, choices: [] }).aloneAfter.length` (ces graines donnaient 8 / 10 / 7 contre 6 / 9 / 5 avec la limite commune).
  - `la progression suit les calculs` : sur un état de 60 inscriptions toutes règles actives, les `done` reçus valent `1..total`, `total` = nombre de règles actives (+1 si la règle de coupure est désactivée et qu'aucune ligne active n'est au-dessus), et le dernier `rows` reçu égale `rows` rendu.
  - Remplacer les tests qui utilisent `LADDER_NODE_BUDGET` ou une limite commune (lignes 68-82 actuelles) : `nodeBudget: 0` rend toujours les rejeux, deux appels identiques donnent les mêmes lignes et le même `hash`.
- [ ] **Step 2: Vérifier l'échec** — `npx vitest run tests/domain/replacement/ladder.test.ts` : le premier test échoue sur au moins une graine.
- [ ] **Step 3: Implémenter.** Chaque `solvePlan` de `planLadder` a son propre budget, toujours amorcé par la ligne active au-dessus (`seed`). Si la règle de coupure est désactivée : le plan affiché est celui de la dernière ligne active au-dessus d'elle (même ensemble de règles permises, aucun calcul de plus) ; s'il n'y en a pas, un calcul de plus, compté dans `total`. Retirer `pool` de `solveGroups`/`GroupSolver` (plus aucun appelant).
- [ ] **Step 4: Performance.** Mesurer `planLadder` sur `randomState(42, 500)` et `randomState(42, 150)` (meilleur de 3). Test existant à 500 : borne = max(3000, 2 × mesure arrondie au millier supérieur) ms, mesure notée dans le rapport. Nouveau test à 150 : < 2000 ms (meilleur de 3). Si 150 dépasse 2 s, statut DONE_WITH_CONCERNS avec la mesure.
- [ ] **Step 5: Vérifier** — `npm run typecheck` et `npx vitest run tests/domain/replacement` passent.
- [ ] **Step 6: Commit** — `fix(reaffectation): un budget de recherche par ligne du diagramme, et sa progression`

### Task 2: Serveur — le fil de calcul, l'annulation et le flux de progression

**Files:**
- Create: `src/server/plan/compute.ts` (pur : réponse du plan à partir d'un `State`)
- Create: `src/server/plan/worker.ts` (point d'entrée du fil)
- Create: `src/server/plan/runner.ts` (lance, relaie, arrête)
- Modify: `src/server/repositories/replacement.ts` (`planResponse`, `applyPlan` passent par le runner ; `previewTransition`, `displayedProposals` déplacés dans un module pur s'ils tirent la base dans le fil), `src/server/routes/replacement.ts`, `src/server/app.ts` (arrêt des fils à la fermeture)
- Test: `tests/server/plan-runner.test.ts`

**Interfaces:**
- Consumes: `planLadder(…, onProgress)`, `LadderProgress` (Task 1) ; `computePlan` (forApply).
- Produces:
  - `planPayload(state: State, input: { waveId: string | null; choices: PlanChoice[]; forApply: boolean }, onProgress?: (p: LadderProgress) => void): PlanResponse` dans `compute.ts` — le corps actuel de `planResponse` sans les accès à la base ; pour `forApply`, `total` = 1.
  - `runPlanJob(state: State, input: …même type…, opts?: { signal?: AbortSignal; onProgress?: (p: LadderProgress) => void }): Promise<PlanResponse>` et `class PlanAbortedError extends Error`, `activePlanJobs(): number`, `stopAllPlanJobs(): Promise<void>` dans `runner.ts`.
  - Un fil par demande : `new Worker(new URL('./worker.<ext>', import.meta.url))`, `<ext>` = extension du module courant ; si `.ts` (vitest, `tsx watch`), `execArgv: [...process.execArgv, '--import', 'tsx']` (à vérifier : si `tsx watch` le donne déjà, ne pas le doubler). `signal` annulé → `worker.terminate()`, rejet `PlanAbortedError`. Erreur du fil → rejet avec le message.
  - Pour appliquer (`applyPlan`), le recalcul `computePlan(forApply)` passe aussi par le fil (sans progression) ; rien n'est écrit avant son résultat.
  - `POST /api/competitions/:id/replacement/plan` : si l'en-tête `Accept` contient `application/x-ndjson`, réponse `200` `application/x-ndjson`, une ligne JSON par événement : `{"type":"progress","done":k,"total":n,"rows":[…]}` puis `{"type":"result","data":<PlanResponse>}`, ou `{"type":"error","status":<code>,"error":"<message>"}` si le calcul échoue après l'envoi des en-têtes. Les erreurs d'avant le calcul (400, 404, droits) restent des réponses JSON ordinaires. Sans cet en-tête : JSON comme aujourd'hui. Client déconnecté avant la fin → annulation du fil.
  - `app.close()` appelle `stopAllPlanJobs()` (hook `onClose`).

- [ ] **Step 1: Tests qui échouent** dans `tests/server/plan-runner.test.ts` :
  - `même résultat dans le fil que hors du fil` : sur `randomState(3, 60)`, `await runPlanJob(s, input)` `toEqual` `planPayload(s, input)` (y compris `plan.hash` et `fingerprint`), pour `forApply` faux et vrai.
  - `la progression arrive dans l'ordre` : `done` strictement croissant jusqu'à `total`, dernier `rows` = `result.rows`.
  - `annuler arrête le fil` : `randomState(42, 500)` toutes règles actives ; abort au premier événement de progression → rejet `PlanAbortedError` ; peu après, `activePlanJobs() === 0`.
  - `le serveur répond pendant un calcul lourd` : app de test, `POST …/replacement/plan` lourd lancé sans attendre, puis `GET /api/health` répond en moins de 200 ms avant la fin du calcul.
  - `flux NDJSON` : `inject` avec `accept: 'application/x-ndjson'` ; chaque ligne est un JSON ; la dernière est `result` et son `data` égale la réponse JSON de la même demande.
  - Les tests existants de `tests/server/replacement.test.ts` et `plan-apply-anchor.test.ts` passent sans changement.
- [ ] **Step 2: Vérifier l'échec** — `npx vitest run tests/server/plan-runner.test.ts`.
- [ ] **Step 3: Implémenter** `compute.ts`, `worker.ts`, `runner.ts`, la route et le branchement de `applyPlan`. Le fil ne doit pas importer `src/server/db` ni Fastify (vérifier les imports de `compute.ts`).
- [ ] **Step 4: Vérifier** — `npm run typecheck`, `npm test`, puis `npm run build && node -e "…"` ou e2e existant : `dist/server/plan/worker.js` existe et le plan s'affiche (`npx playwright test tests/e2e/plan-d-ensemble.spec.ts`).
- [ ] **Step 5: Commit** — `feat(reaffectation): le plan se calcule dans un fil à part, annulable, avec sa progression`

### Task 3: Écran — progression, « Annuler le calcul », « Relancer le calcul »

**Files:**
- Create: `src/web/planStream.ts`
- Create: `src/web/components/replacement/PlanProgress.tsx`
- Modify: `src/web/api.ts` (`usePlan`, `usePlanForApply`), `src/web/pages/ReplacementPage.tsx`, `src/web/components/replacement/RuleLadder.tsx`, `src/web/components/replacement/PlanView.tsx` (si « Appliquer le plan » y vit), `src/web/help.ts`
- Test: `tests/web/plan-stream.test.ts`, `tests/e2e/plan-d-ensemble.spec.ts`

**Interfaces:**
- Consumes: le flux NDJSON de Task 2 ; `LadderProgress`, `PlanResponse`.
- Produces:
  - `ndjsonLines(): { push(chunk: string): unknown[]; end(): unknown[] }` — découpe en lignes JSON, une ligne à cheval sur deux morceaux n'est rendue qu'une fois entière.
  - `fetchPlanStream(url: string, body: unknown, opts: { signal?: AbortSignal; onProgress?: (p: LadderProgress) => void }): Promise<PlanResponse>` — mêmes en-têtes que `api()` (dont `X-Poste-Id`) plus `Accept: application/x-ndjson` ; réponse non OK → `ApiError` comme `api()` ; ligne `error` → `ApiError(status, error)` ; flux fini sans `result` → `ApiError(500, …)`.
  - `usePlan(id, waveId, choices, enabled)` rend en plus `progress: LadderProgress | null` (remis à `null` à chaque nouveau calcul), `cancelled: boolean`, `cancel(): void` (`queryClient.cancelQueries` sur la clé, `cancelled = true`) et `restart(): void` (`refetch`, `cancelled = false`). Le `signal` de TanStack Query est passé à `fetchPlanStream` : changer de choix annule le calcul précédent.
  - `usePlanForApply` passe par `fetchPlanStream` ; fermer la confirmation annule sa demande.

- [ ] **Step 1: Tests qui échouent** — `tests/web/plan-stream.test.ts` : deux lignes dans un morceau ; une ligne coupée en trois morceaux ; ligne vide ignorée ; reste sans saut de ligne rendu par `end()`. Dans `plan-d-ensemble.spec.ts`, test `annuler un calcul long` : plan affiché ; `page.route('**/replacement/plan', …)` retarde la demande de 2 s (en `try/catch` : la demande peut être annulée) ; un geste (activer/désactiver une règle) ; « Annuler le calcul » apparaît ; clic ; « Calcul annulé : le plan affiché ne tient pas compte de votre dernier changement. » visible et « Appliquer le plan » désactivé ; `page.unroute`, clic « Relancer le calcul » ; le message disparaît et « Appliquer le plan » redevient actif.
- [ ] **Step 2: Vérifier l'échec** — `npx vitest run tests/web/plan-stream.test.ts`.
- [ ] **Step 3: Implémenter.** `PlanProgress` : après 500 ms de calcul, `Progress` Mantine (valeur `done / total`), texte « Calcul du plan… » avant le premier événement puis « Calcul du plan : ligne {k} sur {n} », bouton « Annuler le calcul ». Le diagramme montre les `progress.rows` reçues à la place des lignes correspondantes du résultat précédent ; le reste du diagramme et le plan précédents sont grisés pendant le calcul. « Appliquer le plan » est désactivé pendant le calcul et après une annulation. Annulé : `Alert` avec le message exact et le bouton « Relancer le calcul » (sans plan précédent : même message et même bouton). Aide (`help.ts`) : une phrase sur la progression et l'annulation.
- [ ] **Step 4: Vérifier** — `npm run typecheck`, `npm test`, `npx playwright test` (toute la suite).
- [ ] **Step 5: Commit** — `feat(reaffectation): progression du calcul du plan, « Annuler le calcul » et « Relancer le calcul »`
