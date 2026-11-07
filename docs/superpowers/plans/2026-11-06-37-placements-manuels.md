# Placements manuels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déplacer n'importe quel inscrit vers n'importe quelle catégorie ou tableau libre (préparé dans l'onglet
« Catégories »), faire ignorer ces placements manuels par la réaffectation automatique tout en signalant les combattants
seuls, et garder les échanges faits dans un tableau quand il est refait.

**Architecture:** Un tableau libre est une ligne `categories` dont la clé porte `free` (son nom) : sa `keyString` ne peut
jamais égaler une clé naturelle, son libellé est son nom, sa clé n'est jamais recalculée d'après ses membres, il n'est jamais
supprimé quand il est vide, et sa session vient seulement du choix individuel (`waveOverride`). Un placement manuel =
inscription `placementLocked` avec `recasementType === 'M'` ; le domaine de réaffectation ne le déplace jamais, traite un
tableau libre comme verrouillé pour l'automatique, et produit des cartes d'alerte (`Case.alert`) sans proposition pour les
combattants seuls concernés. Les tableaux arrangés à la main (colonne `categories.arranged`) sont refaits par une fonction pure
`keepPlaces` qui part des places du tableau stocké.

**Tech Stack:** TypeScript 7 (natif), Fastify, Drizzle/SQLite (better-sqlite3), React + Mantine, TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-placements-manuels-design.md`

## Global Constraints

- Branche `etape-37-placements-manuels` depuis `main` ; étape 37 de la feuille de route.
- Node épinglé par `.tool-versions` (22.23.2) ; `npm run typecheck`, `npm test`, `npm run test:e2e` doivent passer.
- Interface en français ; vocabulaire de l'app : « session », « réaffectation ». Onglet renommé exactement « Catégories ».
- Nouvelle migration `drizzle/0032_tableaux_arranges.sql` (après `0031`), générée par `npm run db:generate`.
- Nom de tableau libre : obligatoire, 1 à 60 caractères après normalisation (trim, espaces multiples réduits), unique parmi
  les tableaux libres de la compétition sans tenir compte de la casse.
- Droits : toute nouvelle route d'écriture a les mêmes rôles que `POST /replacement/move` (`src/server/auth/permissions.ts`).
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (le conteneur Docker l'utilise) : tester sur une copie.
- Chaque changement visible est vérifié sur Chrome avec l'extension Claude in Chrome (copie de la démo, port 3200).
- e2e : nom de compétition unique (pas contenu dans un autre) ; attendre la réponse réseau plutôt qu'une notification de même
  texte ; ne jamais lancer deux `npx playwright test` en même temps.

## Review Focus

1. Un tableau libre dont la discipline et le règlement égalent ceux d'une catégorie naturelle sans âge (kata) : un nouvel
   inscrit va dans la catégorie de la grille, jamais dans le tableau libre (test Task 3).
2. Une règle de session qui prend toute une discipline (ex. « kata ») : un tableau libre sans session choisie reste
   « En attente » (test Task 1).
3. Combattant déplacé par le plan puis à la main : « Annuler son déplacement manuel » n'annule que le dernier et il redevient
   réaffectable ; « Repartir de zéro » défait les deux et laisse le tableau libre vide mais présent (test Task 3).
4. Tableau arrangé dont il ne reste qu'un combattant actif, ou qui passe de 2 à 3 (combat ➜ poule) : pas d'erreur, format
   automatique respecté (test Task 4).
5. Combattant d'un tableau arrangé marqué absent : traité comme un partant, et retrouve une place logique s'il redevient
   présent (test Task 5).

---

### Task 1: Clé de tableau libre dans le domaine

**Files:**
- Modify: `src/domain/categories.ts` (`CategoryKey`, `keyString`, `categoryLabel`, `compareKeys`), `src/domain/closed-categories.ts`
  (`categoryKeyClosed`), `src/domain/waves.ts` (`waveOfCategory`, `waveConflicts`)
- Test: `tests/domain/categories.test.ts`, `tests/domain/closed-categories.test.ts`, `tests/domain/waves.test.ts`

**Interfaces:**
- Produces (exportés de `src/domain/categories.ts`) : `CategoryKey.free?: string` ; `isFreeKey(k: CategoryKey): boolean` ;
  `freeKey(name: string, discipline: DisciplineId, ruleset: Ruleset | null): CategoryKey` (= `{ discipline, ruleset, sex: 'X',
  ageBandCodes: [], weightClassIds: [], free: name }`) ; `normalizeFreeName(name: string): string` ;
  `freeNameError(name: string, existing: string[]): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('tableau libre', () => {
  const k = freeKey('Gala 1', 'karate', 'jiyu');
  test('keyString : suffixe libre, clés existantes inchangées', () => {
    expect(keyString(k)).toBe('karate|jiyu|X|||libre:Gala 1');
    expect(keyString({ discipline: 'karate', ruleset: 'jiyu', sex: 'M', ageBandCodes: ['senior'], weightClassIds: ['senior:M:-75'] })).toBe('karate|jiyu|M|senior|senior:M:-75');
  });
  test('libellé = nom', () => expect(categoryLabel(k, ffkDefaultGrid())).toBe('Gala 1'));
  test('tri : après la grille, par nom', () => {
    const g = ffkDefaultGrid();
    const keys = [freeKey('B', 'karate', 'jiyu'), freeKey('A', 'kata', null), { discipline: 'kata', ruleset: null, sex: 'M', ageBandCodes: ['senior'], weightClassIds: [] } as CategoryKey];
    expect([...keys].sort((a, b) => compareKeys(a, b, g)).map((x) => x.free ?? 'grille')).toEqual(['grille', 'A', 'B']);
  });
  test('freeNameError', () => {
    expect(freeNameError('  ', [])).toBe('Donnez un nom au tableau libre.');
    expect(freeNameError('x'.repeat(61), [])).toBe('60 caractères au plus.');
    expect(freeNameError('gala   1', ['Gala 1'])).toBe('Un tableau libre porte déjà ce nom.');
    expect(freeNameError('Gala 2', ['Gala 1'])).toBeNull();
  });
});
```

- `closed-categories.test.ts` : `categoryKeyClosed(n'importe quel ensemble, freeKey('Gala', 'karate', 'jiyu'))` vaut `false`.
- `waves.test.ts` (Review Focus 2) : session dont la règle prend toute la discipline kata ;
  `waveOfCategory({ key: freeKey('Gala', 'kata', null), waveOverride: null, waveBands: [] }, waves, grid)` vaut `null` ; avec
  `waveOverride: waves[0].id` il vaut `waves[0].id` ; `waveConflicts` n'inclut jamais un tableau libre.

- [ ] **Step 2: Run** `npx vitest run tests/domain/categories.test.ts tests/domain/closed-categories.test.ts tests/domain/waves.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** : `keyString` ajoute `|libre:<nom>` seulement si `free` est défini ; `categoryLabel` renvoie le
  nom ; `compareKeys` place les clés libres après les autres, triées par `localeCompare` du nom ; `categoryKeyClosed` faux pour
  une clé libre ; `waveOfCategory` : une clé libre ne prend une session que par `waveOverride` ; `waveConflicts` les ignore.

- [ ] **Step 4: Run** the same command, puis `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(categories): clé de tableau libre (nom, discipline, session choisie)`

---

### Task 2: Réaffectation — placements manuels jamais déplacés, tableaux libres intouchés, cartes d'alerte

**Files:**
- Modify: `src/domain/replacement/types.ts` (`Case`), `src/domain/replacement/detect.ts`, `src/domain/replacement/move.ts`
  (`recompute`, filtre des catégories vides de `applyProposal`), `src/domain/replacement/plan-search.ts` (`aloneRegistrations`,
  `mayReturn`, `casesOfWave` ou son appelant), `src/domain/replacement/plan.ts`, `src/domain/replacement/manual.ts`,
  `src/server/repositories/replacement.ts` (`allProposals` : rien pour une carte d'alerte)
- Test: `tests/domain/replacement/manual-placement.test.ts` (nouveau, avec `member`/`makeState` de `fixtures.ts`)

**Interfaces:**
- Consumes: `isFreeKey`, `freeKey` (Task 1).
- Produces (exportés par `src/domain/replacement/index.ts`) :
  - `Case.alert?: true` (carte d'alerte : `kind: 'alone'`, jamais de proposition, jamais dans le plan) ;
  - `isManualPlacement(m: Member): boolean` = `m.placementLocked && m.recasementType === 'M'` ;
  - `isLocked(c)` vaut aussi `true` pour un tableau libre ; `isLockedForManual(c: CategoryState | undefined): boolean` = ancien
    `isLocked` (lancée, terminée ou `frozen`) ;
  - `moveTargetsFor(state: State, registrationId: string): { categoryId: string; free: boolean; warnings: string[] }[]`.

- [ ] **Step 1: Write the failing tests** (`describe('placements manuels et tableaux libres')`)
  - `seul placé à la main : carte d'alerte` — membre `placementLocked: true, recasementType: 'M'`, seul dans une catégorie de la
    grille : `detectCases` contient `{ kind: 'alone', alert: true, detail: 'Placé à la main, seul dans sa catégorie' }` ;
    `allProposals(state).get(caseId)` vide ; `aloneRegistrations(state, null)` ne le contient pas.
  - `seul dans un tableau libre : carte d'alerte` — catégorie `{ key: freeKey('Gala 1', 'karate', 'jiyu') }` avec un membre placé
    à la main : `detail: 'Seul dans le tableau libre Gala 1'`, `alert: true`.
  - `tableau libre vide : rien` — catégorie libre sans membre : aucun cas, et `applyProposal` d'un autre déplacement ne la
    retire pas de `state.categories`.
  - `écart de poids mesuré sans lui` — deux membres normaux à 50 et 52 kg et un placé à la main à 70 kg : aucun cas `weight_gap`.
  - `pas de retour` — `recasementType: 'M'`, `original.reason: 'alone'`, catégorie d'origine avec un adversaire viable : aucun
    cas `return` ; le plan (même entrée que `tests/domain/replacement/plan.test.ts`) ne déplace jamais ce membre.
  - `un combattant normal seul peut le rejoindre` — membre placé à la main seul dans une catégorie X de la grille, autre membre
    seul compatible : le plan déplace le second vers X, jamais le premier.
  - `tableau libre : jamais cible ni source` — un membre seul compatible ailleurs : aucune proposition ni déplacement du plan
    vers le tableau libre ; un tableau libre de 3 membres n'est jamais source d'un split.
  - `déplacement manuel vers un tableau libre` — `manualProposal(state, r, libreId)` : `warnings` vide même avec un autre sexe et
    une autre tranche, `changes` prend discipline et règlement du tableau ; après `applyProposal`, la clé du tableau est
    inchangée (`recompute` ne touche pas une clé libre).
  - `moveTargetsFor` — toutes les catégories non lancées, non fermées, autres que la sienne ; les tableaux libres avec
    `free: true` et `warnings: []`.

- [ ] **Step 2: Run** `npx vitest run tests/domain/replacement` — Expected: nouveaux tests FAIL, anciens PASS.

- [ ] **Step 3: Implement**
  - `detect.ts` : `isManualPlacement`, `isLockedForManual`, `isLocked` (+ libre). Boucle « seul » : si le seul actif est un
    placement manuel ou si la catégorie est libre, cas `alert: true` avec le texte des tests (avant le test `isLocked`, un
    tableau libre étant verrouillé pour l'automatique) ; sinon comme aujourd'hui. Boucle « écart » : sur les actifs non
    manuels. Boucle « retour » : ignorer `isManualPlacement`.
  - `plan-search.ts` / `plan.ts` : les cas `alert` ne sont jamais des cas du plan ; `aloneRegistrations` ignore un seul actif
    manuel et les tableaux libres ; `mayReturn` exclut `isManualPlacement`.
  - `move.ts` : `recompute` ne modifie pas une catégorie libre ; une catégorie libre vide n'est pas retirée.
  - `manual.ts` : cible libre ➜ `warnings = []` ; verrouillage avec `isLockedForManual` ; `moveTargetsFor` reprend le filtre de
    `src/server/routes/replacement.ts:111` avec `isLockedForManual`.
  - `allProposals` : liste vide pour un cas `alert`.

- [ ] **Step 4: Run** `npx vitest run tests/domain` puis `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(reaffectation): placements manuels jamais déplacés, tableaux libres intouchés, cartes d'alerte`

---

### Task 3: Serveur — tableaux libres, annulation d'un déplacement manuel, remise à zéro

**Files:**
- Create: `src/server/repositories/free-tableaux.ts`, `src/server/routes/free-tableaux.ts` (enregistrée comme les autres routes)
- Modify: `src/server/repositories/categories.ts` (`syncCategories`), `src/server/repositories/replacement.ts` (`manualMove`,
  `undoManualMove`, `resetSorting`/`ResetPreview`), `src/server/routes/replacement.ts`, `src/server/auth/permissions.ts`,
  `src/web/api.ts` (types seulement)
- Test: `tests/server/free-tableaux.test.ts` (nouveau, même amorce que `tests/server/replacement.test.ts`), `tests/server/permissions.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `createFreeTableau(db, competitionId, input: { name: string; discipline: DisciplineId; ruleset: Ruleset | null }): Promise<Category>` ;
  - `updateFreeTableau(db, competitionId, categoryId, patch: { name?: string; discipline?: DisciplineId; ruleset?: Ruleset | null }): Promise<Category>` ;
  - `deleteFreeTableau(db, competitionId, categoryId): Promise<{ returned: number }>` ;
  - `undoManualMove(db, competitionId, registrationId): Promise<void>` ;
  - `ResetPreview.manual: number` ;
  - routes : `POST /api/competitions/:id/free-tableaux`, `PATCH /api/competitions/:id/free-tableaux/:cid`,
    `DELETE /api/competitions/:id/free-tableaux/:cid`, `GET /api/competitions/:id/replacement/move-targets/:registrationId`
    ➜ `{ targets: { categoryId: string; label: string; free: boolean; warnings: string[] }[] }`,
    `POST /api/competitions/:id/replacement/undo-manual` `{ registrationId }` ➜ `{ ok: true }`.
  - La session d'un tableau libre se règle avec la route existante `PATCH /categories/:cid` `{ waveOverride }`.

- [ ] **Step 1: Write the failing tests**
  - `créer, lister, sans tableau` : `POST free-tableaux` `{ name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' }` ➜ 201 ;
    `GET /categories` : `label: 'Gala 1'`, `registrationIds: []`, `bracket: null`, `waveId: null` ; il survit à un `GET` suivant.
  - `nom refusé` : `' '` ➜ 400 `Donnez un nom au tableau libre.` ; doublon `'gala 1'` ➜ 400 `Un tableau libre porte déjà ce nom.`
  - `deux combattants de catégories différentes` : `move` de A puis de B vers le tableau ➜ tableau à un combat ; leurs inscriptions
    ont la discipline et le règlement du tableau.
  - `jamais par la catégorie naturelle` (Review Focus 1) : tableau libre kata ; nouvel inscrit kata senior M ➜ sa catégorie a le
    libellé de la grille.
  - `réaffectation : rien ne bouge, alerte si seul` : `POST /replacement/plan` puis `/plan/apply` ➜ A et B toujours dans le
    tableau ; après `undo-manual` de B, `GET /replacement` : carte `alone` avec `alert: true` pour A, `summary.alone`,
    `summary.cases` et `summary.withoutProposal` la comptent.
  - `modifier` : `PATCH` `{ name: 'Gala A' }` ➜ libellé `Gala A` ; `PATCH` `{ discipline: 'kata', ruleset: null }` sur un tableau
    avec A et B ➜ 200, leurs inscriptions passent en kata sans catégorie de poids, tableau de kata ; tableau lancé (un résultat
    saisi) ➜ `PATCH` discipline refusé (`CategoryLockedError`, 409 comme les autres catégories lancées).
  - `session choisie` : `PATCH /categories/:cid` `{ waveOverride: <session> }` ➜ `waveId` = cette session.
  - `supprimer renvoie les combattants` : A et B dans le tableau ➜ `DELETE` ➜ `{ returned: 2 }`, A et B dans leur catégorie
    d'avant, discipline et règlement rendus, tableau absent de `GET /categories`.
  - `undo-manual` (Review Focus 3) : inscrit déplacé par le plan puis à la main ; `undo-manual` ➜ il revient dans la catégorie
    du plan et n'est plus un placement manuel ; second `undo-manual` ➜ 400 `Le dernier déplacement de ce combattant n'est pas manuel.`
  - `Repartir de zéro` (Review Focus 3) : aperçu `reset.manual === 2` ; après `reset`, tous dans leur catégorie naturelle, le
    tableau libre existe toujours, vide.
  - `move-targets` : pour un inscrit sans problème, la liste contient le tableau libre (`free: true`, `warnings: []`).
  - `permissions.test.ts` : un compte Zone reçoit 403 sur `POST/PATCH/DELETE free-tableaux` et `undo-manual`.

- [ ] **Step 2: Run** `npx vitest run tests/server/free-tableaux.test.ts tests/server/permissions.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**
  - `syncCategories` : ne jamais `offer` une catégorie libre dans `byKey` ; ne jamais supprimer une catégorie libre vide ;
    libellé d'une catégorie libre = son nom.
  - `createFreeTableau` : `normalizeFreeName`, `freeNameError` contre les noms des autres tableaux libres (400 via
    `RegistrationValidationError`), insertion d'une ligne `categories` (`freeKey`, `status: 'provisional'`, graine aléatoire).
  - `updateFreeTableau` : 400 `Ce n'est pas un tableau libre.` sinon ; `CategoryLockedError` si lancé ou session lancée (le
    renommage aussi) ; un changement de discipline ou de règlement met à jour la clé **et** les inscriptions de ses membres
    (`discipline`, `ruleset` ; `weightClassId: null` vers le kata), sans toucher à leurs instantanés d'annulation, puis
    `syncCategories` refait le tableau.
  - `deleteFreeTableau` : refus en entier si lancé, session lancée, ou si l'un des membres n'a pas pour dernier déplacement
    validé un déplacement de type `M` vers ce tableau ; sinon `undoRecasement` de chacun, puis suppression de la ligne.
  - `undoManualMove` : dernière ligne `recasements` validée de l'inscription (ordre `rowid`) ; `type !== 'M'` ou aucune ➜
    `RegistrationValidationError` avec le message du test ; sinon `undoRecasement`.
  - `resetSorting` : `preview.manual` = réaffectations défaites de type `M` ; une catégorie libre vidée n'est pas supprimée.
  - `GET /replacement` : `moveTargets` des cartes calculé par `moveTargetsFor` (tableaux libres compris, cartes d'alerte comprises).
  - Routes zod ; `move-targets` avec `label` ; `permissions.ts` : les nouvelles routes d'écriture à côté de `'POST /replacement/move'`.
  - `src/web/api.ts` : `ReplacementData.reset.manual: number` ; `Case.alert?: true` dans les types de la page.

- [ ] **Step 4: Run** `npx vitest run tests/server` puis `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(tableaux-libres): créer, modifier, supprimer ; annuler un déplacement manuel`

---

### Task 4: `keepPlaces` — refaire un tableau en gardant les places

**Files:**
- Create: `src/domain/brackets/keep-places.ts`
- Modify: `src/domain/brackets/elimination.ts`, `src/domain/brackets/pools.ts`, `src/domain/brackets/kata.ts`, `src/domain/brackets/index.ts`
- Test: `tests/domain/brackets/keep-places.test.ts` (avec `entrants` de `helpers.ts`)

**Interfaces:**
- Produces:
  - `keepPlaces(previous: Bracket, entrants: Entrant[], format: BracketFormat, options: { repechage: boolean; thirdPlace: boolean; kataBronzeCount: 1 | 2 }, seed: number): Bracket` ;
  - `matchesFromSlots(slots: SlotSource[], startOrder = 0): Match[]` (`elimination.ts`) ;
  - builders avec placement imposé (sans tirage ni `separateClubs`) : `singleElimination(entrants, options, seed, slots?: SlotSource[])`,
    `doubleElimination(entrants, seed, slots?)`, `roundRobin(entrants, seed, order?: Entrant[])`, `threeWithRepechage(entrants, seed, order?)`,
    `bestOfThree(entrants, seed, order?)`, `poolsThenBracket(entrants, seed, options, pools?: string[][])`,
    `kataBracket(entrants, bronzeCount, seed, order?: Entrant[])`. Sans le dernier paramètre : comportement actuel inchangé.

- [ ] **Step 1: Write the failing tests** (`firstRound(b)` = paires `[a, b]` des matchs `w1-*`, exemption = `null`)
  - `élimination, même taille, un départ` : 6 (8 places) arrangé ; r3 part ➜ son adversaire exempt, autres paires identiques.
  - `élimination, même taille, une arrivée` : 5 (8 places), r6 arrive ➜ il prend une exemption face à un exempté ; autres paires identiques.
  - `arrivée : évite son club` : deux exemptés, l'un du club de l'arrivant ➜ l'arrivant va face à l'autre.
  - `le tableau grandit 4 ➜ 5` : `[r1,r2],[r3,r4]` ; r5 arrive ➜ ces deux paires restent au premier tour, r5 exempt, 8 places.
  - `le tableau rétrécit 5 ➜ 4` : les paires complètes restantes sont gardées.
  - `poules : arrivée dans la plus petite poule, hors de son club` (`pools_then_bracket`, même nombre de poules).
  - `kata : départ et arrivée` : ordre gardé, l'arrivant en dernier.
  - `2 ➜ 3 : combat unique ➜ poule` (Review Focus 4) : `round_robin`, les deux anciens adversaires dans le premier combat.
  - `il reste un seul combattant` (Review Focus 4) : pas d'exception, `matches` vide.
  - `options changées, mêmes inscrits` : premier tour identique, nouvelles options appliquées (3e place).

- [ ] **Step 2: Run** `npx vitest run tests/domain/brackets` — Expected: nouveaux tests FAIL.

- [ ] **Step 3: Implement** — `matchesFromSlots` extrait de `winnersBracket` ; `keepPlaces` (déterministe ; arrivants triés par
  `registrationId`) :

```text
anciens = places du tableau précédent :
  élimination/combat unique : cases a,b des matchs w1-* dans l'ordre (exemptions comprises) ;
  meilleur des trois : [s1.a, s1.b] ; trois avec repêchage : [m1.a, m1.b, m2.b] ;
  poules : pools (aplaties pour un format sans poules) ; kata : order.
partants = anciens absents de entrants ; arrivants = entrants absents des anciens.
paires = paires complètes du premier tour encore entières (élimination, combat unique, meilleur des trois, m1).

cible kata / round_robin / three_with_repechage / best_of_three :
  ordre = paires aplaties, puis autres anciens dans leur ordre, puis arrivants.
cible pools_then_bracket :
  si l'ancien format est pools_then_bracket et ceil(n/4) = nombre d'anciennes poules : anciennes poules moins les partants,
  chaque arrivant dans la plus petite poule (égalité : sans membre de son club, puis l'indice le plus bas) ;
  sinon serpentin de « ordre » comme poolsThenBracket.
cible single_elimination / double_elimination / single_match (S = nextPowerOfTwo(n)) :
  si l'ancien tableau est une élimination à S places : anciennes cases, partants ➜ exemption ; chaque arrivant prend la
  première exemption face à un combattant d'un autre club, sinon face à n'importe quel combattant, sinon la première exemption ;
  sinon : modèle = firstRoundSlots(n sources factices) ; matchs complets du modèle remplis d'abord avec les paires gardées
  (au plus n − S/2, dans l'ordre), puis par des isolés appariés en évitant le même club ; matchs avec exemption remplis avec
  les isolés restants. Isolés = anciens hors paires gardées, dans l'ordre, puis arrivants.
```

- [ ] **Step 4: Run** `npx vitest run tests/domain/brackets` — Expected: PASS (anciens et nouveaux).

- [ ] **Step 5: Commit** `feat(tableaux): refaire un tableau arrangé en gardant les places`

---

### Task 5: Serveur — tableaux arrangés gardés

**Files:**
- Modify: `src/server/db/schema.ts` (`categories.arranged`), `drizzle/0032_tableaux_arranges.sql` + `drizzle/meta` (générés),
  `src/server/repositories/categories.ts` (`buildBracket`, `upToDate`, `swapEntrants`, `redraw`, `toCategory`),
  `src/domain/categories.ts` (`Category.arranged`)
- Test: `tests/server/categories.test.ts`, `tests/server/migration-0032.test.ts` (modèle : `migration-0031.test.ts`),
  `tests/server/sync-package.test.ts`

**Interfaces:**
- Consumes: `keepPlaces` (Task 4).
- Produces: colonne `arranged integer NOT NULL DEFAULT false` ; `Category.arranged: boolean`.

- [ ] **Step 1: Write the failing tests**
  - `un échange marque le tableau arrangé` ; `Nouveau tirage le remet à false`.
  - `l'arrivée d'un inscrit garde les échanges` : 4 inscrits, échanges pour obtenir `[r1,r2],[r3,r4]` ; nouvel inscrit de la
    même catégorie ➜ ces paires toujours au premier tour ; `arranged` toujours vrai.
  - `un tableau sans échange est tiré comme avant` : même scénario sans échange ➜ égal à `generateBracket`.
  - `absent puis présent` (Review Focus 5) : un inscrit d'un tableau arrangé passe absent ➜ son adversaire exempt, autres paires
    gardées ; il redevient présent ➜ il retrouve une place face à un exempté.
  - `Régénérer (session figée) garde les places` : catégorie arrangée d'une session lancée, arrivée d'un inscrit, `regenerate` ➜ paires gardées.
  - `migration-0032` : une base à `0031` avec des catégories migre ; `arranged` vaut `false` partout.
  - `sync-package` : `arranged` et un tableau libre (vide et non vide) survivent à l'export puis l'import d'un paquet.

- [ ] **Step 2: Run** `npx vitest run tests/server/categories.test.ts tests/server/migration-0032.test.ts tests/server/sync-package.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** : schéma + `npm run db:generate` ; `swapEntrants` ➜ `arranged: true` ; `redraw` ➜ `arranged: false` ;
  `buildBracket` : si `row.arranged` et `row.bracketJson`, `keepPlaces(stocké, actifs, format effectif, options, row.seed)`, sinon
  `generateBracket` ; `upToDate` compare membres, format, options et graine sans appeler `keepPlaces` ; `toCategory` ➜ `arranged`.

- [ ] **Step 4: Run** `npx vitest run tests/server` puis `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(tableaux): les échanges survivent quand le tableau est refait`

---

### Task 6: Interface — onglet « Catégories » et bloc « Tableaux libres »

**Files:**
- Modify: `src/web/tabs.ts`, `src/web/App.tsx` (nouveau chemin + `RenamedTab` depuis `grille`), `src/web/pages/GridEditorPage.tsx`,
  `src/web/help.ts` (entrée de la grille), `src/web/api.ts` (hooks)
- Create: `src/web/components/FreeTableauxSection.tsx`
- Test: `tests/e2e/placements-manuels.spec.ts` (nouveau)

**Interfaces:**
- Consumes: routes `free-tableaux` (Task 3), `useUpdateCategory` (`waveOverride`) existant.
- Produces (hooks `src/web/api.ts`) : `useCreateFreeTableau(id)`, `useUpdateFreeTableau(id)`, `useDeleteFreeTableau(id)`.
- `FreeTableauxSection` props : `{ competitionId: string }` (liste tirée de `useCategories`, filtre `isFreeKey`).

- [ ] **Step 1: Write the failing e2e test** `tableaux libres dans l'onglet Catégories` : l'onglet s'appelle « Catégories » et
  l'ancienne adresse `/grille` y redirige ; blocs « Grille âge / poids », « Catégories ouvertes », « Tableaux libres » ;
  « Ajouter un tableau libre » `Gala 1`, Karaté, Jiyu ➜ ligne avec « 0 combattant » et session « En attente » ; choisir une session
  ➜ affichée ; « Modifier » le nom en `Gala A` ➜ affiché ; « Supprimer » (vide) ➜ disparu.

- [ ] **Step 2: Run** `npx playwright test tests/e2e/placements-manuels.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** : chemin `categories` (libellé « Catégories »), `grille` redirigé par `RenamedTab` ; `GridEditorPage`
  en trois `SectionCard` dans l'ordre de la spec §3.1 ; `FreeTableauxSection` : tableau (nom, discipline, règlement, session,
  combattants), fenêtre d'ajout/modification (nom, discipline, règlement — désactivés si le tableau est verrouillé, avec le rappel
  « Déverrouillez-le dans l'onglet Tableaux »), `Select` de session
  (« En attente » + sessions), « Supprimer » avec confirmation « N combattants retourneront dans leur catégorie précédente » ;
  lecture seule selon le poste comme les autres blocs ; aide mise à jour.

- [ ] **Step 4: Run** the e2e test — Expected: PASS ; vérification Chrome (bureau et téléphone, aucun débordement, cf. `clipped()`).

- [ ] **Step 5: Commit** `feat(categories): onglet Catégories et tableaux libres`

---

### Task 7: Interface — onglet Tableaux : déplacer, annuler, pastille

**Files:**
- Modify: `src/web/pages/BracketsPage.tsx`, `src/web/api.ts` (hooks), `src/web/help.ts` (entrée `tableaux`)
- Create: `src/web/components/MoveEntrantPanel.tsx`
- Test: `tests/e2e/placements-manuels.spec.ts` (ajout)

**Interfaces:**
- Consumes: routes `move-targets`, `move`, `preview`, `undo-manual` (Task 3) ; `Category.arranged` (Task 5).
- Produces: `useMoveTargets(id: string, registrationId: string | null)`, `useUndoManualMove(id)` ;
  `MoveEntrantPanel` props `{ competitionId: string; registrationId: string; name: string; manual: boolean }`.

- [ ] **Step 1: Write the failing e2e tests**
  - `gala entre deux catégories` : tableau libre `Gala 1` créé par l'API ; dans Tableaux, sélectionner un inscrit ➜
    « Déplacer vers… » ➜ `Gala 1` (groupe « Tableaux libres ») ➜ confirmer ; même chose pour un inscrit d'une autre catégorie ➜
    `Gala 1` a un combat ; pastille « placé à la main » sur les deux ; page Réaffectation « Voir le plan » puis « Appliquer le plan »
    ➜ `Gala 1` inchangé ; « Annuler son déplacement manuel » sur l'un ➜ il revient dans sa catégorie.
  - `échange gardé après une arrivée` : échange dans un tableau de 4, ajout d'un inscrit (onglet Inscriptions) ➜ les deux
    adversaires échangés toujours face à face.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** : au premier clic sur un inscrit, `MoveEntrantPanel` sous le tableau (le texte d'échange reste) :
  `Select` searchable « Déplacer vers… » (cibles sans avertissement, groupe « Tableaux libres », `Switch` « Toutes les catégories
  (règles enfreintes) »), bouton « Déplacer… » ➜ aperçu `usePreviewReplacement` (avertissements listés) ➜ confirmation ; bouton
  « Annuler son déplacement manuel » si `manual` (`recasementType === 'M'`). Pastille « placé à la main » pour `M` dans
  `badges`/`badgeDetails`. Masqué en lecture seule et quand la catégorie est verrouillée. Aide `tableaux` (spec §5).

- [ ] **Step 4: Run** the e2e tests — Expected: PASS ; vérification Chrome de l'onglet Tableaux (bureau et téléphone).

- [ ] **Step 5: Commit** `feat(tableaux): déplacer un inscrit, annuler un déplacement manuel`

---

### Task 8: Interface — page Réaffectation : cartes d'alerte et remise à zéro

**Files:**
- Modify: `src/web/pages/ReplacementPage.tsx`, `src/web/help.ts` (entrée de la réaffectation)
- Test: `tests/e2e/placements-manuels.spec.ts` (ajout)

**Interfaces:**
- Consumes: `Case.alert`, `ReplacementData.reset.manual` (Task 3), `useUndoManualMove` (Task 7).

- [ ] **Step 1: Write the failing e2e test** `alerte et remise à zéro` : `Gala 1` avec A et B (par l'API) ; annuler B ➜ page
  Réaffectation : carte « Sans adversaire » « Seul dans le tableau libre Gala 1 » sans proposition, avec « Déplacer
  manuellement vers… » et « Annuler son déplacement manuel » ; le compteur « Sans adversaire » l'inclut ; « Repartir de zéro »
  ➜ la fenêtre affiche « dont 1 déplacement manuel » ; confirmer ➜ la carte disparaît, `Gala 1` existe toujours, vide.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** : carte `alert` = même carte « Sans adversaire » sans bloc de propositions, avec « Déplacer
  manuellement vers… » (cibles de `moveTargets` comme les autres cartes, tableaux libres compris), « Annuler son déplacement
  manuel » et « Mettre de côté » ; fenêtre « Repartir de zéro » : « dont N déplacement(s) manuel(s) » (`plural`) quand
  `reset.manual > 0` ; retirer le texte `manual-move-new-hint` s'il devient faux ; aide (spec §5).

- [ ] **Step 4: Run** `npx playwright test tests/e2e/placements-manuels.spec.ts` et `npm test` — Expected: PASS ; vérification
  Chrome de la page Réaffectation.

- [ ] **Step 5: Commit** `feat(reaffectation): cartes d'alerte des combattants seuls placés à la main`

---

### Task 9: Documentation et vérification finale

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (§10, §11.2, §11.3 : renvoi vers la spec du
  2026-11-06), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 37), `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1:** Mettre à jour les trois documents (✅ décisions de l'utilisateur, 💡 choix du concepteur, mineurs reportés).
- [ ] **Step 2: Run** `npm run typecheck && npm test && npm run test:e2e` — Expected: tout PASS (totaux notés dans le bilan).
- [ ] **Step 3:** Migration sur une copie de la base de démo (jamais `data/shidokan.sqlite` depuis l'hôte) : app sur la copie
  (port 3200), vérification Chrome des onglets Catégories, Tableaux et Réaffectation.
- [ ] **Step 4: Commit** `docs: placements manuels et tableaux libres (étape 37)`
