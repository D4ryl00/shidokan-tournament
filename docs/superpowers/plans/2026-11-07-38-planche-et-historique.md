# Planche des tableaux et historique annulable — plan d'implémentation (étape 38)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une vue « Planche » de tous les tableaux avec glisser-déposer (échange de places, échange entre catégories, déplacement), et un historique de tout ce qui change les tableaux, annulable en cascade avec mise en évidence.

**Architecture:** Une table `history_entries` journalise chaque action (diff des lignes `categories` avant/après + lien vers les `recasements` existants) ; une fonction pure `undoSet` calcule la cascade (actions plus récentes touchant les mêmes catégories, de proche en proche) ; l'annulation rejoue, de la plus récente à la plus ancienne, les instantanés de réaffectation puis les lignes de catégories d'avant, dans une seule transaction. Côté web, la planche est une nouvelle vue de l'onglet Tableaux (HTML5 drag-and-drop natif + mode clic-clic), et l'historique un panneau partagé (planche, Liste, Réaffectation).

**Tech Stack:** TypeScript 7 (natif), React 19 + Mantine, Fastify, SQLite (better-sqlite3 + drizzle), Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-11-07-planche-et-historique-design.md` (maquette : `.superpowers/brainstorm/39331-1794069140/content/planche-historique-v4.html`, s'ouvre dans un navigateur).

## Global Constraints

- Compétition le **22/11/2026** : `main` utilisable à chaque commit ; travailler sur la branche `etape-38-planche-historique`.
- Node épinglé par `.tool-versions` (22.23.2) ; aucune nouvelle dépendance (glisser-déposer : API HTML native).
- Textes de l'interface en français, repris **mot pour mot** de la spec quand elle les donne (guillemets « », apostrophe ’ comme le reste de l'appli).
- Couleurs : uniquement les jetons `--sk-*` / couleurs Mantine accordées (thèmes clair et sombre) ; composants partagés de `src/web/components/ui/`.
- Lisible à 360 px sans débordement (`clipped()` de `tests/e2e/helpers.ts` / `mise-en-page.spec.ts`).
- Toute annulation est **tout ou rien** (une transaction) ; une annulation calculée sur un état périmé est refusée avec « Un autre poste a modifié ces tableaux : la liste est mise à jour. » (409).
- Poste Zone : lecture seule partout (planche sans glisser ni choix, pas de bouton Annuler).
- Jamais ouvrir `data/shidokan.sqlite` depuis l'hôte ; vérifications visuelles sur une base temporaire (`DATABASE_PATH=<scratchpad>/demo.sqlite npm run seed:dev`, puis `PORT=3200 DATABASE_PATH=… node dist/server/main.js`) avec Claude in Chrome.
- e2e : un nom de compétition ne doit pas contenir/être contenu dans un autre (`createCompetition` cherche par sous-chaîne) ; jamais deux `npx playwright test` en même temps.

## Review Focus

1. **Deux postes** : le poste A annule en se fiant à une liste périmée (le poste B a ajouté un échange de places entre-temps) → 409, rien d'annulé, la liste se recharge. Test : `history.test.ts` « expect périmé ».
2. **Catégorie disparue puis rendue** : on sort le dernier combattant d'une catégorie (elle est supprimée), puis on annule → la catégorie revient **avec le même id**, le même tableau et les mêmes places. Test : `history.test.ts` « catégorie supprimée puis restaurée ».
3. **Changement hors historique** : un échange de places, puis un combattant du tableau marqué absent à la pesée → l'échange n'est plus annulable (raison « Le tableau a changé depuis… ») mais un déplacement l'est toujours. Test : `history-tableaux.test.ts`.
4. **Plan qui crée une catégorie** (`new:`) puis annulation d'un seul de ses déplacements → cascade correcte, catégorie créée supprimée, aucun combattant hors tableau. Test : `history.test.ts` « plan avec catégorie créée ».
5. **Planche vide ou filtrée à rien** (aucune catégorie, recherche sans résultat, session vide) et **tableau libre vide** comme cible de dépôt. Tests : `planche-model.test.ts` + `planche.spec.ts`.

---

### Task 1: Logique pure — cascade, textes de l'historique, même club, remplacement d'un combattant

**Files:**
- Create: `src/domain/history/types.ts`, `src/domain/history/cascade.ts`, `src/domain/history/text.ts`
- Create: `src/domain/brackets/same-club.ts`, `src/domain/brackets/replace-entrant.ts`
- Modify: `src/domain/brackets/index.ts` (réexporter les deux nouveaux modules)
- Test: `tests/domain/history-cascade.test.ts`, `tests/domain/history-text.test.ts`, `tests/domain/same-club.test.ts`, `tests/domain/replace-entrant.test.ts`

**Interfaces:**
- Produces (`types.ts`) :
  ```ts
  export type HistoryKind = 'plan' | 'reaffectation' | 'manual' | 'exchange' | 'withdraw' | 'places' | 'redraw' | 'format' | 'free';
  export const HISTORY_KIND_LABELS: Record<HistoryKind, string>; // Plan, Réaffectation, À la main, Échange, Ne combat pas, Places, Tirage, Format, Tableau libre
  export type HistoryFilter = 'all' | 'plan' | 'manual' | 'tab';
  export function filterOfKind(k: HistoryKind): Exclude<HistoryFilter, 'all'>; // plan|reaffectation→plan ; manual|exchange|withdraw→manual ; places|redraw|format|free→tab
  export const RESET_KINDS: HistoryKind[]; // plan, reaffectation, manual, exchange, withdraw
  export interface HistorySummary { registrationIds: string[]; fromLabel?: string; toLabel?: string; detail?: string; reason?: string }
  export interface HistoryEntryView {
    id: string; seq: number; kind: HistoryKind; groupId: string | null; status: 'active' | 'undone';
    createdAt: string; undoneAt: string | null; waveId: string | null;
    names: string[];                 // « NOM Prénom » de summary.registrationIds, dans le même ordre
    summary: HistorySummary; categoryIds: string[]; afterMembers: Record<string, string[]>;
    blocked: string | null;          // raison si l'action (ou sa cascade) ne peut pas être annulée
    cascade: string[];               // ids des actions plus récentes emportées (sans elle-même), plus récente d'abord
  }
  ```
- Produces (`cascade.ts`) :
  ```ts
  export interface CascadeEntry { id: string; seq: number; active: boolean; kind: HistoryKind; categoryIds: string[]; afterMembers: Record<string, string[]> }
  export function undoSet<T extends CascadeEntry>(entries: T[], targetIds: string[]): T[];
  export function compositionChanged(set: CascadeEntry[], currentMembers: Map<string, string[]>): boolean;
  export const lockedReason = (label: string) => `${label} est lancée : déverrouillez-la pour annuler.`;
  export const CHANGED_REASON = 'Le tableau a changé depuis (inscrits différents) : refaites le tirage ou échangez à la main.';
  ```
- Produces (`text.ts`) : `entryHeadline(e: HistoryEntryView): { what: string; detail: string }` et `undoEffect(e: HistoryEntryView): string`.
- Produces (`same-club.ts`) : `sameClubFirstRound(b: Bracket | null): [string, string][]`, `newSameClubPairs(before: Bracket | null, after: Bracket | null): [string, string][]`, `sameClubSentence(pair: [string, string], info: (id: string) => { name: string; club: string }): string`.
- Produces (`replace-entrant.ts`) : `replaceEntrant(b: Bracket, fromId: string, to: Entrant): Bracket` (pure, ne modifie pas `b`).

- [ ] **Step 1: Write the failing tests**

`history-cascade.test.ts` (entrées fabriquées `e(id, seq, cats, kind='manual', active=true, after={})`) :
```ts
test('cascade : les plus récentes qui touchent une même catégorie, de proche en proche, plus récente d’abord', () => {
  const all = [e('h1', 1, ['A', 'B']), e('h2', 2, ['C']), e('h3', 3, ['B', 'D'], 'places'), e('h4', 4, ['D']), e('h5', 5, ['C'])];
  expect(undoSet(all, ['h1']).map((x) => x.id)).toEqual(['h4', 'h3', 'h1']);
});
test('cascade : ignore les annulées et les plus anciennes', () => {
  const all = [e('h1', 1, ['A']), e('h2', 2, ['A'], 'manual', false), e('h3', 3, ['A'])];
  expect(undoSet(all, ['h3']).map((x) => x.id)).toEqual(['h3']);
  expect(undoSet(all, ['h1']).map((x) => x.id)).toEqual(['h3', 'h1']);
});
test('plusieurs cibles (plan) : union sans doublon', () => {
  const all = [e('p1', 1, ['A']), e('p2', 2, ['B']), e('s', 3, ['A', 'B'], 'places')];
  expect(undoSet(all, ['p1', 'p2']).map((x) => x.id)).toEqual(['s', 'p2', 'p1']);
});
test('composition : un échange de places dont le tableau a changé hors historique', () => {
  const s = e('s', 3, ['A'], 'places', true, { A: ['r1', 'r2'] });
  expect(compositionChanged([s], new Map([['A', ['r2', 'r1']]]))).toBe(false);
  expect(compositionChanged([s], new Map([['A', ['r1']]]))).toBe(true);
  // Un déplacement ne se bloque jamais pour ça.
  expect(compositionChanged([e('m', 3, ['A'], 'manual', true, { A: ['r1', 'r2'] })], new Map([['A', ['r1']]]))).toBe(false);
  // C'est la plus récente du lot touchant A qui compte.
  const later = e('m2', 4, ['A'], 'manual', true, { A: ['r1'] });
  expect(compositionChanged([later, s], new Map([['A', ['r1']]]))).toBe(false);
});
```
`history-text.test.ts` — textes exacts de la spec §3.3/§3.5 :
```ts
expect(entryHeadline(view({ kind: 'places', names: ['PETIT Inès', 'MOREAU Jade'], summary: { registrationIds: ['a', 'b'], detail: 'Karaté · Jiyu · Benjamins F · -35 kg' } })))
  .toEqual({ what: 'PETIT Inès ↔ MOREAU Jade', detail: 'Karaté · Jiyu · Benjamins F · -35 kg : places échangées dans le tableau' });
expect(entryHeadline(view({ kind: 'redraw', summary: { registrationIds: [], detail: 'Karaté · Jiyu · Benjamins F · -35 kg' } })).what).toBe('Nouveau tirage');
expect(entryHeadline(view({ kind: 'format', summary: { registrationIds: [], detail: 'Kata · Benjamins F : Automatique ➜ Tour 1 puis finale à deux' } })).what).toBe('Format changé');
expect(entryHeadline(view({ kind: 'manual', names: ['GUERIN Emma'], summary: { registrationIds: ['g'], fromLabel: 'Minimes F · -38 kg', toLabel: 'Minimes F · -42 kg' } })))
  .toEqual({ what: 'GUERIN Emma', detail: 'Minimes F · -38 kg ➜ Minimes F · -42 kg' });
expect(undoEffect(view({ kind: 'plan', names: ['GUERIN Emma'], summary: { registrationIds: ['g'], fromLabel: 'Karaté · Jiyu · Minimes F · -38 kg', toLabel: 'x' } })))
  .toBe('GUERIN Emma retourne en Karaté · Jiyu · Minimes F · -38 kg.');
expect(undoEffect(view({ kind: 'exchange', names: ['A', 'B'] }))).toBe('A et B retournent chacun dans leur catégorie d’avant.');
expect(undoEffect(view({ kind: 'places', names: ['A', 'B'] }))).toBe('A et B reprennent leur place d’avant.');
expect(undoEffect(view({ kind: 'redraw', summary: { registrationIds: [], detail: 'Benjamins F · -35 kg' } }))).toBe('Benjamins F · -35 kg retrouve son tirage d’avant.');
```
(format : `${catégorie} repasse en « ${valeur d'avant} ».` — la valeur d'avant est le texte avant « ➜ » du `detail` ; free : même phrase ; withdraw : `${nom} combat de nouveau en ${fromLabel}.`)

`same-club.test.ts` : un tableau à élimination de 4 (deux combattants du club `c1` face à face au combat 1) → `[['r1','r2']]` ; poule de 3 du même club → `[]` ; kata → `[]` ; `newSameClubPairs` ne rend pas une paire déjà présente avant ; `sameClubSentence(['r1','r2'], …)` → `'BERNARD Léa et DUBOIS Lucas (Tani Dojo) se rencontrent au 1er tour.'`. Formats comptés : `single_elimination`, `double_elimination`, `single_match` (combats `phase === 'main' && round === 1`, deux sources `entrant`, `clubId` non nul et égal).

`replace-entrant.test.ts` : dans un tableau à élimination, `replaceEntrant(b, 'r2', x)` met `x` exactement à la case de `r2` (même combat, même côté), `entrants` contient `x` à la place de `r2` ; idem poule (`pools`) et kata (`order`) ; `b` n'est pas modifié.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/history-cascade.test.ts tests/domain/history-text.test.ts tests/domain/same-club.test.ts tests/domain/replace-entrant.test.ts`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Implement the five modules**

`undoSet` : parcourir les entrées actives triées par `seq` croissant à partir de la plus ancienne cible ; une entrée plus récente qu'une entrée du lot et partageant une catégorie avec l'ensemble des catégories déjà touchées entre dans le lot (et ajoute ses catégories) ; renvoyer trié par `seq` décroissant. `compositionChanged` : pour chaque entrée `places`/`redraw` du lot et sa catégorie, prendre l'entrée du lot de plus grand `seq` qui touche cette catégorie et comparer (triés) ses `afterMembers[cat]` aux membres actuels ; entrée sans `afterMembers[cat]` (lignes reprises de l'ancien journal) : ignorée. `replaceEntrant` : même parcours que `swapEntrants` (`src/server/repositories/categories.ts:377`) mais en sens unique.

- [ ] **Step 4: Run tests to verify they pass** — même commande, Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/domain/history src/domain/brackets/same-club.ts src/domain/brackets/replace-entrant.ts src/domain/brackets/index.ts tests/domain/history-*.test.ts tests/domain/same-club.test.ts tests/domain/replace-entrant.test.ts
git commit -m "feat(historique): cascade, textes, même club et remplacement d'un combattant (logique pure)"
```

---

### Task 2: Table `history_entries`, migration 0033 (reprise de l'ancien journal), transactions

**Files:**
- Modify: `src/server/db/schema.ts` (nouvelle table après `recasements`)
- Create: `drizzle/0033_historique.sql` (+ `drizzle/meta/0033_snapshot.json`, `_journal.json` via `npx drizzle-kit generate --name historique`, puis ajout à la main du `INSERT … SELECT` de reprise)
- Create: `src/server/db/atomic.ts`
- Modify: `src/server/sync/package.ts` (`PACKAGE_TABLES` : `history_entries` juste après `recasements`)
- Modify: `src/server/repositories/replacement.ts`, `src/server/repositories/free-tableaux.ts` (remplacer leurs `BEGIN IMMEDIATE … COMMIT/ROLLBACK` à la main par `atomically`)
- Test: `tests/server/migration-0033.test.ts`, `tests/server/atomic.test.ts`

**Interfaces:**
- Produces (schéma) :
  ```ts
  export const historyEntries = sqliteTable('history_entries', {
    id: text('id').primaryKey(),
    competitionId: text('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),                       // HistoryKind
    groupId: text('group_id'),                          // une application du plan
    status: text('status', { enum: ['active', 'undone'] }).notNull().default('active'),
    undoneAt: text('undone_at'),
    waveId: text('wave_id'),
    summaryJson: text('summary_json').notNull(),        // HistorySummary
    recasementIds: text('recasement_ids').notNull().default('[]'),
    categoryIds: text('category_ids').notNull().default('[]'),
    beforeJson: text('before_json').notNull().default('{"categories":[],"created":[],"registrations":[]}'),
    afterMembersJson: text('after_members_json').notNull().default('{}'),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    ...rowMeta(),
  });
  ```
  L'ordre (`seq`) est le `rowid`.
- Produces (`atomic.ts`) : `atomically<T>(db: AppDb, fn: () => Promise<T>): Promise<T>` (BEGIN IMMEDIATE/COMMIT/ROLLBACK, ou simple appel si une transaction est déjà ouverte) et `dryRun<T>(db: AppDb, fn: () => Promise<T>): Promise<T>` (toujours annulé : `SAVEPOINT dry_run … ROLLBACK TO … RELEASE` dans une transaction ouverte, sinon BEGIN IMMEDIATE … ROLLBACK).

- [ ] **Step 1: Write the failing tests**

`migration-0033.test.ts` (modèle : `migration-0032.test.ts`, `olderDb(32)`) : deux lignes `recasements` (une `M` validée avec `wave_id='w1'`, une `B` annulée en masse) → après `openDb`, deux lignes `history_entries` : `kind` = `manual` / `plan`, `status` = `active` / `undone`, `recasement_ids` = `["<id>"]`, `summary_json` contient `registrationIds`, `fromLabel`, `toLabel`, `reason` repris, `wave_id` et `created_at` repris, `group_id` NULL. Correspondance des types : `M`→`manual`, `W`→`withdraw`, sinon `bulk=1`→`plan`, sinon `reaffectation`.

`atomic.test.ts` : une erreur dans `atomically` annule les écritures ; `atomically` imbriqué ne commite pas l'extérieur ; `dryRun` rend la valeur de `fn` et n'écrit rien, y compris appelé dans `atomically`.

Le test existant `tests/server/package*.test.ts` / `unclassifiedTables` doit rester vert (la table est classée).

- [ ] **Step 2: Run tests to verify they fail**
Run: `npx vitest run tests/server/migration-0033.test.ts tests/server/atomic.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement schema, migration (reprise : `INSERT INTO history_entries (...) SELECT ... FROM recasements` avec `json_object` / `json_array`, `rowid` croissant conservé en insérant `ORDER BY rowid`), `atomic.ts`, ajout à `PACKAGE_TABLES`, et remplacement des transactions à la main.**

- [ ] **Step 4: Run tests** — `npx vitest run tests/server` — Expected: PASS (dont `migration-*`, `package*`, `replacement`, `free-tableaux`).

- [ ] **Step 5: Commit** — `git commit -m "feat(historique): table history_entries, reprise du journal des réaffectations, transactions partagées"`

---

### Task 3: Journaliser et annuler — déplacements manuels (places gardées), lecture et annulation en cascade

**Files:**
- Create: `src/server/repositories/history.ts`, `src/server/routes/history.ts`
- Modify: `src/server/repositories/replacement.ts` (`persist` renvoie l'id du recasement ; nouvelle `persistManualMove` ; `manualMove` journalisé ; `recomputeKeys` et `restoreSnapshot` exportés)
- Modify: `src/server/repositories/categories.ts` (export `markArranged(t: AppDb, categoryIds: string[]): void` : `arranged = true` là où `bracket_json` n'est pas nul)
- Modify: `src/server/app.ts` (enregistrer les routes), `src/server/auth/permissions.ts` (`'POST /history/undo'` dans les écritures de la Table centrale)
- Test: `tests/server/history.test.ts`, `tests/server/permissions.test.ts` (route ajoutée)

**Interfaces:**
- Consumes: Task 1 (`undoSet`, `compositionChanged`, `lockedReason`, `CHANGED_REASON`, types), Task 2 (`historyEntries`, `atomically`).
- Produces (`history.ts`) :
  ```ts
  export interface EntrySpec { kind: HistoryKind; groupId?: string | null; waveId: string | null; summary: HistorySummary; recasementIds?: string[]; registrations?: string[] }
  export async function recorded<T>(db: AppDb, competitionId: string, spec: EntrySpec | ((result: T) => EntrySpec), action: () => Promise<T>): Promise<{ result: T; historyId: string | null }>;
  export async function listHistory(db: AppDb, competitionId: string, waveId: string | null): Promise<{ entries: HistoryEntryView[] }>;
  export async function undoHistory(db: AppDb, competitionId: string, ids: string[], expect: string[] | null): Promise<{ undone: string[] }>;
  export function entryOfRecasement(db: AppDb, competitionId: string, recasementId: string): string | undefined;
  ```
  `recorded` : dans `atomically` — lire toutes les lignes `categories` de la compétition, exécuter `action`, `syncCategories`, relire ; `categoryIds` = lignes changées (toutes colonnes sauf `version`, `updated_at`), créées ou supprimées ; `before_json` = `{ categories: <lignes d'avant changées ou supprimées, colonnes drizzle complètes sauf version/updatedAt>, created: <ids créés>, registrations: <discipline, ruleset, weightClassId d'avant des inscriptions de spec.registrations> }` ; `after_members_json` = membres présents (presence ≠ absent) de chaque catégorie touchée ; aucune différence et aucun recasement → rien d'écrit, `historyId: null`.
  Annuler une entrée (dans l'ordre du lot, plus récente d'abord) : `restoreSnapshot` de ses recasements (ordre inverse) et `status='undone'` sur eux ; restaurer `registrations` d'avant ; réinsérer/réécrire les lignes `categories` d'avant (même id) ; `status='undone'`, `undone_at` = maintenant. Puis `syncCategories` et `recomputeKeys` des catégories touchées par les entrées reprises de l'ancien journal (sans `before.categories`).
  `undoHistory` : lot = `undoSet(toutes, ids)` ; si `expect` n'est pas nul et diffère du lot (ids triés) → `StaleProposalError('Un autre poste a modifié ces tableaux : la liste est mise à jour.')` ; si une catégorie touchée par le lot (ou la catégorie actuelle d'un inscrit d'une entrée à recasement) est lancée/terminée ou d'une session lancée → `CategoryLockedError(lockedReason(label))` ; si `compositionChanged` → `CategoryLockedError(CHANGED_REASON)`.
  `listHistory` : toutes les entrées (cascade calculée sur toutes), filtrées ensuite par `waveId` (null : toutes), plus récente d'abord ; `blocked` et `cascade` calculés comme `undoHistory`.
- Produces (`replacement.ts`) : `persistManualMove(db: AppDb, competitionId: string, state: State, registrationId: string, categoryId: string): { recasementId: string; warnings: string[]; fromCategoryId: string | null }` — écrit le déplacement (comme `manualMove` aujourd'hui) **et** `markArranged` sur la catégorie de départ et d'arrivée (places gardées, spec §2.6) ; sans synchronisation. `manualMove(...)` renvoie désormais `{ warnings: string[]; historyId: string | null }`, `kind: 'manual'`, raison `Placé à la main`.
- Routes : `GET /api/competitions/:id/history?waveId=` → `{ entries }` ; `POST /api/competitions/:id/history/undo` body `{ ids: string[]; expect: string[] }` → `{ undone: string[] }`. `POST /replacement/move` renvoie `{ warnings, historyId }`.

- [ ] **Step 1: Write the failing tests** (`history.test.ts`, mêmes aides que `free-tableaux.test.ts`)
  - « déplacement manuel journalisé » : `move(r, cat)` → une entrée `manual`, `names`, `fromLabel`/`toLabel`, `categoryIds` contient départ et arrivée.
  - « places gardées » : tableau à élimination de 4 (aucun échange) ; on déplace un 5e combattant dedans → les deux combats d'avant gardent leurs deux combattants (`bracket` comparé avant/après), `arranged` vrai sur les deux catégories.
  - « annuler remet exactement » : déplacer puis `POST /history/undo { ids:[h], expect:[h] }` → catégories et `bracket` identiques à avant le déplacement, entrée `undone` avec `undoneAt`.
  - « cascade » : déplacer A vers X (h1), puis B vers X (h2) ; `GET /history` → `h1.cascade = [h2]` ; annuler h1 avec `expect=[h2,h1]` → les deux annulées.
  - « expect périmé » (Review Focus 1) : annuler h1 avec `expect=[h1]` alors que h2 dépend → 409 et rien d'annulé.
  - « catégorie supprimée puis restaurée » (Review Focus 2) : déplacer le seul combattant d'une catégorie (elle disparaît), annuler → elle revient avec le **même id** et son tableau.
  - « catégorie lancée » : après un déplacement, saisir un résultat dans la catégorie d'arrivée → `blocked` = `Karaté · Jiyu · … est lancée : déverrouillez-la pour annuler.` et `POST /history/undo` → 409/423 (même code que `CategoryLockedError` aujourd'hui).
  - « session » : `GET /history?waveId=w` ne rend que les entrées de la session.

- [ ] **Step 2: Run** `npx vitest run tests/server/history.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `history.ts`, routes, `persistManualMove`, `markArranged`, permissions.
- [ ] **Step 4: Run** `npx vitest run tests/server` — Expected: PASS (les tests existants de `/replacement/move` acceptent la réponse enrichie).
- [ ] **Step 5: Commit** — `git commit -m "feat(historique): déplacements manuels journalisés (places gardées), lecture et annulation en cascade"`

---

### Task 4: Plan, réaffectations, « Ne combat pas » et anciennes routes d'annulation par l'historique

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`applyPlan`, `applyProposalById`, `withdrawRegistration`, `undoRecasement`, `undoManualMove`)
- Test: `tests/server/history.test.ts` (ajouts), `tests/server/replacement.test.ts` (adapter les tests qui attendaient « Annulez d'abord la réaffectation plus récente de ce combattant. »)

**Interfaces:**
- Consumes: Task 3 (`recorded`, `undoHistory`, `entryOfRecasement`).
- Produces : chaque application du plan a un `groupId = crypto.randomUUID()` ; **une entrée `plan` par déplacement** (`recorded` autour de chaque `persistAll`, dans la transaction existante, raison = `move.reason`) ; `applyProposalById` → une entrée `reaffectation` (tous les recasements d'un « split ») ; `withdrawRegistration` → `withdraw`. `undoRecasement(db, cid, recasementId)` devient : `undoHistory(db, cid, [entryOfRecasement(...)], null)` (cascade, plus de refus « plus récente ») ; `undoManualMove` idem via la dernière réaffectation `M`.

- [ ] **Step 1: Write the failing tests**
  - « plan groupé » : appliquer un plan à 2 déplacements → 2 entrées `plan` de même `groupId`, raisons reprises.
  - « plan avec catégorie créée » (Review Focus 4) : plan dont un déplacement crée une catégorie (`new:`), annuler ce seul déplacement → catégorie créée supprimée, chaque inscrit présent est dans le tableau de sa catégorie (`bracket.entrants` ⊇ membres présents).
  - « annuler une réaffectation ancienne emporte la plus récente » : deux réaffectations du même combattant, `POST /replacement/undo` sur la première → les deux annulées.
- [ ] **Step 2: Run** `npx vitest run tests/server/history.test.ts tests/server/replacement.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server` puis `npm run test:perf` — Expected: PASS (limites actuelles : 150 inscrits 4,5 s, 500 : 15 s).
- [ ] **Step 5: Commit** — `git commit -m "feat(historique): plan, réaffectations et « Ne combat pas » journalisés ; annulations existantes en cascade"`

---

### Task 5: Actions des tableaux journalisées ; tableaux libres

**Files:**
- Modify: `src/server/repositories/categories.ts` (`swapEntrants`, `redraw`, `updateCategory`), `src/server/routes/categories.ts`
- Modify: `src/server/repositories/free-tableaux.ts` (`updateFreeTableau`, `deleteFreeTableau`), sa route (`src/server/routes/free-tableaux.ts` ou là où sont `POST/PATCH/DELETE /free-tableaux`)
- Test: `tests/server/history-tableaux.test.ts`, `tests/server/free-tableaux.test.ts` (ajouts)

**Interfaces:**
- Consumes: Task 3.
- Produces :
  - `swapEntrants` → `places` (`registrationIds: [a, b]`, `detail` = libellé de la catégorie) ; `redraw` → `redraw` ; `updateCategory` → `format` **seulement** si `format`, `repechage` ou `thirdPlace` changent (`detail` = `${libellé} : ${avant} ➜ ${après}` ; libellés : `ALL_FORMAT_LABELS` de `src/web/pages/BracketsPage.tsx` déplacés dans `src/domain/brackets/format-labels.ts` pour être partagés, « Automatique » pour `null` ; repêchage / 3e place : `Repêchage : Comme la compétition ➜ Oui`, `Combat pour la 3e place : Non ➜ Oui`) ; statut, zone, session, ordre : pas journalisés.
  - `updateFreeTableau` → `free` si discipline ou règlement changent (`registrations` = ses membres, `detail` = `${nom} : ${avant} ➜ ${après}`, ex. `Gala 1 : Karaté · Jiyu ➜ Kata`) ; renommage seul : pas journalisé.
  - Les routes `POST /categories/:cid/swap`, `/redraw`, `PATCH /categories/:cid` renvoient la catégorie **plus** `historyId: string | null`.
  - `freeTableauDeleteTargets(db, cid, categoryId): string[]` : pour chaque membre, l'entrée de sa dernière réaffectation `M` (sinon l'erreur actuelle) ; route `GET /api/competitions/:id/free-tableaux/:cid/delete-preview` → `{ targets: string[] }`. `deleteFreeTableau(db, cid, categoryId, expect: string[] | null)` = dans `atomically` : `undoHistory(db, cid, targets, expect)` puis suppression ; la route `DELETE` lit `expect` en paramètre de requête `?expect=id1,id2` (absent : pas de contrôle).
- [ ] **Step 1: Write the failing tests** (`history-tableaux.test.ts`)
  - échange de places journalisé puis annulé → tableau d'avant ; `redraw` annulé → tableau d'avant (même graine) ; changement de format annulé → `format` d'avant.
  - « changement hors historique » (Review Focus 3) : échange de places, puis un inscrit du tableau marqué absent (`PUT …/weigh-in` ou route de présence existante) → l'entrée `places` a `blocked = CHANGED_REASON` ; un déplacement fait avant reste annulable (sa cascade ne contient pas l'échange… sinon il est bloqué aussi : vérifier les deux cas).
  - « tableau libre » : changer sa discipline puis annuler → membres et clé d'avant ; supprimer un tableau libre → `delete-preview` rend les entrées qui y ont mis ses membres, la suppression les annule (cascade comprise) ; suppression avec `expect` périmé → 409 et rien de supprimé.
- [ ] **Step 2: Run** `npx vitest run tests/server/history-tableaux.test.ts tests/server/free-tableaux.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(historique): échanges de places, tirages, formats et tableaux libres journalisés et annulables"`

---

### Task 6: Échange entre deux catégories ; aperçus avec « même club »

**Files:**
- Create: `src/server/repositories/exchange.ts`
- Modify: `src/server/routes/replacement.ts` (routes), `src/server/auth/permissions.ts` (`'POST /replacement/exchange'`, `'POST /replacement/exchange/preview'`)
- Modify: `POST /replacement/preview` (branche `move`) : ajoute `sameClub: string[]`
- Test: `tests/server/exchange.test.ts`, `tests/server/free-tableaux.test.ts` (cas « membre arrivé par un échange »)

**Interfaces:**
- Consumes: Task 1 (`replaceEntrant`, `newSameClubPairs`, `sameClubSentence`), Task 2 (`dryRun`), Task 3 (`persistManualMove`, `recorded`).
- Produces :
  ```ts
  export async function exchangePreview(db: AppDb, competitionId: string, a: string, b: string): Promise<{ warnings: string[]; sameClub: string[] }>;
  export async function exchangeEntrants(db: AppDb, competitionId: string, a: string, b: string): Promise<{ warnings: string[]; sameClub: string[]; historyId: string | null }>;
  ```
  Refus : même catégorie (`RegistrationValidationError(['Échange impossible : ces deux combattants sont dans la même catégorie.'])`), absent, catégorie lancée/session lancée (`CategoryLockedError` comme `manualProposal`). Écriture (dans `recorded`, `kind: 'exchange'`, `registrationIds: [a, b]`, `fromLabel`/`toLabel` = les deux catégories, raison `Échangés à la main`) : `persistManualMove(a → catégorie de b)` puis `persistManualMove(b → catégorie de a)` sur l'état rechargé, puis réécrire les deux `bracket_json` avec `replaceEntrant` (chacun **à la place exacte** de l'autre) et `arranged = true`. `warnings` = règles enfreintes des deux déplacements préfixées du nom (`GARNIER Hugo : Sexe différent.` — reprendre les textes de `moveTargetsFor`). `sameClub` = phrases des **nouvelles** paires même club dans les deux tableaux (aperçu : calculé dans `dryRun`).
  Routes : `POST /replacement/exchange/preview` et `POST /replacement/exchange`, body `{ a: string; b: string }`.
- [ ] **Step 1: Write the failing tests** : échange de deux combattants de deux tableaux à élimination de 4 → chacun au combat et du côté de l'autre, les autres combats inchangés, une seule entrée `exchange` avec deux recasements, les deux `placementLocked` et type `M` ; annulation → tout comme avant ; aperçu sans écriture (catégories inchangées) avec `sameClub` quand l'arrivant rencontre son club au 1er tour ; refus même catégorie ; suppression d'un tableau libre contenant B arrivé par échange → A revient aussi dans sa catégorie d'avant.
- [ ] **Step 2: Run** `npx vitest run tests/server/exchange.test.ts tests/server/free-tableaux.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(tableaux): échange de deux combattants entre catégories, aperçus avec avertissement même club"`

---

### Task 7: « Repartir de zéro » en cascade

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`resetSorting`, `applyReset`, `ResetPreview`, `resetReplacement`)
- Test: `tests/server/replacement.test.ts` (tests existants de remise à zéro : verts), `tests/server/history.test.ts` (ajouts)

**Interfaces:**
- Consumes: Task 3/4 (entrées), Task 1 (`undoSet`, `RESET_KINDS`).
- Produces : `ResetPreview` gagne `cascade: string[]` (ids des entrées `places`/`redraw`/`format`/`free` annulées avec). Règles (spec §3.7) :
  - cibles = entrées actives de `RESET_KINDS` de la session (`wave_id` ; entrée reprise sans session : la règle de repli actuelle via son recasement) ;
  - une cible **reste** si son lot `undoSet` contient une entrée touchant une catégorie lancée/terminée ou d'une session lancée (`kept`, raison `frozen`/`started` comme aujourd'hui) ; si son lot contient une entrée de `RESET_KINDS` d'une **autre** session → `blockedBy` (nom du combattant), remise à zéro refusée en entier (message actuel) ;
  - lot final = `undoSet(toutes, cibles non restantes)`, annulé comme `undoHistory` ; puis **effacement** des entrées annulées par la remise à zéro et de leurs recasements, et des entrées déjà annulées de `RESET_KINDS` de la session ; refus et cartes de côté : inchangés ; essai à blanc (`dryRun`) pour `refusal` comme aujourd'hui.
- [ ] **Step 1: Write the failing tests** : exemple de la spec (plan met GUERIN en -42, échange de places BLANC ↔ GUERIN, remise à zéro → GUERIN en -38, échange annulé et effacé de l'historique) ; un changement de format sur une catégorie non touchée reste (entrée toujours `active`) ; `preview.cascade` contient l'id de l'échange de places.
- [ ] **Step 2: Run** `npx vitest run tests/server/history.test.ts tests/server/replacement.test.ts` — Expected: FAIL (nouveaux tests).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/server` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(historique): « Repartir de zéro » en cascade"`

---

### Task 8: Données côté web et message « Annuler »

**Files:**
- Modify: `src/web/api.ts`
- Create: `src/web/components/history/undoToast.tsx`
- Test: `tests/web/undo-toast.test.ts` (logique de décision seulement)

**Interfaces:**
- Consumes: routes des Tasks 3–7.
- Produces (`api.ts`) : `useHistory(id: string, waveId: string | null)` (clé `['history', id, waveId]`, rechargée par `useInvalidateDay` puisque `q.queryKey[1] === id`) ; `useUndoHistory(id)` (`{ ids, expect }`, invalide la journée en succès **et** en erreur) ; `useExchangePreview(id)` ; `useExchange(id)` ; `useFreeTableauDeletePreview(id: string, cid: string | null)` ; `useManualMove`, `useSwap`, `useRedraw`, `useUpdateCategory` exposent `historyId` dans leur résultat ; type `PreviewData` gagne `sameClub?: string[]`. Réexporter `HistoryEntryView` depuis `src/domain/history/types.ts`.
- Produces (`undoToast.tsx`) : `useUndoToast(competitionId: string): (text: string, historyId: string | null, sameClub?: string[]) => void` — notification Mantine (`autoClose: 5000`) avec le texte, les phrases même club en orange en dessous, et un bouton **Annuler** (`data-testid="undo-toast-action"`) ; au clic : relire `GET /history`, calculer `undoSet(entries, [historyId])` ; lot = cette seule entrée → `POST /history/undo` direct ; sinon ouvrir `UndoHistoryDialog` (Task 9) via un événement de contexte. Fonction pure testée : `toastUndoPlan(entries: HistoryEntryView[], historyId: string): 'direct' | 'dialog' | 'gone'` (`gone` : déjà annulée).
- [ ] **Step 1: Test** `toastUndoPlan` (3 cas). **Step 2: Run** `npx vitest run tests/web/undo-toast.test.ts` — FAIL. **Step 3: Implement.** **Step 4: Run** + `npm run typecheck` — PASS. **Step 5: Commit** — `git commit -m "feat(web): données de l'historique, échange, message « Annuler »"`

---

### Task 9: Panneau d'historique, fenêtre d'annulation et mise en évidence ; Réaffectation et Liste

**Files:**
- Create: `src/web/components/history/HistoryPanel.tsx`, `HistoryEntryCard.tsx`, `UndoHistoryDialog.tsx`, `highlight.tsx`
- Modify: `src/web/pages/ReplacementPage.tsx` (la section « Réaffectations validées » devient l'historique ; « Repartir de zéro » montre `preview.cascade` mises en évidence), `src/web/pages/BracketsPage.tsx` (bouton « Historique (n) » qui ouvre le panneau), la fenêtre de suppression d'un tableau libre (`src/web/components/FreeTableauxSection.tsx`) avec la cascade
- Modify: `src/web/help.ts` (`recasement.valides` → titre « Historique », textes de la spec §3) et `tests/web/help.test.ts` si besoin
- Test: `tests/e2e/historique.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`undoSet`, `entryHeadline`, `undoEffect`, `HISTORY_KIND_LABELS`, `filterOfKind`), Task 8.
- Produces :
  - `HistoryPanel({ competitionId, waveId, mode: 'drawer' | 'inline', opened?, onClose?, onSee? })` — `drawer` : Mantine `Drawer` à droite, 400 px (plein écran sous `sm`), sans voile, la page se resserre au-dessus de `lg` ; `inline` : la liste dans la carte de la Réaffectation. Filtres `SegmentedControl` Tout / Plan / À la main / Tableaux. Bloc du plan par `groupId` (« Plan d’ensemble appliqué · n déplacements », **Annuler tout le plan…**, « n ne peut pas être annulé (catégorie lancée) »). Lignes annulées : barrées, grisées, « Annulée à hh:mm ». Sous un bouton dont la cascade n'est pas vide : « Annule aussi : 09:52 · BLANC Zoé ↔ GUERIN Emma (places), … ». Bouton grisé + raison si `blocked`. **Voir** → `onSee(categoryIds)` (sur la Liste/Réaffectation : ouvre la planche, Task 11).
  - `UndoHighlightProvider` / `useUndoHighlight(): { main: Set<string>; also: Set<string>; categories: Set<string>; show(targets: string[]): void; clear(): void }` — survol ou focus d'un « Annuler… » → `show` ; la fenêtre ouverte garde la mise en évidence.
  - `UndoHistoryDialog({ competitionId, targets, title, onClose })` — titres « Annuler cette action ? » / « Annuler tout le plan d’ensemble ? » ; lignes dans l'ordre du lot avec `undoEffect`, étiquettes « demandée » / « annulée aussi » ; phrase de cascade et « Reste en place : … » (textes exacts de la maquette v4) ; « Un combattant change de session en revenant. » si une entrée à recasement change de session ; « Les tableaux concernés sont remis comme avant ; s’ils étaient imprimés, réimprimez-les. » ; boutons « Garder » / « Annuler cette action » ou « Annuler ces n actions » → `POST /history/undo { ids: targets, expect: lot }`.
  - `data-testid` : `history-open`, `history-panel`, `history-filter`, `history-entry` (+ `data-entry`, `data-highlight="main"|"also"`), `history-plan`, `history-undo`, `history-undo-plan`, `history-see`, `undo-dialog`, `undo-confirm`.
- [ ] **Step 1: Write the failing e2e** (`historique.spec.ts`, compétition « Coupe historique annulable ») : via l'API, deux déplacements manuels liés (A puis B vers la même catégorie) ; Réaffectation → l'historique montre 2 lignes, la plus ancienne dit « Annule aussi : … » ; survol de son « Annuler… » → la plus récente a `data-highlight="also"` ; fenêtre : 2 lignes, « annulée aussi » ; confirmer → les deux barrées « Annulée à » ; filtre « Tableaux » vide ; à 360 px, rien de coupé (`clipped()`).
- [ ] **Step 2: Run** `npx playwright test tests/e2e/historique.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx playwright test tests/e2e/historique.spec.ts tests/e2e/recasement.spec.ts tests/e2e/placements-manuels.spec.ts tests/e2e/plan-d-ensemble.spec.ts` — Expected: PASS (adapter les e2e qui visaient `recasement-row` / `recasement-undo` aux nouveaux identifiants).
- [ ] **Step 5: Commit** — `git commit -m "feat(historique): panneau, annulation en cascade mise en évidence, dans la Réaffectation et les Tableaux"`

---

### Task 10: « Même club » à l'écran ; aperçus du déplacement

**Files:**
- Modify: `src/web/components/BracketView.tsx` (club en surbrillance orange, `data-testid="same-club"`, pas en `printable`)
- Modify: `src/web/components/MoveEntrantPanel.tsx` (fenêtre : phrases `preview.data.sameClub` en orange ; message « Annuler » via `useUndoToast` après un déplacement), `src/web/pages/BracketsPage.tsx` (échange de places de la Liste : `useUndoToast` avec les nouvelles paires même club calculées par `newSameClubPairs` entre l'ancien et le nouveau tableau ; redraw et format : message « Annuler » aussi)
- Test: `tests/e2e/tableaux.spec.ts` (ajout)

**Interfaces:**
- Consumes: Task 1 (`sameClubFirstRound`, `newSameClubPairs`, `sameClubSentence`), Task 8 (`useUndoToast`, `historyId`).
- [ ] **Step 1: e2e** « même club au 1er tour » : 4 inscrits dont deux du même club ; échanger à la main pour les mettre face à face → deux `same-club` visibles, message contenant « se rencontrent au 1er tour. » et bouton Annuler ; cliquer Annuler → plus de `same-club`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/tableaux.spec.ts -g "même club"` — FAIL. **Step 3: Implement.** **Step 4: Run** `npx playwright test tests/e2e/tableaux.spec.ts tests/e2e/placements-manuels.spec.ts` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(tableaux): même club au 1er tour signalé ; « Annuler » après chaque action"`

---

### Task 11: Planche — modèle pur et affichage (sans glisser)

**Files:**
- Create: `src/web/components/planche/model.ts`, `Planche.tsx`, `PlancheToolbar.tsx`, `CategoryCard.tsx`, `FighterChip.tsx`, `LoneTray.tsx`
- Modify: `src/web/pages/BracketsPage.tsx` (sélecteur « Planche / Liste », `data-testid="brackets-view"`, Planche par défaut, choix retenu dans `localStorage` clé `tableaux-vue` avec try/catch ; « Ouvrir dans la liste » depuis une carte ; `onSee` de l'historique)
- Modify: `src/web/help.ts` (aide `tableaux` : la planche)
- Test: `tests/web/planche-model.test.ts`

**Interfaces:**
- Consumes: `Category` (`src/domain/categories.ts`), `compareKeys`, `categoryLabelParts`, `categoryPassages` (`src/web/passages.ts`), `normalizeName`, Task 1 (`sameClubFirstRound`).
- Produces (`model.ts`) :
  ```ts
  export type PlancheSort = 'categorie' | 'zone';
  export interface PlancheGroup { key: string; title: string; categories: Category[] }
  export function groupTitle(c: Category, grid: CategoryGrid): string;      // « Karaté · Jiyu — Benjamins », « Kata — Minimes », « Tableaux libres »
  export function cardTitle(c: Category, grid: CategoryGrid): string;       // libellé sans la discipline/règlement : « Benjamins F · -35 kg » ; tableau libre : son nom
  export function plancheGroups(cats: Category[], o: { sort: PlancheSort; grid: CategoryGrid; zoneOf: (c: Category) => { id: string; name: string } | null; zoneOrder: string[] }): PlancheGroup[];
  export function plancheFilter(cats: Category[], o: { query: string; names: Map<string, string>; onlyTodo: boolean; cases: Map<string, number> }): Category[];
  export function loneFighters(cats: Category[], o: { waveId: string | null; scopeAll: boolean }): { categoryId: string; registrationId: string }[];
  export function shownOnPlanche(c: Category): boolean; // au moins un présent, ou tableau libre
  ```
  Groupe d'une catégorie à tranches regroupées : sa première tranche. Classement par zone : groupes dans `zoneOrder`, « Sans zone » en dernier, catégories dans l'ordre `compareKeys`. Recherche : tous les mots (`normalizeName`) dans `libellé + noms des membres`.
- Rendu (maquette v4) : barre (session `useSelectedWave` comme la Liste, recherche `planche-search`, « Classer par » `planche-sort`, « Seulement à traiter » `planche-todo`, « Historique (n) » `history-open`), ligne de raccourcis (`planche-jump`), bac (`planche-tray`, « Sans adversaire (n) », « À glisser vers une catégorie, ou sur un combattant pour échanger. », vide : « Tout le monde a un adversaire. »), groupes (`planche-group`), cartes (`planche-card` + `data-category`, badges zone/inscrits/état/« Sans adversaire »/« n cas à traiter »/format/« Même club » `card-same-club`), pastilles (`planche-chip` + `data-entrant`, club — en surbrillance orange `same-club` quand la pastille est dans une paire de `sameClubFirstRound` —, badge M, `ReplacementBadge`), contenu réduit par combat du 1er tour / poule / « SANS ADVERSAIRE », **Agrandir/Réduire** (`card-grow`) → `BracketView` pleine largeur + **Nouveau tirage** (`card-redraw`). Vide : `EmptyState` « Aucune catégorie. » / « Aucune catégorie ne correspond. ». Carte lancée : grisée. Poste Zone : aucun bouton d'action.
- [ ] **Step 1: Tests** (`planche-model.test.ts`) : ordre et titres de groupes sur un jeu de catégories (Karaté Jiyu Benjamins F -35, M -40 ; Minimes ; Kata Minimes F ; tableau libre vide) = ordre de l'appli, « Tableaux libres » en dernier ; classement par zone avec « Sans zone » en dernier ; recherche `minimes -50` et `fontaine` ; recherche sans résultat → `[]` ; `shownOnPlanche` vrai pour un tableau libre vide, faux pour une catégorie dont tous sont absents ; `loneFighters` inclut les catégories en attente.
- [ ] **Step 2: Run** `npx vitest run tests/web/planche-model.test.ts` — FAIL. **Step 3: Implement** modèle puis composants. **Step 4: Run** test + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(tableaux): planche de toutes les catégories (groupes, recherche, zones, bac sans adversaire)"`

---

### Task 12: Planche — glisser-déposer, clic-clic, confirmations, historique et mise en évidence

**Files:**
- Create: `src/web/components/planche/useDragMove.ts`, `DropConfirmDialog.tsx`
- Modify: `src/web/components/planche/model.ts` (`dropAction`), `Planche.tsx`, `CategoryCard.tsx`, `FighterChip.tsx`, `LoneTray.tsx`
- Test: `tests/web/planche-model.test.ts` (ajouts), `tests/e2e/planche.spec.ts`

**Interfaces:**
- Consumes: Task 8 (`useSwap`, `useManualMove`, `usePreviewReplacement`, `useExchange`, `useExchangePreview`, `useUndoToast`), Task 9 (`HistoryPanel`, `useUndoHighlight`), Task 11.
- Produces :
  ```ts
  export type DropAction = { kind: 'swap' | 'exchange' | 'move'; from: string; to: string } | { kind: 'none' } | { kind: 'locked' };
  export function dropAction(src: { registrationId: string; categoryId: string }, target: { registrationId?: string; categoryId: string }, cats: Category[]): DropAction;
  export function useDragMove(o: { readOnly: boolean; onAction: (a: DropAction & { source: string; target?: string }) => void }): {
    selected: string | null; dragProps(chip: { registrationId: string; categoryId: string; locked: boolean }): object;
    dropProps(target: { registrationId?: string; categoryId: string; locked: boolean }): object; cancel(): void;
  };
  ```
  `dropAction` : même pastille ou même carte sans pastille → `none` ; une des deux catégories lancée/terminée/`launchLocked` → `locked` ; même catégorie → `swap` ; pastille d'une autre catégorie → `exchange` ; carte d'une autre catégorie → `move`.
  Effets (spec §2.6) : `swap` immédiat + `useUndoToast` (« Places échangées : A ↔ B ») ; `exchange` → `DropConfirmDialog` « Échanger deux combattants » (aperçu `exchange/preview` : « De … ➜ Vers … » pour chacun, « Règles enfreintes », changement de session `WaveChangeWarning`, phrases même club, « Confirmer l’échange ») ; `move` → « Déplacement manuel » (aperçu `replacement/preview` + `ProposalPreview` comme `MoveEntrantPanel`, « Confirmer le déplacement ») ; `locked` → notification « Catégorie lancée : déverrouillez-la d’abord. ». Pendant le glisser : pastille cible en pointillé, carte cible « Déposer ici : déplacer dans cette catégorie », carte lancée refusée. Clic-clic : bandeau `planche-banner` « X choisi(e) : cliquez sur un autre combattant pour échanger, ou sur une catégorie pour l’y déplacer. (Échap pour annuler) ». Historique : panneau `drawer` ; `onSee` fait défiler et entoure les cartes ~2 s (passe la session sur « Toutes » si besoin) ; `useUndoHighlight().categories` entoure les cartes en orange. `data-testid` : `planche-banner`, `drop-dialog`, `drop-confirm`.
- [ ] **Step 1: Tests** — unitaires `dropAction` (5 cas) ; e2e `planche.spec.ts` (compétition « Coupe planche glisser ») : glisser (`locator.dragTo`) une pastille du bac sur un combattant d'une autre catégorie → fenêtre d'échange → confirmer → les deux pastilles ont changé de carte avec badge M ; glisser une pastille sur un **tableau libre vide** → déplacement confirmé, la carte du tableau libre contient la pastille ; échange de places dans une carte → message « Annuler » → cliquer → places d'avant ; mode clic-clic (clic pastille, bandeau, clic carte) ; carte lancée refuse le dépôt ; ouvrir l'historique, survoler « Annuler… » d'une action avec cascade → la carte concernée entourée ; recherche sans résultat → « Aucune catégorie ne correspond. » ; à 360 px : rien de coupé.
- [ ] **Step 2: Run** `npx vitest run tests/web/planche-model.test.ts && npx playwright test tests/e2e/planche.spec.ts` — FAIL. **Step 3: Implement.** **Step 4: Run** même commande — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(tableaux): glisser-déposer et clic-clic sur la planche, échanges et déplacements confirmés, historique intégré"`

---

### Task 13: Documentation, vérification complète et contrôle dans Chrome

**Files:**
- Modify: `docs/guide-utilisateur.md` (planche, échange, historique, annulation en cascade, même club), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 38), `docs/superpowers/plans/2026-10-21-99-bilan.md` (section étape 38 : décisions 💡 de la spec, écarts éventuels)
- [ ] **Step 1: Run** `npm run typecheck && npx vitest run && npm run test:perf` — Expected: tout vert (noter les nombres de tests).
- [ ] **Step 2: Run** `npx playwright test` (seul) — Expected: tout vert.
- [ ] **Step 3: Contrôle Chrome** (Claude in Chrome, base temporaire de démo sur le port 3200, thème clair et sombre, 1280 px et 360 px) : planche (groupes, zone, recherche, bac), glisser un combattant seul sur un autre (échange), dépôt sur une carte, message Annuler, historique (survol, cascade, plan groupé), Réaffectation (historique en place de « Réaffectations validées », Repartir de zéro avec cascade), tableau libre vide comme cible, même club, poste Zone en lecture seule. Corriger tout défaut visible (chaque correction revérifiée dans Chrome).
- [ ] **Step 4: Commit** — `git commit -m "docs: guide, feuille de route et bilan de l'étape 38"`
