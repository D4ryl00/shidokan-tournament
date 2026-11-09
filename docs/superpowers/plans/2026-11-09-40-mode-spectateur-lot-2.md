# Mode spectateur, lot 2 (heures et durées) — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur la page publique, chaque passage a une heure estimée (« vers 10:55 ») qui se recale au fil des résultats, chaque
zone dit son avance ou son retard, et l'organisation saisit les heures des sessions et les durées des combats.

**Architecture:** Les ingrédients (heures des sessions, durée de chaque passage, heure de fin des passages joués) voyagent
dans la vue publique, mise en cache comme au lot 1. Le calcul de la ligne de temps est une fonction **pure** du domaine
(`src/domain/schedule/`), exécutée **dans le navigateur** avec l'heure courante : le cache du serveur ne dépend pas de
« maintenant », et les téléphones recalculent seuls chaque minute.

**Tech Stack:** TypeScript 7 (natif), Fastify, better-sqlite3 + drizzle, React + Mantine 8 (`@mantine/dates` pour
`TimeInput`) + TanStack Query, Vitest, Playwright sur Chrome.

**Spec:** `docs/superpowers/specs/2026-11-08-mode-spectateur-design.md` : §5 (heures et durées), §3.2 (Suivis, Zones,
Tableaux), §3.1 (À venir), §3.6, §7 et le lot 2 du §8. Le lot 1 est dans `main` (plan
`2026-11-08-39-mode-spectateur-lot-1.md`, bilan « étape 39 »).

**Branche :** `etape-40-mode-spectateur-lot-2`, depuis `main`. Gel le **18 novembre 2026** (spec §8) : si le lot n'est pas
fusionné, vérifié sur Chrome et poussé à cette date, il attend la compétition suivante.

## Global Constraints

- Interface en français ; composants et jetons existants (`src/web/components/ui/`, `--sk-*`), clair et sombre ; 360 px
  sans défilement horizontal (helper e2e `clipped()`). Pas de « (e) » dans les textes (`tests/web/textes.test.ts`).
- À l'écran « session » (pas « vague ») ; dans le code, `wave`.
- Heures saisies au format `HH:MM` (24 h, heure de Paris, le jour de la compétition). Heures affichées arrondies à la
  minute, précédées de « vers » pour une estimation.
- Rien d'une session **non lancée** sur la page publique, sauf son **heure prévue** (spec §3.1 et §3.6). Pas d'heure de
  démarrage ni de finales pour une session non lancée.
- Historique (compétition passée) : ni heures ni durées affichées (spec §3.4).
- Durée d'un combat = rounds × durée d'un round + (rounds − 1) × repos. Le temps de changement s'ajoute **après** chaque
  passage. Les prolongations ne sont **pas** comptées (affichées seulement dans les réglages).
- Valeurs par défaut (spec §5.2) :

  | Groupe | Rounds | Round | Repos | Prolongation |
  |---|---|---|---|---|
  | `under14` (moins de 14 ans) | 2 | 90 s | 30 s | 60 s |
  | `youth` (14 à 17 ans) | 2 | 120 s | 60 s | 60 s |
  | `adults` (18 ans et plus) | 2 | 120 s | 60 s | 120 s |
  | `triathlon` | `settings.triathlonRounds` (3 par défaut) | 120 s | 60 s | 120 s |

  Changement entre deux passages : 60 s. Kata : 90 s par passage.
- Précédence des durées : combat, puis tableau, puis compétition.
- `noRest` de l'ordre de passage veut dire « prévoir une pause », pas « pas de pause » : il n'entre **pas** dans le calcul
  (spec §5.2 demandait de le réutiliser seulement s'il voulait dire « pas de pause »).
- Saisie des heures et des durées d'un tableau : organisateur **et** Table centrale. Durées de la compétition : organisateur
  (page Réglages, comme le reste).
- Le paquet de synchronisation, les sauvegardes et la restauration transportent les nouvelles données ; un paquet d'avant
  la migration 0035 s'importe sans erreur (aucune heure).
- e2e du serveur (port 3101) : **aucune connexion de plus** (limite 10 / IP / 15 min) — `SERVER_SESSION` pour
  l'organisateur, contexte sans session pour le visiteur. Ne jamais lancer deux `npx playwright test` en même temps.
- Ne jamais ouvrir `data/shidokan.sqlite` avec sqlite3 depuis l'hôte.
- Hors de ce plan : l'heure de pesée des sessions suivantes (spec §3.2 « si connue ») — aucune donnée ne la porte et la
  migration de la spec §7 ne la prévoit pas ; les heures dans les écrans de l'organisation (seulement la saisie).
- Vérification sur Chrome (Claude in Chrome) de chaque changement visible, y compris à largeur de téléphone (contrôleur).

## Review Focus

1. **« Reprendre les numéros à 1 »** : la session 2 recommence au n° 1 sur une zone, et les files publiques sont triées
   par numéro : la ligne de temps doit suivre l'**ordre des sessions** puis l'ordre dans la session, pas le numéro seul.
   → test `restart numbering keeps wave order` (Task 3).
2. **Résultats saisis dans le désordre ou corrigés** (un combat plus loin dans la file fini avant un autre) : l'heure ne
   recule pas, la suite part de la **plus tardive** des fins connues sur la zone. → test `out-of-order results never move
   the cursor back` (Task 3).
3. **Session lancée sans heure prévue ni démarrage, aucun résultat** : aucune heure affichée (ni « vers NaN:NaN », ni
   « vers 0:00 »), avance / retard absent. → tests `no start known gives no times` (Task 3) et `ZonesTab without times`
   (Task 6).
4. **Tableau libre** (sans tranche d'âge) et **triathlon en 6 rounds** : groupe `adults`, et 6 rounds pris de
   `settings.triathlonRounds`. → tests `free tableau is adults` et `triathlon rounds follow the setting` (Task 1).
5. **Page ouverte un autre jour que celui de la compétition** (veille, ou historique) et **heure d'hiver** : pas de
   « maintenant » hors du jour J ; une heure de résultat ISO (UTC) devient la bonne heure de Paris le 22 novembre (UTC+1).
   → tests `isoToDaySeconds uses Paris winter offset` et `now is null on another day` (Task 3).

---

## Fichiers

- Create `src/domain/schedule/durations.ts` (durées, groupes, textes), `src/domain/schedule/clock.ts` (heures ↔ secondes),
  `src/domain/schedule/timeline.ts` (ligne de temps, avance / retard), `src/domain/schedule/types.ts` (`WaveSchedule`)
- Create `src/domain/public/times.ts` (ligne de temps d'une vue publique)
- Create `drizzle/0035_horaires.sql` (+ `drizzle/meta/0035_snapshot.json` par `npm run db:generate`)
- Create `src/server/repositories/wave-schedules.ts`, `src/server/routes/wave-schedules.ts`
- Modify `src/domain/settings.ts` (`schedule`), `src/domain/categories.ts` (`Category.durations`),
  `src/server/db/schema.ts`, `src/server/repositories/categories.ts`, `src/server/routes/categories.ts`,
  `src/server/repositories/waves.ts`, `src/server/sync/package.ts`, `src/server/auth/permissions.ts`, `src/server/app.ts`
- Modify `src/domain/public/types.ts`, `src/domain/public/view.ts`, `src/domain/public/follow.ts`,
  `src/server/public/load.ts`
- Modify `src/web/api.ts`, `src/web/pages/CompetitionSettingsPage.tsx`, `src/web/components/WaveLaunchPanel.tsx`,
  `src/web/pages/BracketsPage.tsx`; Create `src/web/components/CategoryDurations.tsx`, `src/web/components/MinSecInput.tsx`
- Modify `src/web/components/public/FollowTab.tsx`, `src/web/pages/public/ZonesTab.tsx`,
  `src/web/components/public/zoneRows.ts`, `src/web/pages/public/BracketsTab.tsx`, `src/web/pages/public/PublicHomePage.tsx`,
  `src/web/pages/public/PublicCompetitionPage.tsx`, `src/web/pages/public/tabProps.ts`; Create
  `src/web/components/public/useNow.ts`
- Modify `src/web/help.ts`, `docs/guide-utilisateur.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`,
  `docs/superpowers/plans/2026-10-21-99-bilan.md`
- Tests : `tests/domain/schedule-durations.test.ts`, `tests/domain/schedule-clock.test.ts`,
  `tests/domain/schedule-timeline.test.ts`, `tests/domain/public-times.test.ts`, `tests/server/migration-0035.test.ts`,
  `tests/server/wave-schedules.test.ts`, compléments de `tests/domain/public-view.test.ts`,
  `tests/server/public-routes.test.ts`, `tests/server/sync-package.test.ts`, `tests/server/permissions.test.ts`,
  `tests/web/zone-rows.test.ts` (ou le test existant de `zoneRows`), `tests/e2e/spectateur-horaires.spec.ts`

---

### Task 1: Durées des combats (domaine pur et réglage de la compétition)

**Files:**
- Create: `src/domain/schedule/durations.ts`, `tests/domain/schedule-durations.test.ts`
- Modify: `src/domain/settings.ts` (clé `schedule` dans `competitionSettingsSchema` et `defaultSettings`),
  `src/domain/api-schemas.ts` (libellé de la clé, comme `triathlonRounds: 'rounds de triathlon'`)

**Interfaces:**
- Produces:
  - `interface CombatTiming { rounds: number; roundSec: number; restSec: number; overtimeSec: number }`
  - `const combatTimingSchema` (zod, `.strict()`) : `rounds` entier 1–12, `roundSec` 10–900, `restSec` 0–600,
    `overtimeSec` 0–900
  - `type AgeGroup = 'under14' | 'youth' | 'adults' | 'triathlon'`
  - `interface ScheduleSettings { groups: Record<AgeGroup, CombatTiming>; changeoverSec: number; kataPassageSec: number }`
    (`changeoverSec` 0–900, `kataPassageSec` 10–900) et `scheduleSettingsSchema`, `defaultSchedule(): ScheduleSettings`
  - `interface CategoryDurations { bracket: CombatTiming | null; matches: Record<string, CombatTiming> }` et
    `categoryDurationsSchema` (au plus 200 entrées dans `matches`)
  - `ageGroupOf(key: CategoryKey, grid: CategoryGrid): AgeGroup`
  - `combatTiming(s: { schedule: ScheduleSettings; triathlonRounds: 3 | 6 }, group: AgeGroup, durations: CategoryDurations | null, matchId: string | null): CombatTiming`
  - `fightSeconds(t: CombatTiming): number` ; `kataPassages(activeEntrants: number, block: 'whole' | 'tour1' | 'finale'): number`
  - `minSecText(sec: number): string` ; `timingText(t: CombatTiming): string` ; `parseMinSec(text: string): number | null`

- [ ] **Step 1: Écrire les tests** (`tests/domain/schedule-durations.test.ts`)

```ts
test('defaults follow the rulebook', () => {
  const s = defaultSchedule();
  expect(s.groups.under14).toEqual({ rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 });
  expect(s.groups.youth).toEqual({ rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 60 });
  expect(s.groups.adults).toEqual({ rounds: 2, roundSec: 120, restSec: 60, overtimeSec: 120 });
  expect(s.groups.triathlon).toEqual({ rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 });
  expect(s.changeoverSec).toBe(60);
  expect(s.kataPassageSec).toBe(90);
});
test('age group comes from the highest band of the key', () => {
  // grille FFK : minime 12–13, cadet 14–15, junior 16–17, senior 18–34, v5 sans borne
  expect(ageGroupOf(key({ ageBandCodes: ['minime'] }), ffkDefaultGrid())).toBe('under14');
  expect(ageGroupOf(key({ ageBandCodes: ['minime', 'cadet'] }), ffkDefaultGrid())).toBe('youth');
  expect(ageGroupOf(key({ ageBandCodes: ['junior'] }), ffkDefaultGrid())).toBe('youth');
  expect(ageGroupOf(key({ ageBandCodes: ['senior'] }), ffkDefaultGrid())).toBe('adults');
  expect(ageGroupOf(key({ ageBandCodes: ['v5'] }), ffkDefaultGrid())).toBe('adults');
  expect(ageGroupOf(key({ discipline: 'triathlon', ageBandCodes: ['minime'] }), ffkDefaultGrid())).toBe('triathlon');
});
test('free tableau is adults', () => {
  expect(ageGroupOf(freeKey('Démo', 'karate', 'jiyu'), ffkDefaultGrid())).toBe('adults');
});
test('triathlon rounds follow the setting', () => {
  const t = combatTiming({ schedule: defaultSchedule(), triathlonRounds: 6 }, 'triathlon', null, null);
  expect(t.rounds).toBe(6);
  expect(fightSeconds(t)).toBe(6 * 120 + 5 * 60);
});
test('match beats bracket beats competition', () => {
  const s = { schedule: defaultSchedule(), triathlonRounds: 3 as const };
  const three = { rounds: 3, roundSec: 120, restSec: 60, overtimeSec: 120 };
  const short = { rounds: 1, roundSec: 60, restSec: 0, overtimeSec: 0 };
  const d = { bracket: short, matches: { final: three } };
  expect(combatTiming(s, 'adults', d, 'final')).toEqual(three);
  expect(combatTiming(s, 'adults', d, 'm1')).toEqual(short);
  expect(combatTiming(s, 'adults', null, 'm1')).toEqual(defaultSchedule().groups.adults);
  // tableau en 6 rounds imposé : le réglage du triathlon ne l'écrase pas
  expect(combatTiming({ ...s, triathlonRounds: 6 }, 'triathlon', { bracket: three, matches: {} }, null).rounds).toBe(3);
});
test('fight seconds and texts', () => {
  expect(fightSeconds({ rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 })).toBe(210);
  expect(timingText({ rounds: 2, roundSec: 90, restSec: 30, overtimeSec: 60 })).toBe('2 × 1 min 30');
  expect(timingText({ rounds: 1, roundSec: 120, restSec: 0, overtimeSec: 0 })).toBe('1 × 2 min');
  expect(minSecText(30)).toBe('30 s');
  expect(minSecText(65)).toBe('1 min 05');
  expect(parseMinSec('1:30')).toBe(90);
  expect(parseMinSec('2')).toBe(120);   // minutes seules
  expect(parseMinSec('0:45')).toBe(45);
  expect(parseMinSec('1:75')).toBeNull();
  expect(parseMinSec('abc')).toBeNull();
});
test('kata passages', () => {
  expect(kataPassages(5, 'whole')).toBe(7);   // tour 1 (5) + finale (2)
  expect(kataPassages(2, 'whole')).toBe(2);   // deux katakas : finale seule
  expect(kataPassages(5, 'tour1')).toBe(5);
  expect(kataPassages(5, 'finale')).toBe(2);
  expect(kataPassages(1, 'finale')).toBe(1);
});
test('stored settings without schedule fall back to defaults', () => {
  expect(readStoredSettings({}).schedule).toEqual(defaultSchedule());
  expect(readStoredSettings({ schedule: { changeoverSec: -5 } }).schedule).toEqual(defaultSchedule());
});
```

`key(...)` est un petit fabricant local (`discipline: 'karate'`, `ruleset: 'jiyu'`, `sex: 'M'`, `weightClassIds: []` par
défaut).

- [ ] **Step 2: Lancer, vérifier l'échec** — `npx vitest run tests/domain/schedule-durations.test.ts` → FAIL (module absent).

- [ ] **Step 3: Écrire `src/domain/schedule/durations.ts` et la clé `schedule` des réglages**

`ageGroupOf` : discipline `triathlon` → `'triathlon'` ; sinon la plus grande `maxAge` des tranches de la clé (une tranche
sans borne haute, ou une clé sans tranche connue → `'adults'`) : ≤ 13 → `under14`, ≤ 17 → `youth`, sinon `adults`.
`combatTiming` : `durations.matches[matchId]`, sinon `durations.bracket`, sinon le groupe de la compétition ; pour le groupe
`triathlon` pris **dans la compétition**, `rounds` = `triathlonRounds`. `kataPassages` : `whole` = actifs si ≤ 2, sinon
actifs + 2 ; `tour1` = actifs ; `finale` = `min(actifs, 2)` (deux finalistes, `resolveKata`). `parseMinSec` accepte `m`,
`m:ss` (ss < 60), espaces autour.

- [ ] **Step 4: Lancer** — `npx vitest run tests/domain/schedule-durations.test.ts tests/domain/settings*.test.ts` → PASS ;
  `npm run typecheck` propre.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule/durations.ts src/domain/settings.ts src/domain/api-schemas.ts tests/domain/schedule-durations.test.ts
git commit -m "feat(horaires): durées des combats par groupe d'âge, tableau et combat"
```

---

### Task 2: Heures des sessions et durées d'un tableau en base

**Files:**
- Create: `drizzle/0035_horaires.sql`, `src/domain/schedule/types.ts`, `src/server/repositories/wave-schedules.ts`,
  `src/server/routes/wave-schedules.ts`, `tests/server/migration-0035.test.ts`, `tests/server/wave-schedules.test.ts`
- Modify: `src/server/db/schema.ts`, `src/domain/categories.ts` (`Category.durations`),
  `src/server/repositories/categories.ts` (lecture, `updateCategory`), `src/server/routes/categories.ts` (`patchSchema`),
  `src/server/repositories/waves.ts` (`replaceWaves`), `src/server/sync/package.ts`, `src/server/auth/permissions.ts`,
  `src/server/app.ts` (enregistrer les routes), `tests/server/permissions.test.ts`, `tests/server/sync-package.test.ts`

**Interfaces:**
- Consumes: `CombatTiming`, `CategoryDurations`, `categoryDurationsSchema` (Task 1).
- Produces:
  - table `wave_schedules` : `competition_id` (FK `competitions`, cascade), `wave_key` (`''` : session unique d'une
    compétition sans session), `planned_start`, `actual_start`, `finals_start` (texte `HH:MM` ou null), `version`,
    `updated_at` ; clé primaire (`competition_id`, `wave_key`). Colonne `categories.durations_json` (texte, null).
  - `interface WaveSchedule { waveId: string | null; plannedStart: string | null; actualStart: string | null; finalsStart: string | null }`
    et `isClock(s: string): boolean` (`/^([01]\d|2[0-3]):[0-5]\d$/`) dans `src/domain/schedule/types.ts`
  - `listWaveSchedules(db: AppDb, competitionId: string): WaveSchedule[]`
  - `setWaveSchedule(db: AppDb, competitionId: string, waveId: string | null, patch: Partial<Omit<WaveSchedule, 'waveId'>>): WaveSchedule`
  - `GET /api/competitions/:id/wave-schedules` → `WaveSchedule[]` ; `PUT /api/competitions/:id/wave-schedules` (corps
    `{ waveId, plannedStart?, actualStart?, finalsStart? }`, strict) → `WaveSchedule`
  - `Category.durations: CategoryDurations | null` ; `PATCH …/categories/:cid` accepte `durations: CategoryDurations | null`

- [ ] **Step 1: Écrire les tests**

`tests/server/migration-0035.test.ts` : `migration 0035 adds wave_schedules and categories.durations_json` (colonnes lues
par `pragma_table_info`, catégories existantes à `durations_json` null).

`tests/server/wave-schedules.test.ts` :
- `sets and reads the three times of a wave` (PUT puis GET, valeurs `'09:30'`, `'09:41'`, `'14:00'`) ;
- `a partial patch keeps the other times` (PUT `{ waveId, actualStart: '09:41' }` après `plannedStart`) ;
- `null clears a time` ;
- `rejects a bad clock` (`'9h30'`, `'24:00'` → 400) ;
- `rejects an unknown wave, and waveId null when the competition has waves` (400) ; `waveId null without waves is the
  single session` (ligne `wave_key = ''`) ;
- `removing a wave deletes its times` (`replaceWaves` sans elle → plus de ligne) ;
- `a schedule change fires the competition event` (abonné `onCompetitionChange` appelé une fois) ;
- `category durations are saved even when the wave is launched` (PATCH `durations` sur une catégorie d'une session lancée
  → 200, relu dans `listCategories`) ; `rejects durations out of bounds` (`rounds: 0` → 400).

`tests/server/permissions.test.ts` : `PUT …/wave-schedules` permis à la Table centrale, refusé à un compte Zone.

`tests/server/sync-package.test.ts` : `package carries wave_schedules and durations` (aller-retour export / import) et
`a package without wave_schedules imports with no times` (clé `wave_schedules` retirée du paquet → import réussi, aucune
ligne).

- [ ] **Step 2: Lancer, vérifier l'échec** —
  `npx vitest run tests/server/migration-0035.test.ts tests/server/wave-schedules.test.ts` → FAIL.

- [ ] **Step 3: Schéma, migration, dépôt, routes**

Schéma (`waveSchedules` à côté de `waveLaunches`, même forme), puis `npm run db:generate` : vérifier que le SQL généré est
bien `drizzle/0035_horaires.sql` (renommer le fichier et son entrée du journal si drizzle choisit un autre nom, comme au
lot 1). Les déclencheurs de version de ligne viennent seuls (`versionedTables`).
`setWaveSchedule` : `waveId` doit être une session de la compétition, ou null s'il n'y a aucune session ; heures validées
par `isClock` ; `insert … on conflict do update` des seuls champs du patch. Erreurs : `RegistrationValidationError` (400),
comme ailleurs. `replaceWaves` supprime les lignes `wave_schedules` des sessions retirées, dans sa transaction.
Paquet : `'wave_schedules'` dans `PACKAGE_TABLES` juste après `'wave_launches'`, et
`['wave_schedules', 'wave_key', 'waves']` dans `REFERENCES` (traité comme `wave_launches`, `''` compris). Vérifier que
l'import accepte une table absente du paquet ; sinon, la traiter comme vide.
Permissions : `'PUT /wave-schedules'` dans `TABLE_WRITES`. La lecture (GET) est permise à tous les comptes de la
compétition, comme les autres lectures.
Catégories : `durations_json` lu en `Category.durations` (null si vide ou illisible), écrit par `applyCategoryPatch` ;
`durations` n'est **pas** dans la liste `blocked` des catégories lancées ni dans `changesBracket` (une durée se change à tout
moment) et n'entre pas dans l'historique (`formatChange` l'ignore).

- [ ] **Step 4: Lancer** — les tests de l'étape 1, puis `npx vitest run tests/server` → PASS ; `npm run typecheck` propre.

- [ ] **Step 5: Commit**

```bash
git add drizzle/ src/server src/domain/schedule/types.ts src/domain/categories.ts tests/server
git commit -m "feat(horaires): heures des sessions et durées d'un tableau en base"
```

---

### Task 3: Ligne de temps (domaine pur)

**Files:**
- Create: `src/domain/schedule/clock.ts`, `src/domain/schedule/timeline.ts`, `tests/domain/schedule-clock.test.ts`,
  `tests/domain/schedule-timeline.test.ts`

**Interfaces:**
- Produces:
  - `clockToSeconds(hhmm: string): number` ; `secondsToClock(sec: number): string` (arrondi à la minute la plus proche,
    `'9:05'` sans zéro devant l'heure, `'14:00'`)
  - `isoToDaySeconds(iso: string, date: string): number | null` — secondes depuis minuit **heure de Paris** du jour `date`
    (AAAA-MM-JJ) ; un instant d'un autre jour donne une valeur < 0 ou ≥ 86 400 ; ISO illisible → null
  - `nowOnDay(now: Date, date: string): number | null` — secondes depuis minuit à Paris si `todayInParis(now) === date`,
    sinon null
  - `interface TimelineItem { key: string; waveKey: string; durationSec: number; endedAt: number | null; finals: boolean }`
  - `interface TimelineInput { now: number | null; changeoverSec: number; finalsZoneId: string | null; waves: { key: string; plannedStart: number | null; actualStart: number | null; finalsStart: number | null }[]; zones: { zoneId: string; items: TimelineItem[] }[] }`
    (`waves` : sessions lancées, dans l'ordre ; `items` : dans l'ordre de la file, toutes sessions mêlées)
  - `interface Timeline { starts: Map<string, number>; waveStarts: Map<string, { at: number; estimated: boolean } | null>; finalsStarts: Map<string, number> }`
  - `buildTimeline(input: TimelineInput): Timeline`
  - `zoneDrift(input: TimelineInput, zoneId: string): number | null` (secondes, positif = en retard)

- [ ] **Step 1: Écrire les tests**

`tests/domain/schedule-clock.test.ts` :
- `isoToDaySeconds uses Paris winter offset` : `isoToDaySeconds('2026-11-22T08:41:00.000Z', '2026-11-22') === 9*3600 + 41*60` ;
  heure d'été : `('2026-06-14T07:30:00Z', '2026-06-14') === 9*3600 + 30*60` ;
- `now is null on another day` : `nowOnDay(new Date('2026-11-21T10:00:00Z'), '2026-11-22') === null`, et
  `nowOnDay(new Date('2026-11-22T10:00:00Z'), '2026-11-22') === 11*3600` ;
- `clock round trip` : `clockToSeconds('09:30') === 34200`, `secondsToClock(34200 + 29) === '9:30'`,
  `secondsToClock(34200 + 30) === '9:31'`.

`tests/domain/schedule-timeline.test.ts` (heures en secondes ; fabricant `item(key, wave, dur, endedAt?, finals?)` ;
changement 60 s) :
- `planned start drives the first wave` : une zone, deux passages de 300 s, session prévue 9:30, `now` null → départs 9:30
  et 9:36 ;
- `actual start beats planned` : démarrage saisi 9:41 → premier passage 9:41 ;
- `first result estimates the start` : sans démarrage saisi, premier passage fini à 9:50 (durée 300 s) →
  `waveStarts` = `{ at: 9:45, estimated: true }`, passage suivant à 9:51 ;
- `now pushes unplayed passages` : session démarrée (démarrage saisi 9:30), `now` = 10:20 alors que le calcul donnait
  10:00 → le premier passage non joué commence à 10:20, les suivants à la suite ;
- `now does not move a wave not started` : session prévue 14:00, sans démarrage saisi ni résultat, `now` = 15:00 → ses
  passages gardent 14:00, 14:06… (on ne suppose pas qu'elle a lieu ce jour-là) ;
- `out-of-order results never move the cursor back` : n° 2 fini à 10:10, n° 3 fini à 10:02 → n° 4 commence à 10:11 ;
- `restart numbering keeps wave order` : la zone a, dans sa file triée par numéro, la session 2 (n° 1, 2) **avant** la
  session 1 (n° 3, 4) ; les sessions dans l'ordre `[s1, s2]` → les passages de s1 commencent avant ceux de s2 ;
- `a late wave does not shift the next one` : s2 prévue 11:00, s1 estimée finir à 11:20 sur la zone (en retard) → s2
  commence quand même à 11:00 sur cette zone ; sans heure prévue ni démarrage ni résultat, s2 n'a pas d'heures (la fin de
  s1 ne sert pas de départ) ;
- `finals wait for the other zones` : zone des finales avec ses propres combats finis à 10:30, autres zones finissant à
  11:10 → première finale à 11:10 (fin la plus tardive des combats non-finales de la session, sans changement ajouté) ;
  `finalsStarts.get(s1) === 11:10` ;
- `fixed finals time wins` : `finalsStart` 12:00 → première finale à 12:00, même si les autres zones finissent avant ;
- `no start known gives no times` : session sans heure prévue, sans démarrage, sans résultat → `starts` vide pour ses
  passages, `waveStarts.get(key) === null`, `zoneDrift` null ;
- `drift compares with planned times only` : prévue 9:30, deux passages de 300 s, premier fini à 9:50 → `zoneDrift` =
  `(9:51 − 9:36)` = 900 s ; sans heure prévue → null ; zone terminée → null.

- [ ] **Step 2: Lancer, vérifier l'échec** —
  `npx vitest run tests/domain/schedule-clock.test.ts tests/domain/schedule-timeline.test.ts` → FAIL.

- [ ] **Step 3: Écrire `clock.ts` et `timeline.ts`**

`isoToDaySeconds` : décalage de Paris à cet instant par `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', … })`
(même approche que `todayInParis`), puis écart en jours entre la date locale et `date`. `nowOnDay` réutilise
`todayInParis` (`src/domain/public/view.ts`).

`buildTimeline`, algorithme (spec §5.3) :

```text
départ(session) = actualStart ?? (min sur ses passages joués de endedAt − durationSec) [estimé] ?? plannedStart ?? null
démarrée(session) = actualStart non null, ou au moins un passage joué
Les sessions sont indépendantes (spec §5.3, décision de l'utilisateur) : rien ne passe d'une session à la suivante.
pour chaque session S dans l'ordre :
  passe A — pour chaque zone, les passages de S de cette zone dans l'ordre de la file, jusqu'à la première finale
            (finals = true) de S si la zone est la zone des finales :
      au début de S : curseur(zone) = départ(S) (null → pas d'heures pour S sur cette zone) ; dernièreFin(zone) = null
      passage joué  : début = endedAt − durationSec ; dernièreFin(zone) = max(dernièreFin(zone), endedAt) ;
                      curseur = dernièreFin(zone) + changeoverSec
      passage à venir : si curseur null → pas d'heure ; sinon début = max(curseur, démarrée(S) ? now ?? −∞ : −∞) ;
                      curseur = début + durationSec + changeoverSec
  passe B — zone des finales, la suite de ses passages de S (finales et ce qui suit) :
      avant la première finale non jouée : base = finalsStart(S) ?? max des fins (début + durée, ou endedAt) des passages
      non-finales de S sur toutes les zones ; curseur = max(curseur, base) ; finalsStarts[S] = début de cette finale
      puis mêmes règles que la passe A
```

`zoneDrift` : refaire `buildTimeline` avec `now: null`, tous les `endedAt: null` et tous les `actualStart: null` (heures
prévues seules, `finalsStart` gardé), puis comparer les départs du premier passage non joué de la zone ; null si l'un des
deux manque.

- [ ] **Step 4: Lancer** — les deux fichiers de tests → PASS ; `npm run typecheck` propre.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule/clock.ts src/domain/schedule/timeline.ts tests/domain/schedule-clock.test.ts tests/domain/schedule-timeline.test.ts
git commit -m "feat(horaires): ligne de temps des zones, pure"
```

---

### Task 4: Vue publique avec les ingrédients des heures

**Files:**
- Create: `src/domain/public/times.ts`, `tests/domain/public-times.test.ts`
- Modify: `src/domain/public/types.ts`, `src/domain/public/view.ts`, `src/domain/public/follow.ts`,
  `src/server/public/load.ts`, `tests/domain/public-view.test.ts`, `tests/server/public-routes.test.ts`

**Interfaces:**
- Consumes: `combatTiming`, `ageGroupOf`, `fightSeconds`, `kataPassages`, `ScheduleSettings` (Task 1) ;
  `listWaveSchedules`, `Category.durations` (Task 2) ; `buildTimeline`, `zoneDrift`, `isoToDaySeconds`, `clockToSeconds`,
  `secondsToClock` (Task 3).
- Produces (ajouts aux types publics) :
  - `PublicQueueItem` : `durationSec: number` (sans le changement), `timing: CombatTiming | null` (null : kata),
    `kataPassages: number | null`, `endedAt: string | null` (ISO, seulement si `state === 'played'`)
  - `PublicCompetition` : `changeoverSec: number`, `finalsZoneId: string | null` ; chaque élément de `waves` gagne
    `plannedStart: string | null`, `actualStart: string | null`, `finalsStart: string | null` (`HH:MM` ; `actualStart` et
    `finalsStart` toujours null pour une session non lancée)
  - `PublicCategory` : `timing: CombatTiming | null` (durée du tableau, null pour un kata), `kataPassageSec: number | null`
  - `PublicCompetitionSummary` : `waves: { name: string; plannedStart: string | null }[]`
  - `FighterLine.next` : `key: string`, `durationSec: number`, `timing: CombatTiming | null`, `kataPassages: number | null`
  - `PublicSource` : `schedule: ScheduleSettings`, `triathlonRounds: 3 | 6`, `grid: CategoryGrid`,
    `waveSchedules: WaveSchedule[]`, `endedAt: Record<string, { matches: Record<string, string>; round1: string | null; final: string | null }>`
  - `passageKey(item: { categoryId: string; matchId: string | null; kataPart: 'tour1' | 'finale' | null }): string`
    (`${categoryId}:${matchId ?? (kataPart ? 'kata:' + kataPart : 'kata')}`)
  - `interface PublicTimes { at(key: string): string | null; waveStart(waveId: string | null): { clock: string; estimated: boolean } | null; finalsAt(waveId: string | null): string | null; categoryFinalAt(categoryId: string): string | null; drift(zoneId: string): number | null }`
    (`at` et `finalsAt` : `'H:MM'` ; `drift` en **minutes** arrondies, positif = en retard)
  - `publicTimes(pub: PublicCompetition, now: number | null): PublicTimes` (phase `past` : tout null)

- [ ] **Step 1: Écrire les tests**

`tests/domain/public-view.test.ts` (compléments) :
- `queue items carry duration and end time` : combat de minimes → `durationSec` 210, `timing.rounds` 2 ; résultat saisi →
  `endedAt` = l'heure fournie dans `endedAt.matches` ; passage non joué → `endedAt` null ;
- `kata blocks carry passages` : bloc entier de 5 katakas → `kataPassages` 7, `durationSec` 7 × 90 ;
- `match duration override reaches the item` : `durations.matches[finalId]` en 3 rounds → l'item de la finale a 3 rounds ;
- `unlaunched wave shows only its planned time` : session non lancée avec les trois heures saisies → `plannedStart` présent,
  `actualStart` et `finalsStart` null ;
- `no schedule data leaks` : le JSON de la vue ne contient ni `overtimeSec` d'un autre groupe ni `durations_json` brut
  (seulement les champs listés).

`tests/domain/public-times.test.ts` :
- `times of a launched competition` : vue fabriquée (session prévue 9:30, une zone, deux combats) → `at(clé du 1er)` =
  `'9:30'`, `at(clé du 2e)` = `'9:35'` (210 s + 60 s arrondi), `waveStart` null tant que rien n'est saisi ni joué ;
- `category final time` : `categoryFinalAt` = heure du passage de la finale (`finalMatchIds`), y compris quand elle est sur
  la zone des finales ; kata : le bloc `finale` ou le bloc entier ;
- `history shows no times` : phase `past` → `at(...)` null, `drift` null.

`tests/server/public-routes.test.ts` : `public view exposes wave times and durations` (PUT des heures puis GET public →
`waves[0].plannedStart === '09:30'`, items avec `durationSec`) et `schedule change refreshes the cache` (ETag différent après
le PUT).

- [ ] **Step 2: Lancer, vérifier l'échec** —
  `npx vitest run tests/domain/public-view.test.ts tests/domain/public-times.test.ts tests/server/public-routes.test.ts`.

- [ ] **Step 3: Écrire**

`load.ts` : lit `settings.schedule` et `settings.triathlonRounds` (`getCompetition`), la grille (`getGrid`),
`listWaveSchedules`, et les heures de fin : `match_results.created_at` par combat, `max(kata_scores.updated_at)` par
catégorie et par tour (`round1`, `final`), seulement pour les catégories publiques. `loadPublicList` ajoute l'heure prévue de
chaque session (`waves` vide pour une compétition sans session : une entrée « Session unique » si `''` a une heure prévue).
`view.ts` : durée d'un combat = `fightSeconds(combatTiming(…, ageGroupOf(c.key, grid), c.durations, matchId))` ; bloc de
kata = `kataPassages(actifs, whole | tour1 | finale) × schedule.kataPassageSec` ; `endedAt` d'un bloc : `final` pour
`finale`, `round1` pour `tour1`, la plus tardive des deux pour un bloc entier. Copies champ par champ, comme le reste.
`follow.ts` : `next` reçoit `key`, `durationSec`, `timing`, `kataPassages` du passage choisi.
`times.ts` : construit un `TimelineInput` depuis la vue (sessions lancées dans l'ordre de `pub.waves`, `waveKey`,
`isoToDaySeconds(endedAt, pub.date)`, heures `clockToSeconds`), appelle `buildTimeline` une fois et `zoneDrift` à la demande.

- [ ] **Step 4: Lancer** — les tests de l'étape 1, puis `npx vitest run tests/domain tests/server` → PASS ;
  `npm run typecheck` propre.

- [ ] **Step 5: Commit**

```bash
git add src/domain/public src/server/public tests/domain tests/server/public-routes.test.ts
git commit -m "feat(spectateur): durées, heures des sessions et fins de passage dans la vue publique"
```

---

### Task 5: Saisie des heures et des durées (écrans de l'organisation)

**Files:**
- Create: `src/web/components/MinSecInput.tsx`, `src/web/components/CategoryDurations.tsx`
- Modify: `src/web/api.ts` (`useWaveSchedules`, `useSetWaveSchedule`, `durations` dans la mutation de catégorie),
  `src/web/pages/CompetitionSettingsPage.tsx`, `src/web/components/WaveLaunchPanel.tsx`, `src/web/pages/BracketsPage.tsx`,
  `src/web/help.ts`
- Test: `tests/web/min-sec-input.test.ts` (si le projet teste ses composants ; sinon la logique reste dans `parseMinSec`,
  déjà testée) et l'e2e de la Task 7

**Interfaces:**
- Consumes: routes et types des Tasks 1 et 2 ; `timingText`, `minSecText`, `parseMinSec`, `ageGroupOf`, `combatTiming`.
- Produces: `MinSecInput({ value: number, onChange(sec: number): void, label: string, min?: number, max?: number })`
  (texte `m:ss`, erreur « Format attendu : 1:30 ») ; `CategoryDurations({ competitionId, category, readOnly })`.

- [ ] **Step 1: Réglages de la compétition** — carte « Durées des combats » (aide `reglages.durees`), organisateur : un
  tableau de 4 lignes (« Moins de 14 ans », « 14 à 17 ans », « 18 ans et plus », « Triathlon ») × colonnes Rounds, Round,
  Repos, Prolongation (`MinSecInput` pour les trois dernières) ; pour le triathlon, la colonne Rounds affiche
  `triathlonRounds` sans champ (« réglé dans Rounds de triathlon »). Sous le tableau : « Changement entre deux combats » et
  « Kata : durée d'un passage ». Enregistrement avec le reste de la page (même PATCH des réglages). La prolongation est notée
  « non comptée dans les heures ».

- [ ] **Step 2: Heures d'une session** — dans `WaveLaunchPanel` (onglet Combats, là où se trouve le lancement), une ligne
  « Horaires » : « Début prévu » (`TimeInput` de `@mantine/dates`), « Démarrée à » + bouton « Maintenant » (heure de Paris
  courante, `HH:MM`), « Finales à » (texte d'aide : « vide : à la fin des combats éliminatoires »). Chaque champ s'enregistre
  à la sortie du champ (PUT du seul champ changé) avec une notification « Horaire enregistré ». Visible pour l'organisateur et
  la Table centrale, avant et après le lancement ; « Démarrée à » et « Finales à » seulement une fois la session lancée.
  Le poste Zone ne voit pas la ligne.

- [ ] **Step 3: Durées d'un tableau** — `CategoryDurations` dans `BracketsPage`, sous le choix du format : un `Select`
  « Durée des combats » : « Comme la compétition (2 × 1 min 30) » (texte calculé avec `combatTiming`) ou « Autre » (trois
  champs : rounds, round, repos). Puis « Exceptions » : la liste des combats à durée propre (« n° 14 · Finale : 3 × 2 min »,
  bouton retirer) et « Ajouter une exception » (choix d'un combat du tableau avec le libellé que montre l'onglet Combats,
  puis la durée). Enregistre par `PATCH …/categories/:cid` `{ durations }`. Permis même tableau lancé ou commencé. Kata : pas
  de bloc (la durée d'un passage est celle de la compétition). Lecture seule pour le poste Zone.

- [ ] **Step 4: Aides** — `HELP['reglages.durees']`, `HELP['combats.horaires']`, `HELP['tableaux.durees']` : formule de la
  durée, précédence combat > tableau > compétition, heures affichées aux spectateurs comme des estimations (« vers »).

- [ ] **Step 5: Vérifier** — `npm run typecheck`, `npx vitest run tests/web` → PASS ; contrôle à l'écran par le contrôleur
  (Chrome, 360 px, clair et sombre).

- [ ] **Step 6: Commit**

```bash
git add src/web tests/web
git commit -m "feat(horaires): saisie des heures des sessions et des durées des combats"
```

---

### Task 6: Heures sur la page publique

**Files:**
- Create: `src/web/components/public/useNow.ts`
- Modify: `src/web/pages/public/PublicCompetitionPage.tsx`, `src/web/pages/public/tabProps.ts`,
  `src/web/components/public/FollowTab.tsx`, `src/web/pages/public/ZonesTab.tsx`, `src/web/components/public/zoneRows.ts`,
  `src/web/pages/public/BracketsTab.tsx`, `src/web/pages/public/PublicHomePage.tsx`, le test existant de `zoneRows`

**Interfaces:**
- Consumes: `publicTimes`, `PublicTimes`, `passageKey` (Task 4) ; `nowOnDay` (Task 3) ; `timingText`, `minSecText` (Task 1).
- Produces: `useNow(date: string): number | null` (recalcul toutes les 30 s ; null hors du jour J) ; `PublicTabProps` gagne
  `times: PublicTimes` (calculé une fois dans `PublicCompetitionPage` avec `useMemo([pub, now])`) ;
  `driftText(min: number): string` et `waitingWaves(pub)` avec l'heure prévue, dans `zoneRows.ts`.

- [ ] **Step 1: Tests de `zoneRows`** — `driftText(12) === 'en retard de 12 min'`, `driftText(-5) === 'en avance de 5 min'`,
  `driftText(2) === 'à l\'heure'` et `driftText(-2) === 'à l\'heure'` (moins de 3 min d'écart : « à l'heure », pour ne pas
  faire clignoter la zone d'une minute à l'autre) ; `waitingWaves` : `'Session 2 : numéros et horaires au lancement de la
  session, prévu vers 13:30.'` avec heure prévue, `'Session 2 : numéros et horaires au lancement de la session.'` sans ;
  `finalsLabel` inchangé. Lancer → FAIL.

- [ ] **Step 2: Écrire** :
  - **Suivis** : le prochain combat se lit « Zone 2 · n° 14 · vers 10:55 » (heure en gros à côté du numéro), « 3 combats
    avant le sien », puis « Durée prévue : 2 × 1 min 30 » (kata : « 3 passages · 1 min 30 chacun »). Sans heure connue : la
    ligne actuelle, sans « vers ».
  - **Zones** : en-tête « Session 1 · prévue 9:30 · démarrée 9:41 » (« démarrée vers 9:41 » si estimée ; parties absentes
    omises). Chaque passage montre « vers HH:MM » ; la carte de zone montre `driftText` à droite de son nom (`StatusBadge`
    `warn` en retard, `ok` en avance, neutre à l'heure) ; la ligne des finales devient « Finales de la session 1 à partir de
    11:10 ». Sessions suivantes : texte de `waitingWaves`.
  - **Tableaux** : l'en-tête d'un tableau devient « zone · format · 2 × 1 min 30 · finale vers 11:40 » (kata :
    « 1 min 30 par passage ») ; rien de cela pour une compétition passée.
  - **Accueil, À venir** : sous la date et le lieu, une ligne par session avec une heure prévue (« Session 1 · 9:30 ») ;
    le texte « Numéros et horaires au lancement de la session. » reste.
  - Phase `past` : aucun appel de `useNow` n'affiche d'heure (les onglets de l'historique sont Tableaux et Résultats).

- [ ] **Step 3: Lancer** — `npx vitest run tests/web` → PASS ; `npm run typecheck` propre. Contrôle à l'écran par le
  contrôleur (Chrome à 360 px et sur ordinateur, clair et sombre ; texte long d'avance / retard sur une zone au nom long sans
  débordement).

- [ ] **Step 4: Commit**

```bash
git add src/web tests/web
git commit -m "feat(spectateur): heures estimées, avance et retard sur la page publique"
```

---

### Task 7: Test de bout en bout, documentation, bilan

**Files:**
- Create: `tests/e2e/spectateur-horaires.spec.ts`
- Modify: `docs/guide-utilisateur.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (ligne « 40 »),
  `docs/superpowers/plans/2026-10-21-99-bilan.md` (section « étape 40 »)

- [ ] **Step 1: Écrire l'e2e** (serveur, port 3101, `SERVER_SESSION`, nom de compétition unique qui ne contient aucun
  autre nom de test) : l'organisateur règle « Changement entre deux combats » à 0:30, saisit « Début prévu » 09:30 d'une
  session, vérifie sur l'accueil public (contexte sans session) « Session 1 · 9:30 » ; lance la session, clique
  « Maintenant » ; le visiteur ouvre Zones et lit l'en-tête `/prévue 9:30 · démarrée \d{1,2}:\d{2}/` et un passage
  `/vers \d{1,2}:\d{2}/` ; il épingle un combattant et lit dans Suivis `/vers \d{1,2}:\d{2}/` et « Durée prévue : » ; un
  résultat saisi par l'API met à jour la page sans rechargement (le passage suivant devient « À suivre ») ; à 360 px, rien
  n'est coupé (`clipped()`). Aucune connexion de plus.

- [ ] **Step 2: Lancer** — `npx playwright test tests/e2e/spectateur-horaires.spec.ts` → PASS ; puis toute la suite une
  fois (`npm run test:e2e`) et `npm test`.

- [ ] **Step 3: Documentation** — guide utilisateur : où saisir les heures et les durées, comment l'heure est estimée
  (démarrage, résultats, finales), ce que voit le spectateur. Feuille de route : ligne 40 « Mode spectateur, lot 2 ». Bilan :
  choix faits (calcul dans le navigateur ; `noRest` ignoré ; seuil de 3 min pour « à l'heure » ; fin d'un bloc de kata =
  dernière note du tour), chiffres des tests, points reportés.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/spectateur-horaires.spec.ts docs/
git commit -m "docs(spectateur): lot 2, heures et durées"
```
