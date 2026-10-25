# Catégories fermées et cartes mises de côté — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** pour une compétition, fermer des catégories d'inscription (tranche × sexe × discipline × règlement), traiter en Réaffectation les inscrits de ces catégories (déplacer ou « Ne combat pas »), et pouvoir mettre une carte de Réaffectation de côté sans la perdre.

**Architecture :** une fonction de domaine pure (`src/domain/closed-categories.ts`) décide si une case est fermée, quelles tranches sont offertes et ce que dit le résumé. Une table `closed_categories` stocke les cases fermées ; elle remplace la case « Proposée sur la fiche club » (`age_bands.on_club_form`, qui n'est plus lue). Le moteur de Réaffectation reçoit les cases fermées et les cartes mises de côté dans son `State`, comme il reçoit déjà les refus. « Ne combat pas » est une colonne `registrations.withdrawn_reason`. Chaque retrait est inscrit dans le journal `recasements` sous le type `W`, ce qui réutilise l'historique et le bouton « Annuler ».

**Tech Stack :** TypeScript 7 (natif), Fastify 5, Drizzle + better-sqlite3, React 19 + Mantine 8, Vitest, Playwright (Chrome).

**Spec :** `docs/superpowers/specs/2026-10-25-categories-fermees-et-cartes-de-cote-design.md`

## Global Constraints

- Travail sur la branche `etape-23-categories-fermees`, partie de `main`. Fusion en avance rapide (ff) à la fin, après la relecture.
- Node 22.23.2 (`.tool-versions`). Avant chaque commit : `npm run typecheck` et `npm test` passent.
- Interface et messages en français, avec les mêmes apostrophes typographiques (’) que le code voisin. Les textes cités dans ce plan sont à reprendre mot pour mot.
- Migrations : `npm run db:generate`. Les données se migrent par du SQL ajouté à la main en fin du fichier généré, après un `--> statement-breakpoint`. Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte.
- Toute nouvelle table de compétition : `...rowMeta()`, `competition_id` avec `onDelete: 'cascade'`, et une entrée dans `PACKAGE_TABLES` (`src/server/sync/package.ts`). Le test `unclassifiedTables` le vérifie.
- Toute nouvelle route d'écriture que la Table centrale doit pouvoir appeler va dans `TABLE_WRITES` (`src/server/auth/permissions.ts`). Les autres restent réservées à l'organisateur, sans rien ajouter.
- Les événements en direct (SSE) partent tout seuls après tout `POST`/`PUT`/`DELETE` réussi sous `/api/competitions/:id`. Il n'y a rien à faire pour eux.
- Clé d'une case : `${ageBandCode}|${sex}|${discipline}|${ruleset ?? ''}` (ex. `benjamin|F|shido-mix|jiyu`, `senior|M|kata|`).
- Neuf colonnes, dans cet ordre : karate/jiyu, karate/shobu, shido-boxing/jiyu, shido-boxing/shobu, shido-mix/jiyu, shido-mix/shobu, triathlon/jiyu, triathlon/shobu, kata/null. Pas de shobu pour une tranche `isMinor`.
- Commits au format conventionnel, en français (`feat(grille): …`, `feat(reaffectation): …`, `docs: …`).

## Review Focus

1. **Combattant inscrit en combat (ouvert) et en kata (fermé) :** seule l'inscription en kata a une carte. Si le coach réenregistre sa ligne en ligne avec le kata toujours coché, l'enregistrement est accepté et le « Ne combat pas » reste. Tests : tâche 4 (`ligne déjà enregistrée dans une catégorie fermée : reste modifiable`) et tâche 7 (`réenregistrer la ligne garde « ne combat pas »`).
2. **Catégorie réunissant plusieurs tranches, ou mixte, dont une partie seulement est fermée :** elle reste une cible de déplacement. Tests : tâche 1 (`categoryKeyClosed : fermée seulement si toutes ses parts le sont`) et tâche 6 (`cible multi-tranches à moitié ouverte : proposée`).
3. **Tranche retirée de la grille, ou modèle chargé, avec des cases fermées :** les lignes orphelines disparaissent, et un modèle enregistré avec `onClubForm` se charge encore. Tests : tâche 2 (`une tranche retirée de la grille emporte ses cases fermées`, `un modèle de grille avec onClubForm se charge encore`).
4. **« Tout classer automatiquement » avec une carte fermée et une carte mise de côté :** la carte fermée est déplacée, jamais retirée ; la carte mise de côté n'est pas touchée. Tests : tâche 6 (`classement automatique : déplace un combattant de catégorie fermée`) et tâche 8 (`classement automatique : ignore les cartes mises de côté`).
5. **Annuler un « Ne combat pas » après la réouverture de la catégorie :** le combattant revient dans sa catégorie normale, sans carte. Test : tâche 7 (`annuler « ne combat pas » après réouverture : catégorie normale, pas de carte`).

---

### Task 1 : Domaine des catégories fermées

**Files :**
- Create : `src/domain/closed-categories.ts`
- Test : `tests/domain/closed-categories.test.ts`

**Interfaces :**
- Consumes : `CategoryGrid`, `AgeBand`, `Sex`, `DisciplineId`, `Ruleset` (`src/domain/types.ts`) ; `CategoryKey` (`src/domain/categories.ts`) ; `DISCIPLINES`, `RULESETS` (`src/domain/disciplines.ts`).
- Produces :
  - `interface EntryCell { ageBandCode: string; sex: Sex; discipline: DisciplineId; ruleset: Ruleset | null }`
  - `const ENTRY_COLUMNS: readonly { discipline: DisciplineId; ruleset: Ruleset | null }[]` : les 9 colonnes, dans l'ordre des contraintes globales.
  - `entryKey(c: EntryCell): string`
  - `columnLabel(col: { discipline: DisciplineId; ruleset: Ruleset | null }): string` : `Karaté jiyu`, `Shido-mix-martial shobu`, `Kata`. C'est le libellé de `DISCIPLINES`, puis le règlement en minuscules.
  - `entryCells(grid: CategoryGrid): EntryCell[]` : toutes les cases valides, dans l'ordre tranches de la grille → F puis M → colonnes.
  - `isEntryClosed(closed: ReadonlySet<string>, c: EntryCell): boolean`
  - `categoryKeyClosed(closed: ReadonlySet<string>, key: CategoryKey): boolean` : vrai si **chaque** couple (tranche de `key.ageBandCodes`, sexe) est fermé pour `key.discipline`/`key.ruleset`. Le sexe `X` vaut F et M.
  - `offeredAgeBands(grid: CategoryGrid, closed: ReadonlySet<string>): AgeBand[]` : les tranches qui ont au moins une case ouverte.
  - `closedSummary(grid: CategoryGrid, closed: ReadonlySet<string>): string[]`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
import { expect, test } from 'vitest';
import { categoryKeyClosed, closedSummary, entryCells, entryKey, offeredAgeBands } from '../../src/domain/closed-categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const cells = (pred: (k: string) => boolean) => new Set(entryCells(grid).map(entryKey).filter(pred));

test('entryCells : 9 colonnes chez les adultes, 5 chez les mineurs (pas de shobu)', () => {
  const all = entryCells(grid);
  expect(all.filter((c) => c.ageBandCode === 'senior' && c.sex === 'F')).toHaveLength(9);
  expect(all.filter((c) => c.ageBandCode === 'cadet' && c.sex === 'F')).toHaveLength(5);
  expect(all.some((c) => c.ageBandCode === 'cadet' && c.ruleset === 'shobu')).toBe(false);
  expect(entryKey(all[0]!)).toBe('mini-poussin|F|karate|jiyu');
  expect(entryKey({ ageBandCode: 'senior', sex: 'M', discipline: 'kata', ruleset: null })).toBe('senior|M|kata|');
});

test('closedSummary : phrases en clair', () => {
  expect(closedSummary(grid, new Set())).toEqual([]);
  expect(closedSummary(grid, cells((k) => k.startsWith('benjamin|') && k.includes('|shido-mix|')))).toEqual(['Benjamins (F et M) : pas de Shido-mix-martial']);
  expect(closedSummary(grid, new Set(['senior|F|karate|shobu']))).toEqual(['Seniors (F) : pas de Karaté shobu']);
  expect(closedSummary(grid, new Set(['senior|F|karate|jiyu', 'senior|F|karate|shobu', 'senior|F|kata|']))).toEqual(['Seniors (F) : pas de Karaté, Kata']);
  expect(closedSummary(grid, cells((k) => k.startsWith('mini-poussin|')))).toEqual(['Mini-poussins : aucune catégorie ouverte']);
  expect(closedSummary(grid, new Set(['senior|F|kata|', 'senior|M|triathlon|jiyu']))).toEqual(['Seniors (F) : pas de Kata', 'Seniors (M) : pas de Triathlon jiyu']);
});

test('offeredAgeBands : une tranche entièrement fermée disparaît', () => {
  const codes = offeredAgeBands(grid, cells((k) => k.startsWith('mini-poussin|'))).map((b) => b.code);
  expect(codes).not.toContain('mini-poussin');
  expect(codes).toContain('poussin');
});

test('categoryKeyClosed : fermée seulement si toutes ses parts le sont', () => {
  const closed = new Set(['cadet|F|karate|jiyu', 'cadet|M|karate|jiyu']);
  const key = { discipline: 'karate' as const, ruleset: 'jiyu' as const, sex: 'F' as const, ageBandCodes: ['cadet'], weightClassIds: [] };
  expect(categoryKeyClosed(closed, key)).toBe(true);
  expect(categoryKeyClosed(closed, { ...key, ageBandCodes: ['cadet', 'junior'] })).toBe(false);
  expect(categoryKeyClosed(new Set(['cadet|F|karate|jiyu']), { ...key, sex: 'X' })).toBe(false);
  expect(categoryKeyClosed(closed, { ...key, sex: 'X' })).toBe(true);
});
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/domain/closed-categories.test.ts`
Expected : FAIL, module introuvable.

- [ ] **Step 3 : Écrire `src/domain/closed-categories.ts`**

Règle de `closedSummary`, tranche par tranche, dans l'ordre de la grille :
- toutes les cases de la tranche sont fermées → `${label} : aucune catégorie ouverte` ;
- sinon, pour chaque sexe, on liste les colonnes fermées. Quand **toutes** les colonnes existantes d'une discipline sont fermées pour ce sexe (jiyu et shobu, ou jiyu seul chez les mineurs), on n'écrit que la discipline (`Karaté`). Kata s'écrit `Kata` ;
- même liste non vide pour F et M → une seule ligne `${label} (F et M) : pas de ${liste.join(', ')}`. Sinon, une ligne par sexe qui a une liste : `(F)` d'abord, puis `(M)`.

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

Run : `npx vitest run tests/domain/closed-categories.test.ts`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/domain/closed-categories.ts tests/domain/closed-categories.test.ts
git commit -m "feat(grille): domaine des catégories fermées"
```

---

### Task 2 : Stockage, migration et API des cases fermées ; fin de « Proposée sur la fiche club »

**Files :**
- Modify : `src/server/db/schema.ts` (nouvelle table `closedCategories` ; commentaire sur `ageBands.onClubForm` : « plus lue depuis la migration 0021 : remplacée par closed_categories »)
- Create : `drizzle/0021_*.sql` (généré, avec la reprise des données ajoutée à la main)
- Create : `src/server/repositories/closed-categories.ts`
- Create : `src/server/routes/closed-categories.ts`, à enregistrer dans `src/server/app.ts` à côté de `categoryRoutes`
- Modify : `src/server/repositories/competitions.ts` (`getGrid` ne renvoie plus `onClubForm` ; `writeBandsAndLinks` ne l'écrit plus ; `replaceGrid` supprime les cases fermées des tranches retirées)
- Modify : `src/domain/types.ts` (retirer `AgeBand.onClubForm`), `src/domain/grid-ffk.ts`, `src/domain/api-schemas.ts` (`onClubForm: z.boolean().optional()`, accepté puis ignoré, pour les modèles anciens), `src/domain/grid.ts` (retirer la règle « Au moins une tranche d'âge doit être proposée sur la fiche club. »)
- Modify : les quatre filtres `b.onClubForm`, remplacés par `offeredAgeBands(grid, closed)` : `src/server/club-form-template.ts`, `src/server/club-form-pdf.ts` (signatures ci-dessous), `src/server/repositories/club-entry.ts` (`getClubEntry`), `src/web/components/PaperEntryTable.tsx`
- Modify : appelants des deux fiches : `src/server/routes/registrations.ts` (lignes ~150 et ~159), `src/server/mail.ts` (~97-98)
- Modify : `src/web/pages/GridEditorPage.tsx` (retirer la colonne « Fiche club » de la section des tranches)
- Modify : `src/web/api.ts` (hook `useClosedCategories`)
- Modify : `src/server/sync/package.ts` (`'closed_categories'` juste après `'age_links'` dans `PACKAGE_TABLES`)
- Test : `tests/server/closed-categories.test.ts`, `tests/server/migration-0021.test.ts` ; adapter `tests/domain/grid.test.ts` (règle retirée) et les tests qui construisent des `AgeBand` avec `onClubForm`

**Interfaces :**
- Consumes : tâche 1 (`EntryCell`, `entryKey`, `entryCells`, `isEntryClosed`, `offeredAgeBands`, `columnLabel`).
- Produces :
  - table `closed_categories (competition_id, age_band_code, sex 'F'|'M', discipline, ruleset text not null default '')`, clé primaire sur les cinq colonnes. `''` = pas de règlement (kata).
  - `closedSet(db: AppDb, competitionId: string): Set<string>` (clés `entryKey`)
  - `interface ClosedCategoriesView { closed: EntryCell[]; counts: Record<string, number>; locked: string[] }` : `counts[entryKey]` = inscriptions non déplacées (`placementLocked` faux) dont la case naturelle (tranche et sexe du combattant, discipline et règlement de l'inscription) est cette case ; `locked` = clés des cases couvertes par une catégorie `started`/`finished` ou `launchLocked`. Une case est couverte par une catégorie quand la discipline et le règlement sont les mêmes, que la tranche est dans `ageBandCodes` et que le sexe est le même (ou que la catégorie est `X`).
  - `getClosedCategories(db: AppDb, competitionId: string): Promise<ClosedCategoriesView>`
  - `setClosedCategories(db: AppDb, competitionId: string, cells: EntryCell[], closed: boolean): Promise<void>` : erreurs en `GridValidationError` (400, déjà traduit par `app.ts`), avec ces messages exacts :
    - case absente de `entryCells(grid)` : `Catégorie inconnue dans la grille.`
    - fermeture d'une case de `locked` : `${bandLabel} ${sex} ${columnLabel(col)} : catégorie déjà lancée, elle ne peut plus être fermée.`
    - plus aucune case ouverte après l'opération : `Au moins une catégorie doit rester ouverte.`
  - `GET /api/competitions/:id/closed-categories` → `ClosedCategoriesView`
  - `PUT /api/competitions/:id/closed-categories`, corps `{ cells: EntryCell[] (au moins 1), closed: boolean }` (zod `.strict()`) → 204. Réservée à l'organisateur.
  - `buildClubFormTemplate(competition: Competition, grid: CategoryGrid, closed: ReadonlySet<string>): OdsSheet[]`
  - `buildClubFormPdf(competition: Competition, grid: CategoryGrid, closed: ReadonlySet<string>): Promise<Buffer>`
  - web : `useClosedCategories(id: string)` → `useQuery<ClosedCategoriesView>`, clé `['closed-categories', id]`

- [ ] **Step 1 : Écrire les tests serveur qui échouent** (`tests/server/closed-categories.test.ts`, même montage que `tests/server/replacement.test.ts` : `buildApp({ dbPath: tmpDbPath() })`, une compétition)

Tests à écrire :
- `fermer puis rouvrir une case` : `PUT { cells: [{ ageBandCode: 'senior', sex: 'F', discipline: 'kata', ruleset: null }], closed: true }` → 204 ; `GET` → `closed` la contient. Puis `closed: false` → `GET` → `closed` vide.
- `case inconnue refusée` : `{ ageBandCode: 'cadet', sex: 'F', discipline: 'karate', ruleset: 'shobu' }` → 400, et le corps contient `Catégorie inconnue dans la grille.`
- `au moins une case ouverte` : fermer en une fois toutes les cases (construites avec `entryCells(ffkDefaultGrid())`) → 400 `Au moins une catégorie doit rester ouverte.`
- `compte des inscrits` : deux inscriptions karaté jiyu cadet F (`POST /registrations`, comme `reg()` dans `replacement.test.ts`) → `counts['cadet|F|karate|jiyu']` vaut 2.
- `case d'une catégorie lancée : verrouillée` : mettre la catégorie des deux inscrits en `started`, comme le fait déjà `tests/server/categories.test.ts` → `locked` contient `cadet|F|karate|jiyu`, et la fermer → 400 `Cadets F Karaté jiyu : catégorie déjà lancée, elle ne peut plus être fermée.`
- `une tranche retirée de la grille emporte ses cases fermées` : fermer `senior|F|kata|`, puis `PUT /grid` sans la tranche `v5` (après avoir fermé `v5|F|kata|`) → `GET` ne contient plus `v5|F|kata|` mais garde `senior|F|kata|`.
- `un modèle de grille avec onClubForm se charge encore` : `PUT /grid` avec des `ageBands` qui portent `onClubForm: false` → 204.

- [ ] **Step 2 : Écrire le test de migration qui échoue** (`tests/server/migration-0021.test.ts`, sur le modèle de `migration-0014.test.ts`)

Partir de `olderDb(20)`. Insérer une compétition `c1`, puis deux tranches non proposées (`on_club_form = 0`) : `cadet` (mineure) et `senior` (adulte), et une tranche proposée, `junior`. Après `openDb` :
- `select count(*) from closed_categories where age_band_code = 'cadet'` → **10** (5 colonnes × 2 sexes), aucune ligne `ruleset = 'shobu'` pour `cadet` ;
- `senior` → **18** ; `junior` → **0** ;
- la ligne kata est stockée avec `ruleset = ''`.

- [ ] **Step 3 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/server/closed-categories.test.ts tests/server/migration-0021.test.ts`
Expected : FAIL (route 404, table absente).

- [ ] **Step 4 : Table, migration, dépôt, routes, et remplacement de `onClubForm`**

Après `npm run db:generate`, ajouter en fin de `drizzle/0021_*.sql` :

```sql
--> statement-breakpoint
INSERT INTO `closed_categories` (`competition_id`, `age_band_code`, `sex`, `discipline`, `ruleset`)
SELECT b.`competition_id`, b.`code`, s.sex, c.discipline, c.ruleset
FROM `age_bands` b
CROSS JOIN (SELECT 'F' AS sex UNION ALL SELECT 'M') s
CROSS JOIN (
  SELECT 'karate' AS discipline, 'jiyu' AS ruleset UNION ALL SELECT 'karate', 'shobu'
  UNION ALL SELECT 'shido-boxing', 'jiyu' UNION ALL SELECT 'shido-boxing', 'shobu'
  UNION ALL SELECT 'shido-mix', 'jiyu' UNION ALL SELECT 'shido-mix', 'shobu'
  UNION ALL SELECT 'triathlon', 'jiyu' UNION ALL SELECT 'triathlon', 'shobu'
  UNION ALL SELECT 'kata', ''
) c
WHERE b.`on_club_form` = 0 AND NOT (b.`is_minor` = 1 AND c.ruleset = 'shobu');
```

Les deux fiches et `getClubEntry` reçoivent `closedSet(db, competitionId)`. `PaperEntryTable` lit `useClosedCategories(competitionId)` et filtre avec `offeredAgeBands(grid, new Set(data.closed.map(entryKey)))`.

- [ ] **Step 5 : Lancer toute la suite**

Run : `npm run typecheck && npm test`
Expected : PASS. Les tests qui écrivaient `onClubForm` dans une grille sont adaptés. `sync-package` passe grâce à l'entrée dans `PACKAGE_TABLES`. `grep -rn "Proposée sur la fiche club\|onClubForm" src tests` ne renvoie plus que le schéma, `api-schemas.ts` et le test du modèle ancien ; un parcours e2e qui cochait la case est réécrit à la tâche 3 avec `open-row-…`.

- [ ] **Step 6 : Commit**

```bash
git add -A src drizzle tests
git commit -m "feat(grille): cases fermées en base, la tranche « proposée sur la fiche » devient une ligne fermée"
```

---

### Task 3 : Tableau « Catégories ouvertes » dans la Grille

**Files :**
- Create : `src/web/components/OpenCategoriesMatrix.tsx`
- Modify : `src/web/pages/GridEditorPage.tsx` (une `SectionCard` pleine largeur, juste après la `SimpleGrid` poids / tranches)
- Modify : `src/web/api.ts` (`useSetClosedCategories`)
- Modify : `src/web/help.ts` (clé `'grille.ouvertes'` ajoutée à l'union et à `HELP` ; retirer de `'grille.tranches'` toute mention de la case « fiche club »)
- Modify : `docs/guide-utilisateur.md`, §4, point 2 : à la suite de « (la grille FFK est déjà remplie). », ajouter mot pour mot : `Dans la grille, la section **Catégories ouvertes** ferme ce que vous n’ouvrez pas à cette compétition (par exemple pas de shido-mix chez les benjamins) : ces catégories disparaissent de la fiche club et de l’inscription en ligne. Un combattant déjà inscrit dans une catégorie fermée apparaît en Réaffectation.`
- Test : `tests/e2e/categories-fermees.spec.ts` (nouveau)

**Interfaces :**
- Consumes : tâche 1 (`ENTRY_COLUMNS`, `columnLabel`, `entryCells`, `entryKey`) ; tâche 2 (`useClosedCategories`, `PUT /closed-categories`).
- Produces :
  - `useSetClosedCategories(id: string)` → mutation `{ cells: EntryCell[]; closed: boolean }` qui invalide `['closed-categories', id]`, `['replacement', id]` et `['categories', id]`
  - `OpenCategoriesMatrix({ competitionId, grid }: { competitionId: string; grid: CategoryGrid })`. `grid` est la grille **enregistrée** (`data` de `useGrid`), pas celle qu'on est en train de modifier.
  - data-testid : case `open-cell-${entryKey}` (Checkbox, cochée = ouverte) ; ligne `open-row-${ageBandCode}-${sex}` ; colonne `open-col-${discipline}-${ruleset ?? 'none'}` ; bouton de confirmation `open-cells-confirm`

Comportement :
- En-tête sur deux niveaux : Karaté, Shido-boxing, Shido-mix-martial, Triathlon (chacun sur deux colonnes, Jiyu et Shobu), puis Kata.
- Lignes : `${label} F` et `${label} M`.
- Les cases sans objet (shobu chez les mineurs) sont vides et sans case à cocher.
- La case de ligne (et de colonne) est cochée si toutes ses cases sont ouvertes, et indéterminée si elles sont mélangées. Un clic ferme toutes les cases ouvertes non verrouillées si tout est ouvert ; sinon il rouvre tout.
- Une case de `locked` est désactivée, avec `title="Catégorie déjà lancée : elle ne peut plus être fermée."`.
- À côté de chaque case, s'il y a des inscrits : `counts[k]` en petit, avec `title={plural(n, 'inscrit')}`.
- L'enregistrement est immédiat, sans barre « Enregistrer la grille ». Si la fermeture touche au moins un inscrit, une fenêtre s'ouvre d'abord :
  - titre `Fermer cette catégorie ?` (une case) ou `Fermer ces catégories ?` ;
  - texte `${plural(n, 'combattant déjà inscrit', 'combattants déjà inscrits')} : ${n > 1 ? 'ils apparaîtront' : 'il apparaîtra'} en Réaffectation.` ;
  - boutons `Annuler` / `Fermer` (testid `open-cells-confirm`).
- Une erreur s'affiche avec `ApiErrorAlert`.
- `HELP['grille.ouvertes']` : titre `Catégories ouvertes` ; court : `Décochez une case pour ne pas ouvrir cette catégorie : elle disparaît de la fiche club et de l’inscription en ligne.` ; dans le détail : les inscrits déjà présents vont en Réaffectation, une catégorie lancée ne se ferme plus, et la fermeture vaut pour cette compétition seulement.

- [ ] **Step 1 : Écrire le parcours e2e qui échoue**

Test `grille : fermer une catégorie, avec confirmation s'il y a des inscrits`, avec les aides de `tests/e2e/helpers.ts` :
- créer une compétition et une inscription karaté jiyu cadet F ;
- aller sur l'onglet Grille et cliquer `open-cell-cadet|F|karate|jiyu` ;
- la fenêtre affiche `1 combattant déjà inscrit : il apparaîtra en Réaffectation.` ; cliquer `open-cells-confirm` ;
- la case est décochée ;
- après rechargement, elle est toujours décochée ;
- cliquer `open-cell-senior|F|kata|` (sans inscrit) : la case est décochée tout de suite, sans fenêtre.

- [ ] **Step 2 : Lancer le parcours et vérifier qu'il échoue**

Run : `npx playwright test tests/e2e/categories-fermees.spec.ts`
Expected : FAIL (testid introuvable).

- [ ] **Step 3 : Écrire `OpenCategoriesMatrix`, l'aide et le paragraphe du guide**

- [ ] **Step 4 : Lancer le parcours, puis les tests d'aide et de mise en page**

Run : `npx playwright test tests/e2e/categories-fermees.spec.ts tests/e2e/mise-en-page.spec.ts && npx vitest run tests/web`
Expected : PASS. `mise-en-page` ne signale aucun contenu coupé dans la Grille.

- [ ] **Step 5 : Commit**

```bash
git add src/web tests/e2e/categories-fermees.spec.ts docs/guide-utilisateur.md
git commit -m "feat(grille): tableau « Catégories ouvertes »"
```

---

### Task 4 : Inscription en ligne : choix filtrés, refus serveur, mentions

**Files :**
- Modify : `src/domain/club-line.ts` (exporter `asEntered`, renommée `enteredValues`)
- Modify : `src/server/repositories/club-entry.ts`
- Modify : `src/web/components/ClubLineForm.tsx`, `src/web/pages/ClubEntryPage.tsx`
- Test : `tests/server/club-entry.test.ts`, `tests/e2e/inscription-en-ligne.spec.ts`

**Interfaces :**
- Consumes : tâche 1 (`EntryCell`, `entryKey`, `isEntryClosed`, `columnLabel`, `offeredAgeBands`) ; tâche 2 (`closedSet`).
- Produces :
  - `ClubEntryView.closed: string[]` (clés `entryKey`) ; `ClubEntryView.ageBands` = `offeredAgeBands`, plus la tranche d'une ligne existante qui ne serait plus offerte (pour que sa liste affiche la valeur enregistrée).
  - `ClubLine.notices: string[]` : pour chaque inscription non déplacée dont la case est fermée, `${columnLabel(col)} : cette catégorie n’est plus ouverte, l’organisateur vous contactera.`
  - `enteredValues(r: LineRegistration): { discipline: DisciplineId; ruleset: Ruleset | null }`
  - `export const CLOSED_ENTRY = (label: string) => `${label} : catégorie non ouverte à cette compétition.``. C'est l'erreur de `saveClubLine` (via `RegistrationValidationError`, donc 400) pour toute inscription de la ligne dont la case est fermée **et** n'était pas déjà dans les cases enregistrées de ce combattant. Ces cases enregistrées se calculent avec la tranche et le sexe actuels du combattant et `enteredValues` de chaque inscription.
  - `ClubLineForm` reçoit `closed: ReadonlySet<string>` :
    - une discipline de combat n'est proposée que si au moins un règlement est ouvert pour (tranche, sexe) ;
    - un règlement n'est proposé que s'il est ouvert pour la discipline choisie ;
    - la case Kata n'apparaît que si le kata est ouvert.
    - Exception : la valeur déjà enregistrée sur la ligne reste toujours proposée, avec le suffixe ` (non ouverte)`.
    - Tranche et sexe choisis sans aucune case ouverte : `Text` (testid `line-nothing-open`) `Aucune catégorie ouverte pour cette tranche d’âge à cette compétition.`
  - `ClubEntryPage` affiche les `notices` d'une ligne sous son nom (testid `line-notice`).

- [ ] **Step 1 : Écrire les tests serveur qui échouent** (`tests/server/club-entry.test.ts`, avec le montage existant)

- `catégorie fermée : refusée en ligne` : fermer `cadet|F|shido-mix|jiyu`, puis créer une ligne cadette F shido-mix jiyu → 400, et le message contient `Shido-mix-martial jiyu : catégorie non ouverte à cette compétition.`
- `ligne déjà enregistrée dans une catégorie fermée : reste modifiable` : créer la ligne, fermer sa case, puis la réenregistrer avec un autre poids → 200. `notices` vaut `['Shido-mix-martial jiyu : cette catégorie n’est plus ouverte, l’organisateur vous contactera.']`.
- `passer une ligne vers une catégorie fermée : refusé` : une ligne karaté jiyu enregistrée, le shido-mix jiyu fermé, la ligne modifiée vers shido-mix → 400.
- `tranches offertes` : fermer toutes les cases `mini-poussin|…` → `ageBands` ne contient plus `mini-poussin`, et `closed` contient ces clés.

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/server/club-entry.test.ts`
Expected : FAIL sur les quatre nouveaux tests.

- [ ] **Step 3 : Écrire le dépôt, puis le formulaire et la page**

- [ ] **Step 4 : Ajouter le parcours e2e** dans `tests/e2e/inscription-en-ligne.spec.ts`

Test `catégorie fermée : non proposée au club` :
- l'organisateur ferme tout le shido-mix des cadets F (testid `open-col-…` ou les deux cases), avec la même façon d'arriver sur la page du club que les tests voisins ;
- sur la page du club, ajouter un combattant cadet F : `Shido-mix-martial` n'est pas dans le groupe « Discipline de combat », `Karaté` y est.

- [ ] **Step 5 : Lancer les tests**

Run : `npm run typecheck && npx vitest run tests/server/club-entry.test.ts && npx playwright test tests/e2e/inscription-en-ligne.spec.ts`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add src tests
git commit -m "feat(inscription): catégories fermées non proposées aux clubs"
```

---

### Task 5 : Fiches .ods et PDF, imports et ajout manuel

**Files :**
- Modify : `src/server/club-form-template.ts` (onglet « Aide »), `src/server/club-form-pdf.ts` (encadré)
- Modify : `src/domain/club-form.ts` (`lineToRows`, `parseClubForm`, `parseClubFormLines`), `src/domain/ffk-import.ts` (`parseFfkRows`), plus leurs appelants (`src/server/routes/registrations.ts`, le dépôt ou la route FFK, à trouver avec `grep -rn "parseFfkRows(" src`)
- Modify : `src/server/repositories/registrations.ts` (`createRegistration`)
- Modify : `docs/guide-utilisateur.md`, §4, point 4, puce « par fichier » : ajouter à la fin, mot pour mot : ` Les fiches indiquent les catégories non ouvertes ; une fiche renvoyée qui en contient quand même est acceptée avec un avertissement, et ces combattants passent en Réaffectation.`
- Test : `tests/domain/club-form.test.ts`, `tests/domain/ffk-import.test.ts`, `tests/server/ods.test.ts` (ou le test du modèle .ods qui existe déjà), `tests/server/club-form-pdf.test.ts`, `tests/server/registrations-api.test.ts`

**Interfaces :**
- Consumes : tâche 1 (`closedSummary`, `isEntryClosed`, `columnLabel`) ; tâche 2 (`closedSet` et les nouvelles signatures des deux fiches).
- Produces :
  - `lineToRows(line, lineNumber, grid, tolerance, closed: ReadonlySet<string> = new Set())`. Même dernier paramètre facultatif pour `parseClubForm(cells, grid, tolerance?, closed?)`, `parseClubFormLines(header, lines, grid, tolerance, closed?)` et `parseFfkRows(cells, headerRow, mapping, sheetName, grid, closed?)`.
  - Avertissement (non bloquant, dans `warnings`) d'une ligne dont la case est fermée : `Catégorie non ouverte à cette compétition (${columnLabel(col)}) : la ligne ira en Réaffectation.`
  - `createRegistration` : `warning` vaut `Catégorie non ouverte à cette compétition : l’inscription ira en Réaffectation.` si la case est fermée. S'il y a déjà un avertissement de conflit de disciplines, les deux sont joints par une espace (conflit d'abord).
  - Onglet « Aide » du .ods, seulement si `closedSummary` n'est pas vide : une ligne en gras `Catégories non ouvertes à cette compétition`, puis une ligne par phrase du résumé.
  - PDF, seulement si le résumé n'est pas vide : sous l'en-tête du club, un encadré d'une ligne `Non ouvert à cette compétition : ${résumé.join(' · ')}`. Le texte passe à la ligne s'il est trop long, et la fiche tient toujours sur **une** page A4 paysage.

- [ ] **Step 1 : Écrire les tests qui échouent**

- `club-form.test.ts`, `ligne dans une catégorie fermée : avertissement, pas d'erreur` : `lineToRows` d'une ligne cadette F shido-mix jiyu, avec `closed = new Set(['cadet|F|shido-mix|jiyu'])` → `errors` vide, `input` non nul, `warnings` contient `Catégorie non ouverte à cette compétition (Shido-mix-martial jiyu) : la ligne ira en Réaffectation.`
- `ffk-import.test.ts`, `catégorie fermée : avertissement` : même attente sur `parseFfkRows`.
- `registrations-api.test.ts`, `ajout manuel dans une catégorie fermée : avertissement` : `POST /registrations` → 201, `warning` égal au texte exact.
- Test du modèle .ods, `aide : catégories non ouvertes` : avec `senior|F|kata|` fermé, l'onglet « Aide » contient `Catégories non ouvertes à cette compétition` et `Seniors (F) : pas de Kata`. Sans case fermée, il ne contient ni l'un ni l'autre.
- `club-form-pdf.test.ts`, `encadré des catégories non ouvertes, une seule page` : le texte extrait contient `Non ouvert à cette compétition : Seniors (F) : pas de Kata`, et le document a 1 page. Avec 6 tranches entièrement fermées, il a toujours 1 page.

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/domain/club-form.test.ts tests/domain/ffk-import.test.ts tests/server/registrations-api.test.ts tests/server/club-form-pdf.test.ts tests/server/ods.test.ts`
Expected : FAIL sur les nouveaux tests.

- [ ] **Step 3 : Écrire le code** (les appelants serveur passent `closedSet(db, competitionId)`)

- [ ] **Step 4 : Lancer la suite**

Run : `npm run typecheck && npm test`
Expected : PASS. Ouvrir à la main le .ods produit avec LibreOffice (`/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf`) pour vérifier l'onglet « Aide ».

- [ ] **Step 5 : Commit**

```bash
git add src tests docs/guide-utilisateur.md
git commit -m "feat(fiche-club): catégories non ouvertes sur les fiches et avertissement aux imports"
```

---

### Task 6 : Réaffectation, carte « Catégorie fermée »

**Files :**
- Modify : `src/domain/replacement/types.ts` (`CaseKind` reçoit `'closed'` ; `State.closedEntries: string[]`)
- Modify : `src/domain/replacement/detect.ts`, `src/domain/replacement/propose.ts`, `src/domain/replacement/apply.ts` (`stateFingerprint` inclut `closedEntries` triées)
- Modify : `src/server/repositories/replacement.ts` (`loadState` : `closedEntries: [...closedSet(db, competitionId)]`)
- Modify : `src/server/routes/replacement.ts` (`moveTargets` sans les catégories fermées ; `summary.closed`)
- Modify : `src/web/pages/ReplacementPage.tsx` (`CASE_KINDS.closed`, compteur), `src/web/api.ts` (types `summary`)
- Modify : `tests/domain/replacement/fixtures.ts` (`closedEntries: []` par défaut dans `makeState`)
- Test : `tests/domain/replacement/closed.test.ts` (nouveau), `tests/server/replacement.test.ts`

**Interfaces :**
- Consumes : tâche 1 (`entryKey`, `categoryKeyClosed`) ; tâche 2 (`closedSet`, `PUT /closed-categories`).
- Produces :
  - `isClosedMember(state: State, m: Member): boolean` : non déplacé (`!placementLocked`), pas absent, et la case `{ ageBandCode, sex, discipline, ruleset }` de `m` est dans `state.closedEntries`.
  - `isClosedTarget(state: State, key: CategoryKey): boolean` = `categoryKeyClosed(new Set(state.closedEntries), key)`.
  - Les deux sont exportées par `src/domain/replacement/index.ts`.
  - Cas `{ id: 'closed:${registrationId}', kind: 'closed', detail: 'Catégorie non ouverte à cette compétition' }`. Il ne se crée que si la catégorie actuelle n'est pas verrouillée (`isLocked`). `KIND_ORDER` devient `['closed', 'return', 'weight_out', 'alone', 'weight_gap']`.
  - Un membre fermé n'a aucun autre cas : il est retiré de la boucle `weight_out` et des membres actifs qui servent à calculer `alone` et `weight_gap`.
  - `proposalsFor` pour `closed` passe par la branche générique (celle de `alone`, sans « split »). À la fin, toutes les propositions, quel que soit le cas, perdent celles dont la cible est fermée : `categoryId` → clé de cette catégorie, `newKey` → la clé elle-même, testée avec `isClosedTarget`.
  - `move.ts` n'a pas besoin de changer : un déplacement depuis un cas `closed` inscrit `original.reason = 'closed'`, et `detect` ne propose de retour que pour `'alone'`.
  - Route : `summary.closed` = nombre de cas `closed` ; `moveTargets` ne garde pas une cible `t` si `isClosedTarget(state, t.key)`.
  - UI : `CASE_KINDS.closed = 'Catégorie fermée'` ; `<Stat label="Catégorie fermée" value={s.closed} />` juste après « Cas à traiter » ; la puce de filtre vient d'elle-même.

- [ ] **Step 1 : Écrire les tests de domaine qui échouent** (`tests/domain/replacement/closed.test.ts`, avec `member`/`makeState`)

- `membre d'une catégorie fermée : un cas closed, ni alone ni weight_gap` : un membre seul en cadet F karaté jiyu -54, `closedEntries: ['cadet|F|karate|jiyu']` → `detectCases` renvoie un seul cas, de genre `closed`.
- `propositions jamais vers une catégorie fermée` : `a` et `b` en cadet F -54 (fermée), `c` et `d` en cadet F -61 (ouverte), `e` et `f` en junior F -53 karaté jiyu (fermée) → toutes les propositions du cas `closed:${a}` visent la catégorie de `c`/`d`, aucune la catégorie junior.
- `cible multi-tranches à moitié ouverte : proposée` : catégorie de clé `ageBandCodes: ['cadet', 'junior']` avec deux membres, `cadet|F|karate|jiyu` fermée mais pas `junior|F|karate|jiyu` → elle figure parmi les cibles d'un membre fermé d'une autre catégorie de poids cadette.
- `déplacé hors d'une catégorie fermée : pas de retour` : appliquer (`applyAll`) la première proposition de `closed:${a}`, puis vider `closedEntries` → pas de cas `return:${a}`, et `original.reason` vaut `'closed'`.
- `classement automatique : déplace un combattant de catégorie fermée` : `bulkPlan(state, 'all')` sur l'état du deuxième test → une étape dont la proposition a `caseId` `closed:${a}`.

- [ ] **Step 2 : Écrire le test serveur qui échoue** (`tests/server/replacement.test.ts`)

`catégorie fermée : carte, compteur et cibles manuelles` :
- deux inscriptions cadet F -54, deux cadet F -61, un junior F -53 ;
- fermer `cadet|F|karate|jiyu` → `GET /replacement` : `summary.closed` vaut 4 ;
- rouvrir, puis fermer `junior|F|karate|jiyu` → le cas `closed:${junior}` existe, et ses `moveTargets` ne contiennent aucune catégorie junior ;
- `summary.closed` vaut 1.

- [ ] **Step 3 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/domain/replacement tests/server/replacement.test.ts`
Expected : FAIL sur les nouveaux tests.

- [ ] **Step 4 : Écrire le domaine, le dépôt, la route et la page**

- [ ] **Step 5 : Lancer la suite**

Run : `npm run typecheck && npm test`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add src tests
git commit -m "feat(reaffectation): carte « Catégorie fermée »"
```

---

### Task 7 : « Ne combat pas »

**Files :**
- Modify : `src/server/db/schema.ts` (`registrations.withdrawnReason: text('withdrawn_reason', { enum: ['closed_category'] })`, nullable) ; `drizzle/0022_*.sql` (généré)
- Modify : `src/domain/registration.ts` (`Registration.withdrawn: boolean`) et `toRegistration` dans `src/server/repositories/registrations.ts`
- Modify : `src/domain/replacement/types.ts` (`ProposalType` reçoit `'W'`)
- Modify : `src/server/repositories/categories.ts` (`syncCategories` : une inscription retirée hors catégorie verrouillée garde `categoryId = null` et n'est placée nulle part)
- Modify : `src/server/repositories/replacement.ts` (`loadState` ignore les inscriptions retirées ; `withdrawRegistration` ; `undoRecasement` : type d'instantané avec `withdrawnReason?` ; `weighInList` ne liste pas un combattant dont toutes les inscriptions sont retirées)
- Modify : `src/server/repositories/closed-categories.ts` (`counts` sans les inscriptions retirées)
- Modify : `src/server/repositories/club-entry.ts` (mention du retrait, à la place de « n’est plus ouverte »)
- Modify : `src/server/routes/replacement.ts` (`POST /replacement/withdraw`) ; `src/server/auth/permissions.ts` (`'POST /replacement/withdraw'` dans `TABLE_WRITES`)
- Modify : `src/web/api.ts` (`useWithdrawRegistration`), `src/web/components/ReplacementBadge.tsx` (`PROPOSAL_TYPES.W`), `src/web/pages/ReplacementPage.tsx`, `src/web/pages/RegistrationsPage.tsx`
- Modify : `docs/guide-utilisateur.md`, §6 « Le déroulé », point 2 : le remplacer mot pour mot par `**Réaffectation** : une carte pour chaque combattant seul, hors de sa catégorie, ou inscrit dans une catégorie fermée (propositions, aperçu, validation). Pour une catégorie fermée, vous pouvez aussi choisir « Ne combat pas » : le coach le voit sur sa page d’inscription, et « Annuler » dans l’historique le remet en place.` ; `src/web/help.ts` (dans le détail de l'aide de la page Réaffectation, une ligne : `Catégorie fermée : le combattant est inscrit dans une catégorie que vous n’avez pas ouverte ; déplacez-le ou choisissez « Ne combat pas ».`)
- Test : `tests/server/replacement.test.ts`, `tests/server/club-entry.test.ts`, `tests/e2e/categories-fermees.spec.ts`

**Interfaces :**
- Consumes : tâche 6 (cas `closed`, `stateFingerprint`) ; tâche 4 (`ClubLine.notices`, `columnLabel`).
- Produces :
  - `withdrawRegistration(db: AppDb, competitionId: string, registrationId: string, fingerprint: string): Promise<void>`
    - Lève `StaleProposalError()` si l'empreinte est périmée, et `StaleProposalError('Ce combattant n’est plus dans une catégorie fermée : rechargez.')` si le cas `closed:${registrationId}` n'existe plus.
    - Dans une transaction : `withdrawnReason = 'closed_category'`, `categoryId = null`, puis une ligne dans `recasements` :
      `{ id: uuid, registrationId, proposalId: 'W:${registrationId}', type: 'W', fromLabel: <libellé de la catégorie quittée>, toLabel: 'Ne combat pas', reason: 'Catégorie non ouverte à cette compétition', manual: true, preApproved: false, bulk: false, snapshotJson }`.
      L'instantané reprend la forme de `undoRecasement`, avec `registration.withdrawnReason: null` et `categories: []`.
    - Puis `syncCategories`.
  - `POST /api/competitions/:id/replacement/withdraw`, corps `{ registrationId: string; fingerprint: string }` → 204.
  - `useWithdrawRegistration(id)` = `useReplacementAction<{ registrationId: string; fingerprint: string }>(id, 'withdraw')`.
  - `PROPOSAL_TYPES.W = { color: 'gray', label: '⊘ Ne combat pas', simple: false, title: 'Ne combat pas (catégorie non ouverte)' }`.
  - Mention côté club, pour une inscription retirée : `Ne combattra pas en ${columnLabel(col)} : catégorie non ouverte.`
  - UI Réaffectation : sur une carte `closed` uniquement, un bouton `Ne combat pas` (testid `case-withdraw`) ouvre une fenêtre :
    - titre `Ne combat pas ?` ;
    - texte `${nom} ne combattra pas en ${libellé de la catégorie actuelle}. Le coach le verra sur sa page d’inscription.` ;
    - boutons `Annuler` / `Confirmer` (testid `case-withdraw-confirm`) ;
    - notification `Inscription retirée : ne combat pas.`
  - UI Inscriptions : `StatusBadge` neutre `Ne combat pas` (testid `registration-withdrawn`) sur une inscription retirée.

- [ ] **Step 1 : Écrire les tests serveur qui échouent**

- `replacement.test.ts`, `ne combat pas : hors tableau, hors pesée, dans l'historique` :
  - trois inscriptions cadet F -54, case fermée, `POST /replacement/withdraw` pour l'une → 204 ;
  - `GET /categories` : elle n'est dans aucune `registrationIds` ;
  - `GET /weigh-in` : son combattant n'y est plus ;
  - `GET /registrations` : `withdrawn: true` ;
  - `GET /replacement` : plus de cas pour elle, et `recasements[0]` a `type: 'W'` et `toLabel: 'Ne combat pas'`.
- `replacement.test.ts`, `annuler « ne combat pas » après réouverture : catégorie normale, pas de carte` : retirer, rouvrir la case, `POST /replacement/undo` → l'inscription est de nouveau dans une catégorie (`GET /categories`), `withdrawn: false`, aucun cas.
- `replacement.test.ts`, `ne combat pas refusé hors catégorie fermée` : withdraw sur une inscription ordinaire → 409 avec `Ce combattant n’est plus dans une catégorie fermée : rechargez.`
- `club-entry.test.ts`, `réenregistrer la ligne garde « ne combat pas »` :
  - une ligne avec karaté (ouvert) et kata (fermé) ; retirer l'inscription kata ;
  - réenregistrer la ligne inchangée → 200, `notices` vaut `['Ne combattra pas en Kata : catégorie non ouverte.']`, et l'inscription kata est toujours `withdrawn`.

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/server/replacement.test.ts tests/server/club-entry.test.ts`
Expected : FAIL sur les nouveaux tests.

- [ ] **Step 3 : Migration (`npm run db:generate`), dépôt, route, permission, puis interface**

- [ ] **Step 4 : Ajouter le parcours e2e** à `tests/e2e/categories-fermees.spec.ts`

Test `réaffectation : une catégorie fermée, « Ne combat pas », puis annuler` :
- deux inscriptions cadet F -54 ; fermer la case depuis la Grille ;
- en Réaffectation, deux cartes `Catégorie fermée` ;
- `case-withdraw` puis `case-withdraw-confirm` sur la première → une seule carte reste ; l'historique montre `⊘ Ne combat pas` ;
- dans Inscriptions, `registration-withdrawn` est visible ;
- `recasement-undo` puis `recasement-undo-confirm` → deux cartes de nouveau.

- [ ] **Step 5 : Lancer la suite et les parcours**

Run : `npm run typecheck && npm test && npx playwright test tests/e2e/categories-fermees.spec.ts tests/e2e/recasement.spec.ts`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add -A src drizzle tests docs/guide-utilisateur.md
git commit -m "feat(reaffectation): « Ne combat pas » pour une catégorie fermée"
```

---

### Task 8 : Mettre une carte de côté

**Files :**
- Modify : `src/server/db/schema.ts` (table `setAsideCases`) ; `drizzle/0023_*.sql` (généré) ; `src/server/sync/package.ts` (`'set_aside_cases'` juste après `'refusals'`)
- Modify : `src/domain/replacement/types.ts` (`State.setAside: string[]`), `src/domain/replacement/apply.ts` (`nextBulkStep` saute les cas mis de côté ; `stateFingerprint` inclut `setAside` triées)
- Modify : `src/server/repositories/replacement.ts` (`loadState` lit et nettoie ; `setAsideCase`, `resumeCase`)
- Modify : `src/server/routes/replacement.ts` (deux routes ; `setAside` dans la réponse ; compteurs) ; `src/server/auth/permissions.ts`
- Modify : `src/web/api.ts`, `src/web/pages/ReplacementPage.tsx`, `src/web/pages/BracketsPage.tsx`, `src/web/components/WaveLaunchPanel.tsx`, `src/web/help.ts` (`'recasement.de-cote'`)
- Modify : `tests/domain/replacement/fixtures.ts` (`setAside: []` par défaut)
- Modify : `docs/guide-utilisateur.md`, §6 « Le déroulé », point 2 : ajouter à la fin, mot pour mot : ` « Mettre de côté » écarte une carte que vous ne pouvez pas trancher tout de suite (une note facultative rappelle pourquoi) : elle ne compte plus dans les cas à traiter, se retrouve dans « Mises de côté », et le lancement de la session vous la rappelle.`
- Test : `tests/domain/replacement/apply.test.ts`, `tests/server/replacement.test.ts`, `tests/e2e/categories-fermees.spec.ts`

**Interfaces :**
- Consumes : `Case.id` (`${kind}:${registrationId}`) ; tâche 6 (`summary`).
- Produces :
  - table `set_aside_cases (competition_id, case_id, note text not null default '', created_at)`, clé primaire `(competition_id, case_id)`, `...rowMeta()`.
  - `loadState` : `setAside` = les `case_id` de la compétition **dont le cas existe** dans `detectCases(state)`, toutes sessions confondues. Les lignes dont le cas n'existe plus sont supprimées au passage. C'est ce qui fait revenir un cas réglé puis revenu dans la liste principale. Limite acceptée : si le cas est réglé puis revient sans qu'aucune lecture de Réaffectation ou de Pesée ait eu lieu entre-temps, il reste de côté.
  - `setAsideCase(db: AppDb, competitionId: string, caseId: string, note: string): Promise<void>` (cas inexistant → `StaleProposalError('Cette carte n’existe plus : rechargez.')`) ; `resumeCase(db: AppDb, competitionId: string, caseId: string): Promise<void>`.
  - `POST /api/competitions/:id/replacement/set-aside`, corps `{ caseId: string; note?: string (80 caractères au plus) }` → 204 ; `POST …/replacement/resume`, corps `{ caseId: string }` → 204. Les deux vont dans `TABLE_WRITES`.
  - `GET /replacement` ajoute `setAside: Record<caseId, { note: string; createdAt: string }>` (cas de la session affichée seulement). Dans `summary` : `cases`, `alone`, `closed` et `withoutProposal` ne comptent que les cartes **non** mises de côté ; nouveau `summary.setAside`.
  - `nextBulkStep` saute les cas de `state.setAside`.
  - Hooks : `useSetAsideCase(id)` = `useReplacementAction<{ caseId: string; note?: string }>(id, 'set-aside')`, `useResumeCase(id)` = `useReplacementAction<{ caseId: string }>(id, 'resume')`.
  - UI Réaffectation :
    - Le rendu d'une carte devient un composant `CaseCard`, dans le même fichier.
    - Chaque carte a un bouton discret `Mettre de côté` (testid `case-set-aside`). Il ouvre une fenêtre avec un `TextInput` `Note (facultative)` (`maxLength={80}`), puis `Annuler` / `Mettre de côté` (testid `case-set-aside-confirm`).
    - La liste principale ne montre que les cartes non mises de côté.
    - Sous les cartes et au-dessus de l'historique, une section repliée par défaut `Mises de côté (N)` (testid `set-aside-section`). Elle a une ligne par carte (testid `set-aside-row`) : nom, genre du cas, note, heure `HH:MM`, bouton `Reprendre` (testid `case-resume`). Un clic sur la ligne déplie la `CaseCard` complète.
    - `<Stat label="Mises de côté" value={s.setAside} tone={s.setAside ? 'warn' : undefined} />`.
    - Si toutes les cartes sont de côté, l'`EmptyState` « Aucun cas à traiter » prend le texte `${plural(n, 'carte mise de côté', 'cartes mises de côté')}, à retrouver plus bas.`
  - Tableaux : le lien devient `${n} cas à traiter (dont ${m} de côté)` quand `m > 0`.
  - Lancement de session : dans la fenêtre « Figer et imprimer la session », si `summary.setAside > 0` pour cette session, une `Alert color="orange"` (testid `launch-set-aside`) `${plural(n, 'carte mise de côté', 'cartes mises de côté')} en Réaffectation pour cette session.`, qui ne bloque pas.
  - `HELP['recasement.de-cote']` : titre `Mises de côté` ; court `Une carte mise de côté ne compte plus dans les cas à traiter ni dans le classement automatique : reprenez-la quand vous pouvez trancher.`

- [ ] **Step 1 : Écrire les tests qui échouent**

- `apply.test.ts`, `classement automatique : ignore les cartes mises de côté` : deux cas simples ; `setAside: ['alone:<id du premier>']` → `bulkPlan(state, 'all').steps` ne contient aucune proposition de `caseId` `alone:<id du premier>`.
- `replacement.test.ts`, `mise de côté : compteurs, reprise, disparition quand le cas est réglé` :
  - un cas `alone` ; `POST /replacement/set-aside { caseId, note: 'on attend le coach' }` → 204 ;
  - `GET` : `summary.cases` 0, `summary.setAside` 1, `setAside[caseId].note` vaut `'on attend le coach'` ;
  - `resume` → `summary.cases` 1 ;
  - remettre de côté, puis ajouter un adversaire (le cas disparaît), `GET` ; retirer l'adversaire (le cas revient), `GET` → `summary.cases` 1 et `summary.setAside` 0.
- `replacement.test.ts`, `mise de côté d'une carte qui n'existe plus : 409`.

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

Run : `npx vitest run tests/domain/replacement/apply.test.ts tests/server/replacement.test.ts`
Expected : FAIL sur les nouveaux tests.

- [ ] **Step 3 : Migration (`npm run db:generate`), dépôt, routes, permission, puis interface**

- [ ] **Step 4 : Ajouter le parcours e2e** à `tests/e2e/categories-fermees.spec.ts`

Test `réaffectation : mettre une carte de côté puis la reprendre` :
- un cas `alone` ; `case-set-aside`, une note, `case-set-aside-confirm` ;
- la carte quitte la liste ; `set-aside-section` affiche `Mises de côté (1)` ;
- après l'avoir dépliée, `set-aside-row` montre la note ;
- `case-resume` → la carte revient dans la liste principale.

- [ ] **Step 5 : Lancer la suite et les parcours**

Run : `npm run typecheck && npm test && npx playwright test tests/e2e/categories-fermees.spec.ts tests/e2e/recasement.spec.ts tests/e2e/figeage.spec.ts tests/e2e/mise-en-page.spec.ts`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add -A src drizzle tests docs/guide-utilisateur.md
git commit -m "feat(reaffectation): mettre une carte de côté"
```

---

### Task 9 : Vérification complète, feuille de route et bilan

**Files :**
- Modify : `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (ligne 23 avant « Répétition générale » : `| 23 ✅ | **Catégories fermées** | Conception 2026-10-25-categories-fermees-et-cartes-de-cote-design.md : cases ouvertes / fermées par compétition (fiche club, inscription en ligne), carte « Catégorie fermée » et « Ne combat pas » en Réaffectation, cartes mises de côté (plan 2026-10-25-23-categories-fermees.md) | 22 | avant le 29 oct. |`)
- Modify : `docs/superpowers/plans/2026-10-21-99-bilan.md` (section « Étape 23 » : choix faits, écarts éventuels, points mineurs reportés)
- Modify : la conception, §2.2 et §5.4, si la réalisation s'en est écartée
- Modify : `docs/superpowers/specs/2026-10-22-fiche-club-papier-design.md`, puce « Tranches d'âge proposées » : ajouter à la fin `Remplacé le 2026-10-25 par le tableau « Catégories ouvertes » : voir 2026-10-25-categories-fermees-et-cartes-de-cote-design.md §2.2.`
- Modify : `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` : dans l'en-tête, à côté des renvois vers les autres conceptions, ajouter `Catégories fermées, « Ne combat pas » et cartes mises de côté : 2026-10-25-categories-fermees-et-cartes-de-cote-design.md.`
- Vérifier par une relecture que `docs/guide-utilisateur.md` ne parle plus nulle part de la case « Proposée sur la fiche club », et que les aides à l'écran (`src/web/help.ts`) non plus.

- [ ] **Step 1 : Lancer la vérification complète**

Run : `npm run typecheck && npm test && npm run test:e2e`
Expected : tout PASS. Noter les nombres de tests unitaires et e2e pour le bilan.

- [ ] **Step 2 : Construire l'image Docker et la démarrer**

Run : `docker compose up --build -d && sleep 5 && docker compose logs --tail 30`
Expected : migrations 0021 à 0023 appliquées, serveur à l'écoute, aucune erreur. Avant la reconstruction, noter le nombre d'inscriptions de chaque compétition de la base locale ; après, vérifier qu'il n'a pas changé. Ces nombres se lisent par l'API (`GET /api/competitions/:id/registrations`), jamais avec sqlite3 depuis l'hôte.

- [ ] **Step 3 : Commit**

```bash
git add docs
git commit -m "docs: étape 23 — catégories fermées et cartes mises de côté"
```
