# Étape 2 : Inscriptions et fiche club — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** gérer les clubs, les combattants et leurs inscriptions (saisie manuelle, inscription sur place), générer le **modèle .ods de fiche club** à envoyer aux clubs, et réimporter les fiches remplies en un clic, avec aperçu.

**Architecture :**
- Le domaine (`src/domain`) reçoit le modèle d'inscription, la lecture des préférences, la normalisation des noms et l'analyse d'une fiche club à partir d'un **tableau 2D de cellules**. Cette analyse est pure et testable sans fichier.
- Le serveur lit les tableurs avec SheetJS (pour transformer un fichier en tableau 2D) et écrit l'.ods avec un petit générateur maison : JSZip + `content.xml`, avec des **listes de validation** OpenDocument.
- L'interface ajoute trois onglets : « Clubs », « Inscriptions », « Fiche club ».

**Tech Stack :** celle de l'étape 1, plus :
- **SheetJS** `xlsx` 0.20.3 depuis `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. La version du registre npm (0.18.5) est ancienne et a des failles connues ;
- **JSZip** ;
- `@fastify/multipart` n'est **pas** utilisé : les fichiers sont envoyés en corps brut (`application/octet-stream`).

**Spec :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` §4.1, §4.2, §4.4, §5, §7.1, §7.2, §13. Feuille de route : `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`.

## Global Constraints

- Toutes les contraintes de l'étape 1 s'appliquent : interface en français, hors ligne, Chrome, `src/domain` pur, accès base uniquement via Drizzle, et `coupe-shidokan.xlsx` jamais commité.
- **Fiche club** (spec §7.2) :
  - **pas de numéro de licence** ;
  - **une case globale de pré-accord** du coach, saisie en « Oui / Non » ;
  - préférences codées **1** karaté, **2** shido-boxing, **3** shido-mix-martial ;
  - « Jiyu en priorité » seulement pour les combattants shobu ;
  - **kata et triathlon inscriptibles, mais jamais dans les préférences**.
- **Shobu interdit aux mineurs** (spec §4.2) ; kata sans règlement ni poids (spec §4.1).
- **Une discipline de combat par jour** par défaut : une deuxième inscription de combat produit un **avertissement**, pas un refus. Le kata ne compte pas.
- **Grille** : supprimer une catégorie de poids qui contient des inscriptions est **refusé**, avec le nombre d'inscriptions concernées (feuille de route).
- Une catégorie s'identifie par **discipline + règlement + sexe + tranche d'âge + catégorie de poids**. Depuis la relecture de l'étape 1, les catégories de poids ont un **identifiant stable** (`WeightClass.id`), et la grille est mise à jour sur place. Les inscriptions **référencent `weightClassId`** : un renommage se propage tout seul.
- **Les fonctions du dépôt sont `async`** (voir l'étape 1 : chemin PostgreSQL).

## Review Focus

1. **Fiche remplie de façon approximative** : « oui », « X », « Oui » ; « 3 2 », « 3,2 », « 32 » ; « -35kg » ; sexe « F », « Fille », « Féminin » ; lignes vides au milieu. Tout doit être compris, et ce qui ne l'est pas doit être signalé **par ligne**, sans bloquer les autres lignes. Tests en Task 3.
2. **Réimport de la fiche d'un même club** (version corrigée renvoyée par le coach) : pas de doublons, les combattants de la fiche précédente sont remplacés. Test en Task 5.
3. **Fichier qui n'est pas une fiche club** (export FFK, image, fichier vide) : message clair « Ce fichier n'est pas une fiche club », sans plantage. Test en Task 5.
4. **Shobu pour un mineur et préférences incohérentes** (sa propre discipline, kata ou triathlon dans les préférences) : refusé ou signalé, jamais enregistré en silence. Tests en Tasks 2 et 3.
5. **Le modèle .ods s'ouvre dans LibreOffice et Excel** avec ses listes déroulantes. Vérification par conversion headless de LibreOffice en Task 4.

---

## Structure des fichiers

```
src/domain/registration.ts        types Club, Fighter, Registration, RegistrationInput ; validateRegistration ; parsePreferences
src/domain/names.ts               normalizeName, splitFullName, parseYesNo, parseSex
src/domain/club-form.ts           CLUB_FORM_LAYOUT (cellules du modèle) ; parseClubForm(cells, grid)
src/server/db/schema.ts           + tables clubs, fighters, registrations
src/server/repositories/registrations.ts   clubs, combattants, inscriptions, import de fiche
src/server/repositories/competitions.ts    replaceGrid refuse de supprimer une catégorie utilisée
src/server/spreadsheet/read.ts    readWorkbook(buffer) → { sheets: { name, cells }[] } (SheetJS)
src/server/spreadsheet/ods.ts     writeOds(sheets) → Buffer (JSZip, validations)
src/server/club-form-template.ts  buildClubFormTemplate(competition, grid) → OdsSheet[]
src/server/routes/registrations.ts  routes clubs / inscriptions / fiche club
src/web/pages/ClubsPage.tsx, RegistrationsPage.tsx, ClubFormPage.tsx
src/web/components/RegistrationForm.tsx
tests/domain/registration.test.ts, names.test.ts, club-form.test.ts
tests/server/registrations-repo.test.ts, ods.test.ts, registrations-api.test.ts
tests/e2e/inscriptions.spec.ts
```

---

### Task 1 : Dépendances et normalisation des noms

**Files :**
- Create : `src/domain/names.ts`
- Modify : `package.json` (dépendances)
- Test : `tests/domain/names.test.ts`

**Interfaces :**
- Produces :

```ts
export function normalizeName(s: string): string;           // MAJUSCULES, sans accents, espaces/tirets/apostrophes réduits à un espace
export function splitFullName(full: string, firstName?: string | null): { lastName: string; firstName: string };
export function parseYesNo(v: unknown): boolean | null;     // oui/o/x/yes/true/1 → true ; non/n/no/false/0 → false ; vide → null ; autre → null
export function parseSex(v: unknown): Sex | null;           // F, Fém., Féminin(e), Fille, Femme, Feminine → 'F' ; M, Masc., Masculin, Garçon, Homme → 'M'
```

- [ ] **Step 1 : Installer** `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz jszip`. Vérifier que `node -e "import('xlsx').then(m=>console.log(m.version))"` affiche `0.20.3`.
- [ ] **Step 2 : Écrire `tests/domain/names.test.ts`.**

```ts
test.each([["Côte-d'Azur  Éloïse", 'COTE D AZUR ELOISE'], ['  dupont ', 'DUPONT'], ['Ñoño', 'NONO']])('normalizeName(%s)', (a, b) => expect(normalizeName(a)).toBe(b));
test('nom complet sans prénom séparé : dernier mot = prénom', () => expect(splitFullName('DUBOIS MARIE ANNE')).toEqual({ lastName: 'DUBOIS MARIE', firstName: 'ANNE' }));
test('prénom fourni à part', () => expect(splitFullName('DUPONT', 'Lyna')).toEqual({ lastName: 'DUPONT', firstName: 'Lyna' }));
test('un seul mot', () => expect(splitFullName('DUPONT')).toEqual({ lastName: 'DUPONT', firstName: '' }));
test.each([['Oui', true], ['oui', true], ['X', true], ['x', true], [true, true], ['Non', false], ['', null], [null, null], ['peut-être', null]])('parseYesNo(%s)', (v, r) => expect(parseYesNo(v)).toBe(r));
test.each([['F', 'F'], ['Féminin', 'F'], ['Feminine', 'F'], ['fille', 'F'], ['M', 'M'], ['Masculin', 'M'], ['Garçon', 'M'], ['?', null]])('parseSex(%s)', (v, r) => expect(parseSex(v)).toBe(r));
```

- [ ] **Step 3 : Lancer `npm test`.** Attendu : échec, le module n'existe pas.
- [ ] **Step 4 : Implémenter `names.ts`.** Utiliser `normalize('NFD')`, puis retirer les diacritiques et les caractères `’'-`. Pour `splitFullName` : sans prénom fourni, le **dernier mot** est le prénom. C'est la convention de l'export FFK : « NOM PRÉNOM ».
- [ ] **Step 5 : Lancer `npm test`.** Attendu : tout passe.
- [ ] **Step 6 : Commit** `feat(domain): normalisation des noms, oui/non, sexe ; dépendances SheetJS et JSZip`

---

### Task 2 : Domaine — inscriptions et préférences

**Files :**
- Create : `src/domain/registration.ts`
- Test : `tests/domain/registration.test.ts`

**Interfaces :**
- Consumes : `DISCIPLINES`, `RULESETS` (étape 1) ; `CategoryGrid`, `weightClassesFor` ; `parseWeightLabel`.
- Produces :

```ts
export type RegistrationSource = 'club_form' | 'ffk' | 'manual' | 'onsite';
export interface Club { id: string; competitionId: string; name: string; ffkEntity: string | null; coachName: string | null; coachPhone: string | null; coachEmail: string | null; preApproval: boolean }
export interface Fighter { id: string; competitionId: string; clubId: string | null; lastName: string; firstName: string; sex: Sex; ageBandCode: string; licence: string | null }
export interface Registration {
  id: string; competitionId: string; fighterId: string; discipline: DisciplineId;
  ruleset: Ruleset | null;              // null pour le kata
  weightClassId: string | null;         // null pour le kata ; identifiant stable de la catégorie de poids
  approxWeightKg: number | null;
  otherDisciplines: DisciplineId[];     // préférences ordonnées, combat uniquement
  acceptsJiyuFirst: boolean | null;     // seulement si shobu
  source: RegistrationSource; createdAt: string;
}
export interface RegistrationInput {     // ce que saisit l'interface ou ce que produit une fiche
  clubId: string | null; lastName: string; firstName: string; sex: Sex; ageBandCode: string; licence?: string | null;
  discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null; approxWeightKg?: number | null;
  otherDisciplines?: DisciplineId[]; acceptsJiyuFirst?: boolean | null; source: RegistrationSource;
}
export interface RegistrationRow extends Registration { fighter: Fighter; club: Club | null } // vue jointe pour l'interface
export function parsePreferences(raw: unknown, main: DisciplineId): { value: DisciplineId[]; errors: string[] };
export function validateRegistration(input: RegistrationInput, grid: CategoryGrid): string[]; // erreurs bloquantes, en français
export function combatConflictWarning(existing: Registration[], input: Pick<RegistrationInput, 'discipline'>, allowMultiple: boolean): string | null;
```

- [ ] **Step 1 : Écrire `tests/domain/registration.test.ts`.**
  - `parsePreferences('32', 'karate')` → `{ value: ['shido-mix', 'shido-boxing'], errors: [] }`. Même résultat pour `'3 2'`, `'3,2'`, `'3-2'` et le nombre `32`.
  - `parsePreferences('', 'karate')` → `{ value: [], errors: [] }`.
  - `parsePreferences('12', 'karate')` → `value: ['shido-boxing']`, plus une erreur contenant « discipline principale ».
  - `parsePreferences('4', 'karate')` → erreur contenant « code inconnu ».
  - `parsePreferences('22', 'karate')` → `value: ['shido-boxing']`, doublon ignoré sans erreur.
  - `parsePreferences('2', 'kata')` → erreur « pas de préférences pour le kata ». Même chose pour le triathlon.
  - `validateRegistration` :
    - un minime en shobu → erreur contenant « réservé aux adultes » ;
    - un kata avec `weightClassId` → erreur ;
    - un combat sans `weightClassId` → erreur ;
    - `weightClassId` d'une autre tranche ou d'un autre sexe, ou inconnu → erreur ;
    - tranche d'âge inconnue → erreur ;
    - `acceptsJiyuFirst: true` en jiyu → erreur ;
    - un senior en shobu, karaté, `senior:M:-75`, préférences `['shido-boxing']` → aucune erreur.
  - `combatConflictWarning` : un karaté existant plus un shido-boxing, avec `allowMultiple = false` → un message ; avec `true` → `null`. Un karaté existant plus un kata → `null`.
- [ ] **Step 2 : Lancer `npm test`.** Attendu : échec.
- [ ] **Step 3 : Implémenter `registration.ts`.** `parsePreferences` lit uniquement les chiffres de la chaîne, dans l'ordre. Les codes 1, 2 et 3 viennent de `DISCIPLINES[*].clubFormCode`.
- [ ] **Step 4 : Lancer `npm test`.** Attendu : tout passe.
- [ ] **Step 5 : Commit** `feat(domain): modèle d'inscription, préférences et validations`

---

### Task 3 : Domaine — disposition et lecture de la fiche club

**Files :**
- Create : `src/domain/club-form.ts`
- Test : `tests/domain/club-form.test.ts`

**Interfaces :**
- Consumes : Tasks 1 et 2.
- Produces :

```ts
export const CLUB_FORM_TITLE = 'FICHE DE PRÉ-INSCRIPTION CLUB';
export const CLUB_FORM_HEADER_FIELDS = ['Club', 'Coach (nom)', 'Coach (téléphone)', 'Coach (e-mail)', 'Pré-accord du coach (Oui/Non)'] as const; // libellés en colonne A, valeurs en colonne B, lignes 4 à 8
export const CLUB_FORM_COLUMNS = ['Nom', 'Prénom', 'Sexe', "Catégorie d'âge", 'Catégorie de poids', 'Discipline', 'Règlement', 'Autres disciplines (1 karaté, 2 shido-boxing, 3 shido-mix)', 'Si shobu : jiyu en priorité (Oui/Non)', 'Poids actuel approx. (kg)'] as const; // en-tête du tableau ligne 11
export const CLUB_FORM_FIRST_ROW = 12; // 1re ligne de combattant (numérotation tableur, 1-based)
export const CLUB_FORM_ROWS = 80;     // lignes prévues dans le modèle
export interface ClubFormHeader { club: string; coachName: string | null; coachPhone: string | null; coachEmail: string | null; preApproval: boolean }
export interface ClubFormRow { line: number; input: RegistrationInput | null; errors: string[] } // line = numéro de ligne du tableur
export interface ClubFormParse { header: ClubFormHeader; rows: ClubFormRow[] }
export class NotAClubFormError extends Error {}
export function parseClubForm(cells: unknown[][], grid: CategoryGrid): ClubFormParse; // cells[ligne 0-based][colonne 0-based]
export function disciplineFromLabel(v: unknown): DisciplineId | null; // Karaté/karate/1, Shido-boxing/Boxe/2, Shido-mix-martial/Mix/Kmix/3, Triathlon, Kata
export function rulesetFromLabel(v: unknown): Ruleset | null;         // Jiyu / Ji Yu / Jiyu ippon kumite ; Shobu / Shobu ippon kumite
export function ageBandFromLabel(v: unknown, grid: CategoryGrid): string | null; // libellé ou code, singulier ou pluriel, casse/accents ignorés ; « Vétéran » seul → 'v1'
```

- [ ] **Step 1 : Écrire `tests/domain/club-form.test.ts`.** Un helper construit `cells` : titre en ligne 1, en-tête aux lignes 4 à 8, colonnes ligne 11, combattants à partir de la ligne 12.
  - Fiche correcte, 2 combattants : 1 karaté jiyu cadet F `-54` avec prefs « 32 » ; 1 senior M shobu `-75`, jiyu en priorité « Oui ». Attendu : `header.club` lu, `preApproval: true` (valeur « oui »), 2 lignes sans erreur, `source: 'club_form'`, `acceptsJiyuFirst: true`.
  - **Lignes vides au milieu** : une ligne vide entre deux combattants est ignorée, et les numéros de ligne restent ceux du tableur (12 et 14).
  - **Variantes** : sexe « Fille » ; âge « cadette », « CADETS », « Vétéran » → `v1` ; poids « -35kg » → l'identifiant de la catégorie -35 de la grille ; discipline « Boxe » → shido-boxing ; prefs « 3,2 ».
  - **Erreurs par ligne** : un minime en shobu et un poids absent de la grille. Ces lignes ont `input: null` et des `errors` non vides ; les autres lignes restent valides.
  - **Kata** : discipline « Kata », règlement et poids vides → valide, `ruleset: null`, `weightClassId: null`.
  - **Pas une fiche** : `cells` d'un export FFK (en-tête `Nom, Prenom, Numero, …` en ligne 1) → lève `NotAClubFormError`. Même chose avec `[]`.
  - **Club manquant** : une erreur d'en-tête est levée en `NotAClubFormError` avec le message « Le nom du club est obligatoire ».
- [ ] **Step 2 : Lancer `npm test`.** Attendu : échec.
- [ ] **Step 3 : Implémenter `club-form.ts`.**
  - Reconnaître une fiche à son titre (`CLUB_FORM_TITLE`, comparé après `normalizeName`) dans la colonne A des lignes 1 à 3 **et** à l'en-tête de colonnes de la ligne 11.
  - Une ligne est vide quand ses colonnes 1 à 10 sont toutes vides.
  - `approxWeightKg` accepte « 54,5 ».
- [ ] **Step 4 : Lancer `npm test`.** Attendu : tout passe.
- [ ] **Step 5 : Commit** `feat(domain): disposition et lecture de la fiche club`

---

### Task 4 : Génération du modèle .ods et lecture des tableurs

**Files :**
- Create : `src/server/spreadsheet/ods.ts`, `src/server/spreadsheet/read.ts`, `src/server/club-form-template.ts`
- Test : `tests/server/ods.test.ts`

**Interfaces :**
- Consumes : `CLUB_FORM_*` (Task 3) ; `Competition`, `CategoryGrid` ; `DISCIPLINES`, `RULESETS`.
- Produces :

```ts
// ods.ts
export interface OdsCell { value: string | number | null; bold?: boolean; validation?: string } // validation = nom d'une liste déclarée dans OdsSheet.validations
export interface OdsSheet { name: string; rows: OdsCell[][]; columnWidthsCm?: number[]; validations?: Record<string, string[]> }
export function writeOds(sheets: OdsSheet[]): Promise<Buffer>; // mimetype non compressé en 1er, META-INF/manifest.xml, content.xml, styles.xml
// read.ts
export function readWorkbook(buf: Buffer): { sheets: { name: string; cells: unknown[][] }[] }; // .xlsx, .ods, .csv (séparateur , ou ; et encodage détectés par SheetJS) ; lève UnreadableFileError
// club-form-template.ts
export function buildClubFormTemplate(competition: Competition, grid: CategoryGrid): OdsSheet[]; // feuille « Fiche club » + feuille « Aide »
```

- [ ] **Step 1 : Écrire `tests/server/ods.test.ts`.**
  - Le modèle est généré pour une compétition « Coupe Shidokan – Côte d'Azur » du 2026-11-22, puis relu avec `readWorkbook`.
    - Feuille « Fiche club » : le titre en A1 contient `CLUB_FORM_TITLE` ; A2 contient le nom de la compétition et « 22/11/2026 » ; A4 à A8 contiennent les `CLUB_FORM_HEADER_FIELDS` ; la ligne 11 contient les `CLUB_FORM_COLUMNS`.
    - Feuille « Aide » : on y trouve « 1 = Karaté », « 2 = Shido-boxing », « 3 = Shido-mix-martial », et la liste des catégories de poids de « Cadets » féminines (« -47 -54 -61 +61 »).
  - L'archive contient `mimetype` en premier, non compressé, valant `application/vnd.oasis.opendocument.spreadsheet`. `content.xml` contient des `table:content-validation`, avec au moins les listes Sexe, Catégorie d'âge, Discipline, Règlement et Oui/Non.
  - **Aller-retour** : on remplit le modèle relu (SheetJS `utils.sheet_add_aoa` sur les lignes 12 et suivantes), on l'écrit en .ods, puis `readWorkbook` et `parseClubForm` → les combattants saisis sont retrouvés.
  - `readWorkbook` lit un CSV en `;` avec accents en UTF-8, et un CSV en `,` en Windows-1252 (« Héloïse » préservé).
  - Il lève `UnreadableFileError` pour un buffer PNG.
- [ ] **Step 2 : Lancer `npm test`.** Attendu : échec.
- [ ] **Step 3 : Implémenter `ods.ts`.**
  - XML OpenDocument 1.2 minimal : `office:document-content`, avec `table:content-validations`. Chaque liste est un `table:content-validation` dont `table:condition="of:cell-content-is-in-list(&quot;A&quot;;&quot;B&quot;)"` et `table:allow-empty-cell="true"`.
  - Les cellules validées portent `table:content-validation-name`.
  - Styles : en gras pour l'en-tête, largeurs de colonnes.
  - Échapper `& < > "` dans le XML.
- [ ] **Step 4 : Implémenter `read.ts`** avec `XLSX.read(buf, { type: 'buffer', codepage: 1252, cellDates: false })` et `sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })`.
  - Pour un CSV, si le décodage UTF-8 est valide, utiliser l'UTF-8 ; sinon, Windows-1252.
  - Un fichier non reconnu lève `UnreadableFileError('Fichier illisible : formats acceptés .xlsx, .ods, .csv')`.
- [ ] **Step 5 : Implémenter `club-form-template.ts`.**
  - `CLUB_FORM_ROWS` lignes vides, avec validations sur Sexe (Féminin, Masculin), Catégorie d'âge (libellés de la grille), Discipline (libellés de `DISCIPLINES`), Règlement (Jiyu, Shobu), pré-accord et jiyu en priorité (Oui, Non).
  - La catégorie de poids reste en **texte libre** : une liste dépendante de l'âge et du sexe est trop fragile en ODS. Les catégories sont listées dans la feuille « Aide ».
- [ ] **Step 6 : Lancer `npm test`.** Attendu : tout passe.
- [ ] **Step 7 : Vérification LibreOffice.** Écrire le modèle dans `tmp/fiche.ods`, puis lancer `docker run --rm -v "$PWD/tmp:/w" -w /w lscr.io/linuxserver/libreoffice:latest soffice --headless --convert-to csv fiche.ods`. Attendu : `tmp/fiche.csv` créé, et sa première ligne contient « FICHE DE PRÉ-INSCRIPTION CLUB ». Si l'image n'est pas disponible, consigner une ruling et s'appuyer sur la relecture SheetJS.
- [ ] **Step 8 : Commit** `feat(server): modèle .ods de fiche club et lecture des tableurs`

---

### Task 5 : Base et API — clubs, inscriptions, import de fiche

**Files :**
- Modify : `src/server/db/schema.ts`, `src/server/repositories/competitions.ts`, `src/server/app.ts`
- Create : `src/server/repositories/registrations.ts`, `src/server/routes/registrations.ts`, migration générée
- Test : `tests/server/registrations-repo.test.ts`, `tests/server/registrations-api.test.ts`

**Interfaces :**
- Consumes : Tasks 2 à 4 ; `getGrid`, `getCompetition`.
- Produces :
  - Tables :
    - `clubs` (id, competition_id, name, name_key = `normalizeName(name)`, ffk_entity, coach_*, pre_approval) ;
    - `fighters` (id, competition_id, club_id, last_name, first_name, sex, age_band_code, licence) ;
    - `registrations` (id, competition_id, fighter_id, discipline, ruleset, weight_class_id, approx_weight_kg, other_disciplines_json, accepts_jiyu_first, source, created_at).

    Suppression en cascade depuis `competitions` ; depuis `fighters` vers `registrations`.
  - Dépôt :

```ts
export function listClubs(db, competitionId): Club[];
export function upsertClub(db, competitionId, data: Omit<Club, 'id' | 'competitionId'>): Club; // retrouve par name_key
export function updateClub(db, clubId, patch: Partial<Omit<Club, 'id' | 'competitionId'>>): Club;
export function listRegistrations(db, competitionId): RegistrationRow[];      // triées par club, nom, prénom
export function createRegistration(db, competitionId, input: RegistrationInput): { row: RegistrationRow; warning: string | null }; // réutilise le combattant (même club, même nom normalisé, même sexe) ; lève RegistrationValidationError
export function updateRegistration(db, competitionId, registrationId, input: RegistrationInput): RegistrationRow;
export function deleteRegistration(db, competitionId, registrationId): void;  // supprime le combattant s'il n'a plus d'inscription
export function importClubForm(db, competitionId, parse: ClubFormParse): { club: Club; imported: number; replaced: number; skipped: number };
export function countRegistrationsByWeightClass(db, competitionId): Promise<Map<string, number>>; // clé = weightClassId
```

  - `importClubForm` : dans une transaction, `upsertClub` à partir de l'en-tête, suppression des inscriptions `source = 'club_form'` de ce club (le nombre supprimé est `replaced`), puis création des lignes valides. Les lignes en erreur sont comptées dans `skipped`.
  - `replaceGrid` : lève `GridValidationError(["La catégorie Cadets féminines -54 contient 3 inscription(s) : elle ne peut pas être supprimée."])` si un `weightClassId` utilisé disparaît. Un renommage (même id) est accepté.
  - Toutes les fonctions du dépôt renvoient des `Promise`.
  - Routes (préfixe `/api/competitions/:id`) :

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/clubs` | `Club[]` |
| POST | `/clubs` | 201 `Club` |
| PATCH | `/clubs/:clubId` | `Club` |
| GET | `/registrations` | `RegistrationRow[]` |
| POST | `/registrations` | 201 `{ row, warning }` |
| PUT | `/registrations/:rid` | `RegistrationRow` |
| DELETE | `/registrations/:rid` | 204 |
| GET | `/club-form.ods` | fichier, `Content-Disposition: attachment; filename="fiche-club-<date>.ods"` |
| POST | `/club-forms/preview` | corps brut (fichier) → `ClubFormParse` |
| POST | `/club-forms/import` | corps brut → `{ club, imported, replaced, skipped, parse }` |

  - Erreurs : `NotAClubFormError` et `UnreadableFileError` → 400 `{ error: 'Ce fichier n\'est pas une fiche club', issues: [message] }` ; `RegistrationValidationError` → 400 avec `issues`.
  - Le parseur `application/octet-stream` de Fastify est ajouté avec `bodyLimit` de 20 Mo.

- [ ] **Step 1 : Écrire `tests/server/registrations-repo.test.ts`.**
  - Créer deux inscriptions pour le même combattant (karaté + kata) : un seul `fighters`.
  - Shobu minime → `RegistrationValidationError`.
  - Deuxième discipline de combat → `warning` non nul.
  - `deleteRegistration` de la dernière inscription supprime le combattant.
  - **Réimport de la même fiche corrigée** : 3 lignes, puis 2 → `replaced: 3, imported: 2`, et la liste ne contient que 2 inscriptions `club_form` pour ce club. Une inscription `manual` du même club n'est pas touchée.
  - Le pré-accord et les coordonnées du coach sont mis à jour par le réimport.
  - `replaceGrid` refuse de supprimer `-54` Cadets F quand une inscription l'utilise, mais accepte de supprimer une catégorie vide.
- [ ] **Step 2 : Écrire `tests/server/registrations-api.test.ts`.**
  - Télécharger `/club-form.ods` : 200, `content-type` `application/vnd.oasis.opendocument.spreadsheet`, buffer lisible par `readWorkbook`.
  - Le remplir (comme en Task 4), `preview`, puis `import` → `imported: 2`.
  - `GET /registrations` → 2 lignes avec club et combattant.
  - Envoyer un CSV d'export FFK à `preview` → 400 « Ce fichier n'est pas une fiche club ». Un PNG → 400.
  - `POST /registrations` en shobu minime → 400, `issues` contient « réservé aux adultes ».
- [ ] **Step 3 : Lancer `npm test`.** Attendu : échec.
- [ ] **Step 4 : Implémenter** le schéma (puis `npm run db:generate`), le dépôt, les routes, et l'enregistrement des routes dans `app.ts` (`app.register(registrationRoutes, { db })`).
- [ ] **Step 5 : Lancer `npm test` et `npm run typecheck`.** Attendu : tout passe.
- [ ] **Step 6 : Commit** `feat(server): clubs, inscriptions et import des fiches club`

---

### Task 6 : Interface — clubs, inscriptions, fiche club

**Files :**
- Create : `src/web/pages/ClubsPage.tsx`, `src/web/pages/RegistrationsPage.tsx`, `src/web/pages/ClubFormPage.tsx`, `src/web/components/RegistrationForm.tsx`
- Modify : `src/web/api.ts`, `src/web/components/CompetitionLayout.tsx` (onglets), `src/web/App.tsx` (routes)

**Interfaces :**
- Consumes : les routes de la Task 5.
- Produces : hooks `useClubs`, `useUpsertClub`, `useUpdateClub`, `useRegistrations`, `useCreateRegistration`, `useUpdateRegistration`, `useDeleteRegistration`, `usePreviewClubForm`, `useImportClubForm` ; onglets `clubs`, `inscriptions`, `fiche-club` ; `data-testid` utilisés par la Task 7 :
  - `club-form-download`, `club-form-file`, `club-form-preview-row`, `club-form-row-error`, `club-form-import` ;
  - `registration-add`, `registration-row`, `registration-warning`, `reg-club`, `reg-lastname`, `reg-firstname`, `reg-sex`, `reg-age`, `reg-discipline`, `reg-ruleset`, `reg-weight`, `reg-prefs`, `reg-jiyu-first`, `reg-onsite`, `reg-submit` ;
  - `club-row`, `club-preapproval`.

- [ ] **Step 1 : Page « Fiche club ».**
  - Bouton « Télécharger le modèle de fiche (.ods) » ; zone de dépôt ou de choix de fichier (`<input type="file" accept=".ods,.xlsx,.csv">`).
  - Aperçu : en-tête du club, puis tableau des lignes. Les lignes en erreur sont **surlignées en rouge, avec leur numéro de ligne du tableur et les messages**.
  - Bouton « Importer N inscription(s) valides ». Après import : notification « N inscription(s) importée(s), M remplacée(s), K ignorée(s) ».
- [ ] **Step 2 : Page « Inscriptions ».**
  - Tableau filtrable : texte, club, discipline, tranche d'âge. Colonnes : nom, prénom, club, sexe, âge, discipline, règlement, poids, préférences (libellés), origine (Fiche club, FFK, Manuelle, Sur place).
  - Bouton « Ajouter » qui ouvre `RegistrationForm`, une **saisie rapide** :
    - la catégorie de poids est une liste filtrée par tranche d'âge et sexe, d'après la grille ;
    - règlement et poids sont masqués pour le kata ;
    - les préférences sont une saisie « 32 » avec l'aperçu des libellés ;
    - « Jiyu en priorité » n'apparaît que si shobu ;
    - une case « Inscription sur place » donne `source: 'onsite'`, sinon `source: 'manual'`.
  - « Entrée » enregistre puis **réinitialise le formulaire en gardant le club, la tranche d'âge, le sexe et la discipline**, pour enchaîner les saisies.
  - L'avertissement de discipline multiple s'affiche (`registration-warning`). Modification et suppression depuis chaque ligne.
- [ ] **Step 3 : Page « Clubs ».** Tableau éditable en ligne : nom, coach, téléphone, e-mail, pré-accord (case), nombre d'inscriptions.
- [ ] **Step 4 : Vérifier dans Chrome** (`npm run dev`) : télécharger le modèle, ajouter deux inscriptions à la suite au clavier.
- [ ] **Step 5 : Commit** `feat(web): clubs, inscriptions (saisie rapide, sur place) et import de fiche club`

---

### Task 7 : Tests d'interface (Chrome)

**Files :**
- Create : `tests/e2e/inscriptions.spec.ts`, `tests/e2e/fixtures/build-club-form.ts`

**Interfaces :**
- Consumes : les `data-testid` de la Task 6 ; `readWorkbook` et SheetJS pour remplir le modèle téléchargé.

- [ ] **Step 1 : Écrire `tests/e2e/inscriptions.spec.ts`.**
  - **Fiche club, aller-retour** :
    1. télécharger le modèle (`page.waitForEvent('download')`) ;
    2. le remplir avec `build-club-form.ts` : 3 combattants, dont 1 ligne en erreur (minime shobu) ;
    3. le déposer dans `club-form-file` ;
    4. l'aperçu montre 3 lignes, dont 1 `club-form-row-error` qui contient « réservé aux adultes » ;
    5. importer → 2 `registration-row` dans l'onglet Inscriptions.
  - **Réimport corrigé** : même club, 3 lignes valides → 3 lignes, pas 5.
  - **Saisie rapide au clavier** : deux inscriptions de suite, la deuxième en gardant le club. Les deux apparaissent.
  - **Inscription sur place** : la colonne origine affiche « Sur place ».
  - **Avertissement** : deuxième discipline de combat → `registration-warning` visible.
  - **Kata** : les champs règlement et poids ne sont pas affichés.
- [ ] **Step 2 : Lancer `npm run test:e2e`.** Attendu : les tests de l'étape 1 et de l'étape 2 passent.
- [ ] **Step 3 : Commit** `test(e2e): fiche club et saisie des inscriptions sur Chrome`

---

## Fin de l'étape 2
- [ ] `npm run typecheck && npm test && npm run test:e2e` : tout passe ; `docker compose up -d --build` démarre.
- [ ] Mettre à jour la feuille de route (étape 2 ✅).
- [ ] Le modèle de fiche peut être envoyé aux clubs.
