# Étape 41 — Mêmes fenêtres pour les clubs et les combattants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un seul choix du club, une seule fenêtre « Ajouter un club » (annuaire) et une seule fenêtre de combattant (celle du coach) pour la page du coach, Inscriptions, la saisie d'une fiche papier et l'import .ods ; plusieurs combats par combattant quand le réglage le permet ; une compétition s'ouvre sur Inscriptions.

**Architecture:** La ligne d'un combattant (`ClubFormLine`) porte une liste de combats. Le serveur n'a qu'une écriture de ligne (`saveClubLine`), appelée par la route du coach et par de nouvelles routes organisateur sous `/api/competitions/:id/clubs/:clubId/lines`, avec un mode (`coach` | `organiser`) qui règle la source, les catégories fermées et l'écriture. Côté web, `ClubLineForm` reçoit ses opérations et son mode en props ; un `ClubPicker` et une `ClubEntryModal` partagés servent partout où l'on choisit un club.

**Tech Stack:** TypeScript 7 (natif), React + Mantine, TanStack Query, Fastify + zod, SQLite/drizzle, vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-11-09-memes-fenetres-clubs-combattants-design.md`

## Global Constraints

- Textes de l'interface en français, apostrophe typographique ’ dans les nouveaux textes.
- Aucune migration de base : le modèle de données ne change pas (`fighters.public_name_hidden`, `clubs.pre_approval`, `registrations.source`, `club_changes` existent).
- Réglage existant : `settings.multipleCombatDisciplinesPerDay` (« Autoriser plusieurs disciplines de combat le même jour »). Désactivé : un seul combat par combattant, sauf ceux déjà enregistrés, qu'on ne peut que réduire.
- Une inscription créée depuis Inscriptions a `source = 'onsite'` ; une modification garde la source des inscriptions existantes ; une nouvelle inscription créée en modifiant est `'onsite'` côté organisateur, `'online'` côté coach.
- L'import FFK ne change pas.
- Table centrale : mêmes droits qu'aujourd'hui sur Inscriptions (nouvelles routes ajoutées à `TABLE_WRITES` dans `src/server/auth/permissions.ts`) ; saisie de fiche papier et import .ods restent à l'organisateur.
- e2e : ne jamais lancer deux `npx playwright test` en même temps ; un nouveau nom de compétition e2e ne doit pas contenir ni être contenu dans un autre (`createCompetition` cherche par sous-chaîne).
- Chaque changement visible est vérifié sur Chrome (Claude in Chrome) ; les écrans du coach et la page publique aussi sur le simulateur iPhone (idb).

## Review Focus

1. Combattant dont un tableau a commencé : la fenêtre s'ouvre en lecture seule avec « Ses combats ont commencé… », pour l'organisateur aussi (Inscriptions ne doit pas offrir de contournement) → test Task 2.
2. Inscription réaffectée modifiée depuis Inscriptions : seule la catégorie déclarée (`originalJson`) change, le placement reste → test Task 2.
3. Fenêtre ouverte sur un combattant modifié entre-temps sur un autre poste : refus 409 « périmé », la fenêtre se ferme et la liste se recharge, rien n'est écrasé → test Task 2 (serveur) et Task 6 (e2e).
4. Club de l'annuaire choisi puis saisie abandonnée (fiche papier, import .ods, étape club d'Inscriptions avant « Suivant ») : le club n'entre pas dans la compétition → tests Task 6, 7, 8.
5. Import .ods aux cases coach/téléphone/e-mails vides pour un club connu : rien n'est effacé, aucun changement à examiner n'est créé → test Task 8.

---

### Task 1: Ligne de combattant à plusieurs combats (domaine)

**Files:**
- Modify: `src/domain/club-form.ts` (types, `tidyReclass`, `weightWarning`, `lineToRows`, `cellsToLine`, `parseClubForm`, `parseClubFormLines`, `checkRows`)
- Modify: `src/domain/club-line.ts` (`registrationsToLine`, retirer `TWO_COMBATS_REASON`)
- Modify (mécanique, pour compiler, comportement inchangé) : `src/server/routes/registrations.ts` (`clubFormLineSchema`), `src/web/components/ClubLineForm.tsx`, `src/web/components/PaperEntryTable.tsx`, `src/web/components/club-entry/groups.ts`, `src/server/club-form-template.ts`, `src/server/club-form-pdf.ts` si besoin
- Test: `tests/domain/club-form.test.ts`, `tests/domain/club-line.test.ts`, mise à jour de `tests/web/club-line-groups.test.ts`, `tests/server/club-entry.test.ts`, `tests/server/registrations-api.test.ts`, `tests/server/replacement.test.ts`, `tests/e2e/inscription-en-ligne.spec.ts`

**Interfaces:**
- Produces:
  - `export interface LineCombat { discipline: CombatDiscipline; ruleset: Ruleset | null }`
  - `ClubFormLine` : `combat` et `ruleset` remplacés par `combats: LineCombat[]` (ordre = ordre de saisie ; disciplines distinctes). Le reste ne change pas (`weightClassId` commun à tous les combats, `prefs`, `shobuKeep`).
  - `export interface LineOptions { multipleCombats?: boolean }` (défaut `false`)
  - `lineToRows(line, lineNumber, grid, tolerance, closed = new Set(), opts: LineOptions = {}): ClubFormRow[]` — une ligne d'inscription par combat (dans l'ordre), puis le kata.
  - `parseClubForm(cells, grid, tolerance?, closed?, opts: LineOptions = {})`, `parseClubFormLines(header, lines, grid, tolerance, closed?, opts: LineOptions = {})`
  - `export const ONE_COMBAT_ONLY = 'Une seule discipline de combat par combattant à cette compétition.'`
  - `tidyReclass` retire des `prefs` **toutes** les disciplines de `combats` ; `shobuKeep` gardé si au moins un combat est en shobu et qu'il reste un choix.
  - `weightWarning(line: Pick<ClubFormLine, 'ageBandCode' | 'sex' | 'weightClassId' | 'weightKg' | 'combats'>, …)` : rien si `combats` est vide.

- [ ] **Step 1: Write the failing tests** (`tests/domain/club-form.test.ts`, nouveau `describe('plusieurs combats')`)

```ts
const two: ClubFormLine = { ...base, combats: [{ discipline: 'karate', ruleset: 'shobu' }, { discipline: 'shido-boxing', ruleset: 'jiyu' }], kata: true, prefs: { 'shido-mix': 1, karate: 2 }, shobuKeep: 'discipline' };
test('deux combats et le kata donnent trois inscriptions, dans l’ordre', () => {
  const rows = lineToRows(two, 1, grid, tol, new Set(), { multipleCombats: true });
  expect(rows.map((r) => [r.input?.discipline, r.input?.ruleset])).toEqual([['karate', 'shobu'], ['shido-boxing', 'jiyu'], ['kata', null]]);
  // Reclassement commun, sans ses propres combats ; priorité shobu seulement sur le combat en shobu.
  expect(rows[0]!.input!.otherDisciplines).toEqual(['shido-mix']);
  expect(rows[1]!.input!.otherDisciplines).toEqual(['shido-mix']);
  expect(rows[0]!.input!.acceptsJiyuFirst).toBe(true);
  expect(rows[1]!.input!.acceptsJiyuFirst).toBeNull();
});
test('réglage désactivé : deux combats refusés', () => {
  const rows = lineToRows(two, 1, grid, tol);
  expect(rows[0]!.input).toBeNull();
  expect(rows[0]!.errors).toContain(ONE_COMBAT_ONLY);
});
test('règlement manquant sur un des combats', () => {
  const rows = lineToRows({ ...two, combats: [two.combats[0]!, { discipline: 'shido-boxing', ruleset: null }] }, 1, grid, tol, new Set(), { multipleCombats: true });
  expect(rows[1]!.errors).toContain('Règlement manquant (Jiyu ou Shobu).');
});
test('tidyReclass retire tous ses combats des choix', () => {
  expect(tidyReclass(two).prefs).toEqual({ 'shido-mix': 1 });
});
```

`tests/domain/club-line.test.ts` : un combattant avec deux inscriptions de combat (karaté shobu réaffecté depuis boxing jiyu via `originalJson`, mix jiyu) donne `combats` = valeurs déclarées dans l'ordre d'inscription, `editable: true`, `reason: null` ; `prefs` lues sur le premier combat ; `shobuKeep` lu sur le premier combat en shobu.

- [ ] **Step 2: Run** `npx vitest run tests/domain/club-form.test.ts tests/domain/club-line.test.ts` — Expected: FAIL (types et comportement).
- [ ] **Step 3: Implement** le nouveau type et les fonctions ci-dessus. `cellsToLine` lit encore une seule colonne de combat (la 2e colonne arrive en Task 3) et produit `combats: combat ? [{ discipline: combat, ruleset }] : []`. `checkRows` : l'avertissement « inscrit dans deux disciplines de combat » n'est émis que si le réglage est désactivé (passer `opts` jusqu'à lui) ; il couvre toujours deux **lignes** différentes du même combattant. Mettre à jour les appels (`clubFormLineSchema` : `combats: z.array(z.object({ discipline: z.enum([...]), ruleset: z.enum(['jiyu','shobu']).nullable() })).max(4)` ; les composants web gardent pour l'instant un seul choix : `OneOf` lit `combats[0]?.discipline` et écrit `[{ discipline, ruleset }]`). Les serveurs passent `{ multipleCombats: competition.settings.multipleCombatDisciplinesPerDay }` à `parseClubForm` / `parseClubFormLines` / `lineToRows`.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: tout passe (tests existants adaptés au nouveau champ, sans changement de comportement à un combat).
- [ ] **Step 5: Commit** `feat(fiche-club): une ligne de combattant porte une liste de combats`

---

### Task 2: Une seule écriture de ligne, pour le coach et l'organisateur (serveur)

**Files:**
- Modify: `src/server/repositories/club-entry.ts` (`saveClubLine`, `deleteClubLine`, `lineOf`, `ClubLine`, `getClubEntry`)
- Modify: `src/server/routes/club-entry.ts`, `src/server/app.ts` (enregistre les nouvelles routes)
- Create: `src/server/routes/club-lines.ts` (routes organisateur)
- Modify: `src/server/auth/permissions.ts`
- Test: `tests/server/club-entry.test.ts`, nouveau `tests/server/club-lines-organiser.test.ts`, `tests/server/permissions.test.ts`

**Interfaces:**
- Consumes: Task 1 (`LineOptions`, `combats`).
- Produces:
  - `export type LineWriter = { kind: 'coach' } | { kind: 'organiser' }`
  - `ClubLine` gagne `clubId: string` et `publicNameHidden: boolean`.
  - `ClubEntryView` gagne `multipleCombats: boolean`.
  - `saveClubLine(db, access: ClubAccess, fighterId: string | null, line: ClubFormLine, expectedVersion: string | null, opts: { writer: LineWriter; publicNameHidden?: boolean }): Promise<ClubLine>`
  - `deleteClubLine(db, access, fighterId, expectedVersion, opts: { writer: LineWriter })`
  - `export function fighterLine(db, competitionId: string, fighterId: string): ClubLine` (ligne d'un combattant pour Inscriptions ; 404 si inconnu ; un combattant sans club : `clubId` = `''` et `editable: false`, `reason: null` — l'écran passe d'abord par l'étape club).
  - Routes organisateur (préfixe `/api/competitions/:id`) :
    - `GET /fighters/:fighterId/line` → `ClubLine`
    - `POST /clubs/:clubId/lines` body `{ line, publicNameHidden }` → 201 `ClubLine`
    - `PUT /clubs/:clubId/lines/:fighterId` body `{ line, version, publicNameHidden }` → `ClubLine` ; si `:clubId` n'est pas le club actuel du combattant, il change de club (doublon de nom contrôlé dans le club d'arrivée)
    - `DELETE /clubs/:clubId/lines/:fighterId?version=` → 204
  - Route du coach : body de POST/PUT gagne `publicNameHidden` (booléen, facultatif ; absent = inchangé).

Règles par auteur :

| | coach | organisateur |
|---|---|---|
| inscriptions en ligne fermées / main ailleurs | refus (`ClubEntryClosedError`) | pas de contrôle `clubEntryStatus` (le garde « main ailleurs » existant s'applique) |
| source d'une **nouvelle** inscription | `'online'` | `'onsite'` |
| source d'une inscription existante | inchangée (aujourd'hui `upsertFighterRegistration` reçoit `'online'` : à corriger pour garder la source existante) | inchangée |
| catégorie fermée | refus `CLOSED_ENTRY` sauf valeur déjà enregistrée | acceptée, la réponse porte l'avertissement de `closedEntryWarning` dans `notices` |
| sexe / âge d'un combattant confirmé FFK | modifiable (`FFK_IDENTITY` disparaît) | modifiable |
| plusieurs combats, réglage désactivé | refus `ONE_COMBAT_ONLY` si un combat n'était pas déjà enregistré pour ce combattant | idem |
| catégorie commencée | lecture seule (`LOCKED_REASON`) | idem |

- [ ] **Step 1: Write the failing tests** (`tests/server/club-lines-organiser.test.ts`, base de test comme `club-entry.test.ts`)
  - `organiser adds a fighter: registrations are onsite` — POST combat karaté + kata → deux inscriptions `source: 'onsite'`, réponse `clubId` du club.
  - `editing keeps the existing source, a new discipline is onsite` — combattant FFK (`source: 'ffk'`) : ajout du kata → karaté reste `'ffk'`, kata `'onsite'`.
  - `organiser may choose a closed category, with a notice` — case fermée → 201, `notices` contient `Catégorie non ouverte à cette compétition`.
  - `coach still refused on a closed category` (existant, garder).
  - `sex and age of an FFK-confirmed fighter can change` — coach puis organisateur → 200 ; `FFK_IDENTITY` n'est plus exporté.
  - `two combats refused when the setting is off, kept when already registered` — réglage off : POST deux combats → 400 `ONE_COMBAT_ONLY` ; combattant déjà inscrit en karaté + boxing (via `createRegistration`) : PUT avec les deux → 200, PUT avec karaté seul → 200 (boxing retiré), PUT karaté + mix → 400.
  - `two combats accepted when the setting is on` (coach et organisateur).
  - `started category: read-only for the organiser too` (Review Focus 1) — PUT → `LineReadOnlyError`.
  - `reassigned registration: only the declared values change` (Review Focus 2) — inscription réaffectée (`originalJson` présent) : PUT change la catégorie de poids déclarée → `originalJson` mis à jour, `categoryId` / discipline réelle inchangés.
  - `stale version is refused` (Review Focus 3) — PUT avec une version ancienne → `StaleLineError` (409).
  - `changing club moves the fighter` — PUT sur un autre `clubId` → `fighters.club_id` change ; doublon de nom dans le club d'arrivée → 400.
  - `publicNameHidden is saved with the line` — POST `publicNameHidden: true` → `fighters.public_name_hidden = 1`, `ClubLine.publicNameHidden === true` ; coach aussi.
  - `tests/server/permissions.test.ts` : la Table centrale peut POST/PUT/DELETE `/clubs/:clubId/lines…` ; un compte Zone non.
- [ ] **Step 2: Run** `npx vitest run tests/server/club-lines-organiser.test.ts tests/server/club-entry.test.ts tests/server/permissions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** selon le tableau. `assertWritable` ne s'applique qu'au coach. `lineOf` remplit `clubId`, `publicNameHidden`, et pour l'organisateur ajoute l'avertissement « fermée » aux `notices`. Garder la source existante dans `upsertFighterRegistration` (ou passer la source par inscription) sans changer son comportement pour les imports. Ajouter les quatre routes à `TABLE_WRITES` (`'POST /clubs/:clubId/lines'`, `'PUT /clubs/:clubId/lines/:fighterId'`, `'DELETE /clubs/:clubId/lines/:fighterId'`) et la lecture `GET /fighters/:fighterId/line` aux lectures permises à la Table centrale.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(inscriptions): une seule écriture de ligne de combattant, pour le coach et l'organisateur`

---

### Task 3: Plusieurs combats sur la fiche PDF et le modèle .ods

**Files:**
- Modify: `src/domain/club-form.ts` (`CLUB_FORM_COLUMNS` optionnelles, `cellsToLine`, `parseClubForm`), `src/server/club-form-template.ts`, `src/server/club-form-pdf.ts`
- Test: `tests/domain/club-form.test.ts`, `tests/server/club-form-pdf.test.ts`, nouveau `tests/server/club-form-template.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `export const CLUB_FORM_SECOND_COMBAT_COLUMNS = ['2e discipline de combat', 'Règlement du 2e combat'] as const` — ajoutées **à la fin** des colonnes quand le réglage est activé (les index existants ne bougent pas ; les anciennes fiches restent lisibles).
  - `buildClubFormTemplate(competition, grid, closed)` et `buildClubFormPdf(competition, grid, closed)` lisent `competition.settings.multipleCombatDisciplinesPerDay`.
  - `parseClubForm` reconnaît les deux colonnes par leur libellé (ligne d'en-tête) : présentes → `combats` reçoit un 2e combat s'il est rempli.

- [ ] **Step 1: Write the failing tests**
  - `template with the setting on has the two extra columns, validated like the first combat` — en-tête ligne 13 se termine par `CLUB_FORM_SECOND_COMBAT_COLUMNS` ; listes de validation `combat` et `reglement`.
  - `template with the setting off is unchanged` — mêmes colonnes qu'avant.
  - `reading a form with a second combat` — cellules karaté/Shobu + 2e combat Boxing/Jiyu → `combats` à deux entrées → trois inscriptions avec le kata.
  - `second combat equal to the first is ignored with a warning` — avertissement `2e discipline de combat identique à la première (ignorée).`
  - `an old form (without the columns) still reads` (existant, garder vert).
  - PDF, réglage activé : le texte d'aide de la colonne Disciplines devient `kata et/ou une ou plusieurs disciplines de combat` ; chaque case de combat a sa paire J / S (règlement par combat) ; réglage désactivé : PDF inchangé (test sur le texte extrait, comme les tests PDF existants).
- [ ] **Step 2: Run** `npx vitest run tests/domain/club-form.test.ts tests/server/club-form-pdf.test.ts tests/server/club-form-template.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Forme exacte du PDF laissée au constructeur dans ces contraintes (spec §5.6) ; vérifier le rendu en ouvrant le PDF généré (Chrome) et le .ods (LibreOffice headless : `/Applications/LibreOffice.app/Contents/MacOS/soffice`).
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(fiche-club): plusieurs combats sur la fiche PDF et le modèle .ods quand le réglage le permet`

---

### Task 4: Choix du club et fenêtre « Ajouter un club » partagés

**Files:**
- Create: `src/web/components/club-picker/ClubEntryModal.tsx` (extrait de `EntryModal` dans `src/web/pages/DirectoryPage.tsx`), `src/web/components/club-picker/ClubPicker.tsx`, `src/web/components/club-picker/choice.ts`
- Modify: `src/web/pages/DirectoryPage.tsx` (utilise `ClubEntryModal`), `src/web/api.ts`, `src/server/routes/registrations.ts` (nouvelle route), `src/server/repositories/invitations.ts` ou `directory.ts`, `src/server/auth/permissions.ts`
- Test: `tests/server/registrations-api.test.ts` (route), `tests/web/club-choice.test.ts` (pur), e2e plus tard (Tasks 6–8)

**Interfaces:**
- Produces:
  - Serveur : `POST /api/competitions/:id/clubs/new` body = `directorySchema` (Nom*, N° d'affiliation, Coach, Téléphone, E-mails, Notes) → 201 `Club` : crée la fiche d'annuaire (`createDirectoryEntry`) puis le club de la compétition (`clubFromDirectory`) dans une transaction ; un nom ou un numéro déjà pris dans l'annuaire → même refus que l'annuaire. Ajouté à `TABLE_WRITES` (`'POST /clubs/new'`).
  - `useCreateCompetitionClub(competitionId)` → `Club`.
  - `export type ClubChoice = { kind: 'club'; id: string } | { kind: 'directory'; id: string }` et `choiceKey(c): string` / `parseChoice(key): ClubChoice | null` (`club:<id>`, `dir:<id>`) dans `choice.ts`.
  - `useResolveClub(competitionId): (choice: ClubChoice) => Promise<Club>` — `club` : le club tel quel ; `directory` : `clubs/from-directory`. Appelé **à l'enregistrement**, jamais au choix (Review Focus 4).
  - `<ClubEntryModal opened title="Ajouter un club" | "Modifier le club" initial?: Partial<DirectoryInput> onSubmit={(input) => Promise<unknown>} onClose />` — mêmes champs et mêmes `data-testid` (`directory-name`, `directory-number`, `directory-email`, `directory-save`) qu'aujourd'hui.
  - `<ClubPicker competitionId value: ClubChoice | null onChange={(c: ClubChoice | null, club: Club | null) => void} prefill?: Partial<DirectoryInput> label?="Club" />` — `Select` cherchable, groupes « Clubs de la compétition » puis « Annuaire » (`useClubs` + `useDirectoryClubs`), bouton « Ajouter un club » qui ouvre `ClubEntryModal` (pré-remplie avec `prefill`) et, une fois créé par `POST …/clubs/new`, choisit ce club. `onChange` donne le `Club` de la compétition quand le choix en est un (pour lire `preApproval`), `null` pour un club de l'annuaire. `data-testid="club-picker"`, bouton `club-picker-new`.

- [ ] **Step 1: Write the failing tests** — route : `POST /clubs/new creates the directory entry and the competition club` (201, `directoryClubId` renseigné, coordonnées copiées) ; `duplicate directory name is refused` ; Table centrale autorisée. Pur : `parseChoice('dir:x')` → `{ kind: 'directory', id: 'x' }`, `parseChoice('autre')` → `null`.
- [ ] **Step 2: Run** `npx vitest run tests/server/registrations-api.test.ts tests/web/club-choice.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** ; `DirectoryPage` garde son comportement (création, modification, report vers les compétitions à venir) via `ClubEntryModal`.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npx playwright test tests/e2e/coordonnees-clubs.spec.ts` — Expected: PASS (l'annuaire marche comme avant).
- [ ] **Step 5: Commit** `feat(clubs): choix du club et fenêtre « Ajouter un club » partagés`

---

### Task 5: Fenêtre du combattant partagée (web)

**Files:**
- Modify: `src/web/components/ClubLineForm.tsx`, `src/web/pages/ClubEntryPage.tsx`, `src/web/api.ts`
- Create: `src/web/components/club-line/lineForm.ts` (logique pure extraite de `set` et des listes de choix)
- Test: `tests/web/line-form.test.ts`, `tests/e2e/inscription-en-ligne.spec.ts`

**Interfaces:**
- Consumes: Task 2 (routes, `ClubLine.publicNameHidden`, `ClubEntryView.multipleCombats`).
- Produces:
  - `export interface LineOps { save(args: { fighterId: string | null; line: ClubFormLine; version: string | null; publicNameHidden: boolean }): Promise<ClubLine>; remove(args: { fighterId: string; version: string }): Promise<void>; pending: boolean; error: Error | null }`
  - `useCoachLineOps(token): LineOps`, `useOrganiserLineOps(competitionId, clubId): LineOps` (invalide `registrations`, `clubs`, `club-lines`).
  - `ClubLineForm` props : `{ ops: LineOps; mode: 'coach' | 'organiser'; multipleCombats: boolean; line: ClubLine | null; ageBands; weightClasses; closed: string[]; opened; onClose(message?: string); title?: string; footerExtra?: ReactNode }` — `title` remplace le titre par défaut, `footerExtra` reçoit « Enregistrer et ajouter un autre » (Task 6).
  - `lineForm.ts` : `combatChoices(form, ctx)`, `rulesetChoices(form, discipline, ctx)`, `applyChange(form, patch, ctx): ClubFormLine` avec `ctx = { mode, multipleCombats, closed: Set<string>, ageBands, weightClasses, saved: ClubFormLine | null }`.

Comportement :
- `multipleCombats` faux : les combats restent un choix unique (`OneOf`, second clic décoche), règlement unique sous les combats — écran identique à aujourd'hui.
- `multipleCombats` vrai : cases à choix multiple ; sous chaque combat coché, son « Règlement » (Jiyu / Shobu) ; un combat déjà enregistré reste affiché même si le réglage a été désactivé depuis (on peut le décocher, pas en cocher un nouveau au-delà d'un seul).
- `mode: 'organiser'` : combats, règlements, kata et tranches d'âge fermés **proposés** avec le suffixe ` (non ouverte)` ; `mode: 'coach'` : comme aujourd'hui (seulement la valeur enregistrée).
- Case « Masquer le nom sur la page publique » (les deux modes), sous le grade, envoyée avec l'enregistrement.
- Un refus « périmé » / lecture seule (`RELOAD_STATUSES`) ferme la fenêtre avec le message, comme aujourd'hui.

- [ ] **Step 1: Write the failing tests** (`tests/web/line-form.test.ts`)
  - `organiser sees closed choices marked « (non ouverte) »`, `coach does not`.
  - `multiple combats: ticking a second combat keeps the first, each with its ruleset`.
  - `setting off: a saved second combat stays and can be unticked, a new one replaces` .
  - `changing the age band removes closed choices for the coach only`.
  - `reclassement choices exclude every ticked combat`.
- [ ] **Step 2: Run** `npx vitest run tests/web/line-form.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** ; `ClubEntryPage` passe `ops={useCoachLineOps(token)}`, `mode="coach"`, `multipleCombats={view.multipleCombats}`.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npx playwright test tests/e2e/inscription-en-ligne.spec.ts` — Expected: PASS ; ajouter à ce fichier e2e un test « le coach masque le nom d’un combattant » (case cochée → la ligne enregistrée a `publicNameHidden`, vu sur la page publique « Combattant masqué » si la compétition est publique).
- [ ] **Step 5: Commit** `feat(inscription-en-ligne): fenêtre du combattant partagée, plusieurs combats, nom masqué par le coach`

---

### Task 6: Inscriptions — ajout en deux étapes et modification par la fenêtre du coach

**Files:**
- Create: `src/web/components/FighterWindow.tsx` (enveloppe : étape club → fenêtre du combattant)
- Modify: `src/web/pages/RegistrationsPage.tsx`, `src/web/help.ts` (aide « Inscriptions »), `docs/guide-utilisateur.md`
- Delete: `src/web/components/RegistrationForm.tsx` (plus utilisé ; les routes `POST/PUT /registrations` restent pour l'import, les tests et la synchronisation)
- Test: `tests/e2e/inscriptions.spec.ts` (réécrire les tests qui utilisent `reg-*`), `tests/web/help.test.ts` si les clés changent

**Interfaces:**
- Consumes: Tasks 2, 4, 5 (`fighterLine` via `GET /fighters/:fighterId/line`, `ClubPicker`, `useResolveClub`, `ClubLineForm`, `useOrganiserLineOps`).
- Produces: `<FighterWindow competitionId opened mode={{ kind: 'add' } | { kind: 'edit'; fighterId: string }} onClose />`, `useFighterLine(competitionId, fighterId)`.

Comportement :
- « Ajouter » (`registration-add`) ouvre l'étape « Club » : `ClubPicker` + « Suivant » (`fighter-next`, désactivé sans club). « Suivant » résout le club (`useResolveClub`) puis montre `ClubLineForm` (`mode="organiser"`, `multipleCombats` = réglage de la compétition, `closed` = `useClosedCategories`, toutes les tranches d'âge de la grille), titre « Ajouter un combattant · <club> ».
- `footerExtra` : « Enregistrer et ajouter un autre » (`line-save-next`) enregistre puis rouvre une fenêtre vide sur le même club.
- Modifier (icône crayon d'une ligne) ouvre directement la fenêtre du combattant (toutes ses inscriptions), avec un lien « Changer de club » (`fighter-change-club`) qui revient à l'étape club ; au retour, l'enregistrement passe par `PUT /clubs/<nouveau>/lines/<fighterId>`. Combattant sans club : l'étape club s'ouvre d'abord.
- Le formulaire d'ajout ouvert en permanence et la case « Inscription sur place » disparaissent ; la suppression d'une inscription (corbeille) ne change pas.
- Club de l'annuaire choisi puis fenêtre fermée sans enregistrer : le club n'entre pas dans la compétition (Review Focus 4) — la résolution se fait à « Suivant » ; si « Suivant » a déjà ajouté le club, c'est voulu (le club entre dans la compétition). *Décision du plan :* résoudre à « Suivant » pour que la fenêtre du coach reçoive un `clubId` réel.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/inscriptions.spec.ts`)
  - `ajouter un combattant : club puis fenêtre du coach, inscriptions sur place` — club de la compétition → karaté + kata → deux lignes avec la pastille « sur place ».
  - `ajouter un club depuis Inscriptions` — « Ajouter un club » → fenêtre de l'annuaire → le club est choisi, puis visible dans l'Annuaire.
  - `modifier un combattant ouvre la fenêtre entière ; décocher le kata retire l'inscription kata`.
  - `changer de club`.
  - `deux postes : modification périmée` (Review Focus 3) — deux pages ; la seconde enregistre après la première → la fenêtre se ferme avec le message, la liste montre la valeur de la première.
  - `Enregistrer et ajouter un autre garde le club`.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/inscriptions.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** ; aide à l'écran et guide : section Inscriptions (ajout en deux étapes, inscriptions « sur place », modification du combattant entier, « Changer de club »).
- [ ] **Step 4: Run** `npm run typecheck && npm test && npx playwright test tests/e2e/inscriptions.spec.ts tests/e2e/mise-en-page.spec.ts` — Expected: PASS.
- [ ] **Step 5: Vérifier sur Chrome** (Claude in Chrome, serveur d'essai sur une copie de base démo) : ajout, modification, changement de club, catégorie fermée « (non ouverte) », thème sombre ; noter le résultat dans le journal.
- [ ] **Step 6: Commit** `feat(inscriptions): ajout en deux étapes et modification par la fenêtre du coach`

---

### Task 7: Saisir une fiche papier — choix du club, sans coordonnées

**Files:**
- Modify: `src/web/components/PaperEntryTable.tsx`, `src/server/routes/registrations.ts` (`paperEntrySchema`, routes `club-forms/entry/*`), `src/server/repositories/registrations.ts` (`importClubForm`), `src/web/api.ts` (`PaperEntry`), `src/web/help.ts` (`fiche-club.saisir`), `docs/guide-utilisateur.md`
- Test: `tests/server/registrations-api.test.ts`, `tests/e2e/inscriptions.spec.ts` / `import-ffk.spec.ts` (tests qui remplissent `paper-entry-club`)

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces:
  - `paperEntrySchema` : `header: { clubId: string; preApproval: boolean }` (plus de nom ni de coordonnées) ; le serveur construit le `ClubFormHeader` depuis le club (404 si le club n'est pas dans la compétition).
  - `importClubForm(db, competitionId, parse, opts: { replace: boolean; clubId?: string; coordinates?: boolean })` — avec `clubId`, le club est pris par identifiant (pas par nom) ; `coordinates: false` : ni coach, ni téléphone, ni e-mails écrits ; `preApproval` toujours écrit. Défaut pour la saisie papier : `{ replace: false, clubId, coordinates: false }`.
  - `PaperEntry = { header: { clubId: string; preApproval: boolean }; lines: ClubFormLine[] }` côté web ; l'écran garde le `ClubChoice` et le résout à « Vérifier » / « Enregistrer la fiche » (`useResolveClub`).

Comportement : `ClubPicker` à la place du champ Club (`paper-entry-club` → `club-picker`) ; Coach / Téléphone / E-mails retirés ; « Pré-accord du coach » prend `club.preApproval` au choix d'un club de la compétition, décochée pour un club de l'annuaire, modifiable ; combats en choix multiple + règlement par combat quand le réglage est activé (même `lineForm.ts` que Task 5 si possible).

- [ ] **Step 1: Write the failing tests**
  - Serveur : `paper entry no longer touches coordinates` — club avec coach/téléphone/e-mails → saisie → coordonnées inchangées, `preApproval` écrit.
  - Serveur : `paper entry with an unknown clubId → 404`.
  - e2e : `saisir une fiche papier : choisir le club, pré-accord repris du club` (club dont le coach a coché le pré-accord en ligne → case cochée au choix) ; `club de l'annuaire choisi puis saisie abandonnée : le club n'est pas dans la compétition` (Review Focus 4).
- [ ] **Step 2: Run** the new tests — Expected: FAIL.
- [ ] **Step 3: Implement** ; aide « 3. Saisir une fiche papier » : choisir le club dans la liste (ou « Ajouter un club »), coordonnées dans l'annuaire, pré-accord repris du club.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npx playwright test tests/e2e/inscriptions.spec.ts tests/e2e/import-ffk.spec.ts` — Expected: PASS.
- [ ] **Step 5: Vérifier sur Chrome** (saisie avec un club de la compétition, un club de l'annuaire, un nouveau club ; réglage plusieurs combats activé).
- [ ] **Step 6: Commit** `feat(fiche-club): saisie papier avec le choix du club, sans coordonnées`

---

### Task 8: Import .ods — étape « Club de la fiche » et changements à examiner

**Files:**
- Modify: `src/server/routes/registrations.ts` (`club-forms/preview`, `club-forms/import`), `src/server/repositories/registrations.ts` (`importClubForm`, `clubFormRemovals`, nouvelle `matchFormClub`), `src/web/pages/ClubFormPage.tsx`, `src/web/api.ts`, `src/web/help.ts` (`fiche-club.importer`), `docs/guide-utilisateur.md`
- Test: `tests/server/registrations-api.test.ts`, `tests/server/club-changes.test.ts`, `tests/e2e/import-ffk.spec.ts` ou nouveau `tests/e2e/fiche-club-import.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 7 (`importClubForm` avec `clubId`).
- Produces:
  - `matchFormClub(db, competitionId, name: string): Club | null` — même correspondance qu'aujourd'hui (nom normalisé, alias FFK `clubAliases`), seulement parmi les clubs de la compétition.
  - Preview : réponse gagne `club: Club | null` (le club trouvé) ; `removals` calculées pour ce club, ou pour `?clubId=` s'il est donné.
  - Import : `POST …/club-forms/import?clubId=<id>` ; sans `clubId` et sans club trouvé → 400 `Choisissez le club de la fiche.` ; `clubId` étranger à la compétition → 404.
  - Coordonnées du fichier pour le club importé : seules les valeurs **non vides** du fichier sont écrites dans le club de la compétition, puis `recordClubChange(t, clubId, 'club', before)` (comme l'en-tête en ligne du coach) ; aucune valeur non vide différente → aucun changement créé.
  - Web : après le choix du fichier, si `preview.club === null`, un bloc « Club de la fiche : « <nom du fichier> » » avec `ClubPicker` (`prefill` = nom, coach, téléphone, e-mails du fichier) et l'aperçu attend le choix ; le club choisi (résolu à l'import) est envoyé en `clubId`, et l'aperçu est relu avec ce `clubId` pour montrer les retraits.

- [ ] **Step 1: Write the failing tests**
  - `unknown club name: import refused without clubId`, `import with clubId uses that club, not the file name`.
  - `file coordinates differing from the directory become a change to examine` — `club_changes` contient une ligne pour le club, valeurs du fichier.
  - `empty coordinates in the file erase nothing and create no change` (Review Focus 5).
  - `matched club (alias / accents): no club step` — preview `club` non nul.
  - e2e : `import .ods d'un club au nom différent : choisir le club existant` ; `… : ajouter le club, fenêtre pré-remplie avec le nom et le coach du fichier` ; `fenêtre fermée sans import : le club de l'annuaire choisi n'entre pas dans la compétition` (Review Focus 4).
- [ ] **Step 2: Run** the new tests — Expected: FAIL.
- [ ] **Step 3: Implement** ; aide « Importer » : étape « Club de la fiche », coordonnées → « Comparer ».
- [ ] **Step 4: Run** `npm run typecheck && npm test && npx playwright test tests/e2e/import-ffk.spec.ts tests/e2e/coordonnees-clubs.spec.ts` (+ le nouveau fichier) — Expected: PASS.
- [ ] **Step 5: Vérifier sur Chrome** avec un vrai fichier .ods (modèle téléchargé, rempli par LibreOffice headless ou à la main).
- [ ] **Step 6: Commit** `feat(fiche-club): import .ods avec le choix du club, coordonnées à examiner`

---

### Task 9: Une compétition s'ouvre sur Inscriptions ; clôture

**Files:**
- Modify: `src/web/pages/CompetitionsPage.tsx` (lien du nom → `/inscriptions`), `src/web/App.tsx` (index → `inscriptions`), `src/web/poste.ts` (`defaultTab` organisation → `'inscriptions'`), `tests/e2e/helpers.ts` (`createCompetition` : attendre `/inscriptions$` puis aller sur `/reglages` pour garder le point de départ des tests existants), `tests/web/poste.test.ts`
- Modify: `docs/guide-utilisateur.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md` (section étape 41), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 41)
- Test: `tests/web/poste.test.ts`, e2e `socle.spec.ts` (nouveau test « cliquer sur une compétition ouvre Inscriptions »)

**Interfaces:**
- Consumes: rien.
- Produces: `defaultTab({ kind: 'organisation' }) === 'inscriptions'` ; `table` → `'inscriptions'` ; `zone` → `'combats'` (inchangés).

- [ ] **Step 1: Write the failing tests** — `poste.test.ts` : `defaultTab` organisation = `'inscriptions'` ; e2e `socle.spec.ts` : clic sur le nom → URL `/competitions/<id>/inscriptions` ; `/competitions/<id>` seul → `/inscriptions`.
- [ ] **Step 2: Run** `npx vitest run tests/web/poste.test.ts && npx playwright test tests/e2e/socle.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (et `createCompetition`).
- [ ] **Step 4: Run the whole suite** `npm run typecheck && npm test && npx playwright test` — Expected: tout passe en une seule passe ; noter les nombres dans le bilan.
- [ ] **Step 5: Vérifier sur Chrome** (clic sur une compétition, puis tour complet des écrans changés) et sur le simulateur iPhone pour la page du coach (fenêtre du combattant, combats multiples, case « Masquer le nom »).
- [ ] **Step 6: Commit** `feat(competitions): une compétition s'ouvre sur Inscriptions ; bilan et feuille de route de l'étape 41`
