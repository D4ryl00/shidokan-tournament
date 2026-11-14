# Étape 44 — Importer une fiche renvoyée, fiche par fiche — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dans l'onglet Fiche club, « 2. Importer une fiche renvoyée » devient le parcours du PDF FFK : club choisi, fichier lu, étape « Coordonnées du club » à valider, puis une fenêtre par combattant pré-remplie avec la fiche et des choix « Fiche renvoyée » / « Enregistré » sur chaque conflit, et à la fin les absents à cocher.

**Architecture:** le serveur lit le tableur en lignes de combattant (lecture seule) et écrit les coordonnées validées (club + annuaire) par une route dédiée. Une logique pure (`src/domain/club-form-read.ts`, `src/domain/club-form-plan.ts`) lit, compare et pré-remplit. Le navigateur réutilise le réducteur du parcours FFK (rendu générique), la fenêtre `ClubLineForm` (comparaison étendue à tous les champs de la fiche) et les routes de lignes existantes.

**Tech Stack:** TypeScript, Fastify, Drizzle/SQLite, React + Mantine, Vitest, Playwright, `xlsx` (déjà là).

**Spec:** `docs/superpowers/specs/2026-11-14-import-fiche-renvoyee-design.md` (lire aussi `docs/superpowers/specs/2026-11-10-import-pdf-ffk-design.md` §6.2 pour le comportement commun des étapes).

## Global Constraints

- Aucun nom réel dans le dépôt : tests avec des noms inventés. La fiche réelle `~/Downloads/fiche-club-TANI DOJO.ods` ne sert qu'au test sur Chrome et n'est jamais copiée dans le dépôt.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte : test sur Chrome sur un serveur à part (`PORT=3100 DATABASE_PATH=tmp/<copie d'une sauvegarde> npx tsx src/server/main.ts`).
- Le club n'est **jamais** reconnu d'après le nom écrit dans la fiche : il est choisi (`ClubPicker`) ; le nom lu n'est qu'un rappel.
- Par défaut, partout, la **fiche renvoyée l'emporte** (y compris une discipline enregistrée absente de la fiche, et l'âge / la catégorie de poids d'un combattant confirmé FFK) ; chaque différence est montrée avec les deux cases.
- Une case vide de la fiche ne crée pas de différence et n'efface rien (reclassement, priorité shobu, grade, poids, pré-accord, coach, téléphone compris).
- Nom, prénom, sexe ne sont jamais comparés. Rapprochement : `normalizeName(nom + ' ' + prénom)` et sexe ; sexe illisible dans la fiche → nom seul.
- Rien n'est écrit à « Commencer » sauf l'entrée d'un club de l'annuaire dans la compétition. Les coordonnées ne s'écrivent qu'à « Enregistrer · suivant → » de l'étape coordonnées, dans le club **et** sa fiche d'annuaire.
- Ancien format (colonnes `CLUB_FORM_LEGACY_COLUMNS`) refusé par la lecture : « Ancien modèle de fiche : demandez au club de remplir le nouveau. »
- Inscriptions **créées** par ce parcours : origine `club_form` ; une inscription existante garde la sienne.
- Absents : cases décochées ; cocher supprime la fiche entière (`ops.remove`) ; fiche verrouillée listée sans case.
- Routes nouvelles réservées au rôle Organisateur (ne pas les ajouter à `TABLE_WRITES`).
- Textes exacts : bouton « Importer la fiche d’un club » ; titre « Importer une fiche renvoyée » ; « La fiche indique le club « X ». » ; « Commencer (N fiches) » ; « Fiche k sur N » ; « Enregistrer · suivant → » ; « ← Précédent » ; « Ne pas l’ajouter » ; « Laisser la fiche telle quelle » ; « Laisser tel quel » ; cases « Fiche renvoyée » / « Enregistré » / « Enregistré · confirmé FFK » ; « Fiche déjà créée. » ; « Dans la fiche (ligne N) » ; « <Club> : coordonnées » ; « La fiche renvoyée donne d’autres coordonnées. » ; « Ajouter <adresse> » ; « Inscrits chez nous, absents de la fiche » ; « Cochez seulement ceux qui ne viendront pas : leur fiche est supprimée. » ; « Terminer ».
- Le parcours du PDF FFK ne change pas de comportement : ses tests (`tests/web/ffk-wizard.test.ts`, `tests/web/ffk-step.test.ts`, `tests/e2e/import-pdf-ffk.spec.ts`) passent sans modification de leurs attentes.
- Interface en français, apostrophes typographiques (’).

## Review Focus

1. **Combattant dont une discipline a commencé, absente de la fiche** : la discipline commencée reste cochée (le serveur refuserait « commencé, ne se retire pas ») — Task 2, test `discipline commencée gardée`.
2. **Réimport de la même fiche après un arrêt au milieu** : les fiches enregistrées ressortent « déjà à jour » (poids → catégorie, grade, reclassement identiques une fois relus) — Task 2, test `réimport : déjà à jour`.
3. **Adresse e-mail en casse différente** (`Coach@Dojo.fr` vs `coach@dojo.fr`) : pas une adresse nouvelle — Task 2, test `e-mails sans casse`.
4. **Sexe illisible dans la fiche** : rapprochement par le nom seul, homonymes si plusieurs — Task 2, test `sexe illisible`.
5. **Club modifié ailleurs pendant l'étape coordonnées** : 409, rien n'est écrit, l'étape est relue — Task 3, test `coordonnées périmées`.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/domain/club-form.ts` | Exporter `cellsToLine`, `locate`, `parseHeader` (sans changer leur comportement). |
| `src/domain/club-form-read.ts` (nouveau) | Cellules → en-tête + lignes de combattant (poids → catégorie, fusion, remarques). |
| `src/domain/club-form-plan.ts` (nouveau) | Champs comparés, différences, plan (nouveau / existant / homonyme / à jour / absents), pré-remplissage, différences de coordonnées. |
| `src/server/routes/club-form-read.ts` (nouveau) | `POST …/club-forms/read`, `POST …/clubs/:clubId/club-form-header`. |
| `src/server/repositories/club-changes.ts` | + `writeClubFormHeader` (club + annuaire, recalcul des changements). |
| `src/server/repositories/club-entry.ts`, `src/server/routes/club-lines.ts` | Origine facultative `club_form` ; `ffkConfirmed` sur `ClubLine`. |
| `src/server/app.ts` | Enregistrer les routes. |
| `src/web/components/ffk-import/wizard.ts` | Réducteur générique sur l'entrée importée. |
| `src/web/components/club-line/ffkStep.ts`, `FfkChoice.tsx`, `src/web/components/ClubLineForm.tsx` | Libellés des cases, remarques du fichier, nouveaux champs comparés. |
| `src/web/components/club-form-import/steps.ts` (nouveau) | Vue de chaque étape (combattant, coordonnées), lignes d'absents. |
| `src/web/components/club-form-import/ClubFormImportWizard.tsx` (nouveau) | Départ, étape coordonnées, fiches, fin. |
| `src/web/api.ts` | Hooks de lecture et d'écriture des coordonnées ; `source` dans `LineOps.save`. |
| `src/web/pages/ClubFormPage.tsx`, `src/web/help.ts` | Section 2 et son aide. |

---

### Task 1: Lecture d'une fiche en lignes de combattant

**Files:**
- Modify: `src/domain/club-form.ts` (exports seulement)
- Create: `src/domain/club-form-read.ts`
- Test: `tests/domain/club-form-read.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ClubFormReadHeader { club: string; coachName: string | null; coachPhone: string | null; coachEmails: string[]; preApproval: boolean | null }
  export interface ClubFormItem { order: number; rows: number[]; line: ClubFormLine; notes: string[] }
  export interface ClubFormRead { header: ClubFormReadHeader; items: ClubFormItem[]; merged: { label: string; rows: number[] }[] }
  export const LEGACY_FORM_REFUSED = 'Ancien modèle de fiche : demandez au club de remplir le nouveau.';
  export function readClubFormLines(cells: unknown[][], grid: CategoryGrid, tolerance: WeighInTolerance): ClubFormRead; // NotAClubFormError si refusé
  ```

- [ ] **Step 1: Write the failing tests** (cellules construites dans le test avec les constantes `CLUB_FORM_*` : titre, en-tête lignes 4–8, colonnes ligne 13, lignes à partir de 14 ; grille de test habituelle des tests de `club-form.test.ts`)
  - `ligne complète` : `['MARTIN','Léa','Féminin','Cadets','52','Karaté','Oui','2e kyu','Jiyu','','1','','','']` → `items[0]` : `{ order: 0, rows: [14], line: { combats: ['karate'], kata: true, grade: '2e kyu', ruleset: 'jiyu', weightKg: 52, weightClassId: <id de la catégorie cadets F qui contient 52 kg>, prefs: { 'shido-boxing': 1 } }, notes: [] }`.
  - `poids sans catégorie` : poids hors grille → `weightClassId: null`, une note contenant « catégorie de poids ».
  - `ligne illisible gardée` : âge « 12 ans » → `ageBandCode: null`, `notes` contient « Catégorie d'âge incompréhensible : « 12 ans ». », nom et autres champs lus.
  - `vétéran sans numéro` : « Vétéran » → `ageBandCode: 'v1'` et la note « « Vétéran » sans numéro : placé en V1 (à corriger si besoin). ».
  - `fusion` : MARTIN Léa F ligne 14 karaté, ligne 16 kata → un item `rows: [14, 16]`, `combats: ['karate'], kata: true` ; `merged: [{ label: 'MARTIN Léa', rows: [14, 16] }]`.
  - `pré-accord vide` : en-tête ligne 8 vide → `header.preApproval === null` ; « Oui » → `true`.
  - `ancien format refusé` : colonnes `CLUB_FORM_LEGACY_COLUMNS` → lève `NotAClubFormError` avec `LEGACY_FORM_REFUSED`.

- [ ] **Step 2: Run** `npx vitest run tests/domain/club-form-read.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 3: Implement `readClubFormLines`** : `locate` + `parseHeader` (pré-accord relu en `parseYesNo(...)` sans `?? false`) ; même repérage des colonnes que `parseClubForm` (triathlon, 2e combat) ; `cellsToLine` par ligne non vide, notes = erreurs puis remarques ; catégorie par `weightClassForWeight(grid, âge, sexe, poids, tolerance[sexe])` quand âge, sexe, poids et au moins un combat ; `tidyReclass` ; fusion par `normalizeName(nom prénom)` + sexe (première valeur non nulle, combats réunis dans l'ordre, kata OU). `order` = index de l'item.

- [ ] **Step 4: Run** the same command — Expected: PASS ; `npx vitest run tests/domain/club-form.test.ts` toujours PASS.

- [ ] **Step 5: Commit** `feat(domain): lire une fiche renvoyée en lignes de combattant`

### Task 2: Comparaison, plan et pré-remplissage

**Files:**
- Create: `src/domain/club-form-plan.ts`
- Test: `tests/domain/club-form-plan.test.ts`

**Interfaces:**
- Consumes: `ClubFormItem`, `ClubFormReadHeader` (Task 1) ; `PlanLine` de `ffk-pdf-plan.ts` (+ `startedDisciplines?: DisciplineId[]`).
- Produces:
  ```ts
  export type ImportField = 'ageBandCode' | 'weightClassId' | 'weightKg' | 'disciplines' | 'ruleset' | 'grade' | 'prefs' | 'shobuKeep';
  export interface ImportDiff { field: ImportField; ffk: string; fiche: string | null } // `ffk` = valeur importée (nom gardé du PDF FFK)
  export function fieldValue(line: ClubFormLine, field: ImportField): string | null;
  export function fieldPatch(field: ImportField, value: string | null): Partial<ClubFormLine>;
  export function clubFormDiffs(file: ClubFormLine, saved: ClubFormLine): ImportDiff[];
  export type ClubFormStep = { kind: 'new'; ffk: ClubFormItem } | { kind: 'existing'; ffk: ClubFormItem; fighterId: string; diffs: ImportDiff[] } | { kind: 'homonym'; ffk: ClubFormItem; candidates: string[] };
  export interface ClubFormPlan { steps: ClubFormStep[]; upToDate: number; absents: string[] }
  export function planClubFormImport(items: ClubFormItem[], lines: PlanLine[]): ClubFormPlan;
  export function prefillFromFile(file: ClubFormLine, minorBands: Set<string>): ClubFormLine;
  export function prefillExistingFromFile(saved: ClubFormLine, diffs: ImportDiff[], startedDisciplines: DisciplineId[]): ClubFormLine;
  export interface HeaderDiff { coachName: { fiche: string; saved: string | null } | null; coachPhone: { fiche: string; saved: string | null } | null; preApproval: { fiche: boolean; saved: boolean } | null; newEmails: string[] }
  export function clubHeaderDiff(file: ClubFormReadHeader, club: { coachName: string | null; coachPhone: string | null; coachEmails: string[]; preApproval: boolean }): HeaderDiff;
  export const hasHeaderDiff: (d: HeaderDiff) => boolean;
  ```
  Encodages de `fieldValue` : `weightKg` → `String(kg)` ; `disciplines` → combats dans l'ordre `PREF_DISCIPLINES` puis `kata`, joints par `,` (`null` si aucun) ; `prefs` → `orderedPrefs` joints par `,` (`null` si vide) ; `grade` → texte rogné ; les autres tels quels.

- [ ] **Step 1: Write the failing tests**
  - `fieldValue / fieldPatch aller-retour` pour chaque champ (ex. `fieldPatch('disciplines', 'karate,kata')` → `{ combats: ['karate'], kata: true }`, `fieldPatch('prefs', 'shido-mix,karate')` → `{ prefs: { 'shido-mix': 1, karate: 2 } }`).
  - `case vide n'efface rien` : fichier `weightKg: null, grade: null, prefs: {}, shobuKeep: null` vs enregistré avec valeurs → aucune différence sur ces champs.
  - `discipline retirée = différence` : fichier `combats: ['karate'], kata: false` vs `karate + kata` → `{ field: 'disciplines', ffk: 'karate', fiche: 'karate,kata' }`.
  - `poids / règlement sans combat dans la fiche` : fichier kata seul → pas de différence `weightClassId` ni `ruleset`.
  - `plan` : nouveau, existant avec différences, homonymes (deux fiches même nom et sexe), déjà à jour (`upToDate: 1`), absents (fiches non rapprochées, toutes disciplines).
  - `sexe illisible` : fichier `sex: null` → rapproché par le nom ; deux fiches de même nom → `homonym`.
  - `réimport : déjà à jour` : une ligne enregistrée égale à `prefillFromFile(file)` → `upToDate`.
  - `prefillFromFile` : mineur (`minorBands` contient sa tranche) avec combat et `ruleset: null` → `'jiyu'` ; adulte → reste `null`.
  - `prefillExistingFromFile` : valeurs du fichier pour chaque différence, le reste de l'enregistré (`weightKg`, `grade` gardés si le fichier est vide).
  - `discipline commencée gardée` : différence `disciplines` qui retire `kata` avec `startedDisciplines: ['kata']` → `kata` reste `true`.
  - `e-mails sans casse` : `coachEmails: ['Coach@Dojo.fr', 'neuf@dojo.fr']` vs `['coach@dojo.fr']` → `newEmails: ['neuf@dojo.fr']`.
  - `coordonnées vides` : coach / téléphone / pré-accord vides dans la fiche → `null`, `hasHeaderDiff` faux.

- [ ] **Step 2: Run** `npx vitest run tests/domain/club-form-plan.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** in `src/domain/club-form-plan.ts`. Règles des différences : spec §6.5 (tableau). Les différences de `weightClassId`, `ruleset` ne comptent que si le fichier a un combat ; `grade` si le fichier coche le kata ; `shobuKeep` si le fichier est en shobu. Plan dans l'ordre `order`, même structure que `planFfkImport`. Comparaison des e-mails par `sameEmail` / `cleanEmails` de `src/domain/emails.ts`.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(domain): comparer une fiche renvoyée aux fiches du club`

### Task 3: Routes serveur

**Files:**
- Create: `src/server/routes/club-form-read.ts`
- Modify: `src/server/repositories/club-changes.ts` (+ `writeClubFormHeader`), `src/server/repositories/club-entry.ts` (`saveClubLine` opts `source?: 'club_form'` ; `ClubLine.ffkConfirmed`), `src/server/routes/club-lines.ts` (corps `source` facultatif sur POST et PUT), `src/server/app.ts`
- Test: `tests/server/club-form-read-routes.test.ts`, `tests/server/club-lines-organiser.test.ts`

**Interfaces:**
- Consumes: `readClubFormLines` (Task 1).
- Produces:
  - `POST /api/competitions/:id/club-forms/read` (corps brut, même lecture d'onglets que `parseUpload`) → `ClubFormRead` ; 400 `NotAClubFormError` (dont `LEGACY_FORM_REFUSED`).
  - `POST /api/competitions/:id/clubs/:clubId/club-form-header` corps `{ values: HeaderValues; expected: HeaderValues }` avec `HeaderValues = { coachName: string | null; coachPhone: string | null; coachEmails: string[]; preApproval: boolean }` → `Club` ; 409 « Ce club vient de changer : rouvrez l’étape. » si les valeurs actuelles du club ≠ `expected`.
  - `export function writeClubFormHeader(db: AppDb, competitionId: string, clubId: string, input: { values: HeaderValues; expected: HeaderValues }): Club` — écrit le club ; si le club a une fiche d'annuaire : `updateDirectoryEntry` (coach, téléphone, e-mails), puis `reconcileChange` du club et des autres clubs liés à cette fiche ; `assertWritable` (compétition gérée ailleurs / passée refusée) ; `competitionChanged`.
  - `ClubLine.ffkConfirmed: boolean` (vrai si l'une de ses inscriptions est `ffkConfirmed`).
  - Routes de lignes : `source?: 'club_form'` → origine des inscriptions **créées** (`upsertFighterRegistration` garde celle d'une inscription existante).

- [ ] **Step 1: Write the failing tests**
  - `lecture` : modèle `GET …/club-form.ods` rempli avec `fillClubForm(tpl, header, lines, 'new')` → 200, `items` et `header` ; rien n'est écrit (`GET …/registrations` vide, `GET …/clubs` vide).
  - `ancien modèle refusé` : `fillClubForm(..., 'legacy')` → 400, `error` = `LEGACY_FORM_REFUSED`.
  - `coordonnées : club et annuaire` : club issu de l'annuaire (`POST …/clubs/from-directory`), en-tête écrit → club et `GET /api/club-directory` portent les nouvelles valeurs ; `GET /api/club-changes` sans changement pour ce club.
  - `coordonnées périmées` : `expected` ≠ club → 409, club et annuaire inchangés.
  - `rôle Table refusé` (dans `tests/server/permissions.test.ts`) : `POST …/club-forms/read` et `…/club-form-header` → `deny` pour `table`.
  - `origine fiche club` (`club-lines-organiser.test.ts`) : `POST …/lines` avec `source: 'club_form'` → inscriptions `source: 'club_form'` ; `PUT` ajoutant le kata à une ligne `onsite` → kata `club_form`, combat reste `onsite`.
  - `ffkConfirmed` : ligne d'un combattant confirmé par l'import FFK → `ffkConfirmed: true`.

- [ ] **Step 2: Run** `npx vitest run tests/server/club-form-read-routes.test.ts tests/server/club-lines-organiser.test.ts tests/server/permissions.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** ; `bodyLimit` de la lecture : celui de `club-forms/preview` ; resynchroniser les catégories après les écritures comme les autres routes de lignes.

- [ ] **Step 4: Run** the same command, then `npx vitest run tests/server` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(server): lire une fiche renvoyée, écrire ses coordonnées validées`

### Task 4: Fenêtre du combattant : comparaison sur tous les champs de la fiche

**Files:**
- Modify: `src/web/components/club-line/ffkStep.ts`, `src/web/components/club-line/FfkChoice.tsx`, `src/web/components/ClubLineForm.tsx`, `src/domain/ffk-pdf-plan.ts` (`FfkDiff` = `ImportDiff` restreint, sans changement de valeurs)
- Test: `tests/web/ffk-step.test.ts`

**Interfaces:**
- Consumes: `ImportField`, `ImportDiff`, `fieldValue`, `fieldPatch` (Task 2).
- Produces (dans `FfkFormStep`) :
  - `diffs: (ImportDiff & { savedLabel?: string })[]` — `savedLabel` remplace « Enregistré » pour ce champ (« Enregistré · confirmé FFK »).
  - `labels?: { imported: string; saved: string }` — défaut `{ imported: 'FFK', saved: 'Votre fiche' }` (PDF FFK inchangé).
  - `notes?: { title: string; lines: string[] }` — encadré jaune `data-testid="import-notes"` en tête.
  - `export function importValueText(field: ImportField, value: string | null, ctx: { ageBands; weightClasses }): string` dans `ffkStep.ts` (« -54 kg », « 52,5 kg », « Karaté et Kata », « 1 Boxing · 2 Mix », « Changer de discipline » / « Passer en jiyu », « — » pour `null`).
  - `ffkChoiceState(value, diff)` appelé avec `fieldValue(form, diff.field)`.

- [ ] **Step 1: Write the failing tests** : `importValueText` pour chaque champ ; `ffkChoiceState(fieldValue(form,'disciplines'), diff)` → `'ffk'` / `'fiche'` / `null`.
- [ ] **Step 2: Run** `npx vitest run tests/web/ffk-step.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Cases placées : poids actuel sous son champ (et `setWeight(kgText)` au clic), disciplines sous le bloc Disciplines, grade sous le grade, reclassement et priorité shobu dans l'encadré Reclassement. Désactivées : âge → `locked` ; disciplines → `frozen` ; grade → `frozen` ; les autres → `combatFrozen`. Clic → `set(fieldPatch(field, value))`.
- [ ] **Step 4: Run** `npx vitest run tests/web` and `npm run typecheck` — Expected: PASS (attentes FFK inchangées).
- [ ] **Step 5: Commit** `feat(web): fenêtre du combattant, choix sur tous les champs d’une fiche importée`

### Task 5: Étapes du parcours de la fiche (logique pure)

**Files:**
- Modify: `src/web/components/ffk-import/wizard.ts` (générique)
- Create: `src/web/components/club-form-import/steps.ts`
- Test: `tests/web/club-form-wizard.test.ts`

**Interfaces:**
- Consumes: Tasks 2 et 4.
- Produces:
  - `wizard.ts` : `WizardStep<I> = { kind: 'new'; ffk: I } | { kind: 'existing'; ffk: I; fighterId: string } | { kind: 'homonym'; ffk: I; candidates: string[] }`, `WizardPlan<I> = { steps: WizardStep<I>[]; upToDate: number; absents: string[] }`, `WizardState<I = FfkFighter>`, `wizardReducer<I>`, `wizardSummary<I>` (les étapes « existing » créées par le réducteur n'ont que `fighterId`).
  - `steps.ts` :
    ```ts
    export interface ClubFormStepContext { lines: ClubLine[]; ageBands: ClubEntryView['ageBands']; weightClasses: ClubEntryView['weightClasses'] }
    export function clubFormStepView(s: WizardState<ClubFormItem> & { stage: 'step' }, c: ClubFormStepContext): StepView; // StepView de wizard.ts, `ffk` avec labels « Fiche renvoyée » / « Enregistré »
    export function clubFormAbsentRows(plan: WizardPlan<ClubFormItem>, lines: ClubLine[]): { line: ClubLine; checkable: boolean }[]; // checkable = line.editable
    export function clubFormSummaryText(sum: ReturnType<typeof wizardSummary>, deleted: number): string; // « Fiche renvoyée : 2 ajoutés · 1 mis à jour · 0 laissé tel quel · 1 fiche supprimée. »
    ```
  - Vue existante : `initial = fitWeightClass(lockedKept(fresh, prefillExistingFromFile(...)))`, `banner` « Fiche déjà créée. Une seule fiche par combattant : celle de <Prénom> est inscrite en <disciplines>. Sous chaque différence, choisissez la valeur à garder. », `savedLabel: 'Enregistré · confirmé FFK'` sur `ageBandCode` et `weightClassId` quand `fresh.ffkConfirmed`, `notes: { title: 'Dans la fiche (ligne 14, 16)', lines }` si l'item a des notes, `marks: []`, `skipLabel` comme le PDF FFK. Vue nouvelle : `prefillFromFile`, titre `null` (« Nouveau combattant »), `skipLabel: 'Ne pas l’ajouter'`. Déjà enregistrée à cette étape / homonyme / fiche créée ou supprimée entre-temps : mêmes règles que `stepView` du PDF FFK.

- [ ] **Step 1: Write the failing tests** : vue nouvelle (Jiyu mineur, notes) ; vue existante (différences, banner, `savedLabel` FFK) ; recalcul après relecture (409 : fiche relue sans différence → `diffs: []`) ; homonyme résolu ; absents (verrouillée non cochable) ; `clubFormSummaryText`.
- [ ] **Step 2: Run** `npx vitest run tests/web/club-form-wizard.test.ts tests/web/ffk-wizard.test.ts` — Expected: FAIL (nouveau fichier), FFK PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): étapes du parcours d’une fiche renvoyée`

### Task 6: Le parcours dans l'onglet Fiche club

**Files:**
- Create: `src/web/components/club-form-import/ClubFormImportWizard.tsx`
- Modify: `src/web/api.ts`, `src/web/pages/ClubFormPage.tsx`, `src/web/help.ts`
- Test: `tests/web/help.test.ts` (si l'aide est vérifiée), e2e en Task 7

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `api.ts` : `useReadClubForm(competitionId)` (`upload<ClubFormRead>` vers `…/club-forms/read`) ; `useWriteClubFormHeader(competitionId, clubId)` (invalide `clubs`, `club-changes`, `directory`) ; `LineOps.save` accepte `source?: 'club_form'` (transmis par `useOrganiserLineOps`).
  - Section 2 : bouton `data-testid="club-form-import-open"` « Importer la fiche d’un club » ; l'ancien aperçu (et `usePreviewClubForm` / `useImportClubForm` s'ils ne servent plus) est retiré de la page.

- [ ] **Step 1: Implement the wizard** — structure calquée sur `FfkImportWizard` / `FfkPdfImport` :
  - départ `data-testid="club-form-start"` : `ClubPicker` (préremplissage d'après l'en-tête lu), fichier `data-testid="club-form-file"` (`.ods,.xlsx,.xls,.csv`), « La fiche indique le club « X ». », compteurs `data-testid="club-form-counts"`, lignes réunies `data-testid="club-form-merged"`, « Commencer » `data-testid="club-form-begin"` (`resolveClub` pour une fiche d'annuaire, puis plan sur les fiches du moment) ;
  - étape coordonnées `data-testid="club-header-step"` si `hasHeaderDiff(clubHeaderDiff(header, club))` : progression comptée (N+1), champs coach / téléphone avec `FfkChoice` (libellés « Fiche renvoyée » / « Enregistré »), cases « Ajouter <adresse> » cochées, pré-accord Oui / Non avec cases ; « Enregistrer · suivant → » appelle `useWriteClubFormHeader` avec `expected` = valeurs du club affichées ; 409 → notification orange, club relu, étape réaffichée ; « Laisser tel quel » passe ; « ← Précédent » depuis la 1re fiche y revient ;
  - fiches : `ClubLineForm` mode `organiser` avec `ops` enveloppées pour passer `source: 'club_form'`, même enchaînement que `FfkImportWizard` (homonymes, 409, `sameSaved`) ;
  - fin `data-testid="club-form-end"` : résumé, absents `data-testid="club-form-absent"` décochés, « Terminer » supprime les cochés (`ops.remove` avec version), notification `clubFormSummaryText`.
- [ ] **Step 2: Rewrite help** `fiche-club.importer` (`short` + `details`) d'après la spec §6 : club choisi, fichier, étape coordonnées (club et annuaire, rien sans validation), une fiche à la fois, fiche renvoyée par défaut et conflits, enregistrement au fur et à mesure / reprise, absents décochés, ancien modèle refusé.
- [ ] **Step 3: Run** `npm run typecheck && npx vitest run tests/web` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(web): importer une fiche renvoyée, fiche par fiche`

### Task 7: Tests de bout en bout, vérification réelle, documentation

**Files:**
- Modify: `tests/e2e/inscriptions.spec.ts` (test « fiche club : modèle, aperçu… »), `tests/e2e/import-ods-club.spec.ts`, `tests/e2e/import-ffk.spec.ts` (helper `importClubForm` par l'API `POST …/club-forms/import`)
- Modify: `docs/superpowers/specs/2026-11-14-import-fiche-renvoyee-design.md` (statut : réalisé)

- [ ] **Step 1: Write the e2e tests** (fiches au format `'new'`, noms inventés) :
  - `fiche renvoyée sur un club vide` : club choisi, 2 nouveaux enregistrés (un mineur sans règlement → Jiyu), fin, 2 inscriptions dans Inscriptions avec l'origine Fiche club.
  - `réimport : conflit, coordonnées, absents` : club avec 3 fiches ; fiche renvoyée avec un autre poids et sans le kata d'un combattant, un nouveau téléphone, une adresse nouvelle ; étape coordonnées validée (club et annuaire à jour par l'API) ; conflit disciplines : clic « Enregistré » garde le kata ; à la fin un absent coché (fiche supprimée), un non coché (gardé).
  - `ligne à compléter` : âge illisible → encadré « Dans la fiche (ligne 14) », champ vide, enregistrement après choix.
  - `club de l'annuaire, abandon` : choisi puis fenêtre fermée avant « Commencer » → pas de club dans la compétition.
  - `ancien modèle refusé` : message `LEGACY_FORM_REFUSED`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/inscriptions.spec.ts tests/e2e/import-ods-club.spec.ts tests/e2e/import-ffk.spec.ts tests/e2e/import-pdf-ffk.spec.ts` — Expected: PASS ; puis `npm test` et `npm run typecheck` — Expected: PASS.
- [ ] **Step 3: Check on Chrome** (Claude in Chrome) sur le serveur à part (copie d'une sauvegarde de `data/sauvegardes/` dans `tmp/`, port 3100) avec `~/Downloads/fiche-club-TANI DOJO.ods` : chaque écran de la spec (départ, coordonnées, nouveau, existant avec conflit, ligne à compléter, fin), sur ordinateur ; noter ce qui n'a pas été vu.
- [ ] **Step 4: Commit** `test(e2e): fiche renvoyée fiche par fiche` puis `docs: fiche renvoyée réalisée`
