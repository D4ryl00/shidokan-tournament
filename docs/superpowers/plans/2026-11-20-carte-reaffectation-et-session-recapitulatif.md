# Carte de réaffectation, session à la majorité, gel des sessions, session dans le récapitulatif — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur une carte de réaffectation, le motif passe avant le rappel du combattant. La session d'une catégorie suit la majorité de ses combattants, jusqu'à un gel explicite et réversible. Le récapitulatif club dit « Déplacé dans la session X » quand la session diffère de celle du protocole.

**Architecture:** La règle vit dans `src/domain/waves.ts` (`waveOfCategory` reçoit un décompte de voix par tranche et une session figée). Le décompte est fabriqué par un seul helper domaine, appelé par le serveur (`loadContext`), par le calcul en mémoire de la réaffectation (`src/domain/replacement/waves.ts`) et par la page Sessions. Le gel est stocké dans `categories.frozen_wave` et `competitions.sessions_frozen_at`. Le récapitulatif compare la session « protocole » de chaque inscription (une seule voix, sa tranche) à la session finale de sa catégorie.

**Tech Stack:** TypeScript, React + Mantine, Fastify, drizzle/SQLite (drizzle-kit), pdf-lib, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-carte-reaffectation-et-session-recapitulatif-design.md`

## Global Constraints

- Priorité de la session d'une catégorie : `waveOverride` (y compris `none`), puis `frozenWave` (y compris `none`), puis catégorie libre → null, puis le vote, puis la clé (tranche la plus jeune de `key.ageBandCodes`) sans voix.
- Voix : une par membre de la catégorie, recasés compris. Les absents votent tant que `sessionsFrozenAt` est null et ne votent plus après. Les retirés n'ont pas de catégorie. Un membre dont la tranche n'est prise par aucune session ne vote pas.
- Égalité : la session de la tranche la plus jeune (ordre de `grid.ageBands`) parmi les ex-aequo, puis l'ordre des sessions.
- Une session figée ou choisie à la main ne bascule jamais.
- Texte exact de la mention : `Déplacé dans la session ${nom}`, sans horaire et sans point final.
- Textes des confirmations du gel : ceux du §3 de la spec, mot pour mot.
- Pas de gel automatique. La migration ajoute des colonnes vides.
- Interface, code et commentaires en français, comme le reste du dépôt. Les nouveaux `data-testid` sont en kebab-case.
- Avant la mise en production : sauvegarde du serveur, puis `docker stop` avant de remplacer le conteneur (migration).

## Review Focus

- **Performance du plan de réaffectation** : `mayMoveOthers` doit rester un filtre sans `applyProposal` quand rien ne bascule. Test : Task 3, `pas d'applyProposal sans bascule` (espion ou compteur) ; et `npm run test:perf` avant/après.
- **Session supprimée alors que des catégories y sont figées** : leur `frozenWave` est effacé. Au `syncCategories` suivant, tant que les sessions sont figées, elles sont refigées avec le calcul du moment. Test : Task 4.
- **Inscription tardive après le gel** dans une catégorie existante : la catégorie ne bouge pas, même si la majorité change. Test : Task 4.
- **Absent marqué après le gel** dans une catégorie créée plus tard : la session de cette catégorie est fixée à sa création, pas recalculée. Test : Task 4.
- **Regroupement juniors / seniors avant le gel** : la session suit la majorité, et le récapitulatif mentionne le minoritaire. Test : Task 6.

---

### Task 1: Carte de réaffectation — le motif d'abord

**Files:**
- Modify: `src/web/pages/ReplacementPage.tsx` (`FighterDetail` vers la ligne 70 ; `caseCard` vers la ligne 317)
- Test: `tests/e2e/plan-d-ensemble.spec.ts`, dans le test qui contient `const card = page.getByTestId('replacement-case').filter({ hasText: 'SEULE' });` (vers la ligne 735)

**Interfaces:** aucune.

- [ ] **Step 1: Failing e2e assertion**, juste après la déclaration de `card` :
```ts
  // Le motif de la carte vient avant le rappel du combattant.
  await expect(card.getByTestId('case-detail')).toBeVisible();
  await expect(card.locator('[data-testid="case-detail"] ~ [data-testid="case-fighter"]')).toHaveCount(1);
```
- [ ] **Step 2:** `npx playwright test tests/e2e/plan-d-ensemble.spec.ts -g "<titre exact du test>"`. Expected: FAIL (`case-detail` introuvable).
- [ ] **Step 3: Implement.** Sous `case-name`, trois frères dans le même `<div>`, dans cet ordre :
  1. `<Text size="sm" fw={600} c={c.kind === 'return' ? undefined : 'var(--sk-warn-text)'} data-testid="case-detail">{c.detail}</Text>`
  2. si la catégorie existe : `<Text size="sm">Catégorie actuelle : {label}</Text>`, avec un seul `find`.
  3. `<FighterDetail/>`, dont le `Text` reçoit `c="dimmed"`.

  L'ancien `Text c="dimmed"` est supprimé.
- [ ] **Step 4:** `npx playwright test tests/e2e/plan-d-ensemble.spec.ts && npm run typecheck`. Expected: PASS. `grep -rn "catégorie actuelle" tests` : adapter les assertions qui attendaient l'ancienne minuscule.
- [ ] **Step 5: Commit** `fix(replacement): le motif de la carte en évidence, le rappel du combattant grisé`

### Task 2: Domaine — la session à la majorité

**Files:**
- Modify: `src/domain/waves.ts`, `src/domain/categories.ts` (type `Category`, vers la ligne 130), `src/domain/replacement/waves.ts` (`originBands`, `categoryWave`, `categoryWaves`, `waveChangeOf` : passage aux voix seulement, sans toucher `mayMoveOthers`), `src/server/repositories/categories.ts` (`loadContext` vers la ligne 73 ; `toCategory` vers la ligne 301), `src/web/pages/WavesPage.tsx:56-58`
- Test: `tests/domain/waves.test.ts`

**Interfaces:**
- Produces (dans `src/domain/waves.ts`) :
  - `export type BandCounts = Record<string, number>`
  - `export function bandCounts(members: { ageBandCode: string; presence: Presence }[], frozen: boolean): BandCounts`, où `frozen` exclut les `presence === 'absent'`.
  - `WaveSubject = { key: CategoryKey; bandCounts?: BandCounts }`, qui remplace `waveBands`.
  - `waveOfCategory(c: WaveSubject & { waveOverride: string | null; frozenWave?: string | null }, waves, grid): string | null`, selon la priorité des Global Constraints. Un `frozenWave` qui n'est ni `none` ni une session existante est ignoré.
  - `waveConflicts(cats: (WaveSubject & { id; waveOverride; frozenWave? })[], waves, grid)`. Il ignore les catégories figées ou choisies à la main et liste celles dont une tranche votante (ou, sans voix, la tranche la plus jeune de la clé) est prise par plus d'une session. `waveIds` contient ces sessions.
- `Category` : `waveBands: string[]` devient `bandCounts: BandCounts`, plus `frozenWave: string | null` (null tant que la Task 4 n'existe pas).
- Le serveur compte toutes les inscriptions de la catégorie, recasés compris (le filtre `placementLocked` est supprimé), avec `frozen = false` jusqu'à la Task 4.

- [ ] **Step 1: Failing tests** (`tests/domain/waves.test.ts`, grille `ffkDefaultGrid()`, sessions `J` = `['junior']` et `S` = `['senior']`, clé F karaté avec `ageBandCodes: ['junior', 'senior']`) :
  - `vote : 2 seniors 1 junior → S` ; `vote : 1-1 → J (plus jeune)` ;
  - `vote par session : junior 1, espoir 1, senior 1 avec Adultes = espoir+senior → Adultes` ;
  - `tranche hors session ne vote pas : 2 minimes (aucune session) + 1 senior → S` ;
  - `sans voix : la clé décide (tranche la plus jeune)` ;
  - `frozenWave prioritaire sur le vote` ; `waveOverride prioritaire sur frozenWave` ; `frozenWave 'none' → null` ; `frozenWave inconnu ignoré` ;
  - `bandCounts : absents comptés avant le gel, pas après` ;
  - `conflits : tranche prise par deux sessions` (adapter le test `conflits` existant) ; `conflits : ignorés pour une catégorie figée`.
  Adapter les tests existants qui passent `waveBands` (`relecture : catégorie d'arrivée…` ; il faut maintenant que les recasés comptent : réécrire son attendu selon la majorité).
- [ ] **Step 2:** `npx vitest run tests/domain/waves.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** les interfaces ci-dessus. La session d'une tranche `b` est la première session (par ordre) avec `ruleMatches(w.rules, key, grid, [b])`. `ruleMatches` garde sa signature et prend une liste de tranches.
- [ ] **Step 4: Switch the callers** (compilation) : `loadContext` construit `bandCounts` avec le helper, `toCategory` expose `bandCounts` et `frozenWave: null`, `WavesPage` passe `bandCounts`. Dans `src/domain/replacement/waves.ts`, `originBands` devient un `BandCounts` qui exclut `except`, et `waveChangeOf` ajoute la voix du combattant déplacé dans la cible (une voix, quel que soit son verrouillage).
- [ ] **Step 5:** `npm run typecheck && npx vitest run`. Expected: PASS. Les tests qui supposaient « recasés exclus » ou « tranche la plus jeune » sont corrigés selon la spec, jamais en affaiblissant l'assertion : signaler chacun dans le message de commit.
- [ ] **Step 6: Commit** `feat(sessions): session d'une catégorie à la majorité de ses combattants`

### Task 3: Réaffectation — bascules de session sous le vote

**Files:**
- Modify: `src/domain/replacement/waves.ts` (`mayMoveOthers`, `waveEffects`)
- Test: `tests/domain/replacement-waves.test.ts` (ou le fichier existant qui teste `waveEffects` : `grep -rln waveEffects tests`)

**Interfaces:**
- Consumes: `waveOfCategory`, `BandCounts` (Task 2).
- Produces: `waveEffects(state, p)` inchangé en signature.

- [ ] **Step 1: Failing tests**
  - `arrivée qui bascule` : catégorie S avec 1 senior. Deux juniors y arrivent l'un après l'autre. Le second déplacement donne `waveShifts` = [le senior, de S vers J] et `waveChange` du junior = null.
  - `départ qui bascule` : catégorie avec 2 seniors et 1 junior (session S). Un senior part ailleurs, il reste 1 contre 1 → J. `waveShifts` = [le senior restant et la junior, de S vers J].
  - `départ sans bascule` : catégorie avec 2 juniors et 1 senior (session J). Un junior part, 1 contre 1 → J. `waveShifts` vide.
  - `figée : pas de bascule` : même scénario que `arrivée qui bascule` avec `frozenWave` sur la cible → `waveShifts` vide.
  - `pas d'applyProposal sans bascule` : un déplacement qui ne change aucune majorité ne passe pas par `applyProposal`. Le vérifier avec `vi.spyOn` sur le module `move.js`, ou exposer `mayMoveOthers` pour le tester directement.
- [ ] **Step 2:** `npx vitest run <fichier>`. Expected: FAIL.
- [ ] **Step 3: Implement `mayMoveOthers`.** Pour la catégorie de départ et la catégorie d'arrivée (sauf si figée ou choisie à la main), comparer la session gagnante avant et après le vote du combattant déplacé, avec `waveOfCategory` sur les voix modifiées. Vrai si l'une des deux change et qu'il reste d'autres membres. `waveEffects` ne change pas.
- [ ] **Step 4:** `npx vitest run && npm run test:perf`. Expected: PASS, et le temps du plan proche de la référence mesurée avant la Task 2. Lancer `git stash && npm run test:perf` avant de commencer pour avoir la référence.
- [ ] **Step 5: Commit** `feat(replacement): bascules de session sous la règle de la majorité`

### Task 4: Gel des sessions — stockage, routes, journal

**Files:**
- Modify: `src/server/db/schema.ts` (`categories.frozenWave` = `text('frozen_wave')` ; `competitions.sessionsFrozenAt` = `text('sessions_frozen_at')`)
- Create: `drizzle/0041_*.sql` via `npm run db:generate`, à renommer `0041_gel_des_sessions.sql` en gardant le journal drizzle cohérent comme pour `0040_cartes_ignorees.sql`
- Modify: `src/domain/competition.ts` (+ `sessionsFrozenAt: string | null`), `src/server/repositories/competitions.ts` (`toCompetition`)
- Modify: `src/server/repositories/categories.ts` (`toCategory` lit `frozenWave` ; `loadContext` : `bandCounts(..., frozen)` selon `sessionsFrozenAt` ; fin de `syncCategories` : refiger)
- Create: `src/server/repositories/session-freeze.ts` (`freezeSessions`, `unfreezeSessions`)
- Modify: `src/server/routes/waves.ts` (`POST /api/competitions/:id/waves/freeze` et `/unfreeze`, mêmes droits que `PUT /waves`)
- Modify: `src/server/repositories/waves.ts` (`replaceWaves` : `frozenWave` = null pour les sessions supprimées, comme `waveOverride`)
- Modify: `src/domain/replacement/types.ts` (`CategoryState.frozenWave: string | null` ; `State.sessionsFrozen: boolean`), `src/server/repositories/replacement.ts:117` (remplissage), `src/domain/replacement/waves.ts` (passer `frozenWave` et `bandCounts(..., state.sessionsFrozen)`), `src/domain/replacement/apply.ts` (`stateFingerprint` : `c.frozenWave` et `state.sessionsFrozen`)
- Modify: `src/server/sync/package.ts:74` (ajouter `['categories', 'frozen_wave', 'waves']`)
- Modify: `src/domain/journal/types.ts` (actions `'sessions-frozen' | 'sessions-unfrozen'`, type `'session'`, via `'sessions'`), `src/domain/journal/text.ts` (titres `Sessions figées`, `Sessions défigées` ; détail `{n} catégories figées`)
- Test: `tests/server/session-freeze.test.ts` (nouveau, sur le modèle de `tests/server/estimate.test.ts`), `tests/domain/journal-text.test.ts` (ou le fichier existant de `journalText`)

**Interfaces:**
- Produces:
  - `freezeSessions(db, competitionId): Promise<{ frozenAt: string; count: number }>`. Il synchronise, puis, en une transaction, écrit `frozen_wave` pour chaque catégorie non libre avec `waveOfCategory({ key, waveOverride: null, frozenWave: null, bandCounts }, …) ?? 'none'`, écrit `sessions_frozen_at`, et journalise. Refus (`CategoryLockedError`) s'il n'y a aucune session ou si c'est déjà figé.
  - `unfreezeSessions(db, competitionId): Promise<void>` met tout à null et journalise. Refus si ce n'est pas figé.
  - Routes : `POST …/waves/freeze` → `{ frozenAt, count }` ; `POST …/waves/unfreeze` → 204.
  - `Competition.sessionsFrozenAt` et `Category.frozenWave` (lus par la Task 5).
- Refiger : à la fin de `syncCategories`, si `sessionsFrozenAt` n'est pas null, toute catégorie non libre dont `frozen_wave` est null le reçoit, avec le même calcul (absents exclus).

- [ ] **Step 1: Failing tests** (`tests/server/session-freeze.test.ts`) :
  - `figer : chaque catégorie garde sa session ; une inscription tardive ne la fait plus basculer` : sessions J et S, 1 senior et 1 junior dans une catégorie regroupée. Pour la regrouper, la grille doit avoir les deux tranches dans la même catégorie : sinon, utiliser un déplacement `POST /replacement/move`. La session est J. On fige, on ajoute 2 seniors dans la même catégorie : la session reste J.
  - `ne plus figer : la majorité reprend` : suite du test précédent, la session passe à S. Les `waveOverride` sont intacts.
  - `catégorie créée après le gel : figée à sa création, absents exclus`.
  - `session supprimée : frozenWave effacé, puis refigé au calcul suivant`.
  - `journal : Sessions figées / défigées` (`GET /journal`, ou la route existante du Journal).
  - `refus : figer sans session ; figer deux fois ; défiger sans gel`.
  - `paquet de synchronisation : frozen_wave remappé` : sur le modèle des tests du paquet, `grep -rln "wave_override" tests/server`.
- [ ] **Step 2:** `npx vitest run tests/server/session-freeze.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Schéma + `npm run db:generate` + renommage de la migration. Vérifier que le SQL ne contient que deux `ALTER TABLE … ADD`.
- [ ] **Step 4: Implement** les interfaces ci-dessus.
- [ ] **Step 5:** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(sessions): figer les sessions (stockage, routes, journal, synchronisation)`

### Task 5: Page Sessions — bouton, état, aide, spec principale

**Files:**
- Modify: `src/web/api.ts` (`useFreezeSessions`, `useUnfreezeSessions`, qui invalident competition, categories, waves et replacement), `src/web/pages/WavesPage.tsx`, `src/web/help.ts:459`, `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` (section des vagues)
- Test: `tests/e2e/sessions-gel.spec.ts` (nouveau, sur le modèle des e2e de la page Sessions : `grep -rln "wave-save" tests/e2e`)

**Interfaces:**
- Consumes: routes et champs de la Task 4. `WavesPage` passe `frozenWave` à `waveOfCategory` et à `waveConflicts`.

- [ ] **Step 1: Failing e2e** `figer puis ne plus figer` :
  - sans gel, avec des sessions enregistrées : `sessions-freeze` visible ;
  - clic, la modale affiche le texte exact de la spec, `sessions-freeze-go` ;
  - `sessions-frozen-at` contient `Sessions figées le` ;
  - `sessions-unfreeze` ouvre la confirmation (texte exact), puis `sessions-unfreeze-go` ;
  - `sessions-freeze` est de nouveau visible.

  Masqué sans session.
- [ ] **Step 2:** `npx playwright test tests/e2e/sessions-gel.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Le bouton se place près de « Enregistrer les sessions », sans s'y confondre (variante `default`). Il est désactivé tant que des modifications de sessions ne sont pas enregistrées (`dirty`). Date et heure au format `20 novembre à 14 h 05`, comme le récapitulatif (`Europe/Paris`).
  - Aide (`help.ts:459`) : « Une catégorie va dans la session de la majorité de ses combattants (réaffectés et absents compris) ; à égalité, celle des plus jeunes. Le jour de la compétition, « Figer les sessions » garde chaque catégorie dans sa session : les nouvelles inscriptions et les réaffectations ne la changent plus. Un choix à la main reste toujours possible. »
  - Spec principale : la même règle, plus le gel.
- [ ] **Step 4:** `npx playwright test tests/e2e/sessions-gel.spec.ts && npm run typecheck && npx vitest run tests/web/help.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sessions): bouton « Figer les sessions » et aide`

### Task 6: Récapitulatif — session finale différente du protocole (domaine + dépôt)

**Files:**
- Modify: `src/domain/club-recap.ts`, `src/server/repositories/club-recap.ts`
- Test: `tests/domain/club-recap.test.ts`, `tests/server/club-recap.test.ts`

**Interfaces:**
- Produces: `RecapRegistration.sessions?: { announced: string | null; final: string | null }` (noms) ; `RecapLine.session: string | null`. `changed` reste « catégorie différente » ; la mise en évidence du PDF utilise `changed || session !== null` (Task 7).
- Consumes: `waveOfCategory`, `naturalKey`, `listWaves`, `readCategories` (`Category.waveId`).

- [ ] **Step 1: Failing domain tests.** Le test `non déplacé` attend `session: null`.
```ts
const placed = (sessions: RecapRegistration['sessions'], over: Partial<RecapRegistration> = {}) =>
  recapLines([reg({ sessions, ...over })], grid)[0]!;
test('session différente du protocole, catégorie inchangée : mention', () => {
  expect(placed({ announced: 'Poussins - Pupilles', final: 'Benjamins - Minimes' })).toMatchObject({ changed: false, session: 'Benjamins - Minimes' });
});
test('même session, sans sessions, session finale en attente : pas de mention', () => {
  expect(placed({ announced: 'A', final: 'A' }).session).toBeNull();
  expect(placed(undefined).session).toBeNull();
  expect(placed({ announced: 'A', final: null }).session).toBeNull();
});
test('absent, ne combat pas : pas de mention', () => {
  expect(placed({ announced: 'A', final: 'B' }, { final: { kind: 'absent' } }).session).toBeNull();
  expect(placed({ announced: 'A', final: 'B' }, { final: { kind: 'withdrawn' } }).session).toBeNull();
});
```
- [ ] **Step 2:** `npx vitest run tests/domain/club-recap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** : `session = r.final.kind === 'category' && r.sessions?.final && r.sessions.final !== r.sessions.announced ? r.sessions.final : null`.
- [ ] **Step 4: Failing repository tests.** Appeler `clubRecapLines` directement sur la base du test, ou passer par le PDF de la Task 7. Sessions créées par `PUT /waves` (`tests/server/estimate.test.ts:37`).
  - `regroupement juniors / seniors` : sessions `Juniors` et `Seniors`, 2 seniors et 1 junior F dans une même catégorie (même méthode que la Task 4). La catégorie est en `Seniors`. La junior a `session: 'Seniors'`, les seniors `null`.
  - `choix manuel` : la catégorie d'une cadette passée à la main (`PATCH` de la catégorie avec `waveOverride`, voir `updateCategory`) dans une autre session. La ligne n'est pas changée, mais `session` = nom de cette session.
  - `sans sessions` : `session: null` partout.
- [ ] **Step 5: Implement in the repository.** `context` ajoute `waves` et `waveOf` (id → `waveId`, depuis `readCategories`, sans nouvelle synchronisation). `sessions.announced` vient de `waveOfCategory({ key: naturalKey(registered, f), waveOverride: null, frozenWave: null, bandCounts: { [f.ageBandCode]: 1 } }, waves, grid)`. `sessions.final` est le nom de `waveOf.get(r.categoryId)`. Sans session, `sessions` reste indéfini.
- [ ] **Step 6:** `npx vitest run tests/domain/club-recap.test.ts tests/server/club-recap.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(clubs): récapitulatif — session finale quand elle diffère du protocole`

### Task 7: Récapitulatif PDF — dessiner la mention

**Files:**
- Modify: `src/server/club-recap-pdf.ts`
- Test: `tests/server/club-recap.test.ts`

**Interfaces:** Consumes `RecapLine.session` (Task 6).

- [ ] **Step 1: Failing tests**
  - `PDF : mention sur une ligne changée` : `{ …, changed: true, reason: 'tranche d’âge voisine', session: 'Poussins - Pupilles' }`. Le texte contient `Changé`, `(tranche d’âge voisine)` et `Déplacé dans la session Poussins - Pupilles`.
  - `PDF : mention seule sur une ligne non changée` : `changed: false, reason: null, session: 'S2'`. Le texte contient `Déplacé dans la session S2` et pas `Changé`.
  - `PDF : ligne très longue` : `final` de 400 caractères, `session` de 200. Le PDF tient sur 1 page et le texte contient `Déplacé`.
  - Le test `regroupement juniors / seniors` de la Task 6 vérifie aussi `Déplacé dans la session Seniors` dans `/clubs/:id/recap.pdf`.
- [ ] **Step 2:** `npx vitest run tests/server/club-recap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Fond gris si `line.changed || line.session`. Sous `final`, puis sous « Changé (motif) » si `changed`, une ligne en gras `Déplacé dans la session ${line.session}`, repliée (`wrap(bold, SIZE, …, textW(2))`). Ses lignes comptent dans `noteRows`. `clip` garantit toujours une ligne de `final` au moins et une page au plus.
- [ ] **Step 4:** `npx vitest run && npm run typecheck`. Expected: PASS (toute la suite).
- [ ] **Step 5: Commit** `feat(clubs): récapitulatif PDF — « Déplacé dans la session … »`

### Task 8: Vérification sur Chrome, e2e complet, bilan

- [ ] `npx playwright test` complet. Les échecs intermittents connus sont relancés seuls et notés.
- [ ] Serveur de test jetable : jamais la base vivante, `BACKUP_INTERVAL_MIN` ≤ 1440, `docker stop` avant `rm`. Deux sessions par tranche (Juniors, Seniors), une catégorie avec 2 seniors et 1 junior, une carte « Écart de poids », une carte « Retour possible ».
- [ ] Chrome, Réaffectation : le motif en orange semi-gras, puis la catégorie actuelle, puis le rappel grisé ; « Retour possible » en neutre ; en clair, en sombre et à 390 px.
- [ ] Chrome, Sessions : la catégorie est en Seniors. Figer : le message et la date s'affichent. Ajouter 2 juniors : la catégorie reste en Seniors. Ne plus figer : elle passe en Juniors. Puis vérifier le Journal.
- [ ] Chrome, Clubs : télécharger le récapitulatif et l'ouvrir. « Déplacé dans la session … » apparaît sur la ligne de la minorité, et nulle part ailleurs.
- [ ] Bilan : section dans `docs/superpowers/plans/2026-10-21-99-bilan.md`. Mémoire : pointeur de projet dans `shidokan-spec-location.md`. Commit `docs(bilan): …`.
