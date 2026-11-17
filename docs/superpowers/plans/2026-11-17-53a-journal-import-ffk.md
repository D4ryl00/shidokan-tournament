# Journal de l'import FFK (avance de l'étape 53) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un import FFK validé écrit **une** entrée « Import FFK · <fichier> », dépliable en lignes de détail (combattants ajoutés, modifiés, supprimés, gardés hors export, catégories de poids créées, clubs reliés), sans entrée « Non détaillé » — avant la compétition du 22 novembre.

**Architecture:** `applyFfkCards` s'enveloppe dans `withJournalGroup` (parent écrit d'abord, chiffres tirés du plan) ; les entrées par combattant que `writeClubLineInTx` écrit déjà deviennent ses lignes de détail ; les écritures encore muettes (fiches supprimées ou gardées, catégories, clubs) écrivent la leur. La route passe de `JOURNAL_PENDING` à `JOURNAL_COVERED`. Le genre du combattant est recopié dans l'entrée (`data.sex`) pour accorder « ajoutée ». Un long groupe se replie après 5 lignes.

**Tech Stack:** TypeScript, Fastify, drizzle + better-sqlite3, React + Mantine, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-journal-de-la-competition-design.md` (§5.3 regroupement, §4 types « Import », maquette `.superpowers/brainstorm/58534-1794902304/content/journal-v1.html` ligne « Import FFK »). Base : `main` 643b362 + a20f78c (branche `journal-import-ffk`).

## Global Constraints

- Ajout seul ; même transaction (une ligne refusée, une empreinte périmée 409 → **aucune** entrée) ; libellés recopiés (l'affichage ne relit rien) — comme l'étape 52.
- Aucune écriture de l'import sans trace : chaque combattant créé / modifié / supprimé, chaque fiche gardée qui perd sa confirmation FFK, chaque catégorie de poids créée, chaque club relié a sa ligne de détail. Les correspondances de colonnes (`import_mappings`, réglage global) et le réordonnancement des catégories ne sont pas notés.
- Le recalcul automatique des catégories (`syncCategories` dans `onResponse`) reste hors de ce plan (étape 53).
- Libellé de la manière : `Import FFK` (`via: 'import-ffk'`) ; type : `Import` (`type: 'import'`) pour le parent.
- Textes en français, apostrophe typographique `’`, pluriels par `src/domain/plural.ts` (jamais « (s) »).
- Jamais la base vivante `data/shidokan.sqlite` depuis l'hôte.

## Review Focus

- Import dont l'empreinte a changé (409) ou dont une ligne est refusée → aucune entrée, ni parent ni ligne. Test : Task 2.
- Réimport identique (rien ne change) → **aucune** entrée, ni parent ni brute. Test : Task 2.
- Combattante ajoutée → « … : ajoutée » ; combattant → « ajouté » ; entrée d'avant cette étape sans `sex` → masculin, sans erreur. Test : Task 1.
- Import de 300 combattants → le groupe déplié montre 5 lignes et « … 295 autres » ; une recherche sur un nom de la 200e ligne la montre surlignée. Test : Task 3.
- Fiche gardée qui n'était déjà plus confirmée → pas de ligne (rien n'a changé). Test : Task 2.

---

### Task 1: Domaine — import FFK, catégorie créée, club relié, accord du genre

**Files:**
- Modify: `src/domain/journal/types.ts` (union `JournalAction`, `JournalData`)
- Modify: `src/domain/journal/text.ts` (`journalText`, `journalDetailLine`)
- Test: `tests/domain/journal-text.test.ts`

**Interfaces:**
- Produces: `JournalAction` gagne `'ffk-import' | 'weight-class-added' | 'club-linked' | 'ffk-unconfirmed'` ; `JournalData` gagne `sex?: 'F' | 'M'`.
- Produces: `ffkImportDetail(c: { added: number; changed: number; removed: number; unconfirmed: number; leftAside: number; weightClasses: number; clubs: number }): string` dans `text.ts` — morceaux à zéro omis, combattants séparés par « , », groupes par « · » : `"212 ajoutés, 9 modifiés, 3 supprimés · 2 gardés hors export · 4 laissés de côté · 2 catégories de poids créées · 3 clubs reliés"` ; tout à zéro → `"aucun changement"`.

- [ ] **Step 1: Write the failing tests**

```ts
test('import FFK : titre et détail', () => {
  const t = journalText({ action: 'ffk-import', data: { subject: 'inscriptions-ffk.xlsx', detail: '2 ajoutés · 1 club relié' } });
  expect(t.title).toBe('Import FFK · inscriptions-ffk.xlsx');
  expect(t.detail).toBe('2 ajoutés · 1 club relié');
  expect(ffkImportDetail({ added: 212, changed: 9, removed: 3, unconfirmed: 2, leftAside: 4, weightClasses: 2, clubs: 3 }))
    .toBe('212 ajoutés, 9 modifiés, 3 supprimés · 2 gardés hors export · 4 laissés de côté · 2 catégories de poids créées · 3 clubs reliés');
  expect(ffkImportDetail({ added: 1, changed: 0, removed: 0, unconfirmed: 0, leftAside: 0, weightClasses: 1, clubs: 0 })).toBe('1 ajouté · 1 catégorie de poids créée');
  expect(ffkImportDetail({ added: 0, changed: 0, removed: 0, unconfirmed: 0, leftAside: 0, weightClasses: 0, clubs: 0 })).toBe('aucun changement');
});

test('lignes de détail accordées au genre recopié', () => {
  expect(journalDetailLine({ action: 'fighter-added', data: { subject: 'ROUX Chloé (Dojo Marseille)', sex: 'F', detail: 'Karaté Jiyu' } }))
    .toEqual({ lead: 'ROUX Chloé (Dojo Marseille)', outcome: 'ajoutée', changes: [], detail: 'Karaté Jiyu' });
  expect(journalDetailLine({ action: 'fighter-removed', data: { subject: 'PETIT Nathan (Dojo Marseille)', sex: 'M', detail: 'absent de l’export FFK' } }).outcome).toBe('supprimé');
  expect(journalDetailLine({ action: 'fighter-removed', data: { subject: 'LEROY Emma', sex: 'F' } }).outcome).toBe('supprimée');
  // Entrée écrite avant le genre recopié : masculin.
  expect(journalDetailLine({ action: 'fighter-added', data: { subject: 'MOREAU Lucas' } }).outcome).toBe('ajouté');
  expect(journalDetailLine({ action: 'ffk-unconfirmed', data: { subject: 'SIMON Jade (Shidokan Lyon)', sex: 'F' } }))
    .toEqual({ lead: 'SIMON Jade (Shidokan Lyon)', outcome: 'gardée, absente de l’export FFK', changes: [], detail: null });
});

test('catégorie créée, club relié', () => {
  expect(journalText({ action: 'weight-class-added', data: { subject: 'Benjamins F -30 kg' } }).title).toBe('Catégorie de poids créée · Benjamins F -30 kg');
  expect(journalText({ action: 'club-linked', data: { subject: 'Dojo Marseille', detail: 'au lieu de Dojo Marseille Nord' } }))
    .toMatchObject({ title: 'Dojo Marseille · relié à la FFK', detail: 'au lieu de Dojo Marseille Nord' });
  expect(journalDetailLine({ action: 'club-linked', data: { subject: 'Dojo Marseille' } }).lead).toBe('Dojo Marseille · relié à la FFK');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/domain/journal-text.test.ts` — Expected: FAIL (`ffkImportDetail` absent, titres vides, outcome « ajouté »).

- [ ] **Step 3: Implement** in `types.ts` and `text.ts`. Titles: `ffk-import` → `Import FFK · ${subject}` ; `weight-class-added` → `Catégorie de poids créée · ${subject}` ; `club-linked` → `${subject} · relié à la FFK` ; `ffk-unconfirmed` → `${subject} · gardé hors export FFK` (`gardée` si `sex: 'F'`). `journalDetailLine` : outcomes `ajouté(e)`, `supprimé(e)`, `gardé(e), absent(e) de l’export FFK` selon `data.sex === 'F'`. `journalSearchText` inchangé (il passe par `journalText`).

- [ ] **Step 4: Run** `npx vitest run tests/domain tests/web` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(journal): import FFK, catégorie créée, club relié ; genre recopié dans les lignes de détail"`

### Task 2: Serveur — l'import FFK regroupé, plus d'entrée brute

**Files:**
- Modify: `src/server/journal/fighters.ts` (`recordFighterChange` recopie `sex`, accepte un détail)
- Modify: `src/server/repositories/ffk-import.ts` (`applyFfkCards`, nom du fichier)
- Modify: `src/server/routes/ffk-import.ts` (passe le nom du fichier)
- Modify: `src/server/journal/coverage.ts` (route `POST ${C}/ffk-imports/:uploadId/commit` : PENDING → COVERED)
- Test: `tests/server/ffk-import.test.ts` (remplacer l'attente `[fighter-added, raw]` de la vague de correction de l'étape 52)

**Interfaces:**
- Consumes: Task 1 (`ffkImportDetail`, actions, `data.sex`) ; `withJournalGroup(db, competitionId, parent, fn)` et `recordJournal` de `src/server/journal/write.ts`.
- Produces: `recordFighterChange(t, competitionId, before, after, via?, detail?: string): void` — `data.sex` = `fields.Sexe` de la photo ; `detail` remplace le détail par défaut. `applyFfkCards(db, competitionId, plan, mappings, fileName: string)`. `uploadFileName(db, competitionId, uploadId): Promise<string>` dans `repositories/ffk-import.ts`.

- [ ] **Step 1: Write the failing tests** (dans `tests/server/ffk-import.test.ts`, avec les aides de fabrication de plan déjà présentes dans ce fichier)
  - `import FFK : une entrée « Import FFK · <fichier> », ses lignes de détail, pas d'entrée brute` : 1 carte nouvelle (combattante F), 1 carte existante avec écart de grade, 1 fiche orpheline `delete`, 1 orpheline `keep` encore confirmée, 1 catégorie cochée, 1 club relié → entrées de premier niveau = `[ffk-import]` seule (aucune `raw`) ; parent `via: 'import-ffk'`, `type: 'import'`, `data.subject` = nom du fichier envoyé, `data.detail` = `'1 ajouté, 1 modifié, 1 supprimé · 1 gardé hors export · 1 catégorie de poids créée · 1 club relié'` ; enfants (ordre d'écriture) : `weight-class-added`, `club-linked`, `fighter-added` (`sex: 'F'`), `fighter-changed` (changement `Grade`), `fighter-removed` (`detail: 'absent de l’export FFK'`), `ffk-unconfirmed`.
  - `import FFK refusé (empreinte périmée 409, ligne refusée) : aucune entrée`.
  - `réimport identique : aucune entrée` (ni parent ni brute) — le parent n'est écrit que si au moins une ligne de détail le serait (compter d'après le plan : cartes `auto`/`done` neuves ou avec `changes`, orphelines `delete`, orphelines `keep` encore confirmées, catégories cochées, clubs avec `target`).
  - `fiche gardée déjà non confirmée : pas de ligne ffk-unconfirmed`.
- [ ] **Step 2: Run** `npx vitest run tests/server/ffk-import.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Chiffres du parent tirés du **plan** avant d'écrire (le parent s'écrit en premier, ajout seul : il ne se corrige pas après) ; `leftAside` = `plan.summary.todo + plan.summary.skip`. Lignes : catégorie → `subject` = libellé de tranche d'âge + sexe + `<label> kg` comme l'écran Catégories l'affiche ; club relié → `subject` = nom du club, `detail` `au lieu de <ancien club>` s'il y avait un lien précédent ; orpheline `delete` → `recordFighterChange(t, id, before, null, 'import-ffk', 'absent de l’export FFK')` avant la suppression ; orpheline `keep` → `ffk-unconfirmed` seulement si une inscription passe vraiment de confirmée à non confirmée. Les entrées par combattant de `writeClubLineInTx` restent celles d'aujourd'hui (elles deviennent enfants). Le nom du fichier est relu avant `deleteUpload`.
- [ ] **Step 4: Run** `npx vitest run tests/server` puis `npx vitest run` — Expected: tout vert (le test de couverture des routes accepte la route en COVERED).
- [ ] **Step 5: Commit** `git commit -m "feat(journal): import FFK regroupé en une entrée et ses lignes de détail, sans entrée brute"`

### Task 3: Écran — long groupe replié, vérification de bout en bout, doc

**Files:**
- Modify: `src/web/pages/JournalPage.tsx` (lignes de détail : 5 premières puis « … N autres »)
- Modify: `src/web/journal.ts` (fonction pure de repli)
- Test: `tests/web/journal.test.ts`, `tests/e2e/journal.spec.ts`
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 53 : l'import FFK est fait d'avance, plan `2026-11-17-53a-journal-import-ffk.md`), bilan en fin de ce plan

**Interfaces:**
- Produces: `visibleDetails<T>(children: T[], showAll: boolean, matches: (c: T) => boolean, limit = 5): { shown: T[]; hidden: number }` — `showAll` → tout ; sinon les enfants qui correspondent à la recherche d'abord (tous), complétés jusqu'à `limit` par les premiers autres ; `hidden` = le reste.

- [ ] **Step 1: Write the failing tests**
  - `tests/web/journal.test.ts` : 300 enfants, aucune recherche → `shown.length === 5`, `hidden === 295` ; recherche qui touche le 200e → il est dans `shown` ; `showAll` → `hidden === 0` ; 4 enfants → tous, `hidden === 0`.
  - `tests/e2e/journal.spec.ts` `import FFK : une entrée, lignes accordées, « … N autres »` : importer par l'écran Import FFK le fichier d'essai déjà utilisé par `tests/e2e/import-ffk.spec.ts` (créations seulement), ouvrir Journal → une entrée dont le titre commence par « Import FFK · », aucune entrée « Opération non détaillée » ; « Voir le détail » → au plus 5 `journal-detail-line`, une combattante « : ajoutée », bouton « … N autres » qui montre le reste.
- [ ] **Step 2: Run** `npx vitest run tests/web/journal.test.ts` et `npx playwright test journal` — Expected: FAIL.
- [ ] **Step 3: Implement** : `JournalPage` garde un état « tout montrer » par entrée (remis à zéro quand le groupe se referme) ; le bouton dit `… ${hidden} autre(s)` avec `plural` (« … 1 autre », « … 295 autres »). Feuille de route et bilan : nombres des suites, temps de l'import (même script de mesure que le bilan de l'étape 52 si disponible, sinon dire ce qui est mesuré).
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run && npx playwright test` — Expected: tout vert (noter les nombres).
- [ ] **Step 5: Commit** `git commit -m "feat(journal): long groupe replié après 5 lignes ; import FFK vérifié de bout en bout ; feuille de route"`

## Bilan

Plan fait le 2026-11-17 sur la branche `journal-import-ffk` (commits `a20f78c..` jusqu'à celui de la tâche 3).

- Livré : un import FFK validé écrit une seule entrée « Import FFK · fichier » avec ses lignes de détail (combattants ajoutés, mis à jour, retirés, catégories créées, clubs reliés, genre accordé), sans entrée brute ; un réimport identique n'écrit rien ; un long groupe est replié après 5 lignes (« … N autres », les lignes qui correspondent à la recherche restent montrées) ; onglet Journal rangé dans Préparer après Réglages, comptes dits avec leur rôle.
- Vérifié (avant le commit de la tâche 3) :
  - `npm run typecheck` : sans erreur.
  - `npx vitest run` : 212 fichiers, 2452 tests réussis.
  - `npx playwright test` : 243 tests réussis (12,2 min), sans reprise.
- Mesure de durée : la durée de l'import n'a pas été remesurée pour ce plan (le travail en plus est une entrée parent et des lignes déjà écrites à l'étape 52).
