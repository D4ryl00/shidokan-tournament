# Heures de passage présumées côté organisation — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** afficher « vers H:MM » pour chaque combat et chaque kataka dans Tableaux → Liste et dans l'onglet Combats, avec
l'avance / le retard des zones, et les heures prévues (en gris italique) des sessions pas encore lancées.

**Architecture:** session lancée → le navigateur refait exactement le calcul de la page publique (`publicTimes`) sur une vue
publique servie par une nouvelle route organisation, sans contrôle de visibilité. Session non lancée → l'estimation de la
journée (`estimateDay`) renvoie en plus l'heure de départ de chaque passage. Un objet pur `organiserTimes` réunit les deux,
et les écrans ne lisent que lui. Tout se rafraîchit déjà sur le flux d'événements (toutes les requêtes sont invalidées) et
avec `useNow` (30 s).

**Tech Stack:** TypeScript 7, React + Mantine, TanStack Query, Fastify, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-heures-presumees-organisation-design.md` (maquettes `heures-v4.html`,
`heures-v5.html` dans `.superpowers/brainstorm/31339-1795244530/content/`).

## Global Constraints

- « vers » toujours **devant** l'heure, espace insécable : réutiliser `versText` (`src/web/components/public/zoneRows.ts`).
- Avance / retard : texte et seuil de `driftText` (même fichier) ; rien quand il renvoie « à l’heure » ; orange (`tone="warn"`)
  en retard, vert (`tone="ok"`) en avance.
- Session lancée : jamais d'heure ≤ maintenant, **sauf** la carte « À l'appel » (heure brute, même dépassée).
- Session non lancée : heures en gris italique, pas de badge d'avance / retard ; rien si l'estimation est `relative` (première
  session sans heure de début prévue).
- Clé d'un passage : `passageKey` = `${categoryId}:${matchId}` (`src/domain/public/types.ts`) ; kata : `kataTour1Key(id)`,
  `kataFinaleKey(slot)` (`src/domain/passages/kata-keys.ts`, slot 1/2 = ordre de `resolveKata(...).finalists`).
- La page publique ne change pas (ni rendu ni données).
- Pas d'heure sur les impressions (`printable`).
- Libellés français de l'interface, comme dans les maquettes.

## Review Focus

- Compétition **privée** : les heures doivent quand même s'afficher côté organisation (route sans contrôle de visibilité) —
  test serveur Tâche 2.
- Résultat **saisi en retard** (un passage non joué avant un passage joué) : ce passage n'a pas d'heure et n'est pas « sur le
  tatami » ; seul le premier passage non joué de la file de la zone l'est — test Tâche 1.
- **Première session sans heure de début** : l'estimation est relative (secondes depuis 0) ; aucune heure prévue ne doit
  s'afficher (pas de « vers 0:12 ») — test Tâche 2.
- Compétition **d'un autre jour / passée** (`now` null ou phase `past`) : pas de plantage ; `past` → aucune heure, comme le
  public — test Tâche 1.
- Kata à **deux katakas** (pas de tour 1, finale seule) et **kataka absent** : la finale a son heure ; un absent sans ligne de
  file n'a pas d'heure — test Tâche 1.

---

### Task 1: Calcul pur `organiserTimes`

**Files:**
- Modify: `src/domain/public/times.ts` (ajout de `rawAt` à `PublicTimes`)
- Create: `src/domain/schedule/organiser-times.ts`
- Test: `tests/domain/organiser-times.test.ts` (fixtures : `tests/domain/public-fixtures.ts`), `tests/domain/public-times.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // times.ts — ajout à PublicTimes (NONE : () => null)
  rawAt(key: string): string | null; // départ estimé « H:MM » sans le filtre « après maintenant »

  // organiser-times.ts
  export type PassageTime = { kind: 'onTatami' } | { kind: 'at'; clock: string; planned: boolean };
  export interface CategoryTimes { first: boolean; next: PassageTime | null; final: PassageTime | null }
  export interface OrganiserTimes {
    passage(categoryId: string, matchId: string): PassageTime | null;
    onCall(categoryId: string, matchId: string): string | null;
    category(c: { id: string; bracket: Bracket | null }): CategoryTimes | null;
    drift(zoneId: string): number | null;
  }
  export function organiserTimes(pub: PublicCompetition | null, planned: Record<string, string> | null, now: number | null): OrganiserTimes;
  ```

Règles (`passage`) : passage joué → null ; passage d'une session lancée (présent dans `pub.queues`) → `onTatami` s'il est le
premier passage sans `endedAt` de sa file de zone parmi les sessions lancées (ordre de `publicTimes`), sinon
`{ kind: 'at', clock: times.at(key), planned: false }` ou null si `at` est null ; absent de `pub.queues` → `planned[key]`
(`planned: true`) ou null. `onCall` = `times.rawAt(key)`. `category` : premier passage non joué de la catégorie (ordre des
heures) → `next` ; `first` = aucun passage de la catégorie joué ; `final` = premier passage de finale non joué
(`finalMatchIds(bracket)` en combat, `kataFinaleKey(1|2)` en kata) ; null si la catégorie n'a aucun passage à venir.
`drift` = `times.drift(zoneId)`.

- [ ] **Step 1: Tests qui échouent** — dans `organiser-times.test.ts`, à partir des fixtures publiques :
  - `passage d'une session lancée : vers H:MM, jamais une heure passée` → `{ kind: 'at', clock: '10:42', planned: false }` puis null quand `now` dépasse.
  - `premier passage non joué de la zone : sur le tatami ; onCall garde l'heure même dépassée` → `{ kind: 'onTatami' }` et `onCall(...) === '10:34'` avec `now` à 10:40.
  - `résultat saisi en retard : le passage sauté n'est ni sur le tatami ni daté` → `passage(...) === null`.
  - `session non lancée : heure prévue` → `{ kind: 'at', clock: '15:10', planned: true }` depuis `planned`.
  - `catégorie : 1er combat puis prochain, finale` → `{ first: true, next: at 11:05, final: at 11:50 }`, puis `first: false` après un résultat.
  - `kata à deux katakas : finale seule datée` et `kataka absent sans ligne : null`.
  - `compétition passée : tout est null`.
  - Dans `public-times.test.ts` : `rawAt rend une heure déjà passée` (même fixture que le test « jamais d'heure dépassée » existant).
- [ ] **Step 2:** `npx vitest run tests/domain/organiser-times.test.ts tests/domain/public-times.test.ts` → FAIL (module absent / `rawAt` inconnu).
- [ ] **Step 3:** ajouter `rawAt` dans `publicTimes` (`secondsToClock(timeline.starts.get(key))`, null si absent) ; écrire `organiserTimes`.
- [ ] **Step 4:** même commande → PASS ; `npm run typecheck` → 0 erreur.
- [ ] **Step 5:** `git commit -m "feat(horaires): calcul des heures présumées côté organisation"`

### Task 2: Serveur — vue des heures et heures prévues par passage

**Files:**
- Modify: `src/server/public/load.ts` (`loadPublicSource` / `loadPublicCompetition` : option `{ anyVisibility?: boolean }`)
- Modify: `src/server/routes/results.ts` (route `GET /api/competitions/:id/schedule/times`)
- Modify: `src/domain/schedule/estimate.ts` (`DayEstimate.starts`), `src/server/repositories/estimate.ts` (`plannedStarts`)
- Test: `tests/server/estimate.test.ts`, `tests/server/schedule-times.test.ts` (nouveau, même squelette que `estimate.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  // load.ts
  loadPublicCompetition(db: AppDb, id: string, now: Date, opts?: { anyVisibility?: boolean }): Promise<PublicCompetition | null>;
  // GET /api/competitions/:id/schedule/times → PublicCompetition (non mis en cache ; 404 si inconnue)
  // estimate.ts
  interface DayEstimate { /* … */ starts: Record<string, number> } // clé passageKey → départ (s), toutes sessions
  // DayEstimateView : en plus
  plannedStarts: Record<string, string>; // « H:MM », seulement les passages des sessions NON lancées ; {} si relative
  ```
- La route est un GET de compétition : permise aux rôles Table centrale et Zone sans changer `permissions.ts` (vérifier).

- [ ] **Step 1: Tests qui échouent**
  - `schedule-times.test.ts` : `compétition privée : la vue des heures est servie` (200, `queues` non vide après lancement de la session) ; `compétition inconnue : 404` ; `la route publique reste 404 pour une compétition privée`.
  - `estimate.test.ts` : `plannedStarts : heure de départ de chaque passage d'une session non lancée` (valeurs au format `H:MM` cohérentes avec `waves[].zones[].start` du jeu existant « Matin / Après-midi ») ; `plannedStarts vide pour une session lancée` ; `plannedStarts vide quand la première session n'a pas d'heure de début`.
- [ ] **Step 2:** `npx vitest run tests/server/estimate.test.ts tests/server/schedule-times.test.ts` → FAIL.
- [ ] **Step 3:** implémenter (`starts` rempli depuis `timeline.starts` de chaque session dans `estimateDay` ; `plannedStarts` filtré par `launchedWaveKeys` dans `estimateFor`, via `secondsToClock`).
- [ ] **Step 4:** même commande → PASS ; `npx vitest run tests/domain/schedule-estimate.test.ts tests/server/public*.test.ts` → PASS.
- [ ] **Step 5:** `git commit -m "feat(horaires): heures de la compétition pour l'organisation et heures prévues par passage"`

### Task 3: Hook web et textes

**Files:**
- Create: `src/web/useOrganiserTimes.ts`, `src/web/components/PassageTimeText.tsx`
- Modify: `src/web/api.ts` (`useScheduleTimes`), `src/web/components/DayEstimateCard.tsx` (exporter `readShift`)
- Test: `tests/web/passage-time-text.test.ts`

**Interfaces:**
- Consumes: `organiserTimes`, `PassageTime`, `CategoryTimes` (Tâche 1) ; route et `plannedStarts` (Tâche 2).
- Produces:
  ```ts
  export function useScheduleTimes(id: string): UseQueryResult<PublicCompetition>; // queryKey ['schedule', id, 'times']
  export function useOrganiserTimes(competitionId: string): OrganiserTimes; // pub + useDayEstimate(id, readShift()) + useNow(pub?.date ?? '')
  export function passageTimeText(t: PassageTime): string; // 'sur le tatami' | versText(clock)
  export function categoryTimesText(zone: string | null, t: CategoryTimes, kata: boolean): string;
  export function PassageTime({ t, size }: { t: PassageTime | null; size?: 'xs' | 'sm' }): JSX.Element | null;
  // couleur accent + gras ; planned → c="dimmed" fs="italic" ; data-testid="passage-time", data-planned
  ```
- [ ] **Step 1: Test qui échoue** — `categoryTimesText('Tatami 2', { first: false, next: at 10:42, final: at 11:35 }, false) === 'Tatami 2 · prochain vers 10:42 · finale vers 11:35'` ; `first: true` → « 1er combat » (kata : « tour 1 ») ; `next: onTatami` → « Tatami 2 · sur le tatami · finale vers … » ; `final: null` → partie omise ; zone null → partie omise.
- [ ] **Step 2:** `npx vitest run tests/web/passage-time-text.test.ts` → FAIL.
- [ ] **Step 3:** implémenter.
- [ ] **Step 4:** même commande → PASS ; `npm run typecheck`.
- [ ] **Step 5:** `git commit -m "feat(horaires): textes et lecture des heures présumées"`

### Task 4: Onglet Combats

**Files:**
- Modify: `src/web/components/ZoneQueueCard.tsx`, `src/web/pages/MatchesPage.tsx`, `src/web/components/KataScoring.tsx`
- Test: `tests/e2e/heures-presumees.spec.ts` (nouveau ; partie Combats)

**Interfaces:**
- Consumes: `useOrganiserTimes`, `PassageTime`, `categoryTimesText` (Tâche 3).
- Props ajoutées : `ZoneQueueCard` `times: OrganiserTimes` ; `KataScoring` `times?: OrganiserTimes`.

Rendu (maquette v4) : en-tête de zone → `StatusBadge` `data-testid="zone-drift"` (`driftText`) ; « À l'appel » → `versText(times.onCall(...))` à droite de la ligne « À l'appel » (`data-testid="oncall-time"`) ; lignes « Ensuite » → `<PassageTime>` au-dessus du bouton, colonne de droite ; liste des catégories → `categoryTimesText` sous les badges (`data-testid="category-times"`) ; `BracketView` du panneau reçoit `times` (Tâche 5) ; `KataScoring` → `<PassageTime>` sous le nom de chaque kataka pas encore noté (tour 1 : `kataTour1Key(id)`, finale : `kataFinaleKey(index + 1)`). Session non lancée : pas de badge d'avance / retard (la dérive ne s'affiche que si `pub` contient la session).

Écart à la spec, assumé : la spec cite une ligne « Finales fin de session » dans la file ; la file organisation n'en a pas —
les passages de finale y sont des lignes ordinaires et prennent leur heure comme les autres.

- [ ] **Step 1: e2e qui échoue** — `combats : heures dans la file, sur l'appel et retard de zone` : compétition du jour, une zone, session avec heure de début prévue 5 min avant maintenant, lancée ; attendre `oncall-time` visible, au moins une `passage-time` contenant « vers » dans « Ensuite » ; saisir le résultat du combat à l'appel → l'heure de la ligne suivante passe sur la carte « À l'appel » ; `zone-drift` visible avec « en retard de ». Kata : `notation kata : une heure sous chaque kataka non noté`. Session non lancée : `passage-time[data-planned="true"]` dans la file.
- [ ] **Step 2:** `npx playwright test tests/e2e/heures-presumees.spec.ts` → FAIL.
- [ ] **Step 3:** implémenter.
- [ ] **Step 4:** même commande → PASS ; `npx playwright test tests/e2e/jour-j.spec.ts tests/e2e/zones-autonomes.spec.ts` → PASS (cartes de zone inchangées par ailleurs).
- [ ] **Step 5:** `git commit -m "feat(combats): heures de passage présumées et retard des zones"`

### Task 5: Tableaux → Liste

**Files:**
- Modify: `src/web/pages/BracketsPage.tsx`, `src/web/components/BracketView.tsx`
- Test: `tests/e2e/heures-presumees.spec.ts` (partie Tableaux)

**Interfaces:**
- Consumes: Tâche 3.
- Produces: prop `BracketView` `times?: (matchId: string) => PassageTime | null` (ignorée si `printable`).

Rendu (maquettes v4/v5) : ligne `category-times` sous les badges de chaque catégorie (rien si terminée ou `category()` null) ;
en-tête de la catégorie choisie → badge `zone-drift` de sa zone ; si sa session n'est pas lancée et a des heures prévues,
encadré `data-testid="planned-notice"` : « Session « {nom} » pas encore lancée : heures prévues d’après l’heure de début de
la session et les durées, sans les résultats. Elles peuvent encore changer. » ; carte de combat → à droite de l'en-tête, le
résultat s'il y en a un, sinon `<PassageTime>` (la ligne des rounds reste dessous) ; tableau du kata (`KataView`) → colonne
« Heure » (note si noté, sinon `<PassageTime>`) et « · vers H:MM » au bout de la ligne « Finale : n° … ».

- [ ] **Step 1: e2e qui échoue** — `tableaux : heure dans la liste, le tableau et le kata` : même mise en place que la Tâche 4 ; `category-times` contient « vers » ; dans le tableau choisi, un combat non joué a une `passage-time` dans son en-tête, un combat joué montre son résultat et pas d'heure ; catégorie de kata → colonne « Heure » ; catégorie d'une session non lancée → `planned-notice` visible et `passage-time[data-planned="true"]`. Impression (`/impression`) : aucune `passage-time`.
- [ ] **Step 2:** `npx playwright test tests/e2e/heures-presumees.spec.ts` → FAIL sur les nouveaux tests.
- [ ] **Step 3:** implémenter.
- [ ] **Step 4:** même commande → PASS ; `npx playwright test tests/e2e/tableaux.spec.ts tests/e2e/mise-en-page.spec.ts tests/e2e/planche.spec.ts` → PASS ; `npm test` et `npm run typecheck` → verts.
- [ ] **Step 5:** `git commit -m "feat(tableaux): heures de passage présumées dans la liste et les tableaux"`

### Task 6: Vérification sur Chrome

- [ ] Copie de la base de démo sur un serveur jetable (port 3200, `BACKUP_INTERVAL_MIN` ≤ 1440 ; ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte).
- [ ] Avec Claude in Chrome : Combats (heures, « À l'appel », retard, notation kata) et Tableaux → Liste (ligne des catégories, tableau, kata, session non lancée en gris italique), en clair et en sombre, et à largeur téléphone (pas de débordement).
- [ ] Corriger ce qui cloche, refaire la vérification, commit.
