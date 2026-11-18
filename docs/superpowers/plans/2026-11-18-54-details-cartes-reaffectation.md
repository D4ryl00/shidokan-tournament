# Détails des cartes de Réaffectation et « Copier pour le club » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sur chaque proposition de Réaffectation (cartes ② et lignes du plan ①), un dépliant « Détails » montre les catégories De et Vers exactes (combattants avec fiche au clic, ou tableau), et un bouton « 📋 Copier pour le club » copie la ligne à envoyer au club — avant la compétition du 22 novembre.

**Architecture:** une route serveur en lecture (`POST …/replacement/details/preview`) joue le déplacement à blanc (`dryRun`) — pour une ligne du plan, rejoue le plan affiché jusqu'à elle avec l'écriture d'`applyPlan` — et rend les deux catégories (`Category`, celles de `GET …/categories`) avant/après. La graine d'une catégorie créée devient déterministe, pour que le tirage à blanc soit celui de l'application. Côté écran, un composant `MoveDetails` partagé par ① et ②, une fiche combattant tirée des données déjà chargées, et le texte du presse-papiers calculé par une fonction pure.

**Tech Stack:** TypeScript, Fastify, drizzle + better-sqlite3, React + Mantine, @tanstack/react-query, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-details-cartes-reaffectation-design.md` (maquette validée `.superpowers/brainstorm/15002-1794961656/content/details-b-v3.html`). Base : `main` 2cc80d8.

## Global Constraints

- Textes en français, apostrophe typographique `’`, pluriels par `src/domain/plural.ts`, accords au genre (« part », « arrive », « lui/elle »).
- Couleurs : uniquement les variables `--sk-*` existantes (thème clair et sombre).
- Écran étroit : colonnes De/Vers l'une sous l'autre, aucun débordement horizontal.
- Détails fermés = aucune requête, aucun calcul.
- La fiche combattant n'a **aucune** coordonnée de club (ni coach, ni téléphone, ni e-mail, ni pré-accord) ; seul le nom du club, à côté du nom.
- Jamais deux fois la même liste dans une colonne : « Combattants » **ou** « Tableau » (`SegmentedControl`), ouvert sur « Combattants ».
- La route nouvelle se termine par `/preview` : elle échappe ainsi à l'événement « change » de `src/server/events.ts:110` (sinon les postes se relancent en boucle).
- Jamais la base vivante `data/shidokan.sqlite` depuis l'hôte (API ou sauvegardes seulement).
- Chaque changement visible vérifié dans Chrome (extension Claude in Chrome) ; l'écran étroit dans le simulateur iOS (idb).

## Review Focus

- Ligne du plan qui dépend d'une ligne précédente (la catégorie d'arrivée reçoit déjà quelqu'un plus haut dans le plan) → Vers montre les deux arrivants, comme après « Appliquer le plan ». Test : Task 3.
- Déplacement vers une catégorie qui n'existe pas encore (`newKey` / `new:…`) → Vers a un tableau, identique à celui qu'écrit l'application réelle. Test : Task 1 et Task 3.
- L'état change pendant que le dépliant est ouvert (pesée sur un autre poste) → nouvelle requête (clé `fingerprint`), jamais d'ancien tableau gardé ; plan au `hash` périmé → 409 « Le plan a changé… » affiché dans la colonne, pas d'erreur 500. Test : Task 3.
- Split (deux combattants amenés pour donner une poule) → deux lignes copiées, chacune avec le club et le détail d'âge de son combattant. Test : Task 2 et Task 4.
- Le presse-papiers refusé par le navigateur (HTTP, permission) → notification d'erreur contenant le texte. Test : Task 6.

---

### Task 1: Graine déterministe d'une catégorie créée

**Files:**
- Create: `src/server/repositories/category-seed.ts`
- Modify: `src/server/repositories/replacement.ts:193` (création dans `persist`), `src/server/repositories/categories.ts:201` (création dans `syncCategories`)
- Test: `tests/server/category-seed.test.ts`

**Interfaces:**
- Produces: `categorySeed(competitionId: string, keyString: string): number` — entier non signé 32 bits (FNV-1a sur `${competitionId}|${keyString}`), jamais 0 n'est requis.

- [ ] **Step 1: Write the failing test** — `tests/server/category-seed.test.ts` :
  - `categorySeed('c1', 'k')` === `categorySeed('c1', 'k')` ; ≠ `categorySeed('c1', 'k2')` ; ≠ `categorySeed('c2', 'k')` ; `Number.isInteger` et `0 <= x < 2**32`.
  - Intégration (modèle : `tests/server/plan-apply-anchor.test.ts`, mêmes `reg()` et pesée) : appliquer la proposition vers une catégorie vide (`'newKey' in p.target`) par `POST /replacement/apply` ; la catégorie créée (lue par `GET /categories`, la seule contenant l'inscription) a `seed === categorySeed(competitionId, keyString)` (lire `keyString` via la clé : `keyString(category.key)` de `src/domain/categories.ts`).
  - « Nouveau tirage » (`POST /categories/:cid/redraw`) donne toujours une graine différente de l'ancienne.
- [ ] **Step 2: Run** `npx vitest run tests/server/category-seed.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `categorySeed` et l'utiliser aux deux créations ; `newSeed()` reste pour `redraw` (`categories.ts:456`) ; `free-tableaux.ts` inchangé.
- [ ] **Step 4: Run** `npx vitest run tests/server` — Expected: PASS (aucun test existant ne dépend d'une graine au hasard ; s'il en casse un, il supposait le hasard : l'adapter en le disant dans le commit).
- [ ] **Step 5: Commit** `feat(reaffectation): graine déterministe d'une catégorie créée (tirage à blanc = tirage réel)`

### Task 2: Détails par combattant déplacé (`MoveView.movers`)

**Files:**
- Modify: `src/domain/replacement/view.ts` (`MoveView`, `moveView`)
- Test: `tests/domain/replacement/view.test.ts`

**Interfaces:**
- Produces: `MoveView.movers: { registrationId: string; details: MoveView['details'] }[]` — un élément par déplacement de `proposalMoves(p)`, dans cet ordre ; `details` = `detailsOf(before, { ...p, registrationId }, p.rules, gapKg, max)` (même écart que `view.details`), donc le détail d'âge part de la tranche de **ce** combattant.

- [ ] **Step 1: Write the failing test** — avec les fixtures de `tests/domain/replacement/fixtures.ts` : une proposition simple → `movers` = `[{ registrationId: p.registrationId, details: view.details }]` ; un split dont les deux combattants amenés sont de tranches différentes (ou, à défaut, un `Proposal` construit à la main avec `alsoMoved` et la règle `ageUp`) → deux `movers`, le détail `ageUp` de chacun commence par sa propre tranche (`'Cadets → …'` / `'Minimes → …'`).
- [ ] **Step 2: Run** `npx vitest run tests/domain/replacement/view.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** le champ dans `moveView` (le plan l'obtient aussi : `PlanMove.view` vient de `moveView`).
- [ ] **Step 4: Run** `npx vitest run tests/domain && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(reaffectation): détail des règles pour chaque combattant déplacé`

### Task 3: Route « De et Vers » à blanc

**Files:**
- Create: `src/server/plan/displayed.ts` (mémoire des plans affichés), `src/server/repositories/move-details.ts`, `src/domain/replacement/move-details.ts` (type partagé)
- Modify: `src/server/repositories/replacement.ts` (`applyPlan` : corps de boucle extrait ; `planResponse` : mémorise), `src/server/routes/replacement.ts` (route ; flux NDJSON : mémorise le résultat), `src/server/journal/coverage.ts` (`JOURNAL_EXEMPT`), `src/server/auth/permissions.ts:25` (même liste que `POST /replacement/preview`)
- Test: `tests/server/move-details.test.ts`

**Interfaces:**
- Produces (domaine, `src/domain/replacement/move-details.ts`, importé par le serveur et par `src/web/api.ts`) : `interface MoveDetails { from: Category | null; to: Category; movers: string[] }` (`Category` de `src/domain/categories.ts`, comme `GET /categories`) et `type MoveDetailsBody` (ci-dessous).
- Produces (serveur) :
  - `writePlanMove(db: AppDb, competitionId: string, move: PlanMove, opts: { groupId: string; waveId: string | null }): Promise<void>` — exactement le corps de boucle actuel d'`applyPlan` (rechargement, contrôle d'origine, `new:…` par l'ancre, `recorded` + `persistAll`). `applyPlan` l'appelle.
  - `rememberDisplayedPlan(competitionId: string, r: PlanResponse): void` / `recallDisplayedPlan(competitionId: string, fingerprint: string, hash: string): PlanMove[] | undefined` — 20 entrées au plus (les plus anciennes sortent).
  - `moveDetails(db: AppDb, competitionId: string, body: MoveDetailsBody): Promise<MoveDetails>`, où `type MoveDetailsBody = { proposalId: string } | { plan: { waveId?: string; choices: PlanChoice[]; cardDecisions?: boolean; fingerprint: string; hash: string }; moveId: string }`.
  - Route `POST /api/competitions/:id/replacement/details/preview` (zod `.strict()`, même schéma `choices` que `/replacement/plan`).

Algorithme de `moveDetails` (tout dans un seul `dryRun`, `src/server/db/atomic.ts`) :
- **Carte** : `state = loadState` ; `p = findProposal(state, proposalId)` ; `before = listCategories` ; `persistAll(db, id, state, p, { bulk: false, waveId: actionWave(...) })` ; `loadState` (resynchronise) ; `after = listCategories`.
- **Plan** : `planWave` ; `loadState` ; empreinte ≠ `fingerprint` → `StaleProposalError()` ; `moves = recallDisplayedPlan(...) ?? (await runPlanJob(state, { waveId, choices, forApply: false, cardDecisions })).plan.moves` (après recalcul, `hash` ≠ → `StaleProposalError('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.')`) ; `k = moves.findIndex(m => m.id === moveId)` (−1 → même erreur) ; `writePlanMove` pour `moves[0..k-1]` ; `before = listCategories` ; `writePlanMove(moves[k])` ; `after = listCategories`.
- `from` = catégorie de `before` qui contient `registrationId` (null si aucune) ; `to` = catégorie de `after` qui le contient ; `movers` = `[registrationId, ...alsoMoved]`.
- `runPlanJob` se fait **avant** d'ouvrir le `dryRun` (pas d'attente de fil sous verrou).

- [ ] **Step 1: Write the failing tests** — `tests/server/move-details.test.ts` (préambule de `plan-apply-anchor.test.ts`, `runPlanJob` remplacé par `planPayload` dans le fil) :
  - `carte : De = catégorie actuelle, Vers = celle d'après, rien n'est écrit` : `from.registrationIds` contient le combattant ; `to.registrationIds` aussi, `to.bracket` non nul ; `GET /categories` et `GET /history` identiques avant/après l'appel.
  - `carte vers une catégorie vide : Vers a le tableau qu'écrit l'application` : `to.bracket` de la réponse `toEqual` le `bracket` de la catégorie après `POST /replacement/apply` de la même proposition.
  - `plan : la ligne k voit les lignes précédentes` : un plan d'au moins deux lignes vers la même catégorie (ou `new:…` puis son ancre, comme `plan-apply-anchor`) ; la réponse pour la 2e ligne a `to.registrationIds` ⊇ les deux arrivants ; `to.bracket` `toEqual` celui écrit par `POST /replacement/plan/apply` quand ces lignes sont les seules appliquées (choix `validate` des deux).
  - `plan périmé : 409` : `hash` faux → 409 avec le message ci-dessus ; empreinte fausse → 409.
  - `pas d'événement « change »` : la route ne déclenche pas `competitionChanged` (modèle : `tests/server/events.test.ts`).
  - `journal-coverage.test.ts` et `permissions.test.ts` passent avec la route déclarée.
- [ ] **Step 2: Run** `npx vitest run tests/server/move-details.test.ts` — Expected: FAIL (404).
- [ ] **Step 3: Implement** l'extraction `writePlanMove` (sans changer `applyPlan` autrement), puis `displayed.ts`, `moveDetails`, la route, les deux listes. Mémoriser le plan affiché dans `planResponse` (si `!forApply`) et dans le `.then` du flux NDJSON (si `!input.forApply`).
- [ ] **Step 4: Run** `npx vitest run tests/server` — Expected: PASS (dont `plan-apply-anchor`, `replacement`, `journal-coverage`, `permissions`). Mesurer la durée de la route sur le plus gros plan des tests (`tests/perf` si un jeu s'y prête) ; noter le chiffre dans le commit, signaler s'il dépasse ~1 s.
- [ ] **Step 5: Commit** `feat(reaffectation): De et Vers d’un déplacement calculés à blanc (carte ou ligne du plan rejouée)`

### Task 4: Texte « Copier pour le club »

**Files:**
- Create: `src/web/components/replacement/clubText.ts`
- Test: `tests/web/club-text.test.ts`

**Interfaces:**
- Consumes: `MoveView.movers` (Task 2), `RULE_LABELS`, `categoryLabel`, `whyText` (`keyDiff.ts`).
- Produces: `clubRequestText(view: MoveView, grid: CategoryGrid, person: (registrationId: string) => { firstName: string; lastName: string; club: string | null }): string` — une ligne par élément de `view.movers`, jointes par `\n`.

- [ ] **Step 1: Write the failing test** — valeurs de la spec :
  - un mover, règle `ageUp` détail `'Cadets → Juniors'`, De `Combat · Jiyu · Cadets M · -60 kg`, Vers `Combat · Jiyu · Juniors M · -60 kg` → `'Lucas MARTIN - Karaté Club Rennes - Combat · Jiyu · Cadets M · -60 kg : Tranche d’âge au-dessus Cadets → Juniors (vers Combat · Jiyu · Juniors M · -60 kg)'` (le libellé exact de la règle : `RULE_LABELS.ageUp` ; un détail vide → le libellé seul) ;
  - deux règles → séparées par `' ; '` ;
  - aucune règle (correction imposée) → `whyText(view.why, view.sex)` après « : » ;
  - club `null` → `sans club` ;
  - deux movers → deux lignes, chacune son nom, son club, ses détails.
  (Construire les `MoveView` et la grille à la main, comme `tests/web/key-diff.test.ts`.)
- [ ] **Step 2: Run** `npx vitest run tests/web/club-text.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** De : `categoryLabel(view.from, grid)` (`—` si `null`) ; Vers : `categoryLabel(view.to, grid)`. Pas de règle `return` quand `view.forced` (comme `RulePills`).
- [ ] **Step 4: Run** `npx vitest run tests/web/club-text.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(reaffectation): texte « Copier pour le club »`

### Task 5: Fiche d'un combattant

**Files:**
- Create: `src/web/components/replacement/fighterSheet.ts` (lignes), `src/web/components/replacement/FighterSheet.tsx` (rendu)
- Test: `tests/web/fighter-sheet.test.ts`

**Interfaces:**
- Produces: `sheetLines(row: RegistrationRow, ctx: { grid: CategoryGrid; presence: Presence | null; others: { label: string; session: string | null }[]; recasement: RecasementEntry | undefined }): { label: string; value: string }[]` et `FighterSheet({ competitionId, registrationId }: { competitionId: string; registrationId: string })` — lit `useRegistrations`, `useWeighIn(competitionId)` (présence, toute la compétition), `useCategories` (autres inscriptions du même `fighterId` : libellé de catégorie + session), `useRecasementDetails`, `useGrid`.

- [ ] **Step 1: Write the failing test** — les lignes et l'ordre de la spec §6 : `Sexe · âge` (`'Homme · Cadets'`), `Licence`, `Grade`, `Présence` (`'présent · pesé 58,4 kg (déclaré ≈ 59 kg)'`, `'non pointé'`, `'absent'`), `Discipline` (discipline · règlement · poids), `Accepte aussi` (`'Shido-boxing, puis Shido-mix'` ; shobu + `acceptsJiyuFirst` → `'… · accepte le jiyu en priorité'`), `Origine` (`SOURCE_LABELS[source]` + `' · confirmé FFK ✓'`), `Réaffecté` (seulement s'il y a une réaffectation validée), `Autres inscriptions` (`'aucune'` sinon), `Ne combat pas` (seulement si `withdrawn`) ; valeur vide → `'—'` ; aucune ligne ne contient le coach, le téléphone ou l'e-mail du club.
- [ ] **Step 2: Run** `npx vitest run tests/web/fighter-sheet.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `sheetLines` (libellés par `src/web/labels.ts`), puis `FighterSheet` en grille « libellé · valeur » (maquette v3, `data-testid="fighter-sheet"`).
- [ ] **Step 4: Run** `npx vitest run tests/web && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(reaffectation): fiche d’un combattant`

### Task 6: Dépliant « Détails » et bouton « Copier » sur les cartes et le plan

**Files:**
- Create: `src/web/components/replacement/MoveDetails.tsx`, `src/web/components/replacement/CategoryColumn.tsx`, `src/web/components/replacement/CopyForClub.tsx`
- Modify: `src/web/api.ts` (`useMoveDetails`), `src/web/pages/ReplacementPage.tsx` (propositions de `caseCard`, pas les refusées), `src/web/components/replacement/PlanView.tsx` (`moveRow`), `src/web/help.ts` si un texte d'aide du bloc parle des boutons de la carte
- Test: `tests/e2e/details-reaffectation.spec.ts`

**Interfaces:**
- Consumes: route Task 3, `MoveDetails` (domaine), `clubRequestText` (Task 4), `FighterSheet` (Task 5), `BracketView` (`selected`, `onSelect`, `highlighted`), `withSession`.
- Produces:
  - `useMoveDetails(id: string, body: MoveDetailsBody, fingerprint: string, enabled: boolean)` — `useQuery`, clé `['move-details', id, fingerprint, body]` (le `[1] === id` la fait invalider avec le reste par `useInvalidateDay`).
  - `MoveDetails({ competitionId, waveId, body, fingerprint, sex }: …)` — deux `CategoryColumn` ; `Loader` (spinner) dans chacune pendant le chargement ; `ApiErrorAlert` + bouton « Réessayer » (`refetch`) en cas d'erreur.
  - `CategoryColumn({ side, category, movers, competitionId, waveId, sex })` — en-tête (étiquette, libellé, ligne d'infos : session, zone, format, état, nombre ; Vers : `n combattants (n+1 avec lui|elle)`), `SegmentedControl` `Combattants | Tableau` (défaut `Combattants`), lien `Voir dans la galaxie ↗` (`target="_blank"`, `withSession('/competitions/:id/tableaux?vue=galaxie&categorie=<id>', waveId)`, absent si pas d'`id`).
    - Combattants : lignes « NOM Prénom · Club », poids à droite ; movers marqués `part` (De, en tête) / `arrive` (Vers, à la fin), fond `--sk-warn` clair ; absents grisés `absent` ; clic = fiche dépliée dessous, plusieurs à la fois.
    - Tableau : `BracketView` en lecture, `highlighted` = movers, `selected`/`onSelect` = le nom choisi, `FighterSheet` sous le tableau ; pas de liste ; pas de tableau → `Pas de tableau pour cette catégorie`.
  - `CopyForClub({ view, grid })` — bouton `📋 Copier pour le club` ; `navigator.clipboard.writeText` → notification verte `Copié : <texte>` ; échec ou API absente → notification rouge `Copie impossible : sélectionnez le texte ci-dessous et copiez-le.` suivie du texte.
  - Bouton `Détails ▾` / `Détails ▴` (`data-testid="move-details-toggle"`) avant `Copier`, puis les boutons existants. Corps : carte → `{ proposalId: p.id }` avec `data.fingerprint` ; ligne du plan → `{ plan: { waveId, choices, cardDecisions, fingerprint: data.fingerprint, hash: data.plan.hash }, moveId: m.id }`.

- [ ] **Step 1: Write the failing e2e test** (modèle : `tests/e2e/recasement.spec.ts` pour créer une compétition avec un combattant seul et une proposition de tranche au-dessus) :
  - carte : « Détails » → les deux colonnes ; De liste le combattant `part`, Vers le liste `arrive` ; clic sur un nom de Vers → `fighter-sheet` visible avec `Licence` et sans `coach` ; « Tableau » dans Vers → le tableau, sans liste en dessous, le combattant surligné ; clic sur un nom du tableau → sa fiche ; le lien galaxie a `target="_blank"` et `vue=galaxie&categorie=`.
  - copie (contexte avec `permissions: ['clipboard-read', 'clipboard-write']`) : le presse-papiers contient `<Prénom> <NOM> - <club> - <De> : Tranche d’âge au-dessus …(vers <Vers>)`.
  - plan : sur une ligne du plan, « Détails » montre De et Vers ; Vers contient le combattant `arrive`.
  - écran 390 px : colonnes l'une sous l'autre, `document.documentElement.scrollWidth <= 390`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/details-reaffectation.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** les composants et le branchement (cartes ②, lignes ①).
- [ ] **Step 4: Run** `npx playwright test tests/e2e/details-reaffectation.spec.ts tests/e2e/recasement.spec.ts tests/e2e/plan-d-ensemble.spec.ts && npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Vérifier dans Chrome** (extension Claude in Chrome, nouvel onglet, appli locale) : une carte et une ligne du plan, les deux vues, une fiche, la copie, le thème sombre ; puis dans le simulateur iOS (idb) l'écran étroit. Garder une capture de chaque.
- [ ] **Step 6: Commit** `feat(reaffectation): détails De/Vers et « Copier pour le club » sur les cartes et le plan`
