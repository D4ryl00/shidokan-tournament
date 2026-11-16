# Numéro de licence partout (étape 50) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un champ « N° de licence » facultatif dans la fenêtre combattant, les fiches club ODS et PDF, la saisie de la fiche papier et l'import de la fiche renvoyée.

**Architecture:** La licence entre dans le modèle de saisie `ClubFormLine` (champ facultatif `licence?: string | null`) et circule par les chemins existants : lecture (`registrationsToLine`), enregistrement (`saveClubLine`, `lineToRows` → `RegistrationInput.licence`, déjà géré par `registrations.ts`), tableur (colonne repérée par son titre et retirée avant la lecture par position), comparaison de la fiche renvoyée (`ImportField`). La base a déjà `fighters.licence`.

**Tech Stack:** TypeScript, React + Mantine, Fastify, Drizzle/SQLite, pdf-lib, SheetJS (xlsx), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-numero-de-licence-design.md`

## Global Constraints

- Facultatif partout ; jamais bloquant ; jamais public.
- Saisie : texte libre, enregistré en majuscules sans espaces ; vide = rien.
- **Absente ou vide = conservée** : une saisie vide n'efface jamais une licence enregistrée.
- Libellé de colonne (ODS et PDF) : `N° de licence (facultatif)` ; dans la fenêtre : `N° de licence (facultatif)`.
- Fiche PDF : A4 paysage, une page, mêmes lignes par page qu'aujourd'hui ; colonne juste après Prénom.
- Les fiches ODS déjà envoyées (sans la colonne, et l'ancien format) restent lisibles.
- Jamais la base vivante `data/shidokan.sqlite` depuis l'hôte (copie de démonstration pour les vérifications à l'écran).

## Review Focus

- Licence tapée avec espaces / minuscules (« 1146 2640 r ») → enregistrée `11462640R` partout (fenêtre, ODS, saisie papier). Test : Task 1.
- Fiche renvoyée sans licence pour un combattant qui en a une → la licence reste, aucun écart affiché. Test : Task 3.
- Fiche ODS téléchargée avant cette étape (pas de colonne licence), relue après → toutes les colonnes lues comme avant. Test : Task 2.
- Coach qui modifie un combattant importé de la FFK sans toucher la licence → licence conservée (le formulaire renvoie la valeur affichée ou rien). Test : Task 1.
- Ligne de fiche dont seule la licence est remplie → lue (pas ignorée comme une ligne vide), avec « nom manquant » signalé, comme une ligne qui n'aurait qu'un grade. Test : Task 2.

---

### Task 1: Modèle et enregistrement

**Files:**
- Modify: `src/domain/club-form.ts` (interface `ClubFormLine` l.92 ; `lineToRows` `base` l.219), `src/domain/club-line.ts` (`LineFighter`, `registrationsToLine`), `src/server/routes/registrations.ts` (`clubFormLineSchema`), `src/server/repositories/club-entry.ts` (`saveClubLine`, `fields`)
- Test: `tests/domain/club-form.test.ts`, `tests/domain/club-line.test.ts`, `tests/server/club-entry.test.ts`

**Interfaces:**
- Produces: `normalizeLicence(v: unknown): string | null` (exportée de `src/domain/club-form.ts`) ; `ClubFormLine.licence?: string | null` ; `LineFighter.licence: string | null` ; `registrationsToLine` renvoie `line.licence = fighter.licence` ; schéma `licence: z.string().max(30).nullable().optional()`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/club-form.test.ts
test.each([['1146 2640 r', '11462640R'], ['  ', null], [null, null], [11462640, '11462640']])('normalizeLicence(%j)', (v, out) =>
  expect(normalizeLicence(v)).toBe(out));
// tests/domain/club-line.test.ts
test('registrationsToLine reprend la licence du combattant', () => {
  expect(registrationsToLine({ ...fighter, licence: '11462640R' }, regs).line.licence).toBe('11462640R');
});
// tests/server/club-entry.test.ts
test('licence : enregistrée normalisée ; vide ou absente = conservée', async () => {
  const saved = await saveClubLine(db, access, null, { ...line, licence: '1146 2640 r' }, null, { writer: { kind: 'coach' } });
  expect(saved.line.licence).toBe('11462640R');
  const again = await saveClubLine(db, access, saved.fighterId, { ...line, licence: '' }, saved.version, { writer: { kind: 'coach' } });
  expect(again.line.licence).toBe('11462640R');
  const absent = await saveClubLine(db, access, saved.fighterId, { ...line }, again.version, { writer: { kind: 'organiser' } });
  expect(absent.line.licence).toBe('11462640R');
});
```

(Réutiliser les fixtures `fighter`, `regs`, `line`, `access` déjà présentes dans ces fichiers.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/domain/club-form.test.ts tests/domain/club-line.test.ts tests/server/club-entry.test.ts`
Expected: FAIL — `normalizeLicence` introuvable, `licence` absent de la ligne.

- [ ] **Step 3: Implement**

`normalizeLicence` : texte, espaces retirés, majuscules, `''` → `null`. Dans `saveClubLine`, `fields` reçoit `licence` seulement si `normalizeLicence(line.licence)` n'est pas nul ; l'insertion d'un nouveau combattant garde `licence: null` sinon. Dans `lineToRows`, `base.licence = normalizeLicence(line.licence)` (le chemin d'import de fiche `registrations.ts` fait déjà `input.licence ?? existing.licence`). `lineOf` passe déjà la ligne de `fighters` (qui a `licence`) à `registrationsToLine`.

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npx vitest run tests/domain tests/server/club-entry.test.ts tests/server/club-lines-organiser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(licence): la ligne d'un combattant porte sa licence (normalisée, vide = conservée)"
```

### Task 2: Fiche ODS (modèle et lecture)

**Files:**
- Modify: `src/domain/club-form.ts` (constantes, `parseClubForm`), `src/domain/club-form-read.ts` (`readClubFormLines`), `src/server/club-form-template.ts` (l.75 en-tête des colonnes)
- Test: `tests/domain/club-form.test.ts`, `tests/domain/club-form-read.test.ts`, `tests/server/club-form-template.test.ts`

**Interfaces:**
- Consumes: `normalizeLicence` (Task 1).
- Produces: `CLUB_FORM_LICENCE_COLUMN = 'N° de licence (facultatif)'` ; `CLUB_FORM_LICENCE_INDEX = 2` ; `splitLicenceColumn(cells: unknown[][], columnsRow: number): { cells: unknown[][]; licences: Map<number, string | null> }` (clé : index de ligne 0-based ; renvoie les cellules sans la colonne, ou telles quelles si l'en-tête ne l'a pas).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/club-form-template.test.ts
test('le modèle a la colonne licence juste après Prénom', () => {
  const header = templateColumnsRow(buildClubFormTemplate(competition, grid, closed)); // aide de test existante ou à écrire : la ligne CLUB_FORM_COLUMNS_ROW
  expect(header.slice(0, 3)).toEqual(['Nom', 'Prénom', 'N° de licence (facultatif)']);
});
// tests/domain/club-form.test.ts
test('fiche avec la colonne licence : licence lue, autres colonnes inchangées', () => {
  const parsed = parseClubForm(sheetWithLicence([['MOREAU', 'Lina', '1146 2640 r', 'F', 'Poussin', 22, 'Karaté', 'Non', null, 'Jiyu']]), grid);
  expect(parsed.rows[0]!.input).toMatchObject({ lastName: 'MOREAU', licence: '11462640R', discipline: 'karate', ageBandCode: 'poussin' });
});
test('fiche sans la colonne (envoyée avant) : lue comme avant, licence nulle', () => {
  expect(parseClubForm(sheetWithoutLicence(sameLine), grid).rows[0]!.input).toMatchObject({ lastName: 'MOREAU', licence: null });
});
test('ligne avec seulement une licence : lue, nom manquant signalé', () => {
  expect(parseClubForm(sheetWithLicence([[null, null, '11462640R']]), grid).rows[0]!.errors.join(' ')).toMatch(/Nom/);
});
// tests/domain/club-form-read.test.ts
test('fiche renvoyée : la licence entre dans la ligne lue', () => {
  expect(readClubFormLines(sheetWithLicence(oneLine), grid, tol).items[0]!.line.licence).toBe('11462640R');
});
```

(`sheetWithLicence` / `sheetWithoutLicence` : construire les cellules depuis les aides de fiche existantes de ces fichiers, en insérant la colonne à l'index 2.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/domain/club-form.test.ts tests/domain/club-form-read.test.ts tests/server/club-form-template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Le modèle insère `CLUB_FORM_LICENCE_COLUMN` à `CLUB_FORM_LICENCE_INDEX` (colonne de texte, sans liste de validation ; décaler les plages de validation des colonnes suivantes). `parseClubForm` et `readClubFormLines` appellent `splitLicenceColumn` juste après `locate`, travaillent ensuite sur les cellules sans la colonne (la détection par position — `Poids actuel` en 5e, `Triathlon` en 13e — reste juste), puis posent `line.licence` (et donc `input.licence`). Repérage par titre : `normalizeName` du titre égal à celui de `CLUB_FORM_LICENCE_COLUMN`, à n'importe quel index. Une ligne vide hors licence reste ignorée seulement si la licence est vide aussi. Aide de la feuille (`club-form-template.ts`, l.92 environ) : une ligne « N° de licence : facultatif, aide l'organisation à reconnaître le combattant dans l'export FFK. »

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npx vitest run tests/domain tests/server/club-form-template.test.ts tests/server/club-form-read-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(licence): colonne licence dans la fiche ODS, lue par son titre"
```

### Task 3: Écart de licence à l'import de la fiche renvoyée

**Files:**
- Modify: `src/domain/club-form-plan.ts` (`ImportField`, `fieldValue`, `fieldPatch`, `FIELDS`, `clubFormDiffs`, `prefillExistingFromFile`), `src/web/components/club-line/ffkStep.ts` (`importValueText`, `hiddenConflicts`), `src/web/components/ClubLineForm.tsx` (`FIELD_LABELS`, `DISABLED`)
- Test: `tests/domain/club-form-plan.test.ts`

**Interfaces:**
- Consumes: `ClubFormLine.licence` (Task 1).
- Produces: `ImportField` inclut `'licence'` ; libellé `N° de licence`.

- [ ] **Step 1: Write the failing tests**

```ts
test('licence différente des deux côtés : écart', () => {
  expect(clubFormDiffs({ ...line, licence: '11462640R' }, { ...line, licence: '11000001A' })).toContainEqual({ field: 'licence', ffk: '11462640R', fiche: '11000001A' });
});
test('licence vide d’un côté : pas d’écart, la licence existante est gardée ou complétée', () => {
  expect(clubFormDiffs({ ...line, licence: null }, { ...line, licence: '11000001A' }).map((d) => d.field)).not.toContain('licence');
  expect(clubFormDiffs({ ...line, licence: '11462640R' }, { ...line, licence: null }).map((d) => d.field)).not.toContain('licence');
  expect(prefillExistingFromFile({ ...line, licence: null }, [], [], { ...line, licence: '11462640R' }).licence).toBe('11462640R');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/domain/club-form-plan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`fieldValue(line, 'licence')` = `normalizeLicence(line.licence)` ; `fieldPatch('licence', v)` = `{ licence: v }`. `clubFormDiffs` ne compte la licence que si les deux côtés sont remplis. `prefillExistingFromFile(saved, diffs, started, file?: ClubFormLine)` : nouveau 4e paramètre facultatif ; `licence = saved.licence || file?.licence || null` avant d'appliquer les écarts ; mettre à jour ses appelants (`src/web/components/club-form-import/steps.ts`, `src/web/components/ffk-import/wizard.ts` si concerné) pour passer la ligne lue. Dans `ClubLineForm`, `FIELD_LABELS.licence = 'N° de licence'`, `DISABLED.licence = false` (la licence se corrige même combats commencés).

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npx vitest run tests/domain/club-form-plan.test.ts tests/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(licence): écart de licence à l'import de la fiche renvoyée"
```

### Task 4: Fenêtre combattant et saisie de la fiche papier

**Files:**
- Modify: `src/web/components/ClubLineForm.tsx` (champ après Nom/Prénom), `src/web/components/PaperEntryTable.tsx` (colonne après Prénom, `isEmpty`, `EMPTY`), `src/web/help.ts` (rubriques de la fenêtre et de la fiche papier)
- Test: `tests/e2e/inscriptions.spec.ts` (fenêtre organisateur), `tests/e2e/inscription-en-ligne.spec.ts` (coach), `tests/e2e/import-ods-club.spec.ts` (saisie papier)

**Interfaces:**
- Consumes: `ClubFormLine.licence`, `ImportField 'licence'` (Tasks 1, 3).
- Produces: `data-testid="line-licence"` (fenêtre), `aria-label="N° de licence"` (tableau papier).

- [ ] **Step 1: Write the failing e2e tests**

```ts
// inscriptions.spec.ts
test('licence : saisie dans la fenêtre, relue normalisée', async ({ page }) => {
  // ouvrir « Ajouter un combattant », remplir les champs requis + getByTestId('line-licence').fill('1146 2640 r'), Enregistrer
  // rouvrir la fiche : await expect(page.getByTestId('line-licence')).toHaveValue('11462640R');
});
// inscription-en-ligne.spec.ts : même parcours côté coach.
// import-ods-club.spec.ts : saisie papier avec une licence → la fiche du combattant la montre.
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/e2e/inscriptions.spec.ts tests/e2e/inscription-en-ligne.spec.ts tests/e2e/import-ods-club.spec.ts -g "licence"`
Expected: FAIL — champ introuvable.

- [ ] **Step 3: Implement**

`ClubLineForm` : `TextInput` « N° de licence (facultatif) », `data-testid="line-licence"`, sous Nom / Prénom (pleine largeur à téléphone), valeur `form.licence ?? ''`, `set({ licence: value || null })`, `FfkChoice` dessous (`choice('licence')`) ; modifiable même ligne verrouillée (comme le nom). `PaperEntryTable` : colonne « N° de licence » après Prénom (`w={110}`), `isEmpty` tient compte de la licence. Aides : une phrase dans les rubriques de la fenêtre combattant et de la fiche papier : « N° de licence : facultatif ; il permet de reconnaître le combattant à coup sûr à l'import de l'export FFK. »

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npx vitest run && npx playwright test tests/e2e/inscriptions.spec.ts tests/e2e/inscription-en-ligne.spec.ts tests/e2e/import-ods-club.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(licence): champ licence dans la fenêtre combattant et la saisie de la fiche papier"
```

### Task 5: Fiche PDF

**Files:**
- Modify: `src/server/club-form-pdf.ts` (`COLUMNS` l.19, `head1`/`head2` l.168, indices `xs[2..9]` / `cw(3)` l.210-230)
- Test: `tests/server/club-form-pdf.test.ts`

**Interfaces:**
- Consumes: rien des autres tâches.
- Produces: rien.

- [ ] **Step 1: Write the failing test**

```ts
test('fiche papier PDF : colonne « N° de licence (facultatif) » après Prénom, toujours une page', async () => {
  const pdf = await PDFDocument.load(await fetchPdf());
  expect(pdf.getPageCount()).toBe(1);
  expect(await pdfText(pdf)).toMatch(/Prénom\s+N° de licence/); // aide d'extraction de texte déjà utilisée dans ce fichier
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/club-form-pdf.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`COLUMNS = [8.5, 7.5, 8, 4.5, 17, 5.5, 15.5, 6, 6.5, 9, 12]` (somme 100 ; licence ≈ 22 mm). `head1` insère `'N° de licence'` à l'index 2 et `head2[2] = 'facultatif'` ; tous les indices de colonnes ≥ 2 dans le tracé des lignes (`xs[2]` sexe → `xs[3]`, âge `xs[3]`/`cw(3)` → `xs[4]`/`cw(4)`, disciplines 5 → 6, règlement 7 → 8, si seul 8 → 9, shobu 9 → 10) avancent d'un. Si les cases d'âge débordent à 17 %, réduire leur pas plutôt que la police.

- [ ] **Step 4: Run test and look at the page**

Run: `npx vitest run tests/server/club-form-pdf.test.ts` → PASS. Puis rendre la fiche d'une copie de démonstration (`curl …/club-form.pdf -o /tmp/fiche.pdf && sips -s format png /tmp/fiche.pdf --out /tmp/fiche.png`) et la regarder : aucune case ni texte qui chevauche, en-têtes lisibles, cases d'âge complètes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(licence): colonne licence dans la fiche club PDF"
```

### Task 6: Vérification d'ensemble et documents

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1: Tout lancer**

Run: `npm run typecheck && npx vitest run && npx playwright test`
Expected: tout passe (noter les nombres réels).

- [ ] **Step 2: Vérifier sur Chrome** (copie de démonstration, port 3200 : `PORT=3200 DATABASE_PATH=<copie d'une sauvegarde> WEB_DIST_DIR=<build> npx tsx src/server/main.ts`) : fenêtre organisateur (saisie, relecture, ligne verrouillée), page du club en ligne (coach), fiche PDF ouverte, modèle ODS téléchargé (colonne présente), import d'une fiche ODS avec licence ; aucune erreur console. Simulateur iPhone (idb) : fenêtre combattant à largeur de téléphone.

- [ ] **Step 3: Documents** : « Étape 50 » dans la feuille de route ; section étape 50 dans le bilan (décisions, contrôles à l'écran, « Vérifié » avec les chiffres réels).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(licence): bilan de l'étape 50"
```
