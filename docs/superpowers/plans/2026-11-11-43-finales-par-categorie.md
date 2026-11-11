# Étape 43 — Finales catégorie par catégorie (onglet Finales) — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pour chaque session, une zone des finales ; pour chaque catégorie, où (« Sa zone » / zone des finales) et quand (« Dès que finie » / « Fin de session ») se joue sa finale, réglés dans un nouvel onglet « Finales » (étape Préparer) ; l'ordre de passage, le figeage, la file de Combats et les heures estimées en tiennent compte.

**Architecture:** une logique pure résout le choix effectif de chaque catégorie (`src/domain/passages/finals-choice.ts`) ; `planPassages` / `orderWave` s'en servent à la place de `settings.finalsZoneId` / `kataFinalsOnFinalsZone` (qui disparaissent). Stockage : table `wave_finals` (zone des finales et derniers « Tout… » par session) et deux colonnes sur `categories` ; chaque numéro figé garde la « signature » du choix de sa catégorie pour voir un changement après réouverture. La ligne de temps du mode spectateur distingue « Dès que finie » / « Fin de session » et accepte une finale jouée en avance.

**Tech Stack:** TypeScript 7, Fastify, Drizzle/SQLite (migrations `drizzle/`), React + Mantine, TanStack Query, Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-11-08-finales-des-que-pretes-design.md` (lire en entier avant toute tâche).

## Global Constraints

- Une zone des finales **par session** (`wave_key` '' : session unique d'une compétition sans session) ; par catégorie seulement deux lieux possibles : sa zone ou la zone des finales de sa session.
- Les numéros figés ne bougent jamais tout seuls ; aucune renumérotation quand une zone prend de l'avance.
- Session lancée (`wave_launches.launched = true`, états « Lancée » / « Terminée ») : choix des finales en lecture seule, refus serveur avec le texte « Session figée : rouvrez-la dans Combats pour changer les finales. » Session rouverte ou en préparation : modifiable.
- Valeur par défaut d'une catégorie (`defaultFinalsChoice`) : Où = zone des finales s'il y en a une, sinon sa zone ; Quand = « Dès que finie » si (Où = sa zone et (ordre « catégorie par catégorie » ou kata)), sinon « Fin de session ».
- Choisir une zone des finales (autre que « Aucune ») met toutes les catégories de la session sur cette zone (Où réinitialisé).
- Textes exacts : onglet « Finales » ; « Zone des finales » ; option « Aucune » ; aide de l'option « « Aucune » : chaque finale reste sur la zone de sa catégorie. » ; interrupteurs « Sa zone » / `<nom de zone>` et « Dès que finie » / « Fin de session » ; boutons « Tout sur <nom de zone> », « Tout sur sa zone », « Tout dès que finie », « Tout en fin de session » ; « sur <nom de zone> » (catégorie de la zone des finales) ; « <zone> n’accueille pas <discipline> » ; « pas de finale (poule) » ; badge « finale = tour 2 » (kata) ; « Rouvrez la session dans Combats pour changer. » ; Combats : « Prête · peut passer plus tôt » ; refigeage : « Les finales ont changé : les zones concernées sont renumérotées (mélangés). »
- Onglet « Finales » : étape « Préparer », juste après « Sessions » ; poste Organisation seulement (pas dans `TABLE_TABS` ni `ZONE_TABS`) ; routes d'écriture absentes de `TABLE_WRITES` (organisateur seulement).
- Aucune heure ≤ maintenant n'est montrée publiquement (règle existante du mode spectateur).
- Interface en français, apostrophes typographiques (’). Node 22.23.2. e2e : nom de compétition unique (ni contenu dans un autre, ni le contenant).

## Review Focus

1. **Compétition existante avec `finalsZoneId` réglé, sessions déjà figées** : après migration, rien ne passe « à numéroter » et les numéros imprimés restent (signature `null` = pas de changement) — Task 4, test `migration 0036 : sessions figées intactes`.
2. **Zone des finales supprimée dans les Réglages** : `wave_finals.finals_zone_id` passe à null, les finales retombent sur leur zone sans erreur — Task 4, test `zone des finales supprimée`.
3. **Zone des finales limitée à certaines disciplines** (Ring = shido-boxing seulement) : un kata coché « Tout sur Ring » reste sur sa zone, affiché « Ring n’accueille pas le kata » — Task 1 (résolution) et Task 7 (écran).
4. **Paquet d'un PC d'avant l'étape 43** (sans table `wave_finals`) : les choix sont tirés de ses réglages comme à la migration, rien n'est effacé — Task 5, test `paquet d'avant : finales reprises des réglages`.
5. **Finale jouée en avance puis résultat effacé** : la file et les heures reviennent à l'ordre normal, sans heure passée — Task 9, test `finale avancée puis effacée`.

---

### Task 1: Choix des finales — types, valeurs par défaut, résolution

**Files:**
- Create: `src/domain/passages/finals-choice.ts`
- Modify: `src/domain/passages/index.ts` (exports)
- Test: `tests/domain/passages/finals-choice.test.ts`

**Interfaces:**
- Produces:
  - `type FinalsWhere = 'own' | 'finals'`, `type FinalsWhen = 'ready' | 'end'`
  - `interface StoredFinals { where: FinalsWhere | null; when: FinalsWhen | null }` (null : valeur de la session, sinon défaut)
  - `interface WaveFinals { waveKey: string; finalsZoneId: string | null; whereDefault: FinalsWhere | null; whenDefault: FinalsWhen | null }`
  - `defaultFinalsChoice(o: { kata: boolean; mode: PassageOrderMode; hasFinalsZone: boolean }): { where: FinalsWhere; when: FinalsWhen }`
  - `interface ResolvedFinals { finalZoneId: string | null; when: FinalsWhen; onFinalsZone: boolean; kataSplit: boolean; fixed: 'finals-zone' | 'not-accepted' | null; signature: string }`
  - `resolveFinals(o: { kata: boolean; entrants: number; zoneId: string | null; stored: StoredFinals; wave: WaveFinals | undefined; mode: PassageOrderMode; accepts: (zoneId: string) => boolean }): ResolvedFinals`

- [ ] **Step 1: Write the failing tests** (`finals-choice.test.ts`)
  - `défauts` : `{kata:false, mode:'rounds', hasFinalsZone:false}` → `{own, end}` ; `mode:'categories'` → `{own, ready}` ; `kata:true, hasFinalsZone:false` → `{own, ready}` ; `hasFinalsZone:true` (kata ou non) → `{finals, end}`.
  - `stocké > dernier « Tout… » > défaut` : `stored.where='own'` l'emporte sur `wave.whereDefault='finals'` ; `stored` null → `wave.whenDefault` ; tout null → défaut.
  - `sans zone des finales : Où ignoré` : `stored.where='finals'`, `wave.finalsZoneId=null` → `finalZoneId === zoneId`, `onFinalsZone false`.
  - `catégorie de la zone des finales` : `zoneId === wave.finalsZoneId` → `fixed 'finals-zone'`, `onFinalsZone true`, `kataSplit true` pour un kata à 3 inscrits même avec `stored {own, ready}`.
  - `zone qui n'accueille pas la discipline` : `accepts → false` → `fixed 'not-accepted'`, `finalZoneId === zoneId`.
  - `kata : bloc unique seulement sur sa zone et dès que finie` : `{own, ready}` hors zone des finales → `kataSplit false` ; `{own, end}` → `true` ; `{finals, …}` → `true`.
  - `signature` : `` `${finalZoneId ?? ''}|${when}` `` ; change quand la zone des finales de la session change.
- [ ] **Step 2: Run** `npx vitest run tests/domain/passages/finals-choice.test.ts` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement** `finals-choice.ts` (fonctions pures, sans dépendance au serveur).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): choix des finales par catégorie (défauts et résolution)`

### Task 2: Ordre de passage selon les choix

**Files:**
- Modify: `src/domain/passages/plan.ts` (`PlanInput`, `PlanCategory`, `Context`, `orderWave`, `planPassages`), `src/domain/passages/order.ts` (`OrderCategory`, `zoneOrder`)
- Test: `tests/domain/passages/finals-order.test.ts` ; adapter `tests/domain/passages/frozen.test.ts` (bloc « finales sur une zone » réécrit avec `waveFinals`)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `PlanCategory.finals?: StoredFinals` (absent = `{ where: null, when: null }`)
  - `PlanInput.waveFinals?: WaveFinals[]` (remplace `finals?: { zoneId; kata }`, supprimé)
  - `PlanInput.durationSec?: (categoryId: string, matchId: string | null) => number` (durée d'un passage, `matchId` null / 'kata:tour1' / 'kata:finale' pour le kata ; absent : ordre des rangs)
  - `PassagePlan.finals: Record<string, ResolvedFinals>` (catégories jouables qui ont une zone)
  - `OrderCategory.finalsAfter?: MatchNode[]` : finales à placer juste après le dernier passage de la catégorie dans la file de la zone

- [ ] **Step 1: Write the failing tests** (`finals-order.test.ts`, mêmes aides `pc`/`br`/`seqOf` que `frozen.test.ts`)
  - `tour par tour, sa zone, dès que finie` : A (4) et B (4) sur t1, A `{own, ready}`, B `{own, end}` → `A:w2-0` juste après le dernier `A:w1-*`, `B:w2-0` dernier.
  - `catégorie par catégorie, fin de session` : A `{own, end}` → `A:w2-0` après tous les combats de B.
  - `zone des finales : ses combats d'abord, puis dès que finie, puis fin de session` : t1 (A 8, B 4) + ring (R 4) ; `waveFinals ring` ; A `{finals, ready}`, B `{finals, end}`, R `{…, ready}` → file ring : `R:w1-0, R:w1-1`, puis les finales « dès que finie » (A, R) dans l'ordre de fin estimée, puis `B:w2-0`.
  - `dès que finie : ordre des fins estimées` : avec `durationSec` qui rend la catégorie B de t2 finie avant A de t1 → B avant A ; sans `durationSec` → ordre des rangs.
  - `zone des finales sans combat à elle` : finales « dès que finie » dans l'ordre des fins estimées, sans attendre.
  - `kata` : `{own, ready}` → un seul bloc `kata` ; `{own, end}` → `kata:tour1` en tête de zone et `kata:finale` en fin ; `{finals, ready}` → `kata:finale` sur la zone des finales ; kata à 2 → seulement `kata:finale` quand séparé ; kata dont la zone est la zone des finales → séparé.
  - `deux sessions, deux zones des finales` : w1 → ring, w2 → aucune ; chaque session suit la sienne.
  - `PassagePlan.finals` renseigné pour chaque catégorie jouable placée.
- [ ] **Step 2: Run** `npx vitest run tests/domain/passages` — Expected: FAIL.
- [ ] **Step 3: Implement**
  - `context()` : plus de `finalsZone`/`kataFinals` globaux ; `orderWave` reçoit la `WaveFinals` de sa vague et résout chaque catégorie avec `resolveFinals` (Task 1).
  - Par zone : passages non finals via `zoneOrder` comme aujourd'hui ; finales `{own, ready}` dans `finalsAfter` (insérées par `zoneOrder` juste après le dernier passage de leur catégorie, `noRest` calculé avec `shares`) — une catégorie dont tous les combats sont des finales (combat unique, meilleur des trois) garde l'ordre normal ; puis bloc des finales `{own, end}` (`zoneOrder` à part, comme les finales d'aujourd'hui).
  - Zone des finales : ses passages non finals ; puis les finales « dès que finie » (toutes origines) triées par fin estimée de leur catégorie (simulation des files de la session à partir de 0 avec `durationSec`, changement compris : `settings.schedule.changeoverSec` passé dans `durationSec` par le serveur), à égalité par rang ; puis les finales « fin de session » par rang (`zoneOrder`).
- [ ] **Step 4: Run** `npx vitest run tests/domain` — Expected: PASS (tests existants adaptés compris).
- [ ] **Step 5: Commit** `feat(finales): ordre de passage selon où et quand se joue chaque finale`

### Task 3: Numéros figés — signature du choix, « à numéroter » pour les finales

**Files:**
- Modify: `src/domain/passages/plan.ts` (`FrozenPassage`, `stillValid`, `PassagePlan.pending`, `appendPassages`, `reshuffleZone`, `toFrozen`)
- Test: `tests/domain/passages/frozen.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `FrozenPassage.finalsChoice: string | null` (signature au figeage ; null : figé avant l'étape 43)
  - `PassagePlan.pending: { waveId: string | null; categoryId: string; reason: 'shape' | 'finals' }[]`

- [ ] **Step 1: Write the failing tests**
  - `choix changé après réouverture → à numéroter (finals)` : figer avec A `{own, end}`, passer A à `{own, ready}` → `pending` = `[{…, categoryId:'A', reason:'finals'}]`.
  - `zone des finales de la session changée → à numéroter` pour les catégories sur la zone des finales.
  - `signature null (figé avant) → rien à numéroter` (remplace le test « réglage des finales changé après le lancement : rien n’est à renuméroter »).
  - `forme changée → reason 'shape'` (test existant mis à jour avec `reason`).
  - `appendPassages` / `reshuffleZone` : chaque ligne rendue porte la signature actuelle de sa catégorie.
- [ ] **Step 2: Run** `npx vitest run tests/domain/passages/frozen.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : `stillValid` garde ses règles de forme ; en plus, une ligne dont `finalsChoice` n'est pas null et diffère de `plan.finals[c].signature` rend la catégorie `pending` avec `reason: 'finals'` (forme changée : `'shape'`, prioritaire).
- [ ] **Step 4: Run** `npx vitest run tests/domain` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): un choix de finale changé après le figeage rend la catégorie à numéroter`

### Task 4: Base de données, dépôt, réglages

**Files:**
- Create: `drizzle/0036_finales.sql` (+ `drizzle/meta`), `src/server/repositories/wave-finals.ts`
- Modify: `src/server/db/schema.ts`, `src/server/repositories/passages.ts` (`planInput`, `loadFrozen`), `src/server/repositories/launches.ts` (`rowOf`, `replaceRows` : colonne `finals_choice`), `src/server/repositories/waves.ts` (suppression d'une session → ses lignes `wave_finals`), `src/domain/settings.ts` (retirer `finalsZoneId`, `kataFinalsOnFinalsZone`), tests qui posaient `settings.finalsZoneId` (`tests/server/moves.test.ts`, `tests/server/results.test.ts`, `tests/helpers/zones-fixture.ts`, `tests/domain/settings.test.ts`, `tests/domain/passages/frozen.test.ts`)
- Test: `tests/server/migration-0036.test.ts`, `tests/server/wave-finals.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - table `wave_finals` (`competition_id`, `wave_key`, `finals_zone_id` → `zones.id` ON DELETE SET NULL, `where_default`, `when_default`, `rowMeta`), PK (`competition_id`, `wave_key`) ; `categories.finals_where`, `categories.finals_when` (texte, null) ; `frozen_passages.finals_choice` (texte, null).
  - `listWaveFinals(db, competitionId): WaveFinals[]`
  - `setFinalsZone(db, competitionId, waveId: string | null, finalsZoneId: string | null): void` — zone non null : `where_default = 'finals'` et `finals_where = null` pour les catégories de la session.
  - `setCategoryFinals(db, competitionId, waveId: string | null, patch: { categoryIds?: string[]; where?: FinalsWhere; when?: FinalsWhen }): void` — sans `categoryIds` (« Tout… ») : toutes les catégories de la session **et** `where_default` / `when_default`.
  - `assertFinalsEditable(db, competitionId, waveId)` : lève `RegistrationValidationError(['Session figée : rouvrez-la dans Combats pour changer les finales.'])` si la session est lancée.
  - `WAVE_FINALS_FROM_SETTINGS` : SQL exporté (même règle que la migration) pour le paquet d'avant (Task 5).
- [ ] **Step 1: Write the failing tests**
  - `migration 0036` (`olderDb(35)`) : compétition `settings_json` `{"finalsZoneId":"z2","kataFinalsOnFinalsZone":false}` avec deux sessions → deux lignes `wave_finals` `finals_zone_id 'z2'` ; catégorie kata (`json_extract(key_json,'$.discipline')='kata'`) → `finals_where 'own'`, `finals_when 'ready'` ; catégorie de combat → null/null ; compétition sans session → ligne `wave_key ''` ; `finalsZoneId` inconnu ou null → pas de ligne. Colonnes `frozen_passages.finals_choice` null.
  - `migration 0036 : sessions figées intactes` : session figée avant migration → `launchStatus(...).pending` vide.
  - `wave-finals` : `setFinalsZone` remet `finals_where` à null pour la session seulement ; `setCategoryFinals` sans `categoryIds` enregistre les défauts ; `assertFinalsEditable` refuse une session lancée et accepte une session rouverte.
  - `zone des finales supprimée` : enregistrer les zones sans la zone des finales → `listWaveFinals` rend `finalsZoneId null`, `passagePlan` sans erreur.
  - `planInput` : `waveFinals` et `finals` des catégories lus ; `durationSec` = `fightSeconds(combatTiming(...))` + `changeoverSec` (combat), `kataPassages(n, bloc) × kataPassageSec` + `changeoverSec` (kata).
  - Figeage : `launchWave` écrit `finals_choice` = signature de chaque catégorie.
- [ ] **Step 2: Run** `npx vitest run tests/server/migration-0036.test.ts tests/server/wave-finals.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : schéma + `npx drizzle-kit generate --name finales`, puis ajouter à la main dans `0036_finales.sql` les `INSERT … SELECT` (sessions × compétitions, `json_extract(settings_json, '$.finalsZoneId')` existant dans `zones`) et l'`UPDATE` des catégories kata (`kataFinalsOnFinalsZone` faux ou absent). Retirer les deux clés des réglages (`readStoredSettings` ignore déjà les clés inconnues ; `mergeSettings` refusera désormais `finalsZoneId` : remplacer les appels des tests par `setFinalsZone`).
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): zone des finales par session et choix par catégorie en base (migration 0036)`

### Task 5: Synchronisation, sauvegardes, paquet d'avant

**Files:**
- Modify: `src/server/sync/package.ts` (`PACKAGE_TABLES` : `wave_finals` après `wave_schedules` ; références `['wave_finals','wave_key','waves']`, `['wave_finals','finals_zone_id','zones']` ; paquet sans `wave_finals` → `WAVE_FINALS_FROM_SETTINGS`)
- Test: `tests/server/sync-package.test.ts`, `tests/server/backups.test.ts`

**Interfaces:**
- Consumes: Task 4 (`WAVE_FINALS_FROM_SETTINGS`).

- [ ] **Step 1: Write the failing tests**
  - `aller-retour du paquet : finales gardées` (zone des finales, `finals_where/when`, `finals_choice`).
  - `paquet d'avant : finales reprises des réglages` (paquet sans `wave_finals`, `settings_json` avec `finalsZoneId`).
  - `référence vers une zone d'une autre compétition refusée`.
  - sauvegarde complète puis restauration : `wave_finals` présent.
- [ ] **Step 2: Run** `npx vitest run tests/server/sync-package.test.ts tests/server/backups.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `unclassifiedTables` doit rester vide.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): les choix des finales voyagent avec la compétition`

### Task 6: Routes « Finales » et refigeage

**Files:**
- Create: `src/server/routes/finals.ts` (enregistré comme les autres routes)
- Modify: `src/server/repositories/launches.ts` (`launchStatus.pending[].reason`, `numberPending` : `reason 'finals'` parmi les catégories → mode `'shuffle'` imposé), `src/server/repositories/wave-finals.ts` (`finalsView`)
- Test: `tests/server/finals-routes.test.ts`, `tests/server/launches.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `GET /api/competitions/:id/finals?vague=<id>` → `FinalsView { waveId: string | null; finalsZoneId: string | null; locked: boolean; rows: FinalsRow[]; summary: { zoneId: string; ownPassages: number; ready: number; end: number }[] }`, avec `FinalsRow { categoryId; label; zoneId: string | null; kata: boolean; kataSplit: boolean; noFinal: boolean; fixed: 'finals-zone' | 'not-accepted' | null; where: FinalsWhere; when: FinalsWhen }` (`noFinal` : tableau existant sans `finalMatchIds` ; `where`/`when` effectifs).
  - `PUT /api/competitions/:id/finals/zone` `{ waveId: string | null; finalsZoneId: string | null }` → `FinalsView`
  - `PUT /api/competitions/:id/finals/categories` `{ waveId: string | null; categoryIds?: string[]; where?: FinalsWhere; when?: FinalsWhen }` → `FinalsView`
  - Chaque écriture : `assertFinalsEditable`, puis `competitionChanged(id)` (rafraîchit les autres postes).
- [ ] **Step 1: Write the failing tests**
  - `GET` : lignes de la session dans l'ordre des catégories, `fixed`, `noFinal` (poule unique tirée), `summary` cohérent avec `passagePlan`.
  - `PUT zone` met tout sur la zone ; `PUT categories` sans `categoryIds` règle tout ; zone d'une autre compétition → 400.
  - `session lancée → 400` avec le texte exact ; rouverte → 200.
  - Compte Table centrale → 403 (rôle serveur), organisateur → 200.
  - `refigeage après changement de finale` : lancer, rouvrir, changer A → `launchStatus.pending` = A `reason 'finals'` ; `numberPending(…, 'append')` renumérote « mélangés » la zone de A et la zone des finales ; `A:w2-0` est juste après le dernier combat de A ; les passages joués gardent leur numéro.
- [ ] **Step 2: Run** `npx vitest run tests/server/finals-routes.test.ts tests/server/launches.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): routes de l'onglet Finales, refigeage mélangé quand une finale change`

### Task 7: Onglet « Finales », Réglages, fenêtre de refigeage

**Files:**
- Create: `src/web/pages/FinalsPage.tsx`
- Modify: `src/web/tabs.ts` (`{ path: 'finales', label: 'Finales' }` après `sessions`), `src/web/stages.ts` (Préparer : `…'sessions', 'finales', 'categories'…`), `src/web/App.tsx` (route `finales`), `src/web/api.ts` (`useFinals`, `useSetFinalsZone`, `useSetCategoryFinals`, types), `src/web/pages/CompetitionSettingsPage.tsx` (retirer « Finales sur la zone » et la case kata ; phrase « Les finales se règlent session par session dans l’onglet Finales. » avec lien), `src/web/components/WaveLaunchPanel.tsx` (fenêtre « Refiger » : si une catégorie à numéroter a `reason 'finals'`, « Mélangés » imposé, « À la suite » désactivé, texte exact des contraintes globales), `src/web/help.ts` (sujet `finales`, mise à jour de `reglages.ordre` et `combats.horaires`)
- Test: `tests/web/stages.test.ts`, `tests/web/poste.test.ts`, `tests/web/help.test.ts`, `tests/e2e/finales.spec.ts` (nouveau), `tests/e2e/figeage.spec.ts` (zone des finales réglée par l'onglet Finales), `tests/e2e/plusieurs-postes.spec.ts` (zone des finales posée par `PUT …/finals/zone` au lieu des réglages)

**Interfaces:**
- Consumes: Task 6 (`FinalsView`, routes).

- [ ] **Step 1: Write the failing tests**
  - `stages` : Préparer contient `finales` juste après `sessions` ; `poste` : Table centrale et Zone ne voient pas `finales`.
  - e2e `finales.spec.ts` (compétition « Finales onglet e2e », trois zones Tatami 1/2/3, deux sessions) :
    - choisir « Tatami 3 » → toutes les lignes sur « Tatami 3 » ; « Tout sur sa zone » puis une ligne remise sur « Tatami 3 » ; « Tout dès que finie » ; rechargement : choix gardés ;
    - ligne d'une catégorie de Tatami 3 : « sur Tatami 3 », sans interrupteur Où ; « Aucune » : colonne Où absente ;
    - résumé « Tatami 3 : … » présent ;
    - session figée : interrupteurs désactivés, « Rouvrez la session dans Combats pour changer. » ; rouverte puis changée : fenêtre « Refiger la session » avec « Mélangés » imposé et le texte exact ;
    - à 360 px : pas de débordement (`clipped()` de `tests/e2e/helpers.ts`).
  - `figeage.spec.ts` : réglage de la zone des finales déplacé vers l'onglet Finales, attentes inchangées.
- [ ] **Step 2: Run** `npx vitest run tests/web && npx playwright test tests/e2e/finales.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** la page selon la maquette A de la spec §3 : sélecteur de session (`SegmentedControl` comme Combats, absent sans session), `Select` « Zone des finales », `Table` avec `SegmentedControl` par ligne, boutons « Tout… » dans les en-têtes, résumé par zone ; enregistrement à chaque changement (mutation + invalidation de `['finals', id, waveId]`, `['schedule', id]`, statut de lancement) ; `ApiErrorAlert` pour les refus. Mise en page : tableau défilant horizontalement sous ~700 px plutôt que débordant.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): onglet Finales, réglages et refigeage`

### Task 8: Combats — « Prête · peut passer plus tôt »

**Files:**
- Modify: `src/server/repositories/results.ts` (`schedule`, `QueueItem.early`), `src/web/api.ts` (`QueueItem.early: boolean`), `src/web/components/ZoneQueueCard.tsx`
- Test: `tests/server/results.test.ts`, `tests/web/zone-cards.test.ts`

**Interfaces:**
- Consumes: `PassagePlan.finals` (Task 2).
- Produces: `QueueItem.early: boolean` — passage de finale (combat de `finalMatchIds` ou `kata:finale`) jouable, alors qu'un passage de numéro plus petit de la même zone et de la même session n'est pas encore joué ; jamais vrai pour le premier de la file.

- [ ] **Step 1: Write the failing tests**
  - `finale prête avant son tour` : finale « fin de session » de A jouable alors que B (même zone) n'a pas fini → `early true` ; au-delà des 6 premiers passages, elle est quand même dans la file (ajoutée après les 6).
  - Saisir son résultat hors ordre : accepté ; elle sort de la file, les autres gardent leurs numéros.
  - `zone-cards` : badge « Prête · peut passer plus tôt » (`data-testid="queue-early"`) sur une ligne `early`, absent sur la première.
- [ ] **Step 2: Run** `npx vitest run tests/server/results.test.ts tests/web/zone-cards.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): une finale prête avant son tour est signalée dans Combats`

### Task 9: Heures estimées et vue publique

**Files:**
- Modify: `src/domain/schedule/timeline.ts` (`TimelineItem.finals: FinalsWhen | null`, `TimelineItem.waitsFor?: string[]`, `TimelineInput.waves[].finalsZoneId`, suppression de `TimelineInput.finalsZoneId`), `src/domain/public/types.ts` (`PublicQueueItem.finals: FinalsWhen | null`, `PublicCompetition.finalsZones: Record<string, string | null>` par clé de session à la place de `finalsZoneId`), `src/domain/public/view.ts`, `src/domain/public/times.ts`, `src/server/public/load.ts`, composants publics qui lisent `finals` / `finalsZoneId` (Zones : ligne « Finales de la session … » avant la première finale « Fin de session » de la zone des finales ; badge « Finale » sur les autres passages de finale)
- Test: `tests/domain/schedule-timeline.test.ts`, `tests/domain/public-times.test.ts`, `tests/domain/public-view.test.ts`, `tests/web/public-zones.test.ts`

**Interfaces:**
- Consumes: `PassagePlan.finals` (Task 2), `listWaveFinals` (Task 4).

- [ ] **Step 1: Write the failing tests** (`schedule-timeline.test.ts`)
  - `fin de session sur sa zone, sans « Finales à »` : à la suite de la file, sans attendre les autres zones.
  - `fin de session sur sa zone, avec « Finales à »` : la première attend « Finales à » ; idem sur la zone des finales (règle existante gardée, attente aussi de la fin des éliminatoires).
  - `dès que finie sur la zone des finales` : départ ≥ fin estimée des passages `waitsFor` (sa catégorie, sur une autre zone).
  - `finale jouée en avance` : sur t1, passages 1–3 non joués, finale n° 4 jouée (fin 10:20) → 1–3 ne sont pas « saisis en retard » : départs ≥ 10:20 + changement, aucun ≤ maintenant ; « en cours » = premier passage non joué.
  - `finale avancée puis effacée` : résultat retiré → retour aux heures normales.
  - `public-view` : `finals` vaut `'ready'` / `'end'` / null selon le plan ; `finalsZones` par session.
- [ ] **Step 2: Run** `npx vitest run tests/domain tests/web/public-zones.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** : les finales jouées hors ordre (`finals !== null` et `endedAt` non null après des passages non joués) ne comptent pas comme « dernier joué » pour la règle des passages saisis en retard ; elles poussent le curseur de leur zone à leur fin + changement avant de placer les passages restants.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(finales): heures estimées par choix de finale, finale jouée en avance`

### Task 10: Guide, feuille de route, vérifications

**Files:**
- Modify: `docs/guide-utilisateur.md` (section Finales ; Réglages « Ordre de passage » ; Combats « Prête »), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 43), `docs/superpowers/plans/2026-10-21-99-bilan.md` (section étape 43)

- [ ] **Step 1: Mettre à jour** le guide (aucune mention restante de « Finales de kata aussi sur cette zone »), la feuille de route et le bilan.
- [ ] **Step 2: Run** `npm run typecheck && npm test` — Expected: tout réussi (noter le nombre).
- [ ] **Step 3: Run** la suite e2e complète en une passe `npx playwright test` — Expected: aucun échec (noter le nombre et la durée).
- [ ] **Step 4: Contrôle sur Chrome** (extension Claude in Chrome, copie de la base de démo sur un port temporaire, jamais `data/shidokan.sqlite` depuis l'hôte) : onglet Finales clair et sombre, ~1040 px et 360 px ; figer, rouvrir, changer, refiger ; Combats avec une finale prête ; vue publique Zones. Puis contrôle téléphone (simulateur iOS + idb) de l'onglet Finales et de la vue publique.
- [ ] **Step 5: Commit** `docs(finales): guide, feuille de route et bilan de l'étape 43`
