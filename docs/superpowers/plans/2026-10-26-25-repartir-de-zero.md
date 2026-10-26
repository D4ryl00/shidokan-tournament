# Réaffectation — « Repartir de zéro » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un geste remet la Réaffectation d'une compétition dans l'état où elle était avant toute réaffectation : placements d'origine rétablis, refus, cartes mises de côté et historique effacés.

**Architecture:** l'annulation unitaire (`undoRecasement`) est découpée : la restauration d'un instantané devient une fonction partagée, appelée par l'annulation et par la remise à zéro. La remise à zéro rejoue les instantanés de toutes les réaffectations validées, de la plus récente à la plus ancienne, dans une seule transaction, puis vide `recasements`, `refusals` et `set_aside_cases` de la compétition. Un bouton dans la carte « Réaffectations validées » l'appelle après confirmation.

**Tech Stack:** TypeScript 7 natif, Fastify 5, Drizzle + better-sqlite3, React 19 + Mantine 8 + TanStack Query v5, Vitest, Playwright (Chrome).

**Spec:** décisions prises avec l'organisateur le 2026-10-26 (consignées dans `docs/superpowers/specs/2026-10-25-plan-d-ensemble-reaffectation-design.md` §6 par la Task 3) :
- Tout ou rien : refusé en bloc si une catégorie touchée a commencé, est terminée ou si sa session est lancée.
- L'historique est **effacé** (pas marqué « annulée »).
- Permis à l'Organisation **et à la Table centrale**.
- Les règles de réaffectation (réglages) ne changent pas.
- Une correction des valeurs d'origine arrivée après une réaffectation (export FFK, fiche club) est gardée (sinon l'annulation la perd — défaut actuel de l'annulation unitaire, corrigé en Task 1).

## Global Constraints

- Aucune dépendance nouvelle, aucune migration (tables existantes).
- Interface en français, apostrophe typographique ’ dans les textes affichés ; couleurs par les jetons `--sk-*`.
- Textes exacts : bouton « Repartir de zéro » ; titre de la confirmation « Repartir de zéro ? » ; corps « Toutes les réaffectations validées sont annulées, chaque combattant retrouve sa catégorie d’origine. Les refus, les cartes mises de côté et l’historique sont effacés. Les règles ne changent pas. » ; bouton de confirmation « Tout annuler » ; refus serveur « Une catégorie concernée a déjà commencé ou sa session est lancée : rouvrez-la pour repartir de zéro. »
- Route : `POST /api/competitions/:id/replacement/reset`, corps vide, réponse `{ ok: true, undone: number }`.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (les tests utilisent `tmpDbPath()`). Ne pas pousser, ne pas fusionner, ne pas reconstruire Docker.
- Vérifications : `npm run typecheck`, `npm test`, `npx playwright test`.

## Review Focus

- Un combattant réaffecté deux fois (déplacé puis redéplacé), puis remise à zéro : il revient à sa toute première catégorie, pas à l'intermédiaire.
- Une réaffectation qui a fait changer de session : la présence d'avant est rétablie (pas « non pesé »).
- Une réaffectation dont l'inscription a été supprimée depuis : la remise à zéro passe outre (ligne effacée), sans 404.
- Une catégorie créée par un déplacement (nouvelle clé) ou fusionnée : après la remise à zéro, plus de catégorie vide restante ni de clé élargie ; la liste des catégories égale celle d'avant toute réaffectation.
- Une catégorie touchée dont la session est lancée : 409, et **rien** n'a changé (historique, refus et placements intacts).

---

### Task 1: Restauration partagée, et les corrections d'origine gardées

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`undoRecasement`, ~l. 397-450)
- Test: `tests/server/replacement.test.ts`

**Interfaces:**
- Produces (non exportés, dans `replacement.ts`) :
  - `type RecasementSnapshot` — le type de l'instantané aujourd'hui écrit en ligne dans `undoRecasement`.
  - `restoreSnapshot(t: AppDb, registrationId: string, snapshot: RecasementSnapshot): void` — les écritures de la transaction actuelle de `undoRecasement` (catégories de l'instantané, inscription, présences), sans le changement de statut de la ligne.
  - `snapshotTouches(currentCategoryId: string | null, snapshot: RecasementSnapshot): string[]` — ids des catégories touchées (catégorie actuelle, catégorie de l'instantané, catégories de l'instantané).
- Règle des valeurs d'origine, dans `restoreSnapshot`, seulement si l'instantané porte `originalJson` (absent pour un « Ne combat pas ») et que l'inscription a un `originalJson` actuel :
  - instantané `originalJson === null` (cette réaffectation a créé l'origine) → `discipline`, `ruleset`, `weightClassId` pris dans l'`originalJson` actuel, pas dans l'instantané ;
  - instantané `originalJson !== null` → `originalJson` actuel gardé (pas celui de l'instantané).

- [ ] **Step 1: Tests qui échouent** dans `tests/server/replacement.test.ts` (nouveau `describe('annulation et valeurs d’origine')`). Pour simuler la correction FFK, ouvrir la base de test (`new Database(dbPath)`) et réécrire `original_json` de l'inscription comme le fait `ffk-import.ts:232` (fusion de `{ weightClassId }`), puis fermer.
  - `une correction d’origine arrivée après la réaffectation survit à l’annulation` : inscription `cadet:F:-54` seule, déplacement manuel (`/replacement/move`) vers une autre catégorie ; correction d'origine `weightClassId: 'cadet:F:-59'` ; `/replacement/undo` → l'inscription (`GET /registrations`) a `weightClassId === 'cadet:F:-59'`, `recasementType === null`.
  - `deux réaffectations puis une correction : l’annulation des deux garde la correction` : deux déplacements manuels successifs, correction, annulation de la plus récente puis de l'autre → `weightClassId === 'cadet:F:-59'`.
- [ ] **Step 2: Vérifier l'échec** — `npx vitest run tests/server/replacement.test.ts -t "valeurs d’origine"` : les deux échouent (`cadet:F:-54`).
- [ ] **Step 3: Implémenter** `RecasementSnapshot`, `restoreSnapshot`, `snapshotTouches` et réécrire `undoRecasement` avec eux (mêmes refus, même ordre, même `recomputeKeys` après).
- [ ] **Step 4: Vérifier** — `npm run typecheck` ; `npx vitest run tests/server tests/domain/replacement` passent (dont les tests d'annulation existants).
- [ ] **Step 5: Commit** — `fix(reaffectation): l’annulation garde les corrections des valeurs d’origine (export FFK, fiche club)`

### Task 2: Serveur — remise à zéro tout ou rien

**Files:**
- Modify: `src/server/repositories/replacement.ts`, `src/server/routes/replacement.ts`, `src/server/auth/permissions.ts` (`TABLE_WRITES`)
- Test: `tests/server/replacement.test.ts`, `tests/server/permissions.test.ts`

**Interfaces:**
- Consumes: `restoreSnapshot`, `snapshotTouches`, `RecasementSnapshot` (Task 1) ; `recomputeKeys`, `loadState`, `CategoryLockedError`.
- Produces: `export async function resetReplacement(db: AppDb, competitionId: string): Promise<{ undone: number }>` ; route `POST /api/competitions/:id/replacement/reset` → `{ ok: true, undone }` ; `'POST /replacement/reset'` dans `TABLE_WRITES`.
- Déroulé : lignes de `recasements` de la compétition triées par `rowid` décroissant ; seules les `validated` dont l'inscription existe sont rejouées. Avant toute écriture, l'union des `snapshotTouches` de ces lignes est vérifiée : une catégorie `started`/`finished` ou figée (`loadState(...).categories[].frozen`) → `CategoryLockedError` avec le texte exact des Global Constraints. Puis une transaction : `restoreSnapshot` pour chaque ligne dans l'ordre, puis suppression de toutes les lignes `recasements`, `refusals`, `set_aside_cases` de la compétition. Ensuite `recomputeKeys` sur l'union des catégories touchées. `undone` = nombre de lignes rejouées.

- [ ] **Step 1: Tests qui échouent** (nouveau `describe('repartir de zéro')`) :
  - `rétablit les catégories d’avant toute réaffectation et efface l’historique` : quelques inscriptions seules ; relever `GET /categories` (libellés et membres) ; appliquer le plan d'ensemble (`applyPlan()`) + un déplacement manuel + un refus (`/replacement/refuse`) + une carte mise de côté (`/replacement/set-aside`) ; `POST /replacement/reset` → 200, `undone` = nombre de lignes validées ; `GET /categories` égale le relevé initial (libellés et membres) ; `replacement()` : `recasements` vide, aucune proposition `refused`, aucune carte mise de côté ; chaque inscription a `recasementType === null`.
  - `un combattant réaffecté deux fois revient à sa première catégorie`.
  - `présence rétablie après un changement de session` : reprendre le montage du test de `describe('réaffectation par session')` qui fait changer de session ; présence « présent » avant ; reset → « présent ».
  - `« Ne combat pas » levé` : montage `closeCadet()` + `withdraw()` ; reset → l'inscription a `withdrawnReason === null` et une catégorie.
  - `inscription supprimée depuis : passée outre` : déplacement manuel puis `DELETE /registrations/:rid` ; reset → 200, historique vide.
  - `session lancée : 409 et rien ne change` : réaffectation dans une session, puis `POST /launch` de cette session ; reset → 409 avec le texte exact ; `recasements`, refus et placements inchangés.
  - `permissions.test.ts` : la Table centrale a `POST …/replacement/reset` ; une Zone non.
- [ ] **Step 2: Vérifier l'échec** — `npx vitest run tests/server/replacement.test.ts -t "repartir de zéro"` : 404 sur la route.
- [ ] **Step 3: Implémenter** `resetReplacement`, la route, l'entrée de `TABLE_WRITES`.
- [ ] **Step 4: Vérifier** — `npm run typecheck`, `npm test`.
- [ ] **Step 5: Commit** — `feat(reaffectation): repartir de zéro (tout annuler, refus, cartes de côté et historique effacés)`

### Task 3: Écran, aide, spec et bilan

**Files:**
- Modify: `src/web/api.ts`, `src/web/pages/ReplacementPage.tsx`, `src/web/usePlanChoices.ts`, `src/web/help.ts`
- Modify: `docs/superpowers/specs/2026-10-25-plan-d-ensemble-reaffectation-design.md` (§6), `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`
- Test: `tests/e2e/recasement.spec.ts` (nouveau test), `tests/web/` si `clearPlanChoices` est testable seul

**Interfaces:**
- Consumes: la route de Task 2.
- Produces: `useResetReplacement(id: string)` dans `api.ts` (même famille que `useReplacementAction`, chemin `reset`, corps `{}`) ; `clearPlanChoices(competitionId: string): void` dans `usePlanChoices.ts` (retire toutes les clés `plan-choices:<id>:*` du `sessionStorage`, en `try/catch`).

- [ ] **Step 1: Test e2e qui échoue** — `repartir de zéro remet la réaffectation à l’état d’avant` : pesée + plan appliqué (reprendre le montage du test existant) ; l'historique a des lignes ; clic « Repartir de zéro » ; la confirmation montre le texte exact ; « Tout annuler » ; l'historique affiche « Aucune pour l’instant. » ; le bouton « Repartir de zéro » n'est plus là ; les cartes de cas sont revenues.
- [ ] **Step 2: Vérifier l'échec** — `npx playwright test tests/e2e/recasement.spec.ts -g "repartir de zéro"`.
- [ ] **Step 3: Implémenter.** Bouton « Repartir de zéro » (`variant="subtle" color="red"`, `data-testid="replacement-reset"`) dans `actions` de la carte « Réaffectations validées », visible dès qu'il y a une ligne d'historique, un refus ou une carte mise de côté. Nouveau `dialog` `{ kind: 'reset' }` : `Modal` avec le titre, le corps et le bouton exacts ; à la réussite, `clearPlanChoices(id)` puis remise à zéro des choix de la session affichée (`setChoices([])`) ; l'erreur 409 s'affiche comme les autres refus de l'écran. Aide `recasement.valides` : une phrase « Repartir de zéro annule tout d’un coup et efface l’historique (impossible si une catégorie concernée a commencé ou si sa session est lancée). »
- [ ] **Step 4: Documents.** Spec §6 : une puce « ✅ (2026-10-26) **Repartir de zéro** » reprenant les décisions de l'en-tête de ce plan. Bilan : section « Repartir de zéro » (décisions, correction des valeurs d'origine à l'annulation). Feuille de route : ligne 25.
- [ ] **Step 5: Vérifier** — `npm run typecheck`, `npm test`, `npx playwright test` (toute la suite).
- [ ] **Step 6: Commit** — `feat(reaffectation): bouton « Repartir de zéro » sur l’écran de réaffectation`
