# Durée des finales — plan (étape 46)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une durée de finale (rounds, round, repos, prolongation) par groupe d'âge dans Réglages, et par tableau dans Tableaux, utilisée pour les heures estimées.

**Architecture:** les données de durée gagnent un champ « finale » (`ScheduleSettings.finals` par groupe d'âge, `CategoryDurations.finals`), tous deux `null` = « comme les autres combats ». `combatTiming` reçoit `isFinal` et applique la précédence de la spec ; chaque appelant le calcule avec `finalMatchIds`. Pas de migration SQL : réglages et `categories.durations_json` sont du JSON.

**Tech Stack:** TypeScript 7, zod, React + Mantine, Fastify, Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-11-15-duree-des-finales-design.md`

## Global Constraints

- Branche `etape-46-duree-des-finales` depuis `main` ; ff-merge dans `main` à la fin, push sur demande seulement.
- Texte de l'interface en français, guillemets « », apostrophe typographique ’ dans les libellés (comme l'existant).
- Libellés exacts : ligne « Finale » ; choix Réglages « Comme les autres combats » / « Autre » ; choix Tableaux « Comme les autres combats du tableau » / « Autre » ; champs « Rounds », « Round », « Repos », « Prolongation ».
- Bornes : rounds 1–12 (triathlon compris pour la finale), round 10–900 s, repos 0–600 s, prolongation 0–900 s (`combatTimingSchema`).
- Une finale = `finalMatchIds(bracket)` (`src/domain/passages/finals.ts`), rien d'autre (pas `third`).
- Absent dans des données stockées, une sauvegarde ou un paquet = `null` ; ne jamais rendre la lecture plus stricte.
- Aucune donnée réelle (noms) dans les tests ni les commits.

## Review Focus

1. Réglages enregistrés avant l'étape (pas de `schedule.finals`) → la page s'ouvre, finales « Comme les autres combats », heures inchangées (test Tâche 1).
2. `durations_json` stocké avant l'étape (`{bracket, matches}` sans `finals`) → lu sans erreur, finale du tableau `null` ; PATCH d'un ancien poste sans `finals` accepté (tests Tâches 1 et 2).
3. Tableau repassé sur « Comme la compétition » → sa finale propre disparaît aussi (pas de finale fantôme invisible à l'écran) (test Tâche 4).
4. Triathlon : finale de compétition en 2 rounds alors que « Rounds de triathlon » = 6 → la finale fait 2 rounds, les autres combats 6 (test Tâche 1).
5. Tableau sans finale (poule unique) ou combat unique d'une catégorie à 2 → aucune erreur ; le combat unique prend la durée de finale (tests Tâche 2).

---

### Task 1: Domaine — champs « finale » et précédence

**Files:**
- Modify: `src/domain/schedule/durations.ts`
- Test: `tests/domain/schedule-durations.test.ts`

**Interfaces:**
- Produces:
  - `ScheduleSettings.finals: Record<AgeGroup, CombatTiming | null>` ; schéma `finals: z.object({ under14, youth, adults, triathlon: combatTimingSchema.nullable() }).strict()` dans `scheduleSettingsSchema` ; `defaultSchedule().finals` = les quatre à `null`. (La lecture tolérante passe par `readStoredSettings`, qui fusionne avec les défauts : un ancien `schedule` sans `finals` reste valide.)
  - `CategoryDurations.finals: CombatTiming | null` ; schéma `finals: combatTimingSchema.nullable().default(null)` (ancien JSON et ancien client acceptés).
  - `combatTiming(s, group, durations, matchId, isFinal: boolean): CombatTiming` — précédence : `durations.matches[matchId]` → (isFinal) `durations.finals` → `durations.bracket` → (isFinal) `s.schedule.finals[group]` → groupe (triathlon : `rounds = s.triathlonRounds`). La finale de compétition du triathlon garde ses propres rounds.
  - `isEmptyDurations(d: CategoryDurations): boolean` — `bracket === null && finals === null && matches` vide (remplace le test inline de `CategoryDurations.tsx`).

- [ ] **Step 1: Write the failing tests** (adapter les appels existants à `combatTiming(..., isFinal)`)

```ts
const s = { schedule: defaultSchedule(), triathlonRounds: 3 as const };
const three = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 };
const short = { rounds: 1, roundSec: 60, restSec: 0, overtimeSec: 0 };
const fin = { rounds: 4, roundSec: 90, restSec: 30, overtimeSec: 60 };

test('defaults have no finals duration', () => {
  expect(defaultSchedule().finals).toEqual({ under14: null, youth: null, adults: null, triathlon: null });
});
test('finals precedence: match, bracket finals, bracket, competition finals, group', () => {
  const comp = { ...s, schedule: { ...s.schedule, finals: { ...s.schedule.finals, adults: fin } } };
  expect(combatTiming(comp, 'adults', null, 'w2-0', true)).toEqual(fin);
  expect(combatTiming(comp, 'adults', null, 'w1-0', false)).toEqual(defaultSchedule().groups.adults);
  expect(combatTiming(comp, 'youth', null, 'w2-0', true)).toEqual(defaultSchedule().groups.youth); // autre groupe : pas de finale propre
  expect(combatTiming(comp, 'adults', { bracket: short, finals: null, matches: {} }, 'w2-0', true)).toEqual(short); // tableau « Autre » sans finale propre
  expect(combatTiming(comp, 'adults', { bracket: short, finals: three, matches: {} }, 'w2-0', true)).toEqual(three);
  expect(combatTiming(comp, 'adults', { bracket: short, finals: three, matches: {} }, 'w1-0', false)).toEqual(short);
  expect(combatTiming(comp, 'adults', { bracket: short, finals: three, matches: { 'w2-0': fin } }, 'w2-0', true)).toEqual(fin);
});
test('triathlon finals keep their own rounds', () => {
  const two = { rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 120 };
  const comp = { schedule: { ...defaultSchedule(), finals: { ...defaultSchedule().finals, triathlon: two } }, triathlonRounds: 6 as const };
  expect(combatTiming(comp, 'triathlon', null, 'w2-0', true).rounds).toBe(2);
  expect(combatTiming(comp, 'triathlon', null, 'w1-0', false).rounds).toBe(6);
});
test('stored data from before finals stays readable', () => {
  const old = { groups: defaultSchedule().groups, changeoverSec: 60, kataPassageSec: 90 };
  expect(readStoredSettings({ schedule: old }).schedule.finals).toEqual(defaultSchedule().finals);
  expect(readStoredSettings({ schedule: { ...old, groups: { ...old.groups, adults: three } } }).schedule.groups.adults).toEqual(three);
  expect(categoryDurationsSchema.parse({ bracket: short, matches: {} })).toEqual({ bracket: short, finals: null, matches: {} });
  expect(readStoredSettings({ schedule: { finals: { adults: fin } } }).schedule.finals.adults).toEqual(fin);
});
test('empty durations', () => {
  expect(isEmptyDurations({ bracket: null, finals: null, matches: {} })).toBe(true);
  expect(isEmptyDurations({ bracket: null, finals: fin, matches: {} })).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/domain/schedule-durations.test.ts` — Expected: FAIL (`finals` absent, `isEmptyDurations` non défini).
- [ ] **Step 3: Implement** the Interfaces above in `src/domain/schedule/durations.ts` (mettre à jour le commentaire de `combatTiming`).
- [ ] **Step 4: Run** `npx vitest run tests/domain/schedule-durations.test.ts tests/domain/settings.test.ts` — Expected: PASS. `npm run typecheck` signale alors seulement les trois appelants de `combatTiming` : c'est attendu, la Tâche 2 les corrige (branche non poussée entre les deux).
- [ ] **Step 5: Commit** `feat(durees): durée de finale dans les données de durée`

### Task 2: Heures — les appelants savent si le combat est une finale

**Files:**
- Modify: `src/server/repositories/passages.ts:~86`, `src/domain/public/view.ts:~219-223`, `src/web/components/CategoryDurations.tsx` (appels `combatTiming` seulement, pour compiler : `inherited` → `isFinal=false`, `pick` → `finalMatchIds(bracket).includes(matchId)`)
- Test: `tests/server/wave-finals.test.ts` (describe « plan de passage »), `tests/server/public-routes.test.ts`

**Interfaces:**
- Consumes: `combatTiming(..., isFinal)` (Tâche 1), `finalMatchIds(bracket: CombatBracket): string[]` (`src/domain/passages/index.js`).
- Produces: rien de nouveau ; `PlanInput.durationSec` et `timingOf` dans la vue publique tiennent compte des finales. Calculer `finalMatchIds` une fois par catégorie (Set), pas à chaque passage.

- [ ] **Step 1: Write the failing tests**

Dans `tests/server/wave-finals.test.ts`, nouveau test du describe « plan de passage » :

```ts
test('la finale prend la durée de finale du tableau, sinon de la compétition', async () => {
  const s = await setup();
  const fin = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 60 };
  await call('PATCH', '', { settings: { schedule: { finals: { youth: fin } } } }); // cadettes = 14 à 17 ans
  const input = await planInput(db, id);
  const finalId = finalMatchIds(input.categories.find((c) => c.id === s.a54)!.bracket as CombatBracket)[0]!;
  let duration = input.durationSec!;
  expect(duration(s.a54, finalId)).toBe(3 * 120 + 2 * 60 + 60);
  expect(duration(s.a54, 'w1-0')).toBe(2 * 120 + 60 + 60);
  await call('PATCH', `/categories/${s.a54}`, { durations: { bracket: { rounds: 1, roundSec: 100, restSec: 0, overtimeSec: 0 }, matches: {} } }); // ancien client : pas de `finals`
  duration = (await planInput(db, id)).durationSec!;
  expect(duration(s.a54, finalId)).toBe(100 + 60); // tableau « Autre » sans finale propre
  await call('PATCH', `/categories/${s.a54}`, { durations: { bracket: { rounds: 1, roundSec: 100, restSec: 0, overtimeSec: 0 }, finals: { rounds: 2, roundSec: 100, restSec: 20, overtimeSec: 0 }, matches: {} } });
  duration = (await planInput(db, id)).durationSec!;
  expect(duration(s.a54, finalId)).toBe(2 * 100 + 20 + 60);
});
```

(Adapter la route de PATCH des réglages et l'accès au bracket aux helpers du fichier ; si `s.a54` n'a que 2 combattants, l'unique combat est la finale — le test reste valable, retirer alors la ligne `w1-0` et ajouter une catégorie de 4 si le fichier en a une.)

Dans `tests/server/public-routes.test.ts`, nouveau test `public view uses the finals duration for the final` : après `launch()`, régler `schedule.finals` du groupe de la catégorie du fixture, relire la vue publique, et vérifier que l'item de la file dont `matchId` est la finale (`finalMatchIds`) a un `durationSec` égal à la durée de finale + changement, et qu'un item non-finale garde l'ancienne valeur.

- [ ] **Step 2: Run** `npx vitest run tests/server/wave-finals.test.ts tests/server/public-routes.test.ts` — Expected: FAIL (durée de finale ignorée).
- [ ] **Step 3: Implement** — passer `isFinal` dans les trois appelants.
- [ ] **Step 4: Run** the same command, puis `npm run typecheck` et `npx vitest run` — Expected: PASS, typecheck propre.
- [ ] **Step 5: Commit** `feat(durees): les heures prennent la durée de finale`

### Task 3: Réglages → Durées des combats : ligne « Finale »

**Files:**
- Modify: `src/web/pages/CompetitionSettingsPage.tsx:~315-332`, `src/web/help.ts` (`reglages.durees`), `docs/guide-utilisateur.md:186`
- Test: `tests/e2e/duree-des-finales.spec.ts` (nouveau ; nom de compétition unique, ex. « Coupe durée finales »)

**Interfaces:**
- Consumes: `ScheduleSettings.finals` (Tâche 1).
- Produces: `data-testid` `durations-finals-<group>` (le Select) et `durations-finals-fields-<group>` (les quatre champs) — réutilisés par l'e2e de la Tâche 4.

Sous chaque groupe (`data-testid="durations-<g>"`) : Select « Finale » [« Comme les autres combats », « Autre »]. « Autre » → `finals[g] = { ...groups[g] }` (pour le triathlon, `rounds: s.triathlonRounds`) et quatre champs Rounds (NumberInput 1–12, aussi pour le triathlon), Round, Repos, Prolongation, avec `durationFields.field('<g>.finals.round' …)` pour bloquer « Enregistrer ». Retour à « Comme les autres combats » → `finals[g] = null`. L'enregistrement passe par `settingsPatch` (diff feuille à feuille ; `null` ↔ objet fonctionne déjà).

Aide `reglages.durees` : ajouter un détail « Finale : par groupe d’âge, une autre durée pour les combats pour la 1re place (finale, grande finale, combat unique, manches d’un meilleur des trois ; pas la petite finale). Un tableau avec sa propre durée a aussi sa ligne Finale. » ; ajuster la phrase de précédence : « le combat l’emporte sur le tableau (et sa finale), qui l’emporte sur la compétition (et sa finale) ». Guide : même ajout à la ligne 186-187.

- [ ] **Step 1: Write the failing e2e** `réglages : finale des 18 ans et plus en 3 rounds` — ouvrir Réglages (`#durees`), choisir « Autre » dans `durations-finals-adults`, mettre Rounds à 3, « Enregistrer » (`settings-save`), recharger la page : le Select vaut « Autre » et Rounds = 3 ; `GET /api/competitions/:id` → `settings.schedule.finals.adults.rounds === 3` et `finals.youth === null`. Puis remettre « Comme les autres combats », enregistrer → `finals.adults === null`. Saisir un Round illisible (`1:5`) dans la ligne Finale → `settings-invalid` visible et `settings-save` désactivé.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/duree-des-finales.spec.ts` — Expected: FAIL (pas de `durations-finals-adults`).
- [ ] **Step 3: Implement** la ligne, l'aide et le guide.
- [ ] **Step 4: Run** the e2e + `npx vitest run tests/web/help.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(reglages): ligne Finale dans les durées des combats`

### Task 4: Tableaux → Durée des combats : prolongation et ligne « Finale »

**Files:**
- Modify: `src/web/components/CategoryDurations.tsx`, `src/web/help.ts` (`tableaux.durees`)
- Test: `tests/e2e/duree-des-finales.spec.ts`, `tests/web/category-durations.test.ts` (nouveau, si la logique de préremplissage est extraite)

**Interfaces:**
- Consumes: `combatTiming(..., isFinal)`, `isEmptyDurations`, `CategoryDurations.finals` (Tâche 1), `finalMatchIds`.
- Produces: `data-testid` `durations-own-finals` (Select « Finale ») et `durations-own-finals-fields`.

Comportement :
- `TimingFields` gagne le champ « Prolongation » (MinSecInput 0–900) ; le commentaire « la prolongation reste celle de la compétition » disparaît. Les exceptions l'ont donc aussi.
- Libellé « Comme la compétition (…) » : ajoute `, finale ${timingText(f)}` quand `schedule.finals[group]` existe.
- Mode « Autre » (un seul formulaire, un seul « Enregistrer ») : ligne des combats, puis Select « Finale » [« Comme les autres combats du tableau », « Autre »] et ses quatre champs. En passant le tableau de « Comme la compétition » à « Autre », le brouillon de finale = `schedule.finals[group]` s'il existe (Select sur « Autre »), sinon `null`. « Autre » choisi à la main → préremplit avec la ligne des combats du brouillon. Fonction pure à extraire et tester : `draftFromCompetition(base, group): { bracket: CombatTiming; finals: CombatTiming | null }`.
- Enregistrer → `{ bracket, finals, matches }`. Revenir à « Comme la compétition » → `{ bracket: null, finals: null, matches }` (envoie `null` si `isEmptyDurations`).
- Lecture seule : « 2 × 2 min, repos 60 s » puis, si finale propre, « Finale : 3 × 2 min, repos 60 s ».
- Préremplissage d'une exception : `combatTiming(..., finalMatchIds(bracket).includes(matchId))`.

Aide `tableaux.durees` : « Durée d’un combat = … Un combat avec une exception prend sa durée ; sinon une finale prend la finale du tableau, puis le tableau, puis la finale de la compétition, puis la compétition. »

- [ ] **Step 1: Write the failing tests**
  - Unit (`tests/web/category-durations.test.ts`) : `draftFromCompetition` renvoie `finals: null` sans finale de compétition, et la finale du groupe sinon.
  - e2e `tableaux : finale propre au tableau, reprise de la compétition` (seed : 4 combattantes cadettes -54 comme `tableaux.spec.ts`) : via l'API, `schedule.finals.youth = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 60 }` ; Tableaux, Liste, catégorie -54 → `durations-mode` montre « finale 3 × 2 min » ; choisir « Autre » → `durations-own-finals` vaut « Autre » avec Rounds = 3 ; mettre Rounds des combats à 1 et Prolongation à `0:30`, Enregistrer → `GET categories` : `durations = { bracket: { rounds: 1, …, overtimeSec: 30 }, finals: { rounds: 3, … }, matches: {} }` ; revenir à « Comme la compétition » → `durations === null`.
  - e2e : ajouter une exception sur la « Finale » sans finale de tableau → les champs sont préremplis avec la finale de compétition (Rounds = 3).
- [ ] **Step 2: Run** `npx vitest run tests/web/category-durations.test.ts && npx playwright test tests/e2e/duree-des-finales.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** le comportement ci-dessus.
- [ ] **Step 4: Run** the same commands + `npm run typecheck` — Expected: PASS. Vérifier aussi le bloc à 360 px (`clipped(page)` de `tests/e2e/helpers.ts` vide dans l'e2e).
- [ ] **Step 5: Commit** `feat(tableaux): ligne Finale et prolongation dans la durée du tableau`

### Task 5: Vérifications et documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (« ## Étape 46 : durée des finales »), `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1:** `npm run typecheck && npx vitest run && npx playwright test` — Expected: tout vert (2124+ unit / 221+ e2e au départ). Un seul run Playwright à la fois.
- [ ] **Step 2:** Vérification sur Chrome (extension Claude in Chrome, serveur local sur une copie de base de démo, jamais la base live) : Réglages (ligne Finale, triathlon), Tableaux (finale reprise, prolongation, lecture seule sur un poste Zone), heure « vers » d'une finale dans Combats / spectateur qui change avec la durée ; thème sombre et 360 px.
- [ ] **Step 3:** Feuille de route + bilan (décisions : prolongation ajoutée dans Tableaux ; finale de tableau effacée en revenant à « Comme la compétition » ; un vieux poste d'avant l'étape qui lirait des réglages avec `finals` retomberait sur les durées par défaut — sans objet tant que tous les postes ont la même version).
- [ ] **Step 4: Commit** `docs: étape 46 durée des finales réalisée`
