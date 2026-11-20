# Carte de réaffectation lisible, session finale dans le récapitulatif club — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur une carte de réaffectation, mettre en valeur le motif plutôt que le rappel du combattant ; dans le récapitulatif PDF d'un club, écrire « Déplacé dans la session X » quand un combattant change de session.

**Architecture:** Changement d'affichage seul dans `ReplacementPage.tsx` (pas de logique). Pour le récapitulatif, le dépôt calcule deux noms de session par inscription : celle des règles pour la catégorie d'inscription, et celle de la catégorie finale. Le domaine `recapLines` décide de la mention, puis le PDF la dessine.

**Tech Stack:** TypeScript, React + Mantine, Fastify, drizzle/SQLite, pdf-lib, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-carte-reaffectation-et-session-recapitulatif-design.md`

## Global Constraints

- Texte exact de la mention : `Déplacé dans la session ${nom}` (sans horaire, sans point final).
- Pas de mention sans sessions, pour une ligne non changée, ni pour Absent / Ne combat pas / Pas encore placé, ni quand la session finale est « en attente » (null).
- Couleur d'attention : `var(--sk-warn-text)` (déjà utilisée par `Stat`).
- Les `data-testid` existants sont gardés ; nouveau : `case-detail`.
- Code et commentaires en français, comme le reste du dépôt.

## Review Focus

- Une catégorie regroupée (aliasKeys) contient l'ancienne clé du combattant : la session d'inscription se calcule **par les règles** (`waveOfCategory` sur la clé naturelle, sans choix individuel), jamais en cherchant la catégorie naturelle. Sinon, un senior placé dans un groupe Juniors / Seniors n'aurait jamais la mention. Test : Task 2, `regroupement juniors / seniors`.
- Ligne non changée dans une catégorie dont la session a été fixée à la main (`waveOverride`) : pas de mention (la mention suit `changed`). Test : Task 2, domaine, `non changé : pas de mention même si les sessions diffèrent`.
- Session finale « en attente » (catégorie sans session) : pas de mention. Test : Task 2, domaine.
- Ligne très longue dans le PDF : la mention compte dans la hauteur de la ligne et reste sur une page. Test : Task 3.
- Une carte « Retour possible » garde un motif neutre (pas orange). Pas de test automatique ; à vérifier à l'œil sur Chrome (Task 1).

---

### Task 1: Carte de réaffectation — le motif d'abord

**Files:**
- Modify: `src/web/pages/ReplacementPage.tsx:69-82` (`FighterDetail`) et `:317-326` (`caseCard`)
- Test: `tests/e2e/plan-d-ensemble.spec.ts` (test qui contient `const card = page.getByTestId('replacement-case').filter({ hasText: 'SEULE' });`, vers la ligne 735)

**Interfaces:** aucune pour les autres tâches.

- [ ] **Step 1: Write the failing e2e assertion** — juste après la ligne `const card = …filter({ hasText: 'SEULE' });` :

```ts
  // Le motif de la carte vient avant le rappel du combattant.
  await expect(card.getByTestId('case-detail')).toBeVisible();
  await expect(card.locator('[data-testid="case-detail"] ~ [data-testid="case-fighter"]')).toHaveCount(1);
```

- [ ] **Step 2: Run it to make sure it fails**
Run: `npx playwright test tests/e2e/plan-d-ensemble.spec.ts -g "SEULE|toutes les catégories"` (ou le titre exact du test). Le `-g` doit sélectionner ce test.
Expected: FAIL, `case-detail` introuvable.

- [ ] **Step 3: Implement** — dans `caseCard`, sous `case-name`, dans cet ordre et tous trois frères dans le même `<div>` :
  1. `<Text size="sm" fw={600} c={c.kind === 'return' ? undefined : 'var(--sk-warn-text)'} data-testid="case-detail">{c.detail}</Text>`
  2. si la catégorie actuelle existe : `<Text size="sm">Catégorie actuelle : {label}</Text>`. Le label est cherché une seule fois.
  3. `<FighterDetail …/>`, dont le `Text` reçoit `c="dimmed"`.

  L'ancien `Text c="dimmed"` qui concaténait le motif et la catégorie est supprimé.

- [ ] **Step 4: Run tests**
Run: `npx playwright test tests/e2e/plan-d-ensemble.spec.ts && npm run typecheck`
Expected: PASS. Puis `grep -rn "catégorie actuelle" tests` : adapter les assertions qui attendaient l'ancien texte en minuscule.

- [ ] **Step 5: Commit**
`git commit -am "fix(replacement): le motif de la carte en évidence, le rappel du combattant grisé"`

### Task 2: Récapitulatif — session finale quand elle change (domaine + dépôt)

**Files:**
- Modify: `src/domain/club-recap.ts`
- Modify: `src/server/repositories/club-recap.ts`
- Test: `tests/domain/club-recap.test.ts`, `tests/server/club-recap.test.ts`

**Interfaces:**
- Produces: `RecapRegistration.sessions?: { registered: string | null; final: string | null }` (noms de session, null = aucune) ; `RecapLine.session: string | null`, le nom de la session finale quand elle change, sinon null. Task 3 lit `line.session`.
- Consumes: `waveOfCategory` (`src/domain/waves.ts`), `naturalKey` (`src/domain/categories.ts`), `listWaves` (`src/server/repositories/waves.ts`), `readCategories` (`src/server/repositories/categories.ts`, qui donne `Category.waveId`).

- [ ] **Step 1: Write the failing domain tests** (dans `tests/domain/club-recap.test.ts`). Le test `non déplacé` existant attend maintenant `session: null` dans son `toEqual`.

```ts
const moved = (sessions: RecapRegistration['sessions'], over: Partial<RecapRegistration> = {}) =>
  recapLines([reg({ final: { kind: 'category', label: 'X', keyString: 'autre' }, recasementType: 'C', sessions, ...over })], grid)[0]!;

test('session finale différente : mention', () => {
  expect(moved({ registered: 'Matin', final: 'Poussins - Pupilles' })).toMatchObject({ changed: true, session: 'Poussins - Pupilles' });
});
test('même session, sans sessions, session finale en attente : pas de mention', () => {
  expect(moved({ registered: 'Matin', final: 'Matin' }).session).toBeNull();
  expect(moved(undefined).session).toBeNull();
  expect(moved({ registered: 'Matin', final: null }).session).toBeNull();
});
test('non changé : pas de mention même si les sessions diffèrent', () => {
  expect(recapLines([reg({ sessions: { registered: 'Matin', final: 'Soir' } })], grid)[0]!.session).toBeNull();
});
test('absent : pas de mention', () => {
  expect(moved({ registered: 'Matin', final: 'Soir' }, { final: { kind: 'absent' } }).session).toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/domain/club-recap.test.ts`. Expected: FAIL (`session` absent).

- [ ] **Step 3: Implement in `recapLines`.** `session = changed && r.final.kind === 'category' && r.sessions?.final && r.sessions.final !== r.sessions.registered ? r.sessions.final : null`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Write the failing server tests** (dans `tests/server/club-recap.test.ts`). Ce sont des tests de dépôt : `clubRecapLines` s'appelle directement sur la base du test, sur le modèle des autres tests de dépôt. À défaut, passer par `buildClubRecapPdf`/`pdfText` en attendant le texte de la Task 3. Sessions créées par `PUT /waves` comme dans `tests/server/estimate.test.ts:37`.
  - `déplacé vers une tranche d'une autre session` : sessions `Cadets` (`['cadet']`) et `Juniors` (`['junior']`), une cadette `DEPLACEE` et deux juniors F -54. `POST /replacement/move` place la cadette dans la catégorie des juniors. Attendu : sa ligne a `session: 'Juniors'` ; les lignes des juniors ont `session: null`.
  - `regroupement juniors / seniors` : sessions `Juniors` (`['junior']`) et `Seniors` (`['senior']`), une senior seule et une junior seule, F, même discipline et même poids. `GET /replacement` (vague `Juniors` ou `Seniors`), puis appliquer par `POST /replacement/apply` la proposition de type `C` qui les réunit, comme les tests de `tests/server/replacement.test.ts`. Attendu : une seule des deux lignes a une `session` non nulle, égale au nom de la session de l'autre tranche (celle de la catégorie finale).
  - `sans sessions` : la ligne du test `récapitulatif PDF…` existant, pour la combattante déplacée, a `session: null`.

- [ ] **Step 6: Run** `npx vitest run tests/server/club-recap.test.ts`. Expected: FAIL.

- [ ] **Step 7: Implement in `src/server/repositories/club-recap.ts`.**
  - `context` charge en plus `waves = await listWaves(db, competitionId)` et `waveOf = new Map((await readCategories(db, competitionId)).map((c) => [c.id, c.waveId]))`, sans resynchroniser.
  - Dans `linesOf`, `sessions.final` est le nom de `waveOf.get(r.categoryId)` (null si pas de catégorie ou en attente). `sessions.registered` est le nom de `waveOfCategory({ key: naturalKey(registered, f), waveOverride: null, waveBands: [f.ageBandCode] }, waves, grid)`. `registered` désigne les valeurs d'origine déjà calculées. Sans session (`waves.length === 0`), `sessions` reste indéfini.

- [ ] **Step 8: Run** `npx vitest run tests/server/club-recap.test.ts tests/domain/club-recap.test.ts && npm run typecheck`. Expected: PASS.

- [ ] **Step 9: Commit**
`git commit -am "feat(clubs): récapitulatif — session finale quand elle change"`

### Task 3: Récapitulatif PDF — dessiner la mention

**Files:**
- Modify: `src/server/club-recap-pdf.ts`
- Test: `tests/server/club-recap.test.ts`

**Interfaces:**
- Consumes: `RecapLine.session: string | null` (Task 2).

- [ ] **Step 1: Write the failing tests**
  - `PDF : mention de session` : `buildClubRecapPdf` avec une ligne `{ fighter: 'A B', registered: 'r', final: 'f', changed: true, reason: 'tranche d’âge voisine', session: 'Poussins - Pupilles' }`. `pdfText` contient `Déplacé dans la session Poussins - Pupilles`.
  - `PDF : mention sur une ligne très longue` : même ligne avec `final` de 400 caractères et `session` de 200 caractères. Le PDF garde 1 page et `pdfText` contient `Déplacé`.
  - Le test de route avec sessions de la Task 2 (`déplacé vers une tranche…`) vérifie aussi que le texte du PDF de `/clubs/:id/recap.pdf` contient `Déplacé dans la session Juniors`.

- [ ] **Step 2: Run** `npx vitest run tests/server/club-recap.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Dans la colonne « Au final », après « Changé (motif) », écrire en gras `Déplacé dans la session ${line.session}`, replié sur la largeur de la colonne (`wrap(bold, …, textW(2))`). Ses lignes comptent dans `noteRows`. La règle « une ligne ne dépasse jamais une page » reste vraie : la mention est tronquée par `clip` comme le reste, et `final` garde au moins une ligne.

- [ ] **Step 4: Run** `npx vitest run tests/server/club-recap.test.ts && npm run typecheck && npx vitest run`. Expected: PASS (toute la suite).

- [ ] **Step 5: Commit**
`git commit -am "feat(clubs): récapitulatif PDF — « Déplacé dans la session … »"`

### Task 4: Vérification sur Chrome et bilan

- [ ] Serveur de test jetable (jamais la base vivante ; `BACKUP_INTERVAL_MIN` ≤ 1440). Créer deux sessions par tranche, une catégorie avec un écart de poids, et un déplacement vers une autre session.
- [ ] Chrome, Réaffectation : la carte « Écart de poids » montre le motif en orange semi-gras sous le nom, la catégorie actuelle, puis le rappel grisé. Vérifier aussi une carte « Retour possible » (motif neutre), en clair et en sombre, et à 390 px.
- [ ] Chrome, Clubs : télécharger le récapitulatif du club et l'ouvrir. Il contient « Déplacé dans la session … » sur la bonne ligne et rien sur les autres.
- [ ] `npx playwright test` complet. Puis ajouter une section au bilan `docs/superpowers/plans/2026-10-21-99-bilan.md` et commiter.
