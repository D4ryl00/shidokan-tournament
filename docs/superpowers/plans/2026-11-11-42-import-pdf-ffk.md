# Étape 42 — Import du PDF FFK, fiche par fiche — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le coach (page `/inscription/:token`) et l'organisateur (onglet Fiche club) importent le PDF « État des inscriptions » de la FFK ; chaque combattant passe ensuite, l'un après l'autre, dans la fenêtre habituelle du combattant, pré-remplie, avec choix FFK / fiche pour les conflits.

**Architecture:** le serveur extrait le texte du PDF (pdfjs-dist) et le traduit dans la grille de la compétition pour la discipline choisie (route de lecture seule). Une logique pure (`src/domain/ffk-pdf*.ts`) découpe le texte, traduit les catégories et compare avec les fiches du club. Le navigateur déroule un parcours (`FfkImportWizard`) qui ouvre `ClubLineForm` étendu, et enregistre chaque fiche par les routes de lignes existantes (versions comprises).

**Tech Stack:** TypeScript 7, Fastify, Drizzle/SQLite, React + Mantine, Vitest, Playwright, `pdf-lib` (déjà là, pour fabriquer les PDF de test), `pdfjs-dist` (nouvelle dépendance, lecture).

**Spec:** `docs/superpowers/specs/2026-11-10-import-pdf-ffk-design.md`

## Global Constraints

- Aucun nom réel dans le dépôt : les PDF de test sont fabriqués avec `pdf-lib` et des noms inventés. Ne jamais copier les PDF de `~/Downloads`.
- Pas de numéro de licence lu pour rapprocher ni enregistré. Pas de lecture du club ni de la discipline dans le PDF.
- Rapprochement : `normalizeName(nom + ' ' + prénom)` **et** sexe égaux (coupure indifférente).
- Enregistrement fiche par fiche, par les routes de lignes existantes (`POST/PUT/DELETE …/lines`), avec la version de la ligne ; aucune nouvelle route d'écriture.
- Textes exacts (copier tels quels) : bouton « Importer le PDF de la FFK » ; « Fiche k sur N » ; « Commencer (N fiches) » ; « Enregistrer · suivant → » ; « ← Précédent » ; « Ne pas l’ajouter » ; « Laisser la fiche telle quelle » ; marque « FFK » ; cases « FFK » / « Votre fiche » ; « Fiche déjà créée. » ; titre « Nouveau combattant » ; « Terminer ».
- Conflit : « FFK » choisie par défaut ; absents : cases décochées par défaut ; seule la discipline de l'import est retirée.
- Discipline de l'import obligatoire, sans valeur par défaut.
- Côté coach, l'import n'existe que si `view.editable`. Routes du coach : `bodyLimit` propre de 5 Mo pour la route PDF (les autres restent à 64 Ko).
- Interface en français, apostrophes typographiques (’) comme le reste de l'interface.
- Node 22.23.2 (`.tool-versions`) ; dépendances épinglées exactement (`--save-exact`).
- e2e du coach sur le serveur de test port 3101 avec `SERVER_SESSION` ; ne pas ajouter de connexions (limite 10 / 15 min) ; le nom d'une compétition e2e ne doit pas contenir ni être contenu dans un autre.

## Review Focus

1. **Texte collé par l'extraction** (« Vétéran2 Masculin-75 KG », « - Page4 ») : le titre se lit quand même (Task 2, test `mots collés`).
2. **Combattant en haut de page sous un en-tête resté en bas de la précédente** : il garde la catégorie de la page d'avant (Task 2, test `à cheval sur deux pages`).
3. **Fiche modifiée ailleurs pendant le parcours (409)** : la fiche est relue et réaffichée avec la comparaison recalculée, le parcours ne saute pas (Task 6, test du réducteur `stale`).
4. **Réimport du même PDF après un arrêt au milieu** : les fiches déjà enregistrées comptent « déjà à jour » (Task 3, test `reprise`).
5. **Une seule discipline de combat autorisée, coach déjà inscrit dans un autre combat** : la discipline n'est pas cochée d'office et la phrase l'explique (Task 3, test `une seule discipline`).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/server/ffk-pdf-text.ts` (nouveau) | PDF → lignes de texte positionnées (pdfjs-dist). |
| `src/domain/ffk-pdf.ts` (nouveau) | Lignes de texte → combattants FFK bruts ; lecture d'un titre de catégorie. |
| `src/domain/ffk-pdf-plan.ts` (nouveau) | Traduction dans la grille, comparaison avec les fiches, pré-remplissage, retrait d'une discipline. |
| `src/domain/names.ts` | + `titleCaseName`. |
| `src/server/routes/ffk-pdf.ts` (nouveau) | Routes de lecture (coach, organisateur) + liste des lignes d'un club (organisateur). |
| `src/server/routes/club-entry.ts` | Hook `bodyLimit` : ne plus écraser une limite explicite. |
| `src/server/repositories/club-entry.ts` | + `clubLines` (export). |
| `src/server/auth/permissions.ts`, `src/server/app.ts` | Enregistrement et droits des nouvelles routes. |
| `src/web/components/club-line/ffkStep.ts` (nouveau) | Logique pure des choix FFK / fiche dans la fenêtre. |
| `src/web/components/ClubLineForm.tsx` | Prop `ffk` : marques, choix, encadré, progression, pied du parcours. |
| `src/web/components/ffk-import/wizard.ts` (nouveau) | Réducteur pur du parcours. |
| `src/web/components/ffk-import/FfkImportWizard.tsx` (nouveau) | Fenêtre de départ, enchaînement des fiches, fin. |
| `src/web/api.ts` | Hooks de lecture du PDF et des lignes d'un club. |
| `src/web/pages/ClubEntryPage.tsx` | Bouton + parcours côté coach. |
| `src/web/pages/ClubFormPage.tsx`, `src/web/help.ts` | Section organisateur + aide. |
| `tests/helpers/ffk-pdf.ts` (nouveau) | Fabrique de PDF FFK factices (pdf-lib). |

---

### Task 1: Extraction du texte d'un PDF

**Files:**
- Create: `src/server/ffk-pdf-text.ts`, `tests/helpers/ffk-pdf.ts`
- Modify: `package.json`, `package-lock.json`
- Test: `tests/server/ffk-pdf-text.test.ts`

**Interfaces:**
- Produces:
  - `export interface PdfTextItem { x: number; text: string }`
  - `export interface PdfTextLine { page: number; y: number; items: PdfTextItem[] }` (items triés par x ; `y` en points depuis le haut de la page)
  - `export class UnreadablePdfError extends Error { readonly statusCode = 400 }` — message « Ce fichier n’est pas un PDF lisible. »
  - `export async function extractPdfLines(data: Uint8Array): Promise<PdfTextLine[]>` — toutes les pages, dans l'ordre de lecture (page, puis y croissant).
  - Test helper : `export async function buildFfkPdf(spec: FakeFfkPdf): Promise<Uint8Array>` avec
    `interface FakeFfkPdf { competition: string; entity: string; categories: { title: string; status?: 'En cours' | 'Inscrits'; fighters: string[] }[]; rowsPerPage?: number; footerGlued?: boolean }`.
    Mise en page imitant l'exemple : page 1 = « ÉTAT DES INSCRIPTIONS », `competition`, « Inscrits : n », résumé `entity` ; pages suivantes : `entity`, puis par catégorie son titre, « Aucune inscription » si vide, sinon l'état, l'en-tête « N° Licencié | Nom Prénom | Ligue régionale | Rattachement » et une ligne par combattant (licence factice `1000000` + index + `A` à x=40, nom à x=120, « LIGUE REGIONALE TEST » sur 3 lignes à x=360, `entity` sans numéro à x=520) ; pied « 10/11/2026 - Page N » (« - Page4 » collé si `footerGlued`). Saut de page après `rowsPerPage` lignes (défaut 40), **sans** répéter l'en-tête de tableau (comme l'exemple).

- [ ] **Step 1: Ajouter la dépendance** — `npm install --save-exact pdfjs-dist@<dernière 5.x publiée>` ; vérifier qu'elle s'importe en Node : `node -e "import('pdfjs-dist/legacy/build/pdf.mjs').then(m=>console.log(typeof m.getDocument))"` → `function`.
- [ ] **Step 2: Écrire les tests qui échouent** (`tests/server/ffk-pdf-text.test.ts`) :
  - `lit les lignes d'un PDF fabriqué` : `buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', categories: [{ title: 'Poussin Masculin -25 KG', status: 'Inscrits', fighters: ['DURAND LEO'] }] })` → une ligne contient un item `'DURAND LEO'` avec `x` ≈ 120 (±2) ; une ligne a pour texte joint `'Poussin Masculin -25 KG'` ; la licence est un item distinct de la même ligne que le nom.
  - `refuse un fichier qui n'est pas un PDF` : `extractPdfLines(new TextEncoder().encode('bonjour'))` rejette avec `UnreadablePdfError`.
- [ ] **Step 3: Lancer** `npx vitest run tests/server/ffk-pdf-text.test.ts` → FAIL (module absent).
- [ ] **Step 4: Implémenter** `extractPdfLines` avec `getDocument({ data, isEvalSupported: false, useSystemFonts: false })` du build `legacy` ; `page.getTextContent()` ; regrouper les items par `y = viewport.height - transform[5]` arrondi (tolérance 2 pt) ; ignorer les items vides ; toute erreur de pdfjs → `UnreadablePdfError`. Écrire `buildFfkPdf` (Helvetica de pdf-lib ; les accents « É », « é » passent en WinAnsi).
- [ ] **Step 5: Lancer** le test → PASS. `npm run typecheck` → 0 erreur.
- [ ] **Step 6: Commit** — `git commit -m "feat(import-pdf-ffk): extraction du texte d'un PDF"`

### Task 2: Lecture des combattants dans le texte

**Files:**
- Create: `src/domain/ffk-pdf.ts`
- Test: `tests/domain/ffk-pdf.test.ts`

**Interfaces:**
- Consumes: `PdfTextLine` (Task 1) — à redéclarer comme type structurel dans le domaine (`{ page: number; y: number; items: { x: number; text: string }[] }`), le domaine n'importe pas le serveur.
- Produces:
  - `export interface FfkCategoryTitle { sex: Sex; ageLabel: string; weightLabel: string | null; rulesetLabel: string | null }`
  - `export function parseFfkCategory(title: string): FfkCategoryTitle | null`
  - `export interface FfkPdfEntry { order: number; fullName: string; category: string; title: FfkCategoryTitle }`
  - `export function parseFfkPdfLines(lines: FfkTextLine[]): { entries: FfkPdfEntry[]; duplicates: string[] }` — `duplicates` : `fullName` des lignes ignorées (même `normalizeName(fullName)` + même sexe déjà lu).

- [ ] **Step 1: Écrire les tests qui échouent** (lignes de texte écrites à la main, pas de PDF) :
  - `parseFfkCategory` :
    - `'Poussin Masculin -25 KG'` → `{ sex: 'M', ageLabel: 'Poussin', weightLabel: '-25', rulesetLabel: null }`
    - `'Séniors shobu ippon kumité Feminine +68 KG'` → `{ sex: 'F', ageLabel: 'Séniors', weightLabel: '+68', rulesetLabel: 'shobu' }`
    - `'Séniors jiyu ippon kumite Masculin -75 KG'` → `rulesetLabel: 'jiyu'`
    - mots collés : `'Vétéran2 Masculin-75 KG'` → `{ ageLabel: 'Vétéran 2', weightLabel: '-75', sex: 'M' }` ; `'Benjamin Feminine-30 KG'` → `{ sex: 'F', weightLabel: '-30' }`
    - kata : `'Pupille Masculin'` → `weightLabel: null` ; `'Seniors Débutants Shindo Feminine'` → `{ ageLabel: 'Seniors Débutants Shindo', sex: 'F', weightLabel: null }`
    - `'Aucune inscription'`, `'N° Licencié Nom Prénom'`, `'10/11/2026 - Page 2'` → `null`
  - `parseFfkPdfLines` :
    - lit `'DURAND LEO'` sous `'Poussin Masculin -25 KG'` (ligne `[{x:40,'1000001A'},{x:120,'DURAND LEO'},{x:360,'LIGUE REGIONALE TEST'},{x:520,'DOJO TEST'}]`, suivie de deux lignes de suite de ligue à x=360 seulement) → une entrée, `category: 'Poussin Masculin -25 KG'`, `order: 0`.
    - nom et ligue fondus dans un seul item (`'DI MARCO SANTOS LUCA LIGUE REGIONALE TEST'`) → `fullName: 'DI MARCO SANTOS LUCA'` (coupe avant `LIGUE`).
    - `à cheval sur deux pages` : titre + en-tête en fin de page 1, combattant au début de page 2 (après le pied « - Page 1 » et sans titre) → catégorie de la page 1.
    - catégories vides (« Aucune inscription »), page 1 de résumé (« 0000001 DOJO TEST Inscrit(s) : 2 … ») et entité en tête de page → aucune entrée.
    - doublon : même nom deux fois dans la même catégorie → 1 entrée, `duplicates: ['DURAND LEO']`.
- [ ] **Step 2: Lancer** `npx vitest run tests/domain/ffk-pdf.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.** `parseFfkCategory` travaille sur le texte brut (pas `normalizeName`, qui efface les `-`) : insérer une espace entre lettre et chiffre ou signe collés, puis
  `/^(.+?)\s+(masculin|f[ée]minine?)\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*kg)?\s*$/i` ; le règlement est le mot `jiyu|shobu` du préfixe, retiré avec `ippon kumit[eé]` ; `ageLabel` = le reste, espaces réduites. Une ligne combattant = premier item conforme à `/^\d{6,}[A-Z]$/` ; nom = texte des items suivants joints, coupé avant `/\bLIGUE\b/i`, espaces réduites, et s'arrêtant avant un item d'x ≥ 500 (rattachement). Lignes ignorées : pied de page `/^\d{2}\/\d{2}\/\d{4}/`, lignes sans licence qui ne sont pas un titre.
- [ ] **Step 4: Lancer** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-pdf-ffk): lecture des combattants et des catégories FFK"`

### Task 3: Traduction dans la grille et comparaison avec les fiches

**Files:**
- Create: `src/domain/ffk-pdf-plan.ts`
- Modify: `src/domain/names.ts`
- Test: `tests/domain/ffk-pdf-plan.test.ts`, `tests/domain/names.test.ts`

**Interfaces:**
- Consumes: `FfkPdfEntry` (Task 2) ; `ageBandFromLabel`, `rulesetFromLabel` (`club-form.ts`) ; `parseWeightLabel` (`weights.ts`) ; `weightClassesFor` (`grid.ts`) ; `splitFullName`, `normalizeName` ; `DISCIPLINES`.
- Produces:
  - `export function titleCaseName(s: string): string` (names.ts) — `'INES'` → `'Ines'`, `'JEAN PIERRE'` → `'Jean Pierre'`, `'JEAN-PIERRE'` → `'Jean-Pierre'`.
  - ```ts
    export interface FfkFighter {
      order: number; fullName: string; lastName: string; firstName: string; sex: Sex;
      ageBandCode: string | null; weightClassId: string | null; ruleset: Ruleset | null;
      rulesetGiven: boolean;            // vrai si le titre FFK portait jiyu/shobu
      raw: { age: string; weight: string | null };  // textes FFK, pour les champs non traduits
    }
    export function translateFfkEntries(entries: FfkPdfEntry[], grid: CategoryGrid, discipline: DisciplineId): FfkFighter[]
    export type FfkField = 'ageBandCode' | 'weightClassId' | 'ruleset';
    export interface FfkDiff { field: FfkField; ffk: string; fiche: string | null }
    export interface PlanLine { fighterId: string; line: ClubFormLine; editable: boolean; partlyEditable: boolean }
    export type FfkStep =
      | { kind: 'new'; ffk: FfkFighter }
      | { kind: 'existing'; ffk: FfkFighter; fighterId: string; diffs: FfkDiff[]; addsDiscipline: boolean; oneCombatBlocked: boolean; locked: boolean }
      | { kind: 'homonym'; ffk: FfkFighter; candidates: string[] };
    export interface FfkImportPlan { steps: FfkStep[]; upToDate: number; absents: string[] /* fighterIds */ }
    export function planFfkImport(fighters: FfkFighter[], lines: PlanLine[], discipline: DisciplineId, opts: { multipleCombats: boolean; mode: 'coach' | 'organiser' }): FfkImportPlan
    export function hasDiscipline(line: ClubFormLine, d: DisciplineId): boolean
    export function prefillNew(ffk: FfkFighter, discipline: DisciplineId): ClubFormLine
    export function prefillExisting(fiche: ClubFormLine, step: Extract<FfkStep, { kind: 'existing' }>, discipline: DisciplineId): ClubFormLine
    export function withoutDiscipline(line: ClubFormLine, d: DisciplineId): ClubFormLine | null   // null : plus aucune discipline
    ```

- [ ] **Step 1: Écrire les tests qui échouent** (grille de `grid-ffk.ts` ; ids de poids au format `'<âge>:<sexe>:<libellé>'`, ex. `'poussin:M:-25'`) :
  - `titleCaseName` : les trois cas ci-dessus.
  - `translateFfkEntries`, discipline `karate` : `'DA SILVA SANTOS INES'` + `'Minime Feminine -45 KG'` → `{ lastName: 'DA SILVA SANTOS', firstName: 'Ines', sex: 'F', ageBandCode: 'minime', weightClassId: 'minime:F:-45', ruleset: 'jiyu', rulesetGiven: false }` ; `'Séniors shobu …'` → `ruleset: 'shobu', rulesetGiven: true` ; `'Vétéran 1'` → `'v1'` ; poids absent de la grille → `weightClassId: null`, `raw.weight: '-99'` ; discipline `kata` → `weightClassId: null` et `ruleset: null` ; `'Seniors Débutants Shindo'` → `ageBandCode: null`, `raw.age: 'Seniors Débutants Shindo'`.
  - `planFfkImport` (discipline `karate`, `multipleCombats: false`, `mode: 'coach'`) :
    - personne inconnue → `{ kind: 'new' }`.
    - fiche égale (même nom en casse différente, même tranche/poids/règlement, inscrite en karaté) → pas d'étape, `upToDate: 1`.
    - `reprise` : la fiche créée par `prefillNew` puis relue comme `PlanLine` → `upToDate` (pas d'étape).
    - poids différent → `existing`, `diffs: [{ field: 'weightClassId', ffk: 'benjamin:F:-40', fiche: 'benjamin:F:-35' }]`.
    - règlement : différent seulement si `rulesetGiven` (un `jiyu` par défaut ne contredit pas une fiche `shobu`).
    - fiche inscrite en kata seulement → `existing`, `addsDiscipline: true`, `oneCombatBlocked: false`.
    - `une seule discipline` : fiche en `shido-mix` → `addsDiscipline: true`, `oneCombatBlocked: true` ; même cas en `mode: 'organiser'` → `oneCombatBlocked: false` ; avec `multipleCombats: true` → `false`.
    - deux fiches de même nom et sexe → `{ kind: 'homonym', candidates: [id1, id2] }`.
    - fiche `editable: false, partlyEditable: false` et différente → `existing`, `locked: true`.
    - fiche inscrite en karaté absente du PDF → `absents: [id]` ; fiche en boxing seulement absente → pas dans `absents`.
    - ordre des étapes = ordre du PDF.
  - `prefillExisting` : garde poids actuel, grade, reclassement, kata ; met les valeurs FFK des `diffs` ; ajoute `karate` aux combats si `addsDiscipline && !oneCombatBlocked`.
  - `withoutDiscipline` : karaté + kata, retrait karaté → kata seul, `prefs` vidées et `ruleset: null` si plus de combat ; karaté seul → `null`.
- [ ] **Step 2: Lancer** `npx vitest run tests/domain/ffk-pdf-plan.test.ts tests/domain/names.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.** Poids : `parseWeightLabel(raw)` puis classe de `weightClassesFor(grid, âge, sexe)` de même libellé, sinon `null` (jamais créée). Règlement absent pour un combat : `'jiyu'` (comme l'import Excel FFK). Après retrait d'une discipline, passer la ligne par `tidyReclass`.
- [ ] **Step 4: Lancer** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-pdf-ffk): comparaison avec les fiches du club"`

### Task 4: Routes de lecture

**Files:**
- Create: `src/server/routes/ffk-pdf.ts`
- Modify: `src/server/routes/club-entry.ts:35-38`, `src/server/repositories/club-entry.ts`, `src/server/app.ts`, `src/server/auth/permissions.ts:31`
- Test: `tests/server/ffk-pdf-routes.test.ts`

**Interfaces:**
- Consumes: `extractPdfLines` (Task 1), `parseFfkPdfLines` (Task 2), `translateFfkEntries` (Task 3), `getGrid`.
- Produces:
  - `export const FFK_PDF_MAX_BYTES = 5 * 1024 * 1024`
  - `export interface FfkPdfRead { fighters: FfkFighter[]; duplicates: string[] }`
  - `POST /api/inscription/:token/ffk-pdf?discipline=<DisciplineId>` (corps `application/octet-stream`) → `FfkPdfRead` ; 400 « Choisissez la discipline de ce PDF. » si absente/inconnue ; 400 « Aucun combattant trouvé dans ce PDF. » si `fighters` vide ; 409 (`ClubEntryClosedError`) si la page n'est pas modifiable.
  - `POST /api/competitions/:id/ffk-pdf?discipline=` → `FfkPdfRead` (mêmes erreurs, sans le contrôle d'ouverture).
  - `GET /api/competitions/:id/clubs/:clubId/lines` → `ClubLine[]` (vue organisateur, ordre `nameKey`).
  - `export function clubLines(db: AppDb, access: ClubAccess, viewer: LineWriter['kind']): ClubLine[]` (repository ; `getClubEntry` l'utilise).

- [ ] **Step 1: Écrire les tests qui échouent** (mise en place comme `tests/server/club-entry.test.ts`, PDF via `buildFfkPdf`) :
  - coach : PDF de 2 combattants, `?discipline=karate` → 200, 2 `fighters` avec `weightClassId` traduit ; sans `discipline` → 400 ; corps `'bonjour'` → 400 « Ce fichier n’est pas un PDF lisible. » ; PDF de 200 Ko accepté (la limite de 64 Ko des autres routes ne s'applique pas) ; PUT de ligne avec un corps de 100 Ko toujours refusé (413) ; inscriptions closes → 409.
  - organisateur : `POST …/ffk-pdf?discipline=kata` → `weightClassId: null` ; `GET …/clubs/:clubId/lines` → les lignes du club, `partlyEditable` pour une ligne commencée comme `fighterLine`.
  - droits : compte de rôle Zone → 403 sur les deux routes organisateur (même liste de rôles que `POST /clubs/:clubId/lines`).
- [ ] **Step 2: Lancer** `npx vitest run tests/server/ffk-pdf-routes.test.ts` → FAIL.
- [ ] **Step 3: Implémenter.** Hook de `club-entry.ts` : `route.bodyLimit ??= 64 * 1024`. La route coach déclare `{ bodyLimit: FFK_PDF_MAX_BYTES }` et appelle `access()` puis le contrôle d'ouverture du repository avant de lire. Enregistrer les routes dans `app.ts` à côté de `clubLineRoutes` / `clubEntryRoutes` (la route coach n'existe que si `clubServices`, comme les autres routes `/api/inscription`). Ajouter `'POST /ffk-pdf'` et `'GET /clubs/:clubId/lines'` dans `permissions.ts` à côté de la ligne 31.
- [ ] **Step 4: Lancer** → PASS ; `npx vitest run tests/server/club-entry.test.ts tests/server/permissions.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-pdf-ffk): routes de lecture du PDF et des fiches d'un club"`

### Task 5: La fenêtre du combattant en mode import

**Files:**
- Create: `src/web/components/club-line/ffkStep.ts`, `src/web/components/club-line/FfkChoice.tsx`
- Modify: `src/web/components/ClubLineForm.tsx`
- Test: `tests/web/ffk-step.test.ts`

**Interfaces:**
- Consumes: `FfkDiff`, `FfkField` (Task 3).
- Produces:
  - ```ts
    export interface FfkFormStep {
      progress: { index: number; total: number };        // « Fiche {index+1} sur {total} »
      initial: ClubFormLine;                              // valeurs de départ du formulaire (remplace line.line)
      marks: ('name' | 'sex' | FfkField | 'discipline')[]; // champs marqués « FFK »
      diffs: FfkDiff[];
      banner: string | null;                              // encadré « Fiche déjà créée. … »
      hints: Partial<Record<'name' | 'ageBandCode' | 'weightClassId' | 'discipline', string>>;
      skipLabel: 'Ne pas l’ajouter' | 'Laisser la fiche telle quelle';
      onSkip: () => void;
      onPrevious: (() => void) | null;
      onSaved: SavedThen;                                 // après « Enregistrer · suivant → » (ou Entrée)
    }
    export function ffkChoiceState(value: string | null, diff: FfkDiff): 'ffk' | 'fiche' | null
    export function ffkBanner(firstName: string, disciplines: string[]): string
    ```
  - `ClubLineForm` : nouvelle prop optionnelle `ffk?: FfkFormStep`.

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/web/ffk-step.test.ts`) :
  - `ffkChoiceState('benjamin:F:-40', diff)` → `'ffk'` ; valeur de la fiche → `'fiche'` ; autre valeur tapée → `null`.
  - `ffkBanner('Jade', ['Karaté', 'Kata'])` → `'Fiche déjà créée. Une seule fiche par combattant : Jade est inscrit(e) en Karaté et Kata. Ce que vous choisissez ici vaut pour toutes ses disciplines.'` ; une discipline → `'… inscrit(e) en Karaté. …'` ; trois → `'Karaté, Boxing et Kata'`.
- [ ] **Step 2: Lancer** `npx vitest run tests/web/ffk-step.test.ts` → FAIL.
- [ ] **Step 3: Implémenter** les deux fonctions, puis `FfkChoice` (deux cases côte à côte « FFK » / « Votre fiche » avec la valeur lisible ; clic → `onPick(value)` ; `aria-pressed`) et l'extension de `ClubLineForm` quand `ffk` est donné :
  - état initial du formulaire = `ffk.initial` (la ligne `line`, si présente, reste la source de `fighterId` et `version`) ;
  - titre : `line ? '<NOM> <Prénom>' : 'Nouveau combattant'` ; sous le titre, « Fiche k sur N » + barre de progression Mantine `Progress` ;
  - `ffk.banner` dans une `Alert` bleue en tête ; marque `FFK` (petit `Badge` contour) à côté des étiquettes de `marks` ;
  - sous chaque champ de `diffs`, `FfkChoice` (valeur « FFK » sélectionnée au départ puisque `initial` porte la valeur FFK) ; `hints` en texte d'aide sous le champ (« La FFK écrit « … » : corrigez la coupure nom / prénom si besoin. », « La FFK indique « … » : choisissez la catégorie. ») ;
  - pied : à gauche bouton discret `ffk.skipLabel` ; à droite « ← Précédent » (si `onPrevious`) et « Enregistrer · suivant → » (`submit(ffk.onSaved)`) ; pas de « Supprimer », pas d'« Annuler » ; Entrée = « Enregistrer · suivant → » ;
  - fiche verrouillée : lecture seule habituelle, `FfkChoice` désactivées, le bouton principal devient « Suivant → » (sans enregistrer).
  - Sans `ffk`, le comportement actuel est inchangé (les tests existants `tests/web/line-form.test.ts` et les e2e de saisie restent verts).
- [ ] **Step 4: Lancer** `npx vitest run tests/web` → PASS ; `npm run typecheck` → 0 erreur.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-pdf-ffk): fenêtre du combattant pré-remplie, choix FFK / fiche"`

### Task 6: Le parcours d'import (page du coach)

**Files:**
- Create: `src/web/components/ffk-import/wizard.ts`, `src/web/components/ffk-import/FfkImportWizard.tsx`
- Modify: `src/web/api.ts`, `src/web/pages/ClubEntryPage.tsx`
- Test: `tests/web/ffk-wizard.test.ts`

**Interfaces:**
- Consumes: `FfkPdfRead` (Task 4), `planFfkImport`, `prefillNew`, `prefillExisting`, `withoutDiscipline`, `hasDiscipline` (Task 3), `FfkFormStep`, `ffkBanner` (Task 5), `LineOps`, `ClubLineForm`.
- Produces:
  - `export const useReadFfkPdfCoach = (token: string) => useMutation<FfkPdfRead, ApiError, { file: File; discipline: DisciplineId }>` (via `upload`, query `discipline`) ; `useReadFfkPdfOrganiser(competitionId)` ; `useClubLines(competitionId, clubId)` (`GET …/clubs/:clubId/lines`, clé `['club-lines', competitionId, 'club', clubId]`, invalidée par `useOrganiserLineOps`).
  - ```ts
    export type WizardState =
      | { stage: 'start' }
      | { stage: 'step'; plan: FfkImportPlan; index: number; done: Record<number, 'saved' | 'skipped'> }
      | { stage: 'end'; plan: FfkImportPlan; done: Record<number, 'saved' | 'skipped'>; remove: string[] };
    export type WizardAction =
      | { type: 'start'; plan: FfkImportPlan } | { type: 'saved' } | { type: 'skipped' } | { type: 'previous' }
      | { type: 'stale' } | { type: 'toggleAbsent'; fighterId: string };
    export function wizardReducer(s: WizardState, a: WizardAction): WizardState
    export function wizardSummary(s: Extract<WizardState, { stage: 'end' }>): { added: number; updated: number; left: number }
    export function FfkImportWizard(props: {
      opened: boolean; onClose: (message?: string) => void; mode: 'coach' | 'organiser';
      read: (file: File, discipline: DisciplineId) => Promise<FfkPdfRead>;
      lines: ClubLine[]; ops: LineOps; multipleCombats: boolean;
      ageBands: ClubEntryView['ageBands']; weightClasses: ClubEntryView['weightClasses']; closed: string[];
      before?: ReactNode;          // étape Club de l'organisateur (Task 7)
      ready?: boolean;             // false : « Commencer » désactivé (club pas encore choisi)
      onBeforeStart?: () => Promise<void>;  // organisateur : rend le club choisi effectif
    }): JSX.Element
    ```

- [ ] **Step 1: Écrire les tests qui échouent** (`tests/web/ffk-wizard.test.ts`, réducteur seul) :
  - `start` avec 3 étapes → `{ stage: 'step', index: 0 }` ; avec 0 étape → `{ stage: 'end' }`.
  - `saved` à la dernière étape → `stage: 'end'`, `done` complet ; `skipped` → `done[i] = 'skipped'`.
  - `previous` à l'index 2 → index 1 ; à l'index 0 → inchangé.
  - `stale` → même index (la fiche est relue par le composant).
  - `toggleAbsent` deux fois → `remove` vide ; `wizardSummary` : 2 nouveaux enregistrés, 1 existante enregistrée, 1 passée → `{ added: 2, updated: 1, left: 1 }`.
- [ ] **Step 2: Lancer** → FAIL.
- [ ] **Step 3: Implémenter** le réducteur, les hooks d'API, puis `FfkImportWizard` (une `Modal` pour le départ et la fin ; `ClubLineForm` avec `ffk` pour les étapes, remonté par `key` à chaque étape) :
  - Départ : `Select` « Discipline de ce PDF » (obligatoire, vide au départ ; disciplines de `combatChoices`/`kataChoice` d'une ligne vide, ou les cinq de `DISCIPLINES`), `FileButton` (`accept=".pdf"`), lecture dès que les deux sont choisis, `ApiErrorAlert`, compteurs « N nouveaux · N fiches existantes à revoir · N déjà à jour » (+ « N lignes en double ignorées » si `duplicates`), bouton « Commencer (N fiches) ». Le plan est calculé à « Commencer » sur les `lines` du moment.
  - Étape `new` : `initial = prefillNew`, `marks` = tout ce qui est non nul, `hints.name` si le nom complet a plus de deux mots, `hints.ageBandCode`/`weightClassId` si non traduits, `skipLabel: 'Ne pas l’ajouter'`.
  - Étape `existing` : ligne fraîche prise dans `lines` par `fighterId` ; diffs **recalculés** sur cette ligne (via `planFfkImport` sur ce seul combattant) ; `initial = prefillExisting` ; `banner = ffkBanner(...)` ; si `oneCombatBlocked`, `hints.discipline` = « Déjà inscrit(e) en <discipline> : une seule discipline de combat à cette compétition. Cochez <discipline de l'import> pour changer. » ; les autres disciplines de la fiche restent cochées, avec sous « Disciplines » la phrase « <disciplines> : gardé(es) (pas dans ce PDF). » (ajoutée à `hints.discipline`) ; `skipLabel: 'Laisser la fiche telle quelle'`.
  - Étape `homonym` : petite fenêtre « Plusieurs fiches portent ce nom : laquelle ? » avec une option par candidat (nom, tranche, disciplines) et « C’est un autre combattant » → l'étape devient `existing` ou `new`.
  - « ← Précédent » : rouvre la fiche précédente telle qu'elle est maintenant (lecture de `lines`), sans comparaison si elle a été enregistrée.
  - Erreur 409 / 410 (`RELOAD_STATUSES`) pendant l'enregistrement : notification orange avec le message, `dispatch({ type: 'stale' })`, la fiche est remontée depuis la liste rechargée.
  - Fin : récapitulatif « N ajoutés · N mis à jour · N laissés tels quels », section des absents (titre « Inscrits en <discipline> chez nous, absents du PDF », phrase « Normal s’ils ne sont pas inscrits à la FFK en <discipline>. Cochez seulement ceux qui ne viendront pas en <discipline>. », une `Checkbox` décochée par fiche avec ses autres disciplines), « Terminer » : pour chaque coché, `ops.save` avec `withoutDiscipline` ou `ops.remove` si `null` ; puis `onClose('Import FFK : …')` en notification verte.
  - `ClubEntryPage` : bouton `variant="default"` « Importer le PDF de la FFK » à gauche de « Ajouter un combattant », seulement si `view.editable` ; `lines = view.lines`.
- [ ] **Step 4: Lancer** `npx vitest run tests/web/ffk-wizard.test.ts` → PASS ; `npm run typecheck` → 0 erreur ; `npm test` → tout vert.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-pdf-ffk): parcours fiche par fiche sur la page du coach"`

### Task 7: Section de l'organisateur (Fiche club)

**Files:**
- Modify: `src/web/pages/ClubFormPage.tsx`, `src/web/help.ts`
- Test: `tests/web/help.test.ts` (existant, doit rester vert)

**Interfaces:**
- Consumes: `FfkImportWizard`, `useReadFfkPdfOrganiser`, `useClubLines`, `useOrganiserLineOps`, `ClubPicker`, `useResolveClub`, `useGrid`, `useCompetition` (réglage `multipleCombatDisciplinesPerDay`), fermetures (`useClosedCategories` ou ce qu'utilise `PaperEntryTable`).
- Produces: aide `'fiche-club.pdf-ffk'` (titre « Importer un PDF de la FFK », `short` ≤ 160 caractères terminée par un point).

- [ ] **Step 1: Ajouter l'aide** `'fiche-club.pdf-ffk'` dans le type et `HELP` (`help.ts`), dans le ton des autres aides Fiche club : à quoi sert le PDF, choix du club et de la discipline, une fiche à la fois, enregistrement au fur et à mesure, absents décochés.
- [ ] **Step 2: Ajouter la section** `SectionCard` entre « Importer la fiche d’un club » et « Saisir une fiche papier », avec un bouton « Importer le PDF de la FFK » qui ouvre `FfkImportWizard` en `mode="organiser"` ; `before` = `ClubPicker` (même usage que la fiche papier) ; `ready` = club choisi ; `onBeforeStart` = `resolveClub(choice)` pour une fiche d'annuaire (le club entre dans la compétition à « Commencer ») ; `lines` = `useClubLines(id, clubId)` ; `ops = useOrganiserLineOps(id, clubId)` ; tranches, poids et fermetures comme `PaperEntryTable` les passe à `ClubLineForm`.
- [ ] **Step 3: Vérifier** `npx vitest run tests/web/help.test.ts` → PASS ; `npm run typecheck` → 0 erreur.
- [ ] **Step 4: Commit** — `git commit -m "feat(import-pdf-ffk): import du PDF FFK depuis la Fiche club"`

### Task 8: Tests de bout en bout, vérification réelle, documentation

**Files:**
- Create: `tests/e2e/import-pdf-ffk.spec.ts`
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1: Écrire les e2e** (PDF fabriqués par `buildFfkPdf`, passés à `setInputFiles({ name, mimeType: 'application/pdf', buffer })`) :
  - coach (serveur 3101, `inviteWithLink`) : liste vide → import karaté de 3 combattants → « Commencer (3 fiches) » → fiche 1 : la marque « FFK » est visible, on tape un poids actuel, « Enregistrer · suivant → » ; fiche 2 : « Ne pas l’ajouter » ; fermer à la fiche 3 → la liste a 1 combattant. Réimporter le même PDF → « 1 déjà à jour », « Commencer (2 fiches) ».
  - coach, conflit et absent : fiche saisie à la main en −35 kg + une autre fiche karaté absente du PDF → import → la fiche existante montre l'encadré « Fiche déjà créée. » et les cases « FFK −40 » / « Votre fiche −35 » ; choisir « Votre fiche », enregistrer ; à la fin, l'absent est décoché ; « Terminer » ne retire rien.
  - organisateur (serveur local) : Fiche club → « Importer le PDF de la FFK » → choisir un club de l'annuaire → discipline kata → « Commencer » → enregistrer une fiche → l'onglet Inscriptions montre le combattant dans ce club, en kata.
- [ ] **Step 2: Lancer** `npx playwright test tests/e2e/import-pdf-ffk.spec.ts` → PASS, puis la suite complète `npm run test:e2e` → PASS (une seule exécution Playwright à la fois).
- [ ] **Step 3: Vérifier sur Chrome (Claude in Chrome)** sur une copie de base de démonstration (jamais la base vivante ouverte depuis l'hôte) : page du coach — départ, fiche nouvelle, fiche en conflit, homonymes, fiche verrouillée, fin avec absents ; Fiche club côté organisateur ; thème sombre et clair. Puis iPhone simulé (idb) : la fenêtre plein écran, la barre de progression et les deux cases FFK / Votre fiche lisibles sans débordement. Noter dans le bilan ce qui n'a pas été vu.
- [ ] **Step 4: Documenter** : ligne « 42 » dans la feuille de route (même format que la 41) et section de l'étape 42 dans le bilan (décisions, choix du builder, mineurs reportés).
- [ ] **Step 5: Commit** — `git commit -m "test(import-pdf-ffk): parcours de bout en bout ; bilan de l'étape 42"`
