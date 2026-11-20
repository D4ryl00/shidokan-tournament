# Ignorer, écart des grandes catégories, poids sur les Tableaux, autorisations, export FFK, récapitulatif club — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer avant le dimanche 22 novembre les six changements de la conception, chacun utilisable dès qu'il est fini.

**Architecture:** règles pures dans `src/domain/` (testées par `tests/domain/`), lecture/écriture SQLite dans `src/server/repositories/`, routes Fastify dans `src/server/routes/`, pages React/Mantine dans `src/web/`. « Ignorer » copie le modèle des cartes mises de côté (`set_aside_cases`) et ajoute un type d'Historique sans catégorie touchée. Les deux exports réutilisent `xlsx` (SheetJS), `pdf-lib` et `jszip`, déjà en dépendances.

**Tech Stack:** TypeScript, Fastify, drizzle + better-sqlite3, React 18 + Mantine, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-ignorer-ecart-poids-tableaux-design.md`

## Global Constraints

- Interface en français, typographie de l'application : apostrophe `’` dans les textes affichés, guillemets « … », espaces avant `:`.
- Ordre de construction (spec, « Calendrier ») : tâches 1 → 11 dans l'ordre ; après chaque tâche, `npm run typecheck` et `npm test` passent, et un commit est fait sur `main` (travail direct sur `main` accepté par l'utilisateur pour ce projet).
- Chaque changement visible est vérifié sur Chrome avec l'extension Claude in Chrome (préférence de l'utilisateur), y compris les corrections qui suivent.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte (le WAL du conteneur serait tronqué) : tester sur un serveur de dev (`npm run dev` + `npm run seed:dev`) ou une base temporaire.
- Seule migration : `ignored_cases` (tâche 5). Mise en service : sauvegarde, puis `docker stop` avant de remplacer le conteneur, jamais `docker rm -f` directement.
- Le modèle FFK n'a pas de macro : on écrit un `.xlsx`.

## Review Focus

1. Un combattant inscrit dans deux disciplines, absent dans une seule (la présence est par inscription) : seule la ligne absente disparaît de l'export FFK et seule elle est « Absent (désisté) » dans le récapitulatif (tests en tâches 9 et 10).
2. Carte ignorée dont un adversaire est pesé ensuite : la carte revient, la marque est effacée et l'entrée d'Historique dit « La carte est déjà revenue : la situation a changé. » (test en tâche 5).
3. « Repartir de zéro » d'une session ne touche pas une carte ignorée depuis une autre session (test en tâche 5).
4. Nom de combattant ou de club hors jeu WinAnsi (« Đặng », « Łukasz ») dans le récapitulatif PDF : pas d'exception, caractère remplacé par `?` comme la fiche club (test en tâche 10).
5. Compétition sans sessions : pas de choix « Cette session / Toutes les sessions » et le texte copié garde la formule (test en tâche 1).

---

### Task 1: Autorisations — copie par session sans formule, vue « Toutes les sessions »

**Files:**
- Modify: `src/domain/authorizations-text.ts`
- Modify: `src/web/components/authorizations/AuthorizationsSection.tsx`
- Modify: `src/web/help.ts` (sujet `reaffectation.autorisations`)
- Test: `tests/domain/authorizations-text.test.ts`, `tests/e2e/autorisations.spec.ts`

**Interfaces:**
- Produces: `fightersText(rows: MessageRow[]): string` ; `clubMessage(club, rows)` inchangé (avec formule) ; `allClubsMessage(clubs, opts?: { greeting?: boolean }): string` (défaut `true`) ; `copyText(club: { name: string }, rows: MessageRow[], greeting: boolean): string`.

- [ ] **Step 1: Tests qui échouent** dans `tests/domain/authorizations-text.test.ts` :

```ts
test('fightersText : combattants numérotés et puces, sans salutation ni demande finale', () => {
  expect(fightersText([{ label: 'DUPONT Léa', bullets: [AGE] }, { label: 'MARTIN Hugo', bullets: [MISSING_WEIGHT_BULLET] }]))
    .toBe(['1. DUPONT Léa', `   - ${AGE}`, '2. MARTIN Hugo', `   - ${MISSING_WEIGHT_BULLET}`].join('\n'));
});
test('copyText : formule seulement si demandée', () => {
  const rows = [{ label: 'DUPONT Léa', bullets: [AGE] }];
  expect(copyText({ name: 'Karaté Lyon' }, rows, true)).toBe(clubMessage({ name: 'Karaté Lyon' }, rows));
  expect(copyText({ name: 'Karaté Lyon' }, rows, false)).toBe(fightersText(rows));
  expect(copyText({ name: 'X' }, [], false)).toBe('');
});
test('allClubsMessage sans formule : en-têtes de club gardés', () => {
  expect(allClubsMessage([{ name: 'A', rows: [{ label: 'N P', bullets: [AGE] }] }], { greeting: false }))
    .toBe(`=== A ===\n1. N P\n   - ${AGE}`);
});
```

- [ ] **Step 2:** `npx vitest run tests/domain/authorizations-text.test.ts` → FAIL (`fightersText` non exporté).
- [ ] **Step 3: Implémenter** dans `src/domain/authorizations-text.ts`. `clubMessage` réutilise `fightersText` pour la partie centrale.
- [ ] **Step 4:** même commande → PASS.
- [ ] **Step 5: Section ③.** Dans `Authorizations`, un état local `allSessions` (faux par défaut). Un `SegmentedControl` « Cette session / Toutes les sessions » (`data-testid="auth-scope"`) dans `actions`, rendu seulement si `waveId !== null`. La requête devient `useAuthorizations(competitionId, allSessions ? null : waveId)`. `greeting = waveId === null || allSessions`. « Copier pour le club » utilise `copyText(club, rows, greeting)`, et « Copier tout » `allClubsMessage(toCopy, { greeting })`. Le compteur ⏳ suit la vue (il vient déjà de la réponse).
- [ ] **Step 6: Aide.** Dans `reaffectation.autorisations`, remplacer la phrase « 📋 Copier pour le club » par : « “Cette session” : “📋 Copier pour le club” copie seulement les combattants numérotés et leurs demandes, pour les coller à la suite d’une autre session. “Toutes les sessions” : un seul texte par club, avec bonjour, combattants numérotés et demande des accords et des poids. “📋 Copier tout” suit la même vue. »
- [ ] **Step 7: e2e.** Dans `tests/e2e/autorisations.spec.ts`, les attentes de la ligne 70 (`toContain('Bonjour,')`) et de la ligne 92 (`/^=== Dojo Accords ===\nBonjour,/`) valent pour une compétition sans sessions : vérifier si la fixture de ces tests a des sessions. Si oui, les attentes deviennent `not.toContain('Bonjour')` et `/^=== Dojo Accords ===\n1\. /`, et on ajoute un test qui clique `auth-scope` sur « Toutes les sessions » puis attend `Bonjour,`. Lancer `npx playwright test tests/e2e/autorisations.spec.ts` → PASS.
- [ ] **Step 8: Chrome.** Sur un serveur de dev avec deux sessions : copier en session, puis en « Toutes les sessions », coller dans la console (`navigator.clipboard.readText()`) et vérifier les deux textes.
- [ ] **Step 9: Commit** `feat(autorisations): copie par session sans formule, vue toutes les sessions`.

### Task 2: Poids sur les pastilles des Tableaux

**Files:**
- Modify: `src/web/labels.ts`, `src/web/components/BracketView.tsx` (`EntrantInfo`), `src/web/pages/BracketsPage.tsx` (`useEntrantInfo`), `src/web/components/planche/FighterChip.tsx`
- Test: `tests/web/entrant-weight.test.ts`

**Interfaces:**
- Produces: `entrantWeight(r: { discipline: DisciplineId; weighInKg: number | null; approxWeightKg: number | null }): string | null` ; `EntrantInfo.weight?: string | null`.

- [ ] **Step 1: Test qui échoue**

```ts
test('pesé, sinon déclaré, sinon rien ; jamais en kata', () => {
  expect(entrantWeight({ discipline: 'karate', weighInKg: 68.5, approxWeightKg: 70 })).toBe('68,5 kg');
  expect(entrantWeight({ discipline: 'karate', weighInKg: null, approxWeightKg: 68 })).toBe('≈ 68 kg');
  expect(entrantWeight({ discipline: 'karate', weighInKg: null, approxWeightKg: null })).toBeNull();
  expect(entrantWeight({ discipline: 'kata', weighInKg: 60, approxWeightKg: 60 })).toBeNull();
});
```

- [ ] **Step 2:** `npx vitest run tests/web/entrant-weight.test.ts` → FAIL.
- [ ] **Step 3: Implémenter** `entrantWeight` dans `src/web/labels.ts` (avec `kgLabel` et `DISCIPLINES[d].hasWeight`). `useEntrantInfo` ajoute `weight: entrantWeight(r)` ; `RegistrationRow` porte déjà `discipline`, `weighInKg` et `approxWeightKg`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: `FighterChip`.** Hors mode compact, la ligne du club devient un `Group justify="space-between" wrap="nowrap"` : le club à gauche (ellipsis, orange si même club), le poids à droite (`Text size="xs" c="dimmed" className="num"`, `data-testid="chip-weight"`). En mode compact (Galaxie), le poids est un petit texte après le nom dans le même `Group` (qui passe à la ligne), et `title` devient `club · poids`. La hauteur d'une pastille non compacte ne change pas.
- [ ] **Step 6: Chrome.** Planche, bac des combattants seuls, Galaxie, sur ordinateur puis au téléphone (simulateur iOS + idb) : le poids apparaît, rien ne déborde, et les noms longs passent toujours à la ligne.
- [ ] **Step 7: Commit** `feat(tableaux): poids pesé ou déclaré sur les pastilles`.

### Task 3: Écart de poids toléré par la largeur de la catégorie

**Files:**
- Modify: `src/domain/replacement/weights.ts`, `src/domain/replacement/detect.ts` (lignes 96-108 et 123), `src/domain/replacement/view.ts` (ligne 91), `src/web/help.ts` (carte « Écart de poids » et réglage « Écart de poids max »)
- Test: `tests/domain/replacement/weights.test.ts`, `tests/domain/replacement/closed.test.ts` (ou un nouveau `gap-tolerance.test.ts`)

**Interfaces:**
- Produces: `categoryGapTolerance(category: CategoryState, members: Member[], state: State): number`. Une seule catégorie de poids (`key.weightClassIds.length === 1`) : `Infinity` si elle n'a pas de limite basse (la plus légère de sa tranche et de son sexe, via `weightClassesFor`) ou pas de limite haute (`maxKg === null`) ; sinon `Math.max(gapThreshold(members, state), maxKg - limitePrécédente)`. Autres cas : `gapThreshold(members, state)`.

- [ ] **Step 1: Tests qui échouent** (fixtures `member`/`makeState` de `tests/domain/replacement/fixtures.ts`, grille FFK : cadettes −47, −54, −61, +61 ; pupilles F −25, −30… ; seuil 5 kg) :
  - `cadette -54, 47,5 et 53,5 kg (écart 6 ≤ largeur 7) : pas de carte weight_gap`
  - `cadette -54, 40 et 54 kg (écart 14 > 7) : carte, détail « (max 7 kg) »`
  - `cadette -47 (sans limite basse), 35 et 47 kg : pas de carte`
  - `cadette +61 (ouverte), 62 et 80 kg : pas de carte`
  - `pupille F -30 (largeur 5), 24 et 30 kg : carte, détail « (max 5 kg) »`
  - `catégorie fusionnée -54 + -61, 50 et 57 kg : carte (seuil 5 inchangé)`
  - `retour possible vers une catégorie d'origine ouverte malgré un écart de 9 kg` (combattant `original.reason: 'alone'` déplacé, origine +61 où un adversaire est arrivé) : un cas `return` apparaît.
  - Dans `weights.test.ts` : `categoryGapTolerance` vaut `Infinity`, `7` et `5` pour les cas ci-dessus.
- [ ] **Step 2:** `npx vitest run tests/domain/replacement` → les nouveaux tests échouent.
- [ ] **Step 3: Implémenter** `categoryGapTolerance` dans `weights.ts`. Dans `detect.ts`, le cas `weight_gap` compare à la tolérance de la catégorie `c`. Son détail affiche cette tolérance (`String(t).replace('.', ',')`). Le retour compare à la tolérance de la catégorie d'origine `home`. Dans `view.ts`, `max` = tolérance de la catégorie d'arrivée seulement si `p.type === 'R'`, sinon `gapThreshold` comme aujourd'hui. Propositions, plan et déplacements à la main ne changent pas.
- [ ] **Step 4:** `npx vitest run tests/domain/replacement` → PASS (aucune régression des tests existants).
- [ ] **Step 5: Aide.** Texte de l’écart de poids : « Écart de poids max (enfants et adultes séparément) : jusqu’à cet écart, un déplacement vers un poids voisin est sans risque […]. Dans une catégorie de la grille, l’écart toléré est au moins sa largeur (de −45 à −55 kg : 10 kg) ; une catégorie sans limite (la plus légère, ou “+”) ne donne jamais de carte “Écart de poids”. »
- [ ] **Step 6: Chrome.** Page Réaffectation sur des données de dev avec une catégorie ouverte et un grand écart : pas de carte.
- [ ] **Step 7: Commit** `feat(reaffectation): l'écart de poids imposé par la catégorie ne donne plus de carte`.

### Task 4: Ignorer — règles (domaine)

**Files:**
- Create: `src/domain/replacement/ignore.ts`
- Modify: `src/domain/replacement/types.ts` (`State.ignored: string[]`), `src/domain/replacement/apply.ts` (`stateFingerprint` : clé `i`), `src/domain/replacement/plan-search.ts` (lignes 67 et 89 : exclure `ignored` comme `setAside`), `src/domain/replacement/plan-inputs.ts` (`ignored: cardDecisions ? state.ignored : []`), `src/domain/history/types.ts`, `src/domain/history/text.ts`, `tests/domain/replacement/fixtures.ts` (`ignored: []` par défaut)
- Test: `tests/domain/replacement/ignore.test.ts`, `tests/domain/history-text.test.ts`

**Interfaces:**
- Produces: `caseFingerprint(state: State, c: Case): string`. C'est le JSON de `[c.kind, c.detail, membres actifs de c.categoryId, membres actifs de la catégorie d'origine si c.kind === 'return']`. Chaque membre vaut `[registrationId, presence, weighInKg, approxWeightKg]`, triés par `registrationId`, et les absents comptent comme non actifs. `HistoryKind` gagne `'ignore'` (libellé `'Ignoré'`, filtre `'plan'`, dans `RESET_KINDS`). `IGNORE_RETURNED = 'La carte est déjà revenue : la situation a changé.'` exporté de `src/domain/history/types.ts`.

- [ ] **Step 1: Tests qui échouent** (`ignore.test.ts`) :
  - `même situation : même empreinte` ;
  - `un adversaire pesé (weighInKg change) : empreinte différente` ;
  - `un nouvel arrivant dans la catégorie : empreinte différente` ;
  - `un adversaire absent : empreinte différente` ;
  - `retour : un changement dans la catégorie d'origine change l'empreinte` ;
  - `plan : une carte ignorée n'est pas un départ du plan` (sur le modèle du test existant des cartes mises de côté dans `plan.test.ts`).
  - Dans `history-text.test.ts` : `entryHeadline` d'une entrée `ignore` (`summary: { registrationIds: ['r1'], fromLabel: 'Cadettes · -54 kg', detail: 'Seule dans sa catégorie' }`, `names: ['DUPONT Léa']`) → `{ what: 'DUPONT Léa', detail: 'ignoré : Seule dans sa catégorie' }` ; `undoEffect` → `La carte de DUPONT Léa revient dans les cas à traiter.`
- [ ] **Step 2:** `npx vitest run tests/domain/replacement/ignore.test.ts tests/domain/history-text.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.** Ajouter `ignored` partout où `setAside` est lu dans `src/domain/replacement` (grep `setAside`). Ajouter `'ignore'` aux `switch` de `filterOfKind`, `entryHeadline` et `undoEffect`.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/domain` → PASS.
- [ ] **Step 5: Commit** `feat(reaffectation): empreinte d'une carte et type d'historique « Ignoré »`.

### Task 5: Ignorer — base, dépôt, routes, Historique

**Files:**
- Modify: `src/server/db/schema.ts` (table `ignoredCases` sur le modèle de `setAsideCases`, colonnes `competition_id`, `case_id`, `fingerprint`, `note`, `created_at`, `wave_id`, `history_entry_id`, `...rowMeta()`, clé primaire `(competition_id, case_id)`, cascade sur la compétition)
- Create: `drizzle/0040_cartes_ignorees.sql` + snapshot (`npx drizzle-kit generate --name cartes_ignorees`)
- Modify: `src/server/repositories/replacement.ts` (`loadState`, `ignoreCase`, `unignoreCase`, `ignoredNotes`, `resetSorting`/`applyReset`), `src/server/repositories/history.ts` (`undoEntry`, `listHistory`), `src/server/routes/replacement.ts`, `src/server/auth/permissions.ts`, `src/server/journal/coverage.ts`, `src/server/sync/package.ts` (`'ignored_cases'` dans `PACKAGE_TABLES`)
- Test: `tests/server/replacement.test.ts`, `tests/server/history.test.ts`, `tests/server/migration-0040.test.ts`, `tests/server/row-versions.test.ts`, `tests/server/sync-package.test.ts`

**Interfaces:**
- Consumes: `caseFingerprint`, `IGNORE_RETURNED`, `HistoryKind 'ignore'` (tâche 4).
- Produces:
  - `ignoreCase(db, competitionId, caseId, note): Promise<{ historyId: string }>`. Il échoue avec `StaleProposalError('Cette carte n’existe plus : rechargez.')` si le cas n'existe plus. Dans `atomically`, il insère l'entrée d'Historique (kind `'ignore'`, `categoryIds '[]'`, `waveId: actionWave(state, caseId, caseId)`, summary `{ registrationIds: [rid], fromLabel: label de la catégorie, detail: case.detail, reason: note || undefined }`), insère la marque avec l'empreinte et efface une éventuelle mise de côté du même cas.
  - `unignoreCase(db, competitionId, caseId): Promise<void>` : `undoHistory(db, competitionId, [historyEntryId], null)`.
  - Routes `POST /api/competitions/:id/replacement/ignore` `{ caseId, note? (≤ 80) }` → `{ ok: true, historyId }` et `POST …/replacement/unignore` `{ caseId }` → `{ ok: true }`.
  - `GET …/replacement` ajoute `ignored: Record<caseId, { note; createdAt; historyEntryId }>` et `summary.ignored`. `summary.cases` exclut les cartes ignorées.

- [ ] **Step 1: Tests qui échouent** dans `tests/server/replacement.test.ts` (même helper `call` que les tests `set-aside` des lignes 199 et 981) :
  - `ignorer : la carte sort des cas, entre à l'Historique (kind ignore), summary.ignored = 1` ;
  - `ignorer une carte mise de côté : la mise de côté disparaît` ;
  - `nouvel élément : un adversaire pesé → la carte revient, la marque est effacée, l'entrée d'Historique a blocked = IGNORE_RETURNED` ;
  - `problème disparu : marque effacée` ;
  - `unignore : la carte revient, l'entrée passe à undone` ;
  - `annuler l'entrée depuis l'Historique : la carte revient` ;
  - `Repartir de zéro (session A) : la carte ignorée en A revient, celle ignorée en B reste` ;
  - `carte inconnue : 409 (StaleProposalError)`.

  `migration-0040.test.ts` sur le modèle de `migration-0039.test.ts` (table, clé primaire, cascade). On ajoute `'ignored_cases'` à la liste de `row-versions.test.ts` et à l'attendu de `sync-package.test.ts`.
- [ ] **Step 2:** `npx vitest run tests/server/replacement.test.ts tests/server/history.test.ts tests/server/migration-0040.test.ts` → FAIL.
- [ ] **Step 3: Schéma et migration.** On ajoute la table, puis `npx drizzle-kit generate --name cartes_ignorees`, et on relit le SQL produit (une seule `CREATE TABLE`).
- [ ] **Step 4: Dépôt.**
  - `loadState` : même passe que les mises de côté. Une marque est effacée (seulement si `getManagement(...).managedHere`) quand son cas a disparu ou quand `caseFingerprint` diffère de l'empreinte gardée. Ensuite `state.ignored` = les marques restantes.
  - `undoEntry` (history.ts) : pour `kind === 'ignore'`, il supprime la marque dont `history_entry_id = e.id`.
  - `listHistory` : une entrée `ignore` active sans marque reçoit `blocked: IGNORE_RETURNED`.
  - `applyReset` : rien à ajouter (le lot passe par `undoEntries`). On vérifie par le test de la session B.
- [ ] **Step 5: Routes, permissions, journal.** Les deux routes, `'POST /replacement/ignore', 'POST /replacement/unignore'` dans `TABLE_WRITES`, `` `POST ${C}/replacement/ignore` `` et `` `POST ${C}/replacement/unignore` `` dans la liste couverte du journal.
- [ ] **Step 6:** `npm run typecheck && npm test` → PASS (dont `journal-coverage`, `permissions`, `row-versions`, `sync-package`).
- [ ] **Step 7: Commit** `feat(reaffectation): ignorer une carte, notée à l'historique, revient sur un nouvel élément`.

### Task 6: Ignorer — page Réaffectation et Historique

**Files:**
- Modify: `src/web/api.ts` (`ReplacementData.ignored`, `summary.ignored`, `useIgnoreCase`, `useUnignoreCase`), `src/web/pages/ReplacementPage.tsx`, `src/web/help.ts` (nouveau sujet `recasement.ignorees`, mise à jour de `recasement.de-cote`)
- Test: `tests/web/help.test.ts` (le sujet existe), Chrome

**Interfaces:**
- Consumes: routes de la tâche 5.

- [ ] **Step 1: Carte.**
  - Bouton « Ignorer » (`data-testid="case-ignore"`) sous « Mettre de côté », aussi sur une carte mise de côté dépliée.
  - Il ouvre une fenêtre « Ignorer cette carte ? » : « Elle ne sera plus proposée tant que rien ne change (arrivée ou absence d’un combattant de la catégorie, poids pesé ou déclaré). L’action est notée dans l’Historique, d’où vous pouvez l’annuler. » Note facultative (80 caractères) ; bouton `case-ignore-confirm` ; message « Carte ignorée. ».
- [ ] **Step 2: Listes.** `activeCases` exclut aussi `data.ignored`. Nouvelle carte repliée « Ignorées (n) » (`data-testid="ignored-section"`), sur le modèle de « Mises de côté ». Chaque ligne (`ignored-row`) montre le nom, le type, la note et l’heure, avec « Reprendre » (`case-unignore`). Pas de rappel au lancement.
- [ ] **Step 3: Aide.** `recasement.ignorees` : titre « Cartes ignorées », short « Une carte ignorée est réglée : elle ne revient que si la situation change. » Détails : ce qui fait revenir la carte, l’annulation depuis l’Historique ou par « Reprendre », et « Repartir de zéro » qui les reprend. Dans `recasement.de-cote`, une phrase qui distingue « Mettre de côté (à reprendre plus tard) » et « Ignorer (réglé) ». Le `HelpButton` de la section pointe sur `recasement.ignorees`.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/web` → PASS.
- [ ] **Step 5: Chrome.** Ignorer une carte, la voir dans « Ignorées » et dans l’Historique (« Ignoré »), puis peser un adversaire dans Pesée : la carte revient, et l’Historique dit « La carte est déjà revenue : la situation a changé. ». Ignorer de nouveau, puis annuler depuis l’Historique : la carte revient.
- [ ] **Step 6: Commit** `feat(reaffectation): bouton Ignorer et section des cartes ignorées`.

### Task 7: Export FFK — construction des feuilles (domaine)

**Files:**
- Create: `src/domain/ffk-export.ts`
- Test: `tests/domain/ffk-export.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FfkExportRegistration {
  firstName: string; lastName: string; licence: string | null;
  /** « 0060690 ETOILE SPORTIVE… » : entité FFK, sinon « numéro nom », sinon le nom ; '' sans club. */
  entity: string;
  sex: Sex; ageBandCode: string;
  /** Valeurs d'inscription : `original` si l'inscription a été déplacée, sinon les valeurs actuelles. */
  registered: { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null };
  /** Catégorie où il combat (null : pas placé ; tableau libre : sa clé `free`). */
  final: { id: string; key: CategoryKey } | null;
  /** Absent à la pesée ou « ne combat pas ». */
  out: boolean;
}
export const FFK_SHEETS: { name: string; discipline: DisciplineId; type: string; widths: Record<string, number> }[];
export interface FfkSheet { name: string; widths: Record<string, number>; rows: (string | number | null)[][] }
export function ffkAgeLabel(grid: CategoryGrid, ageBandCode: string, ruleset: Ruleset | null): string;
export function buildFfkExport(regs: FfkExportRegistration[], grid: CategoryGrid): FfkSheet[];
```

Valeurs fixées par la spec et le modèle :
- Feuilles dans cet ordre : `Karate` (karate, Type `Karate`, largeurs `{A:25.71, B:19.71, D:58.29, G:33.71, H:11.43}`), `Boxe` (shido-boxing, `Boxe`, `{B:20.43, C:10.86, D:58.29, E:11.29, F:16.43, G:33.71, H:9.57, I:10.29}`), `Mix Martial` (shido-mix, `Kmix`, `{A:11.86, B:21.86, C:10.71, D:34.57, E:8.86, F:10, G:33.71, H:9.57, I:10.29}`), `Triathlon` (triathlon, `Triathlon`, largeurs de Karate s'il y a des lignes), `Kata` (kata, `Kata`, `{A:15.57, B:16.86, D:44.14, G:17.14}`).
- En-tête : `['Prénom','Nom','Numero','Entite rattachement','Genre','Type','Age','Categorie','Technique']`. Feuille Triathlon sans ligne : `rows = [['Ytiathlon']]`, `widths = {}`.
- Genre `Féminin`/`Masculin`. Noms et prénoms en majuscules. Technique toujours `null`.
- `ffkAgeLabel` : `senior` → `Séniors jiyu ippon kumite` (jiyu ou null) / `Séniors shobu ippon kumité` ; `v1`…`v5` → `Vétéran 1`…`Vétéran 5` ; les autres → libellé de la grille au singulier (« Poussins » → `Poussin`, « Mini-poussins » → `Mini-poussin`, « Espoirs » → `Espoir`).
- Categorie : `-35` → nombre `-35` ; `+45` → texte `'+45'` ; kata → `null`.
- Catégorie retenue pour une ligne (`final` non nul et non libre) : feuille et règlement de `final.key`. Âge et poids de `final.key` seulement si c'est une vraie catégorie pour ce combattant (`ageBandCodes.length === 1`, au plus un `weightClassId` et, s'il y en a un, de la tranche `ageBandCodes[0]` et du sexe du combattant dans la grille). Sinon, sa tranche et `registered.weightClassId`. Avec `final` nul ou libre : toutes les valeurs `registered`.
- Blocs : un par `final.id` (non placé ou libre : un par clé naturelle d'inscription). Dans chaque feuille, tri des blocs : sexe (F, puis M et mixtes), ordre des tranches de la grille, poids croissant (ouverte en dernier), jiyu avant shobu. Une catégorie fusionnée se place à sa tranche la plus jeune et son poids le plus léger. Lignes d'un bloc triées par nom puis prénom. Deux lignes vides (`[]`) entre deux blocs, aucune après le dernier.
- `out` : la ligne est omise.

- [ ] **Step 1: Tests qui échouent** (`tests/domain/ffk-export.test.ts`, grille `ffkDefaultGrid()`) :
  - `cinq feuilles dans l'ordre du modèle, en-têtes et largeurs` ;
  - `ffkAgeLabel : Poussin, Mini-poussin, Espoir, Vétéran 2, Séniors jiyu ippon kumite, Séniors shobu ippon kumité` ;
  - `combattant non déplacé : sa ligne, Categorie -54 en nombre, +61 en texte` ;
  - `déplacé vers une vraie catégorie voisine (cadette -54 → -61) : Categorie -61` ;
  - `catégorie fusionnée cadettes -61 + juniors : chacun garde sa tranche et son poids d'inscription, un seul bloc` ;
  - `seniors fusionnés avec Vétérans 1 : les seniors restent « Séniors … »` ;
  - `catégorie mixte : une fille dans un -50 de garçons garde son poids d'inscription` ;
  - `passé de shobu à jiyu : Age « Séniors jiyu ippon kumite »` ; `passé du karaté au boxing : ligne dans la feuille Boxe` ;
  - `absent ou ne combat pas : omis` ; `deux disciplines, absent dans une seule : une seule ligne` (Review Focus 1) ;
  - `tableau libre : catégorie d'inscription` ;
  - `deux lignes vides entre deux catégories, rien à la fin` ;
  - `Triathlon vide : [['Ytiathlon']]` ;
  - **Relecture par l'import** : chaque feuille produite, passée à `findHeaderRow` + `guessColumnMapping` + `parseFfkRows(cells, header, mapping, name, grid)`, donne des lignes sans `errors`, avec la même discipline, le même règlement, la même tranche et la même catégorie de poids que la ligne écrite.
- [ ] **Step 2:** `npx vitest run tests/domain/ffk-export.test.ts` → FAIL.
- [ ] **Step 3: Implémenter** `src/domain/ffk-export.ts` (`weightClassesFor` pour l'ordre des poids, `naturalKey`/`keyString` de `categories.ts` pour les blocs).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(export): feuilles de l'export FFK au format du modèle`.

### Task 8: Export FFK — fichier, route, bouton

**Files:**
- Create: `src/server/repositories/ffk-export.ts`
- Modify: `src/server/routes/results.ts`, `src/web/pages/PodiumsPage.tsx`, `src/web/help.ts` (sujet `podiums`)
- Test: `tests/server/ffk-export.test.ts`

**Interfaces:**
- Consumes: `buildFfkExport`, `FfkExportRegistration` (tâche 7).
- Produces: `exportFfk(db: AppDb, competitionId: string): Promise<Buffer>` et la route `GET /api/competitions/:id/exports/ffk.xlsx` (`Content-Disposition: attachment; filename="export-ffk.xlsx"`).

- [ ] **Step 1: Test qui échoue.** Sur une compétition créée par les helpers de `tests/server` (une inscription déplacée, une absente, une « ne combat pas ») : la route répond 200. Relu avec `XLSX.read`, le fichier a `SheetNames` = `['Karate','Boxe','Mix Martial','Triathlon','Kata']`, la cellule H de la ligne déplacée vaut sa nouvelle catégorie avec `z === '@'`, `!cols[0].width ≈ 25.71` sur Karate, et l'absente n'y est pas.
- [ ] **Step 2:** `npx vitest run tests/server/ffk-export.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.**
  - `exportFfk` lit **toutes** les inscriptions, retirées comprises : `out` = `presence === 'absent'` ou `withdrawnReason` non nul. Il lit aussi les combattants (noms, licence, sexe, tranche), les clubs (`ffkEntity`, sinon `affiliationNumber + ' ' + name`, sinon `name`) et les catégories (`keyJson`).
  - `registered` = `originalJson` analysé s'il existe, sinon les valeurs actuelles.
  - Écriture `XLSX.utils.aoa_to_sheet`, `!cols` à partir de `widths` (`{ width }` par lettre, les autres colonnes sans largeur), `z: '@'` sur les cellules H sous l'en-tête. Retour `XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Bouton.** Dans `PodiumsPage`, un troisième groupe « Export FFK » avec `exportButton('ffk.xlsx', '.xlsx', 'export-ffk')`. Aide `podiums` : « Export FFK (.xlsx) : le fichier au format de l’export FFK, avec la situation finale de chaque combattant (catégorie où il combat, désistés retirés), pour que la FFK voie les changements. »
- [ ] **Step 6: Chrome.** Télécharger l’export sur les données de dev, puis l’ouvrir avec l’import FFK de l’application (Inscriptions › Import FFK, sans importer) : aucune ligne en erreur. Comparer l’allure (feuilles, colonnes, largeurs) avec `/Users/remi/Downloads/Shidokan.xlsm`.
- [ ] **Step 7: Commit** `feat(export): export FFK de la situation finale`.

### Task 9: Récapitulatif club — lignes (domaine)

**Files:**
- Create: `src/domain/club-recap.ts`
- Test: `tests/domain/club-recap.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RecapRegistration {
  lastName: string; firstName: string; sex: Sex; ageBandCode: string;
  registered: { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null };
  final: { kind: 'category'; label: string; keyString: string } | { kind: 'absent' } | { kind: 'withdrawn' } | { kind: 'unplaced' };
  recasementType: ProposalType | null;
}
export interface RecapLine { fighter: string; registered: string; final: string; changed: boolean; reason: string | null }
export function recapLines(regs: RecapRegistration[], grid: CategoryGrid): RecapLine[];
export const RECAP_REASONS: Partial<Record<ProposalType, string>>;
```

Valeurs fixées :
- `fighter` = `NOM Prénom`. Ordre : nom, prénom, puis discipline dans l'ordre de `DISCIPLINES`.
- `registered` = `Karaté · Jiyu · Cadettes · -54 kg`. En kata : `Kata · Cadettes`. La tranche suit le libellé de la grille accordé au sexe, comme ailleurs dans l'application (réutiliser la fonction existante qui produit « Cadettes »).
- `final` : `label` de la catégorie, `Absent (désisté)`, `Ne combat pas` ou `Pas encore placé`.
- `changed` vaut vrai si `final.kind !== 'category'` ou si `final.keyString` diffère de la clé naturelle des valeurs `registered`.
- `reason` : `RECAP_REASONS[recasementType]`, sinon `catégorie regroupée` si `changed` sans déplacement, sinon `null`. Table : A et B `catégorie de poids voisine`, C `tranche d’âge voisine`, D `mélange seniors / vétérans`, E `mélange mineurs / adultes`, F `mélange filles / garçons`, G `passage du shobu au jiyu`, H `autre discipline`, M `placé par l’organisation`.

- [ ] **Step 1: Tests qui échouent** : non déplacé → `changed: false`, `reason: null` ; déplacé A → `catégorie de poids voisine` ; absent → `Absent (désisté)` et `changed: true` ; deux disciplines, absent dans une seule (Review Focus 1) ; catégorie regroupée sans déplacement ; kata sans poids ; ordre alphabétique.
- [ ] **Step 2:** `npx vitest run tests/domain/club-recap.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(clubs): lignes du récapitulatif club`.

### Task 10: Récapitulatif club — PDF, .zip, boutons

**Files:**
- Create: `src/server/club-recap-pdf.ts`, `src/server/repositories/club-recap.ts`
- Modify: `src/server/club-form-pdf.ts` (exporter `safe` et `wrap`), `src/server/routes/registrations.ts` (à côté de `club-form.pdf`), `src/web/pages/ClubsPage.tsx`, `src/web/help.ts` (sujet de la page Clubs)
- Test: `tests/server/club-recap.test.ts`

**Interfaces:**
- Consumes: `recapLines` (tâche 9).
- Produces:
  - `clubRecapLines(db, competitionId, clubId): Promise<{ club: string; lines: RecapLine[] }>` ;
  - `buildClubRecapPdf(input: { competition: { name: string; date: string }; club: string; generatedAt: Date; lines: RecapLine[] }): Promise<Uint8Array>` ;
  - routes `GET /api/competitions/:id/clubs/:clubId/recap.pdf` (`recapitulatif-<club>.pdf`, 404 si le club n'a pas d'inscription) et `GET /api/competitions/:id/exports/club-recaps.zip` (`recapitulatifs-clubs.zip`, un PDF par club qui a des inscriptions).

- [ ] **Step 1: Tests qui échouent** :
  - le PDF d'un club s'ouvre avec `PDFDocument.load`, et son texte (lu avec `pdfjs-dist` comme les tests existants de `club-form-pdf.test.ts`) contient le nom du club, « Inscrit », « Au final », « Absent (désisté) » et « Changé » ;
  - un nom « Đặng Łukasz » ne lève pas d'exception (Review Focus 4) ;
  - le .zip contient un fichier par club inscrit et aucun pour un club vide ;
  - le PDF d'un club sans inscription répond 404.
- [ ] **Step 2:** `npx vitest run tests/server/club-recap.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.**
  - A4 portrait, polices standard Helvetica et Helvetica-Bold, marges de 15 mm.
  - En-tête : « Récapitulatif des inscriptions », nom et date de la compétition, club, « Créé le <date> à <heure> ».
  - Tableau à 3 colonnes (Combattant 30 %, Inscrit 35 %, Au final 35 %), texte replié avec `wrap`, nouvelle page quand il faut avec répétition de l'en-tête du tableau.
  - Une ligne `changed` a un fond gris clair `rgb(0.95,0.95,0.95)`, puis « Changé » en gras dans « Au final », suivi du motif entre parenthèses.
  - `clubRecapLines` lit les inscriptions du club, retirées comprises.
  - Le .zip est fait avec `jszip`. Nom de fichier : le nom du club sans accents, `[^a-z0-9]+` → `-`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Page Clubs.**
  - Une icône de téléchargement par ligne (`data-testid="club-recap"`, lien `download` vers `recap.pdf`, désactivée si `count(c.id) === 0`, `title="Récapitulatif (PDF)"`).
  - Un bouton « Tous les récapitulatifs (.zip) » dans l'en-tête de page (`data-testid="club-recaps-zip"`).
  - Aide de la page : « Récapitulatif : pour chaque combattant du club, ce qui était inscrit et ce qu’il fait au final (catégorie, désisté, ne combat pas). Le fichier dit son heure : refaites-le après un changement. »
- [ ] **Step 6: Chrome.** Télécharger un récapitulatif et le .zip, ouvrir le PDF : lignes changées mises en évidence, désistés présents, mise en page sur deux pages pour un gros club.
- [ ] **Step 7: Commit** `feat(clubs): récapitulatif PDF par club et .zip de tous les clubs`.

### Task 11: Vérification d'ensemble et mise en service

- [ ] **Step 1:** `npm run typecheck && npm test` → tout passe. Noter le nombre de tests.
- [ ] **Step 2:** `npx playwright test tests/e2e/autorisations.spec.ts tests/e2e/historique.spec.ts tests/e2e/deplacements.spec.ts tests/e2e/galaxie.spec.ts` → PASS (les specs les plus proches des changements). Puis la suite complète si le temps le permet.
- [ ] **Step 3:** Mettre à jour le bilan (`docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` ou le bilan courant, comme les étapes précédentes) avec ce lot, puis commit `docs(bilan): ignorer, écart des grandes catégories, poids, autorisations, exports`.
- [ ] **Step 4: Mise en service — demander à l'utilisateur avant d'agir** (action sur le serveur réel) : sauvegarde, `docker stop`, reconstruction de l'image, démarrage, migration 0040 appliquée au démarrage, contrôle sur Chrome que la page Réaffectation charge.
