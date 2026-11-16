# Import FFK : tout trancher sur une page, importer ce qui est prêt (étape 51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre la page « Import FFK » : catégories de poids, clubs, une carte par combattant (formulaire de l'app avec cases FFK / Fiche club), fiches sans inscription FFK, puis un import partiel avec récapitulatif.

**Architecture:** Le serveur recalcule l'aperçu à chaque décision (approche A) : la page envoie `choices` à `…/preview`, le domaine pur (`src/domain/ffk-plan/`) regroupe les lignes en cartes, rapproche, calcule écarts, états et récapitulatif ; `…/commit` recalcule, vérifie l'empreinte et applique dans une transaction ce qui est validé ou sans problème, en écrivant chaque combattant par le cœur extrait de `saveClubLine`. La page garde dans son état ce qui est tapé dans une carte jusqu'à « Valider la carte ».

**Tech Stack:** TypeScript, React + Mantine, Fastify + zod, Drizzle/SQLite (better-sqlite3, transactions synchrones), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-import-ffk-refonte-design.md` (maquette validée : https://claude.ai/artifact/RtvjpY5Di95SXADui6NVuA, version 10). Prérequis fait : étape 50 (licence, `normalizeLicence`, `ClubFormLine.licence`).

## Global Constraints

- **Par défaut, rien ne change** : aucune catégorie créée, aucun club relié s'il n'est pas sûr, aucune suppression, aucune ligne douteuse liée, **aucune différence avec la fiche appliquée sans validation**.
- « Sans problème » = rapprochement sûr et aucune différence avec la fiche (seuls des champs vides de la fiche complétés), ou nouveau combattant sans candidat et sans champ manquant.
- **« Importer… » n'est jamais bloqué** ; ce qui n'est pas tranché est laissé tel quel et revient au prochain import.
- Toute décision se défait (relier / « Ne pas relier pour l'instant », lier / « Ne pas lier pour l'instant », « Annuler mes modifications »).
- Recherche d'un club ou d'un combattant par son nom (dès 2 lettres, insensible aux accents), résultats à cocher ; jamais une longue liste déroulante.
- Fenêtre « Ajouter un club » = `ClubEntryModal` de l'annuaire, pré-remplie (nom, N° d'affiliation = chiffres en tête de l'entité FFK) ; le club est créé tout de suite.
- Carte ouverte = le formulaire combattant de l'app (champs de `ClubLineForm`), tous modifiables, cases FFK / Fiche club sous chaque champ qui diffère ; un champ qui diffère démarre **vide** ; fiche vide + export rempli = la valeur FFK complète (pas un écart) ; export vide = la fiche gardée ; nouveau combattant sans règlement = Jiyu.
- Zones de décision : champ à trancher encadré orange « À choisir » (cases en pointillés), tranché encadré bleu « Choisi » ; en tête « N choix à faire : les champs encadrés en orange. Cliquez sur FFK ou Fiche club, ou saisissez une autre valeur. »
- Textes exacts : « Relier à <club> », « Ne pas relier pour l'instant », « Chercher un autre club par son nom… », « ➕ Créer un club… », « Relié d'office », « C'est <combattant> (raison) », « ➕ Nouveau combattant », « Ne pas lier pour l'instant », « Pas dans la liste ? Chercher un inscrit par son nom… », « Écarter cette ligne », « Annuler mes modifications », « Fermer », « Valider la carte », « Reste à remplir : … », « Garder », « Rapprocher… », « Supprimer », « présent dans l'export précédent », « Vous pouvez importer maintenant : les N points non tranchés sont laissés de côté », « Importer… », « Confirmer l'import FFK », raison de rapprochement « même nom, autre licence » (étape 50).
- États d'une carte : « À trancher », « À valider » (page seulement), « Validée », « Sans problème », « Écartée ».
- Lien de club mémorisé à l'import comme aujourd'hui (`clubs.ffkEntity`, `club_aliases`) pour un lien sûr ou choisi.
- Jamais la base vivante `data/shidokan.sqlite` depuis l'hôte ; vérifications à l'écran sur une copie de sauvegarde (port 3200).

## Review Focus

- Un même combattant sur deux onglets (Karaté + Kata, même licence) → une seule carte, deux disciplines ; une ligne en double (même licence, même discipline) signalée dans la carte, pas deux inscriptions. Test : Task 2.
- Réimport du même fichier après un import partiel → seules les cartes non tranchées restent « À trancher » ; les validées sont maintenant « Sans problème » (aucun écart). Test : Task 6.
- Inscription recasée (valeurs `original`) ou combats commencés : valider une carte écrit les valeurs d'origine / garde ce qui a commencé, sans erreur. Test : Task 6.
- Inscriptions modifiées sur un autre poste entre l'aperçu et l'import → 409 « Les inscriptions ont changé depuis l'aperçu… », rien d'écrit. Test : Task 6.
- Club créé par « Ajouter un club » puis import annulé → le club reste, relié au prochain aperçu par son N° d'affiliation. Test : Task 1 (rapprochement par N° d'affiliation).

---

## File Structure

- `src/domain/ffk-plan/clubs.ts` (nouveau) — rapprochement des clubs (déplacé de `ffk-import.ts`, + N° d'affiliation, + choix « none »).
- `src/domain/ffk-plan/cards.ts` (nouveau) — regroupement des lignes en cartes, candidats, poids (catégories acceptées), ligne de l'export en `ClubFormLine`.
- `src/domain/ffk-plan/values.ts` (nouveau) — écarts carte / fiche, valeur de départ, champs manquants, état, résumé des changements.
- `src/domain/ffk-plan/plan.ts` (nouveau) — `planFfkCards` (assemble tout, orphelins, récapitulatif, empreinte) et types publics.
- `src/domain/ffk-import.ts` — garde la lecture (`parseFfkRows`, colonnes) ; l'ancien `planFfkImport` et `linkClubs` disparaissent à la Task 4.
- `src/server/repositories/club-entry.ts` — cœur synchrone `writeClubLineInTx` extrait de `saveClubLine`.
- `src/server/repositories/ffk-import.ts` — `loadExisting` (+ affiliations, + lignes des combattants), `buildFfkPlan`, `applyFfkCards`.
- `src/server/routes/ffk-import.ts` — schéma zod des nouveaux `choices`, réponse d'aperçu.
- `src/web/components/ClubLineFields.tsx` (nouveau) — corps du formulaire combattant, sans `Modal` ni enregistrement, avec zones de décision ; `ClubLineForm.tsx` l'utilise.
- `src/web/components/ffk-import/` — `WeightClassesSection.tsx`, `ClubCards.tsx`, `FighterCards.tsx`, `FighterCard.tsx`, `OrphansSection.tsx`, `ImportBar.tsx` (barre + fenêtre de confirmation), `search.ts` (recherche insensible aux accents), `cardState.ts` (état de page : brouillons, ouverte, vues).
- `src/web/pages/FfkImportPage.tsx` — réécrite : dépôt du fichier, onglets et colonnes (inchangés), puis les sections.

---

### Task 1: Clubs — rapprochement, N° d'affiliation, « Ne pas relier »

**Files:**
- Create: `src/domain/ffk-plan/clubs.ts`
- Modify: `src/domain/ffk-import.ts` (retirer `linkClubs`/`ClubLink`, réexporter depuis `ffk-plan/clubs.ts` jusqu'à la Task 4), `src/server/repositories/ffk-import.ts` (`loadExisting` : affiliation du club ou de sa fiche d'annuaire)
- Test: `tests/domain/ffk-plan-clubs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ExistingClub { id: string; name: string; ffkEntity: string | null; affiliationNumber: string | null }
  export type ClubCertainty = 'sure' | 'doubtful' | 'new';
  export interface ClubLink {
    clubEntity: string; clubName: string; affiliationNumber: string | null; // chiffres en tête de l'entité
    proposal: { clubId: string; name: string; certainty: 'sure' | 'doubtful' } | null;
    target: string | null;           // club relié (choix ou proposition sûre), null = pas relié
    chosen: boolean;                 // décidé par l'organisateur (choix présent dans clubLinks)
    rows: number;                    // lignes de l'export de ce club
    warning?: string;
  }
  export function linkClubs(entities: { clubEntity: string; clubName: string; rows: number }[], clubs: ExistingClub[], aliases: Record<string, string>, choices: Record<string, string | 'none'> | undefined): ClubLink[]
  export const entityAffiliation: (clubEntity: string) => string | null
  ```
  `ExistingData.clubs` devient `ExistingClub[]` (le reste de `ExistingData` est complété à la Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
test('sûr : même entité, alias, même nom, ou même N° d’affiliation (club ou annuaire) → relié d’office', () => {
  const [l] = linkClubs([{ clubEntity: '0060690 ETOILE SPORTIVE VILLENEUVE LOUBET KARATE', clubName: 'ETOILE SPORTIVE VILLENEUVE LOUBET KARATE', rows: 14 }],
    [{ id: 'c1', name: 'ESVL Karaté', ffkEntity: null, affiliationNumber: '0060690' }], {}, undefined);
  expect(l).toMatchObject({ affiliationNumber: '0060690', proposal: { clubId: 'c1', certainty: 'sure' }, target: 'c1', chosen: false });
});
test('nom proche « à vérifier » : proposé, pas relié par défaut', () => {
  const [l] = linkClubs([{ clubEntity: '0060781 SAISHO DOJO', clubName: 'SAISHO DOJO', rows: 5 }], [{ id: 'c2', name: 'Saisho Dojo Nice', ffkEntity: null, affiliationNumber: null }], {}, undefined);
  expect(l).toMatchObject({ proposal: { clubId: 'c2', certainty: 'doubtful' }, target: null });
});
test('choix : un club relie, « none » délie même un lien sûr', () => {
  const ent = [{ clubEntity: '0060057 STADE LAURENTIN KARATE', clubName: 'STADE LAURENTIN KARATE', rows: 22 }];
  const clubs = [{ id: 'c3', name: 'Stade Laurentin Karaté', ffkEntity: '0060057 STADE LAURENTIN KARATE', affiliationNumber: null }, { id: 'c4', name: 'Autre', ffkEntity: null, affiliationNumber: null }];
  expect(linkClubs(ent, clubs, {}, { '0060057 STADE LAURENTIN KARATE': 'none' })[0]).toMatchObject({ target: null, chosen: true });
  expect(linkClubs(ent, clubs, {}, { '0060057 STADE LAURENTIN KARATE': 'c4' })[0]).toMatchObject({ target: 'c4', chosen: true });
});
test('club inconnu : ni proposition ni lien', () => {
  expect(linkClubs([{ clubEntity: '0310769 PYRENEES FIGHTING CLUB', clubName: 'PYRENEES FIGHTING CLUB', rows: 2 }], [], {}, undefined)[0]).toMatchObject({ proposal: null, target: null });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/domain/ffk-plan-clubs.test.ts` → FAIL (module introuvable).

- [ ] **Step 3: Implement** — reprendre `linkOne` de `ffk-import.ts` (entité, alias, nom exact = sûr ; nom contenu = à vérifier ; avertissement « même nom de club ») et ajouter l'affiliation : `entityAffiliation` = `/^(\d+)\s/` ; un club dont `affiliationNumber` (sans zéros perdus : comparer les chaînes telles quelles) égale celle de l'entité est sûr. `loadExisting` lit `clubs.affiliationNumber ?? club_directory.affiliationNumber` via `directoryClubId`.

- [ ] **Step 4: Run tests** — `npm run typecheck && npx vitest run tests/domain tests/server/ffk-import.test.ts` → PASS (l'ancien plan utilise encore `linkClubs` via la réexportation ; adapter ses appels si la signature change).

- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): clubs reliés aussi par N° d'affiliation, « Ne pas relier pour l'instant »"`

### Task 2: Cartes — regroupement, candidats, poids

**Files:**
- Create: `src/domain/ffk-plan/cards.ts`
- Test: `tests/domain/ffk-plan-cards.test.ts`

**Interfaces:**
- Consumes: `FfkRow` (`src/domain/ffk-import.ts`), `ClubLink` (Task 1), `normalizeLicence`, `ClubFormLine` (`src/domain/club-form.ts`).
- Produces:
  ```ts
  export interface ExistingFighter {        // ce que loadExisting fournit par combattant (Task 5)
    fighterId: string; clubId: string | null; licence: string | null; line: ClubFormLine; publicNameHidden: boolean;
    version: string; editable: boolean; partlyEditable: boolean; startedDisciplines: DisciplineId[];
    fromFfk: boolean;                       // a une inscription source 'ffk'
  }
  export interface FfkCardDraft {
    key: string;                            // `L:<licence>` sinon `N:<nameKey>|<sex>|<clubEntity>`
    rows: FfkRow[];                         // lignes de l'export (toutes disciplines)
    exportLine: ClubFormLine;               // nom, prénom, sexe, âge, poids (catégorie), disciplines, règlement, licence
    clubEntity: string | null; clubId: string | null; // club tel que relié (Task 1), null si pas relié
    weightIssue: string | null;             // « Poids « 70 » sans signe dans l’export. », « « +60 » n’existe pas pour les cadettes. », « « −20 » n’est pas dans la grille. »
    notes: string[];                        // erreurs non bloquantes de lecture, lignes en double
    candidates: { fighterId: string; reason: string }[];
    sure: string | null;                    // fighterId du rapprochement sûr (licence, ou nom exact unique dans le club relié)
  }
  export function buildCards(rows: FfkRow[], links: ClubLink[], fighters: ExistingFighter[], grid: CategoryGrid, acceptedWeightClasses: ReadonlySet<string>): { cards: FfkCardDraft[]; newWeightClasses: (WeightClass & { rows: number })[] }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('Karaté + Kata, même licence → une carte, deux disciplines ; doublon même discipline signalé', () => {
  const { cards } = buildCards([row({ licence: '11518201J', discipline: 'karate' }), row({ licence: '11518201J', discipline: 'kata' }), row({ licence: '11518201J', discipline: 'karate', line: 9 })], links, [], grid, new Set());
  expect(cards).toHaveLength(1);
  expect(cards[0]!.exportLine).toMatchObject({ combats: ['karate'], kata: true, licence: '11518201J' });
  expect(cards[0]!.notes.join(' ')).toMatch(/Ligne en double/);
});
test('sans licence : regroupées par nom + sexe + club', () => {
  expect(buildCards([row({ licence: null, discipline: 'karate' }), row({ licence: null, discipline: 'kata' })], links, [], grid, new Set()).cards).toHaveLength(1);
});
test('candidats : licence = sûr ; nom exact dans le club relié = sûr ; nom proche, même nom autre club, même nom autre licence = candidats sans sûr', () => { /* une assertion par cas, raisons exactes de l'import actuel : « même nom de famille, prénom différent », « nom très proche », « même nom, autre club », « même nom, club non renseigné », « même nom, autre licence » */ });
test('poids hors grille : catégorie nouvelle non acceptée → weightClassId null + weightIssue ; acceptée → id `${age}:${sex}:${label}`', () => {
  const r = row({ ageBandCode: 'poussin', sex: 'M', weightLabel: '-20' });
  expect(buildCards([r], links, [], grid, new Set()).cards[0]).toMatchObject({ exportLine: { weightClassId: null }, weightIssue: '« −20 » n’est pas dans la grille.' });
  expect(buildCards([r], links, [], grid, new Set(['poussin:M:-20'])).cards[0]!.exportLine.weightClassId).toBe('poussin:M:-20');
  expect(buildCards([r], links, [], grid, new Set()).newWeightClasses[0]).toMatchObject({ id: 'poussin:M:-20', rows: 1 });
});
test('poids illisible (« 70 », « +60 » inconnu) : la ligne devient une carte avec weightIssue, plus une erreur', () => { /* row.errors portant le message de poids → carte, weightIssue = ce message */ });
```

(`row(...)` : fabrique d'`FfkRow` à écrire en tête du fichier de test ; `links` : un `ClubLink` relié à `c1`.)

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/domain/ffk-plan-cards.test.ts` → FAIL.

- [ ] **Step 3: Implement** — reprendre la logique de candidats de `planFfkImport` (`sameSex`, `claimedBy`, levenshtein ≤ 2, raisons) dans `buildCards`. `parseFfkRows` doit renvoyer les lignes à poids illisible avec `weightLabel: null` et le message dans `row.weightIssue` (nouveau champ facultatif d'`FfkRow`) au lieu de `errors` ; les autres erreurs (nom, sexe, âge, discipline manquants) restent bloquantes : une telle ligne donne une carte avec `notes` et `exportLine` incomplet (champ manquant à remplir dans la carte). Règlement vide : `ruleset` de la ligne à `null` (la fiche décide, Task 3).

- [ ] **Step 4: Run tests** — `npx vitest run tests/domain` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): une carte par combattant de l'export, candidats et poids"`

### Task 3: Valeurs d'une carte — écarts, départ, manquants, état

**Files:**
- Create: `src/domain/ffk-plan/values.ts`
- Modify: `src/domain/club-form-plan.ts` (`ImportField` + `'lastName' | 'firstName' | 'sex'`, `fieldValue`/`fieldPatch` ; `clubFormDiffs` ne les compte pas), `src/web/components/ClubLineForm.tsx` + `src/web/components/club-line/ffkStep.ts` (libellés des nouveaux champs : « Nom », « Prénom », « Sexe »)
- Test: `tests/domain/ffk-plan-values.test.ts`

**Interfaces:**
- Consumes: `FfkCardDraft`, `ExistingFighter` (Task 2).
- Produces:
  ```ts
  export interface FfkCardValue { line: ClubFormLine; clubId: string | null; publicNameHidden: boolean }
  export type FfkField = ImportField | 'clubId';
  export interface FfkCardDiff { field: FfkField; ffk: string; fiche: string }
  export function ffkCardDiffs(card: FfkCardDraft, saved: ExistingFighter | null): FfkCardDiff[]
  export function initialValue(card: FfkCardDraft, saved: ExistingFighter | null): FfkCardValue
  export function missingFields(value: FfkCardValue): string[]   // libellés : « Nom », « Prénom », « Sexe », « Catégorie d’âge », « Catégorie de poids », « Disciplines », « Règlement », « Club »
  export function cardChanges(saved: ExistingFighter | null, value: FfkCardValue, labels: ChangeLabels): string[] // « Catégorie d’âge : Pupilles → Benjamins »
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('aucun écart : valeur = fiche, licence FFK complète une fiche vide', () => {
  const v = initialValue(card({ licence: '11462640R' }), saved({ licence: null }));
  expect(ffkCardDiffs(card({ licence: '11462640R' }), saved({ licence: null }))).toEqual([]);
  expect(v.line.licence).toBe('11462640R');
});
test('écarts âge et poids : ces champs démarrent vides (rien d’office)', () => {
  const c = card({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-35' });
  const s = saved({ ageBandCode: 'pupille', weightClassId: 'pupille:F:-30' });
  expect(ffkCardDiffs(c, s).map((d) => d.field)).toEqual(['ageBandCode', 'weightClassId']);
  expect(initialValue(c, s).line).toMatchObject({ ageBandCode: null, weightClassId: null });
  expect(missingFields(initialValue(c, s))).toEqual(['Catégorie d’âge', 'Catégorie de poids']);
});
test('nom, sexe, club et licence qui diffèrent sont des écarts ; discipline de la fiche absente de l’export = écart « disciplines »', () => { /* MARTINI vs MARTINNI → lastName ; clubId c1 vs c2 → clubId ; licences 2 non vides différentes → licence ; fiche karate+boxing, export karate → disciplines */ });
test('export sans règlement : celui de la fiche ; nouveau combattant sans règlement : jiyu', () => {
  expect(initialValue(card({ ruleset: null }), saved({ ruleset: 'shobu' })).line.ruleset).toBe('shobu');
  expect(initialValue(card({ ruleset: null }), null).line.ruleset).toBe('jiyu');
});
test('poids à problème : champ vide même pour un nouveau combattant', () => {
  expect(initialValue(card({ weightClassId: null, weightIssue: '« +60 » n’existe pas pour les cadettes.' }), null).line.weightClassId).toBeNull();
});
test('cardChanges : libellés lisibles', () => {
  expect(cardChanges(saved({ ageBandCode: 'pupille' }), { ...value, line: { ...value.line, ageBandCode: 'benjamin' } }, labels)).toContain('Catégorie d’âge : Pupilles → Benjamins');
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/domain/ffk-plan-values.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `ffkCardDiffs` = `clubFormDiffs(card.exportLine, saved.line)` (règles existantes : export vide = pas d'écart ; licence seulement si les deux remplies) + nom / prénom / sexe comparés par `normalizeName` + `clubId` (les deux non nuls et différents). `initialValue` : nouveau combattant = `exportLine` (+ `clubId` du lien, règlement `jiyu` si combat sans règlement, `publicNameHidden: false`) ; existant = `saved.line` complétée par les champs vides de la fiche que l'export remplit, puis chaque champ en écart vidé (`fieldPatch(field, null)` ; disciplines vidées = `combats: [], kata: false` ; `clubId: null`) ; poids à problème vidé.

- [ ] **Step 4: Run tests** — `npm run typecheck && npx vitest run tests/domain tests/web` → PASS (l'Import Fiche Club inchangé : nom / prénom / sexe ne sont pas comparés par `clubFormDiffs`).

- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): écarts carte / fiche, valeur de départ sans rien d'office"`

### Task 4: Plan complet — états, orphelins, récapitulatif, empreinte

**Files:**
- Create: `src/domain/ffk-plan/plan.ts`
- Modify: `src/domain/ffk-import.ts` (retirer `planFfkImport`, `FfkChoices`, `PlanItem`, `FfkImportPlan`, `planFingerprint` ; garder la lecture), tous leurs importeurs (grep)
- Test: `tests/domain/ffk-plan.test.ts` (réécrit : les anciens cas utiles portés sur `planFfkCards`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  ```ts
  export type FfkCardChoice = { kind: 'none' } | { kind: 'skip' } | { kind: 'validated'; fighterId: string | 'new'; value: FfkCardValue };
  export interface FfkChoices {
    acceptedWeightClasses?: string[];
    clubLinks?: Record<string, string | 'none'>;           // entité FFK → clubId | 'none'
    cards?: Record<string, FfkCardChoice>;                  // FfkCardDraft.key → choix
    orphans?: Record<string, 'keep' | 'delete'>;            // fighterId → action (défaut 'keep')
  }
  export type FfkCardState = 'todo' | 'auto' | 'done' | 'skip';
  export interface FfkCard extends FfkCardDraft {
    state: FfkCardState;
    fighterId: string | 'new' | null;                       // combattant retenu (choix validé, ou défaut sûr), null = pas lié
    value: FfkCardValue | null;                             // valeur importée si state ∈ auto|done
    diffs: FfkCardDiff[];                                   // contre le combattant retenu (ou le sûr)
    missing: string[]; changes: string[]; reason: string | null; // reason si todo : « combattant pas choisi », « reste à remplir … », « club pas relié »
  }
  export interface FfkOrphan { fighterId: string; label: string; clubName: string; disciplines: string; fromFfk: boolean; action: 'keep' | 'delete' }
  export interface FfkCardsPlan {
    weightClasses: (WeightClass & { rows: number; accepted: boolean })[];
    clubs: ClubLink[]; cards: FfkCard[]; orphans: FfkOrphan[];
    summary: { todo: number; auto: number; done: number; skip: number; clubsTodo: number; creates: number; updates: number; deletes: number };
  }
  export function planFfkCards(rows: FfkRow[], grid: CategoryGrid, existing: ExistingData, choices?: FfkChoices): FfkCardsPlan
  export function planFingerprint(plan: FfkCardsPlan): string
  ```
  `ExistingData = { clubs: ExistingClub[]; fighters: ExistingFighter[]; aliases: Record<string, string> }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('défaut : sûr sans écart = auto ; sûr avec écart = todo (fighterId null) ; sans candidat = auto « new »', () => { /* trois cartes, états attendus */ });
test('choix validé : done, value et changes du choix ; un fighterId choisi sans écart reste done', () => {});
test('none et skip : todo / skip, rien importé', () => {});
test('catégorie acceptée : la carte au poids -20 passe de todo à auto', () => {});
test('club « none » : un nouveau combattant de ce club est todo « club pas relié » ; un existant sûr par licence reste auto (garde son club)', () => {});
test('orphelins : combattants sans carte ; candidats d’une carte todo exclus ; fromFfk pour une inscription ffk ; action par défaut keep', () => {});
test('summary compte creates / updates / deletes / clubsTodo', () => {});
test('empreinte stable pour le même plan, différente si une fiche change de version', () => {});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/domain/ffk-plan.test.ts` → FAIL.

- [ ] **Step 3: Implement** — état par carte : `skip` si choix skip ; `done` si choix validé (vérifier que `fighterId` existe encore, sinon todo « combattant introuvable ») ; sinon défaut : `fighterId = sure ?? (aucun candidat et club relié ? 'new' : null)`, `auto` si `fighterId` et ni écart ni manquant ni `weightIssue` non résolu, sinon `todo` avec `fighterId: null`. Empreinte : hash des clés, états, valeurs et versions des combattants retenus et des orphelins supprimés. Adapter les appelants serveur/web au minimum pour compiler (la route et la page sont refaites aux Tasks 6 et 8–9 ; la page peut être temporairement réduite à l'aperçu brut si nécessaire, sans casser le build).

- [ ] **Step 4: Run tests** — `npm run typecheck && npx vitest run` → PASS (les anciens tests de `planFfkImport` sont réécrits ou supprimés avec cette tâche ; les e2e `import-ffk.spec.ts` sont remis à la Task 10).

- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): plan par cartes, états, orphelins et récapitulatif"`

### Task 5: Cœur d'écriture d'une ligne, dans une transaction donnée

**Files:**
- Modify: `src/server/repositories/club-entry.ts` (`saveClubLine` ~l.282-370)
- Test: `tests/server/club-entry.test.ts`, `tests/server/club-lines-organiser.test.ts` (inchangés, doivent rester verts) + un test du cœur

**Interfaces:**
- Produces:
  ```ts
  export function writeClubLineInTx(t: AppDb, competitionId: string, args: {
    fighterId: string | null; line: ClubFormLine; clubId: string; expectedVersion: string | null;
    writer: LineWriter; publicNameHidden?: boolean; source?: RegistrationSource; licence?: string | null;
  }): string   // id du combattant ; lève RegistrationValidationError / StaleLineError comme saveClubLine
  ```
  `saveClubLine` garde sa signature et appelle `writeClubLineInTx` dans sa transaction.

- [ ] **Step 1: Write the failing test** — `test('writeClubLineInTx : deux lignes dans une même transaction, la seconde invalide annule tout')` (deux appels dans `db.transaction`, le second lève → aucun combattant créé).
- [ ] **Step 2: Run** — FAIL (fonction absente).
- [ ] **Step 3: Implement** — déplacer validation (`lineToRows`, catégories fermées pour le coach, plusieurs combats), fusion des combats commencés (`startedMerge`) et écriture dans `writeClubLineInTx` ; les lectures (`getCompetition`, `getGrid`) se font de façon synchrone dans le cœur (variantes `…Sync` existantes, sinon passer `competition` et `grid` en arguments). `source: 'ffk'` pour les inscriptions créées par l'import.
- [ ] **Step 4: Run** — `npm run typecheck && npx vitest run tests/server` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(club-entry): cœur d'écriture d'une ligne réutilisable dans une transaction"`

### Task 6: Serveur — aperçu et import partiel

**Files:**
- Modify: `src/server/repositories/ffk-import.ts` (`loadExisting`, `buildFfkPlan`, `applyFfkPlan` → `applyFfkCards`), `src/server/routes/ffk-import.ts` (schéma `choices`, réponse)
- Test: `tests/server/ffk-import.test.ts` (réécrit), `tests/server/ffk-import-routes.test.ts` si présent

**Interfaces:**
- Consumes: `planFfkCards`, `FfkChoices`, `planFingerprint` (Task 4), `writeClubLineInTx` (Task 5).
- Produces: `POST …/ffk-imports/:uploadId/preview` → `FfkCardsPlan & { fingerprint: string; fighters: { fighterId: string; label: string; clubName: string; ageLabel: string; disciplines: string; line: ClubFormLine; clubId: string | null; publicNameHidden: boolean }[] }` ; `POST …/commit` (même corps + `fingerprint`) → `{ created: number; updated: number; deleted: number; weightClassesCreated: number; leftAside: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('import sans aucun choix : seules les cartes auto sont écrites ; les todo ne touchent pas leurs inscriptions', async () => {});
test('carte validée : valeurs de la carte écrites (âge, poids, licence, club), inscriptions de l’export ffkConfirmed, source ffk pour les nouvelles', async () => {});
test('inscription recasée : la carte validée écrit les valeurs d’origine, le placement validé reste', async () => {});
test('combats commencés : la carte validée garde ce qui a commencé', async () => {});
test('catégorie acceptée créée ; non acceptée jamais créée', async () => {});
test('lien choisi mémorisé (ffkEntity + alias) ; « none » ne mémorise rien', async () => {});
test('orphelin « delete » supprimé (et le combattant sans inscription) ; « keep » gardé, ffkConfirmed false', async () => {});
test('réimport du même fichier après import partiel : seules les cartes non tranchées restent todo', async () => {});
test('fiche modifiée entre aperçu et import : 409 « Les inscriptions ont changé depuis l’aperçu : relancez l’aperçu avant d’importer. », rien écrit', async () => {});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — `loadExisting` : clubs (Task 1), alias, et pour chaque combattant `lineOf(db, fighter, 'organiser')` → `ExistingFighter` (+ `fromFfk`). `applyFfkCards` en une transaction : catégories acceptées (code actuel des catégories), liens (code actuel de mémorisation, pour `target` choisi ou sûr), cartes `auto`/`done` via `writeClubLineInTx` (fighterId `new` → `null`, `source: 'ffk'`, `licence` de la valeur) puis `ffkConfirmed = true` sur les inscriptions de ses disciplines de l'export, orphelins `delete` supprimés et `keep` passés `ffkConfirmed = false`, correspondances de colonnes. Une `RegistrationValidationError` sur une carte annule tout et remonte (400) avec le nom du combattant en tête du message.
- [ ] **Step 4: Run** — `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): aperçu par cartes et import partiel côté serveur"`

### Task 7: Formulaire combattant en ligne, avec zones de décision

**Files:**
- Create: `src/web/components/ClubLineFields.tsx`
- Modify: `src/web/components/ClubLineForm.tsx` (utilise `ClubLineFields` dans sa `Modal`), `src/web/components/club-line/FfkChoice.tsx` (pointillés en attente)
- Test: e2e existants des fenêtres (`inscriptions.spec.ts`, `inscription-en-ligne.spec.ts`, `import-ods-club.spec.ts`, `import-pdf-ffk.spec.ts`) inchangés et verts ; `tests/web/line-form.test.ts`

**Interfaces:**
- Produces:
  ```tsx
  export function ClubLineFields(props: {
    value: FfkCardValue;                          // ligne + club + nom masqué
    onChange: (v: FfkCardValue) => void;
    ctx: LineFormContext;                         // existant (lineForm.ts)
    diffs: { field: FfkField; ffk: string; fiche: string }[];
    clubs?: { value: string; label: string }[];   // si fourni : champ « Club » (carte d’import)
    showLicenceHint: boolean;                     // « Laissée vide, la licence déjà enregistrée est gardée. »
    weightIssue?: string | null;
    disabled?: { locked: boolean; partly: boolean; started: DisciplineId[] };
  }): JSX.Element
  export function pendingDecisions(diffs: FfkCardDiff[], value: FfkCardValue, weightIssue?: string | null): number
  ```
  Zone d'un champ : `data-zone="decide"` (écart et champ vide) ou `"decided"` (écart et champ rempli) ; étiquette « À choisir » / « Choisi » ; bandeau `N choix à faire : les champs encadrés en orange. Cliquez sur FFK ou Fiche club, ou saisissez une autre valeur.` quand N > 0.

- [ ] **Step 1: Write the failing test** — `tests/web/line-form.test.ts` : `pendingDecisions` (2 écarts dont un rempli → 1 ; poids à problème vide → +1).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — déplacer le corps de `ClubLineForm` (champs, choix FFK, reclassement) dans `ClubLineFields` sans changer son rendu dans la fenêtre ; `ClubLineForm` garde `Modal`, pied, enregistrement, suppression. Champ « Club » (`Select` cherchable sur `clubs`) seulement si `clubs` est fourni. Styles des zones : bordure `var(--mantine-color-orange-6)` / fond `var(--mantine-color-orange-light)` pour `decide`, bordure `var(--mantine-color-blue-6)` pour `decided`.
- [ ] **Step 4: Run** — `npm run typecheck && npx vitest run tests/web && npx playwright test tests/e2e/inscriptions.spec.ts tests/e2e/inscription-en-ligne.spec.ts tests/e2e/import-ods-club.spec.ts tests/e2e/import-pdf-ffk.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(combattant): corps du formulaire réutilisable en ligne, zones de décision"`

### Task 8: Page — catégories, clubs, fiches sans inscription FFK

**Files:**
- Create: `src/web/components/ffk-import/WeightClassesSection.tsx`, `ClubCards.tsx`, `OrphansSection.tsx`, `search.ts`
- Modify: `src/web/pages/FfkImportPage.tsx`, `src/web/api.ts` (types de l'aperçu, `useCreateCompetitionClub` réutilisé)
- Test: `tests/web/ffk-import-search.test.ts` ; e2e à la Task 10

**Interfaces:**
- Consumes: aperçu (Task 6), `ClubEntryModal` (`initial`), `useCreateCompetitionClub`.
- Produces: `searchByName<T>(items: T[], query: string, name: (t: T) => string, limit = 6): T[]` (dès 2 lettres, `normalizeName`, contient) ; l'état de page `choices` (catégories, liens, orphelins) envoyé à l'aperçu à chaque changement.

- [ ] **Step 1: Write the failing test** — `searchByName` : « nava » trouve « NAVARO Tess », « é » ignoré (« lea » trouve « Léa »), 1 lettre → `[]`, 6 résultats au plus.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — ordre de la page : dépôt, onglets et colonnes (inchangés), résumé collé en haut, 1 catégories (cases décochées par défaut, « N combattants · sera créée / pas créée »), 2 clubs (une carte par club ; sûr replié « Relié d'office » + « Modifier » / « Replier » ; options « Relier à … » (proposition), « Ne pas relier pour l'instant », recherche, « ➕ Créer un club… » → `ClubEntryModal` `initial={{ name: clubName, affiliationNumber }}`, à l'enregistrement `clubLinks[entité] = nouveau club`), 4 fiches sans inscription FFK (« Garder » / « Rapprocher… » / « Supprimer » ; « présent dans l'export précédent » si `fromFfk` ; « Rapprocher… » cherche parmi les cartes et ouvre la carte choisie avec ce combattant, Task 9).
- [ ] **Step 4: Run** — `npm run typecheck && npx vitest run tests/web` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): page — catégories, cartes de clubs, fiches sans inscription FFK"`

### Task 9: Page — cartes des combattants, barre d'import, confirmation

**Files:**
- Create: `src/web/components/ffk-import/FighterCards.tsx`, `FighterCard.tsx`, `ImportBar.tsx`, `cardState.ts`
- Modify: `src/web/pages/FfkImportPage.tsx`, `src/web/help.ts` (rubriques `import-ffk`, `import-ffk.clubs`, nouvelles `import-ffk.categories`, `import-ffk.cartes`, `import-ffk.sans-ffk`)
- Test: `tests/web/ffk-card-state.test.ts`

**Interfaces:**
- Consumes: `FfkCard`, `FfkCardsPlan` (aperçu), `ClubLineFields`, `pendingDecisions` (Task 7), `ffkCardDiffs`, `initialValue`, `missingFields` (Task 3, partagés avec la page), `searchByName` (Task 8).
- Produces (`cardState.ts`) :
  ```ts
  export interface CardDraft { fighterId: string | 'new' | null; value: FfkCardValue; dirty: boolean }
  export type PageCardState = 'todo' | 'pending' | 'done' | 'auto' | 'skip';   // pending = « À valider »
  export function pageState(card: FfkCard, draft: CardDraft | undefined, choice: FfkCardChoice | undefined): PageCardState
  export function nextToSettle(cards: FfkCard[], after: string, states: Record<string, PageCardState>): string | null
  ```

- [ ] **Step 1: Write the failing tests** — `pageState` : brouillon modifié non validé → `pending` ; choix validé → `done` ; `nextToSettle` saute les `auto`/`done`/`skip`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — filtres « À trancher » (défaut), « Validées », « Sans problème », « Tout » ; les cartes vues dans « À trancher » y restent après validation ; confirmées sans changement repliées en une ligne. Carte : en-tête (nom, disciplines, âge · sexe · poids, club relié ou « (pas relié) », onglets et lignes) ; options « C'est … (raison) » par candidat, « ➕ Nouveau combattant », « Ne pas lier pour l'instant » (choisi par défaut sur une carte todo), recherche parmi `fighters` de l'aperçu ; cliquer l'option choisie ouvre / replie la carte ; carte ouverte = `ClubLineFields` (valeur de départ `initialValue`, écarts `ffkCardDiffs`, `clubs` de la compétition, `showLicenceHint` si la fiche a une licence) ; pied « Écarter cette ligne », « Annuler mes modifications », « Fermer », « Valider la carte » (grisé avec « Reste à remplir : … ») ; valider → `choices.cards[key] = { kind: 'validated', … }`, repli en « Liée à X · <changements> » + « Modifier », carte suivante ouverte et défilée. Barre collée : message des points laissés de côté + « Importer… » → fenêtre « Confirmer l'import FFK » (rubriques du spec §5, depuis l'aperçu) → commit ; 409 → message et nouvel aperçu ; succès → notification « Import FFK : … ».
- [ ] **Step 4: Run** — `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(import-ffk): cartes des combattants, validation, barre d'import et récapitulatif"`

### Task 10: Parcours complet, vérifications et documents

**Files:**
- Modify: `tests/e2e/import-ffk.spec.ts` (réécrit), `tests/helpers/ffk-fixture.ts` (en-tête 2026-2027 : Prénom, Nom, …, Technique, règlement dans l'âge), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1: e2e** — `import ffk : relier un club, créer un club, valider une carte avec écarts, écarter une ligne, importer avec des points non tranchés, réimporter : seuls les non tranchés restent` ; `import ffk : catégorie cochée puis décochée` ; `import ffk : fiche sans inscription FFK supprimée` ; `import ffk : 360 px sans débordement`.
- [ ] **Step 2: Run** — `npm run typecheck && npx vitest run && npx playwright test` → tout passe (noter les nombres).
- [ ] **Step 3: Vérifier à l'écran** — Chrome, copie de démonstration (port 3200 : `PORT=3200 DATABASE_PATH=<copie d'une sauvegarde> WEB_DIST_DIR=dist/web npx tsx src/server/main.ts`) avec l'export réel `Shidokan.xlsm` : toutes les sections, une carte de chaque sorte (poids « 70 », cadette « +60 », MARTINI/MARTINNI, club ESVL relié puis délié), fenêtre de confirmation, import, réimport ; aucune erreur console. Simulateur iPhone (idb, `http://127.0.0.1:3200`) : une carte ouverte à largeur de téléphone.
- [ ] **Step 4: Documents** — « Étape 51 » dans la feuille de route ; section étape 51 dans le bilan (décisions, contrôles, « Vérifié » avec les chiffres réels).
- [ ] **Step 5: Commit** — `git commit -m "test(import-ffk): parcours complet ; bilan de l'étape 51"`
