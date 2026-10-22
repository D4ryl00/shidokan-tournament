# Étape 8 bis : Fiche club papier, fiche .ods aux couleurs Shidokan, saisie des fiches papier — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une fiche papier à cocher (A4 paysage, logo), une fiche .ods au même contenu et à la même allure, un écran de saisie des fiches papier, le grade du combattant et le choix des tranches d'âge proposées aux clubs.

**Architecture:** une ligne de fiche (papier, .ods ou saisie) est décrite par un même type de domaine `ClubFormLine`, converti en une ou deux inscriptions par une seule fonction (`lineToRows`) ; le parseur .ods (nouveau format, ancien format toujours lu) et l'écran de saisie la réutilisent, puis l'import existant (`importClubForm`, `clubFormRemovals`) fait le reste. La fiche papier est une page d'impression React comme les autres ; le .ods gagne styles, image et mise en page dans `writeOds`.

**Tech Stack:** TypeScript, React 19 + Mantine 8, Fastify, Drizzle (SQLite), JSZip, SheetJS (lecture), Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-10-22-fiche-club-papier-design.md`.

## Global Constraints
- Fiche papier : **A4 paysage, marges 1 cm, 10 lignes de combattants, une seule page**, logo `assets/brand/shidokan-france-logo.webp` aux deux coins, titre encadré « FICHE DE PRÉ-INSCRIPTION », imprimable en noir et blanc.
- Colonnes, dans cet ordre : Nom · Prénom · Sexe (F/M) · Catégorie d'âge (une case par tranche proposée) · Poids actuel (kg) · Disciplines (Karaté, Boxing, Mix, Triathlon, Kata — kata et/ou une discipline de combat) · Grade (si kata) · Règlement (Jiyu/Shobu) · Si reclassement : autres disciplines, numéroter 1, 2 (Karaté, Box., Mix) · « Shobu : si reclassement, garder en priorité » (1. les règles shobu / 2. la discipline).
- En-tête : Club, Coach, Téléphone, E-mail, « Le coach accepte d'avance les reclassements de ses combattants : ☐ Oui ☐ Non ».
- Bas de page : légende des abréviations d'âge avec les âges ; « les règles shobu » = changer de discipline plutôt que passer en jiyu ; « la discipline » = passer en jiyu plutôt que changer de discipline ; « Boxing = shido-boxing, Mix = shido-mix martial » ; « Page … / … ».
- Abréviations : poussin P, pupille Pu, benjamin B, minime Mi, cadet C, junior J, senior S, v1…v5 V1…V5, mini-poussin MP, espoir E ; autre code : les deux premières lettres du libellé.
- Priorité shobu : « la discipline » ⇔ `acceptsJiyuFirst = true` ; « les règles shobu » ⇔ `false`.
- Catégorie de poids déduite du poids actuel : `weightClassForWeight(grid, band, sex, kg, settings.weighInToleranceKg[sex])`. Combat sans poids actuel → ligne en erreur « Poids actuel manquant (nécessaire pour la catégorie de poids). »
- Grade : texte libre facultatif (≤ 30 caractères) du **combattant**, sans effet sur les catégories.
- Les fiches .ods déjà renvoyées au format actuel restent importables.
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`. Aides à l'écran (`src/web/help.ts`) mises à jour pour tout écran ou libellé nouveau.

## Review Focus
- **Ancien format** : une fiche .ods remplie avec le modèle actuel (colonnes « Catégorie de poids », « Autres disciplines (1 karaté…) ») doit toujours s'importer comme avant → test Task 2.
- **Kata seul** sur une ligne (sans discipline de combat ni poids) : une seule inscription kata, aucune erreur de poids → test Task 2.
- **Préférence vers sa propre discipline** (« 1 » dans Karaté pour un combattant de karaté) : ignorée avec remarque, pas d'erreur → test Task 2.
- **Fiche papier qui déborde** : avec 12 tranches proposées et des noms de compétition longs, elle doit rester sur une page → test Task 4 (PDF d'une page).
- **Saisie papier abandonnée** : quitter l'écran de saisie sans enregistrer ne crée rien ; enregistrer deux fois la même fiche ne duplique rien → test Task 5.

---

### Task 1 : Grade du combattant et tranches proposées aux clubs

**Files:**
- Modify: `src/domain/types.ts` (`AgeBand.onClubForm: boolean`), `src/domain/api-schemas.ts` (grille : `onClubForm: z.boolean().default(true)`), `src/domain/grid-ffk.ts` (toutes les tranches `onClubForm: true`), `src/domain/registration.ts` (`Fighter.grade: string | null`, `RegistrationInput.grade?: string | null`), `src/server/db/schema.ts` (`age_bands.on_club_form` booléen non nul défaut 1, `fighters.grade` texte), migration `drizzle/0007_*.sql` (`npm run db:generate`), `src/server/repositories/competitions.ts` (lecture/écriture de `onClubForm`), `src/server/repositories/registrations.ts` (grade écrit sur le combattant ; absent = conservé, comme la licence), `src/server/routes/registrations.ts` (`grade: z.string().trim().max(30).nullable().optional()`), `src/web/pages/GridEditorPage.tsx` (colonne case à cocher « Fiche club » dans le tableau des tranches, `aria-label="Proposée sur la fiche club"`), `src/web/components/RegistrationForm.tsx` (champ « Grade (si kata) » visible pour le kata ; case shobu relibellée « Si reclassement, garder en priorité la discipline (passer en jiyu) »), `src/web/help.ts` (`grille.tranches` : la case « Fiche club »)
- Test: `tests/server/api.test.ts`, `tests/server/registrations-api.test.ts`, `tests/e2e/socle.spec.ts`

**Interfaces:**
- Produces: `AgeBand.onClubForm: boolean` ; `Fighter.grade: string | null` ; `RegistrationInput.grade?: string | null` ; `RegistrationRow.fighter.grade`.

- [ ] **Step 1 : tests**
  - `api.test.ts` › `grille : une tranche peut ne pas être proposée sur la fiche club` : `PUT /grid` avec `mini-poussin` et `espoir` à `onClubForm: false` → `GET /grid` les renvoie à `false`, les autres à `true` ; une grille envoyée sans `onClubForm` (ancien client, modèle enregistré) → toutes à `true`.
  - `registrations-api.test.ts` › `grade : enregistré sur le combattant, conservé si absent` : `POST` kata avec `grade: '2e kyu'` → `row.fighter.grade === '2e kyu'` ; `PUT` sans `grade` → toujours `'2e kyu'` ; `PUT` avec `grade: null` → `null`.
  - `socle.spec.ts` › `grille : décocher « Fiche club » pour une tranche` : décocher la case de « Mini-poussins », enregistrer, recharger → décochée.
- [ ] **Step 2 :** `npx vitest run tests/server/api.test.ts tests/server/registrations-api.test.ts` et `npx playwright test tests/e2e/socle.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter ; `npm run db:generate` pour la migration.
- [ ] **Step 4 :** mêmes commandes + `npm run typecheck` → PASS.
- [ ] **Step 5 : Commit** — `feat: grade du combattant, tranches d'âge proposées sur la fiche club`

---

### Task 2 : Ligne de fiche commune, nouveau format .ods, ancien format toujours lu

**Files:**
- Modify: `src/domain/club-form.ts`, `src/server/routes/registrations.ts` (passer la tolérance de pesée des réglages au parseur)
- Test: `tests/domain/club-form.test.ts`

**Interfaces:**
- Consumes: `AgeBand.onClubForm`, `RegistrationInput.grade` (Task 1) ; `weightClassForWeight` (`src/domain/weights.ts`).
- Produces (dans `src/domain/club-form.ts`) :
  ```ts
  export type CombatDiscipline = 'karate' | 'shido-boxing' | 'shido-mix' | 'triathlon';
  export type PrefDiscipline = 'karate' | 'shido-boxing' | 'shido-mix';
  /** Une ligne de fiche telle que remplie (papier, .ods ou saisie) : un combattant. */
  export interface ClubFormLine {
    lastName: string; firstName: string;
    sex: Sex | null; ageBandCode: string | null; weightKg: number | null;
    combat: CombatDiscipline | null; kata: boolean; grade: string | null;
    ruleset: Ruleset | null;
    prefs: Partial<Record<PrefDiscipline, 1 | 2>>;
    shobuKeep: 'ruleset' | 'discipline' | null;
  }
  export type WeighInTolerance = { M: number; F: number };
  /** Une ligne → une ou deux ClubFormRow (combat puis kata), même numéro de ligne. */
  export function lineToRows(line: ClubFormLine, lineNumber: number, grid: CategoryGrid, tolerance: WeighInTolerance): ClubFormRow[];
  export function parseClubForm(cells: unknown[][], grid: CategoryGrid, tolerance?: WeighInTolerance): ClubFormParse; // tolérance par défaut { M: 0, F: 0 }
  export const CLUB_FORM_COLUMNS: readonly string[];        // nouveau format (en-têtes du .ods, ordre de la fiche papier)
  export const CLUB_FORM_LEGACY_COLUMNS: readonly string[]; // format actuel, renommé
  export function ageBandAbbreviation(code: string, label: string): string; // table des Global Constraints
  ```
  Nouvelles colonnes du .ods (`CLUB_FORM_COLUMNS`) : `Nom`, `Prénom`, `Sexe`, `Catégorie d'âge`, `Poids actuel (kg)`, `Discipline de combat`, `Kata (Oui/Non)`, `Grade (si kata)`, `Règlement`, `Reclassement : Karaté (1, 2)`, `Reclassement : Shido-boxing (1, 2)`, `Reclassement : Shido-mix (1, 2)`, `Shobu : si reclassement, garder en priorité`.
  `parseClubForm` choisit le format d'après la ligne d'en-tête trouvée (`locate`) ; ancien format : comportement actuel inchangé ; doublons et « deux disciplines de combat » vérifiés comme aujourd'hui sur les ClubFormRow produites.

- [ ] **Step 1 : tests** (`tests/domain/club-form.test.ts`, cellules construites en mémoire avec le titre, les champs d'en-tête et `CLUB_FORM_COLUMNS`)
  - `nouveau format : kata et karaté sur une ligne → deux inscriptions` : `['MARTIN','Léa','Féminin','Cadets','53,5','Karaté','Oui','1er kyu','Jiyu','','2','1','La discipline']` → deux rows de même `line` ; karaté : `weightClassId 'cadet:F:-54'`, `otherDisciplines ['shido-mix','shido-boxing']`, `acceptsJiyuFirst null` (jiyu) ; kata : `ruleset null`, `weightClassId null`, `grade '1er kyu'`.
  - `poids actuel → catégorie avec la tolérance` : cadet F `54,4` avec tolérance `{F:0.5}` → `-54` ; `54,6` → `-61`.
  - `combat sans poids actuel → erreur` : message « Poids actuel manquant (nécessaire pour la catégorie de poids). »
  - `kata seul : pas de poids demandé` : discipline de combat vide, Kata Oui, poids vide → une row kata, aucune erreur.
  - `priorité shobu` : Shobu + « Les règles shobu » → `acceptsJiyuFirst false` ; « La discipline » → `true` ; priorité remplie en jiyu → remarque, ignorée.
  - `préférence vers sa propre discipline ignorée avec remarque` : karaté avec Reclassement Karaté `1` → `otherDisciplines []`, une remarque.
  - `ancien format toujours lu` : cellules au format `CLUB_FORM_LEGACY_COLUMNS` (`['MARTIN','Léa','Féminin','Cadets','-54','Karaté','Jiyu','2',null,null]`) → même résultat qu'aujourd'hui (`weightClassId 'cadet:F:-54'`, `otherDisciplines ['shido-boxing']`).
  - `abréviations` : `ageBandAbbreviation('pupille','Pupilles') === 'Pu'`, `('v3','Vétérans 3') === 'V3'`, `('ado','Adolescents') === 'Ad'`.
- [ ] **Step 2 :** `npx vitest run tests/domain/club-form.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter (l'ancien `parseRow` reste pour l'ancien format ; le nouveau lit chaque cellule vers un `ClubFormLine` puis appelle `lineToRows`).
- [ ] **Step 4 :** `npx vitest run tests/domain/club-form.test.ts tests/server` → PASS (les tests serveur de fiche club existants utilisent l'ancien format via `fillClubForm` : les adapter à `CLUB_FORM_LEGACY_COLUMNS` s'ils construisent les colonnes eux-mêmes).
- [ ] **Step 5 : Commit** — `feat(domain): ligne de fiche commune, nouveau format (kata + combat, poids actuel, grade), ancien format lu`

---

### Task 3 : Modèle .ods aux couleurs Shidokan et au nouveau contenu

**Files:**
- Modify: `src/server/spreadsheet/ods.ts`, `src/server/club-form-template.ts`, `tests/helpers/club-form-fill.ts`
- Test: `tests/server/ods.test.ts`, `tests/server/registrations-api.test.ts`

**Interfaces:**
- Consumes: `CLUB_FORM_COLUMNS`, `ageBandAbbreviation`, `AgeBand.onClubForm` (Tasks 1-2).
- Produces (`ods.ts`) :
  ```ts
  export interface OdsCell { value: string | number | null; bold?: boolean; text?: boolean; validation?: string;
    style?: 'title' | 'subtitle' | 'label' | 'header' | 'input' | 'note'; colSpan?: number }
  export interface OdsSheet { name: string; rows: OdsCell[][]; columnWidthsCm?: number[]; validations?: Record<string, string[]>;
    rowHeightsCm?: Record<number, number>; image?: { data: Buffer; mime: 'image/png'; widthCm: number; heightCm: number; anchors: ('left' | 'right')[] };
    print?: { landscape: true; fitToWidth: true; repeatRows?: [number, number] } }
  ```
  Styles : `title` (gras 18 pt, bordure épaisse), `header` (gras, fond gris clair, bordure), `input` (bordure fine, format texte), `note` (italique 9 pt). Page : A4 paysage, marges 1 cm, ajustée à une page en largeur, en-tête du tableau répété.
  Logo : `assets/brand/shidokan-france-logo.webp` converti une fois en PNG (🔧 fichier `assets/brand/shidokan-france-logo.png` ajouté au dépôt, 512 px) et inclus comme image (`Pictures/logo.png`, déclaré dans le manifeste).

- [ ] **Step 1 : tests** (`ods.test.ts`)
  - `modèle : en-têtes du nouveau format, tranches proposées seulement` : feuille « Fiche club », ligne d'en-tête = `CLUB_FORM_COLUMNS` ; la liste de validation des âges ne contient ni « Mini-poussins » ni « Espoirs » quand ils sont `onClubForm: false`.
  - `modèle : logo, styles et mise en page A4 paysage` : l'archive contient `Pictures/logo.png` (déclaré dans `META-INF/manifest.xml`) ; `content.xml` contient un `draw:frame` référençant `Pictures/logo.png` ; `styles.xml` contient `style:print-orientation="landscape"`, `fo:page-width="29.7cm"`, `style:scale-to-X="1"` ; `content.xml` contient `table:print-ranges` ou des lignes d'en-tête répétées (`table:table-header-rows`).
  - `modèle rempli puis relu` : `fillClubForm` (adapté au nouveau format) remplit une ligne kata + karaté → `parseClubForm` donne deux inscriptions.
  - `registrations-api.test.ts` existant `modèle, aperçu, import, liste` : passe avec le nouveau modèle.
- [ ] **Step 2 :** `npx vitest run tests/server/ods.test.ts tests/server/registrations-api.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter les styles, l'image, la mise en page dans `writeOds`, puis le nouveau contenu du modèle (même en-tête de club, onglet « Aide » gardé : codes, règlements, abréviations d'âge, explication de la priorité shobu ; plus de tableau des catégories de poids).
- [ ] **Step 4 :** mêmes commandes → PASS. Si LibreOffice est disponible (`soffice`), `soffice --headless --convert-to pdf` du modèle : une page en largeur ; sinon noter au bilan que l'organisateur vérifie l'ouverture dans LibreOffice et Excel.
- [ ] **Step 5 : Commit** — `feat(server): modèle de fiche club .ods au logo Shidokan, nouveau contenu, mise en page A4`

---

### Task 4 : Fiche papier à imprimer

**Files:**
- Create: `src/web/pages/PaperClubFormPage.tsx`
- Modify: `src/web/App.tsx` (route `/competitions/:id/impression/fiche-club`), `src/web/pages/ClubFormPage.tsx` (bouton « Fiche papier (PDF) », `data-testid="paper-form-open"`, ouvre la page dans un nouvel onglet), `src/web/print.css` (page A4 paysage, marges 1 cm), `src/web/help.ts` (`fiche-club.envoyer` : la fiche papier ; `impression`)
- Test: `tests/e2e/inscriptions.spec.ts`

**Interfaces:**
- Consumes: `useCompetition`, `useGrid` ; `ageBandAbbreviation`, `AgeBand.onClubForm`.
- Produces: page `PaperClubFormPage` (`data-testid="paper-form"`, 10 lignes `data-testid="paper-form-row"`), rendu de la maquette validée (`.superpowers/brainstorm/35458-1792661973/content/fiche-a-v7.html`, recopiée dans les Global Constraints) ; barre « Imprimer » + `HelpText topic="impression"` en `no-print`.

- [ ] **Step 1 : tests** (`inscriptions.spec.ts`)
  - `fiche papier : une page A4 paysage, 10 lignes, tranches proposées` : décocher Mini-poussins et Espoirs dans la grille ; ouvrir `/impression/fiche-club` → 10 `paper-form-row`, cases d'âge P…V5 sans MP ni E, logo visible deux fois, titre « FICHE DE PRÉ-INSCRIPTION » ; `page.pdf({ format: 'A4', landscape: true, printBackground: true })` → exactement une page (compter `/Type /Page` hors `/Pages`, comme le test d'impression des tableaux).
  - `fiche papier : nom de compétition long` : renommer la compétition avec 80 caractères → toujours une page.
- [ ] **Step 2 :** `npx playwright test tests/e2e/inscriptions.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter la page (tailles en unités d'impression `mm`/`pt` ; hauteur des lignes calculée pour que 10 lignes remplissent la page).
- [ ] **Step 4 :** même commande → PASS ; capture de la page en clair et sombre (la feuille reste noir sur blanc).
- [ ] **Step 5 : Commit** — `feat(web): fiche club papier à cocher (A4 paysage, logo Shidokan)`

---

### Task 5 : Saisie d'une fiche papier

**Files:**
- Modify: `src/server/routes/registrations.ts` (routes `POST /api/competitions/:id/club-forms/entry/preview` et `…/entry/import`, corps `{ header: ClubFormHeader, lines: ClubFormLine[] }` validé par zod → `ClubFormParse` via `lineToRows` (numéro de ligne = rang + 1) → mêmes réponses que `club-forms/preview` et `club-forms/import`), `src/web/api.ts` (`usePreviewPaperEntry`, `useImportPaperEntry`), `src/web/pages/ClubFormPage.tsx` (section « 3. Saisir une fiche papier »), `src/web/help.ts` (sujet `fiche-club.saisir`)
- Create: `src/web/components/PaperEntryTable.tsx`
- Test: `tests/server/registrations-api.test.ts`, `tests/e2e/inscriptions.spec.ts`

**Interfaces:**
- Consumes: `ClubFormLine`, `lineToRows`, `ClubFormHeader` (Task 2) ; `importClubForm`, `clubFormRemovals` (`src/server/repositories/registrations.ts`).
- Produces: `PaperEntryTable` : en-tête du club (club, coach, téléphone, e-mail, pré-accord) puis lignes dans l'ordre de la fiche (cases à cocher Mantine, `data-testid="paper-entry-row"`), « Ajouter une ligne », « Vérifier » (aperçu : erreurs et remarques par ligne, retraits annoncés), « Enregistrer la fiche ». Rien n'est écrit avant « Enregistrer la fiche ».

- [ ] **Step 1 : tests**
  - `registrations-api.test.ts` › `saisie papier : kata + karaté sur une ligne, catégorie déduite du poids` : `entry/import` avec une ligne → deux inscriptions, `weightClassId` déduit, `fighter.grade` renseigné ; même saisie envoyée deux fois → toujours deux inscriptions (remplacement de la fiche du club, comme un réimport).
  - `registrations-api.test.ts` › `saisie papier : ligne invalide → erreur dans l'aperçu, rien d'écrit` : `entry/preview` sans sexe → row en erreur ; `GET /registrations` vide.
  - `inscriptions.spec.ts` › `saisie d'une fiche papier` : remplir le club, une ligne (nom, prénom, F, case C, poids 53,5, Karaté + Kata, grade, Jiyu, Mix = 1) → « Vérifier » montre 2 inscriptions → « Enregistrer la fiche » → l'onglet Inscriptions liste les deux ; quitter sans enregistrer une deuxième saisie → rien de plus.
- [ ] **Step 2 :** `npx vitest run tests/server/registrations-api.test.ts` et `npx playwright test tests/e2e/inscriptions.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter routes, hooks et écran.
- [ ] **Step 4 :** mêmes commandes → PASS.
- [ ] **Step 5 : Commit** — `feat: saisie d'une fiche club papier ligne par ligne`

---

### Task 6 : Grade affiché aux arbitres, bilan

**Files:**
- Modify: `src/web/pages/BracketsPage.tsx` (`useEntrantInfo` : `EntrantInfo.grade?: string | null`), `src/web/components/BracketView.tsx` (kata : grade sous le nom, imprimé), `src/web/components/KataScoring.tsx` (grade sous le nom), `src/web/help.ts` (`combats.kata` : le grade), `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (8 bis ✅)
- Test: `tests/e2e/jour-j.spec.ts`

- [ ] **Step 1 : test** — `jour-j.spec.ts` : un kataka inscrit avec `grade: '1er dan'` → son grade apparaît sur sa ligne de notation et dans `/impression` (tableau de kata).
- [ ] **Step 2 :** `npx playwright test tests/e2e/jour-j.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5 :** bilan (décisions, corrections) et feuille de route ; commit — `feat(web): grade du kataka affiché aux arbitres ; bilan de l'étape 8 bis`
