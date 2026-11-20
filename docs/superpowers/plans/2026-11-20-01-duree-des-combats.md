# Durée des combats affichée — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher le format de chaque combat (« 2 rounds de 2 min · prolongation 1 min ») sur la carte de zone (Combats) et sur chaque combat de Tableaux → Liste.

**Architecture:** Un formateur pur dans le domaine (`durations.ts`) ; le serveur l'ajoute à chaque combat de la file (`QueueItem.timing`) ; le client calcule le texte des combats d'un tableau avec `combatTiming` (déjà utilisé par `CategoryDurations`) et le passe à `BracketView` (nouvelle prop `timings`), seulement dans la vue Liste.

**Tech Stack:** TypeScript, React + Mantine, Fastify, Vitest (`npm test`), Playwright (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-11-20-kata-par-kataka-duree-recap-mail-design.md` (partie 1)

## Global Constraints

- Texte exact : `« {n} round(s) de {minSecText(roundSec)} · prolongation {minSecText(overtimeSec)} »` ; « 1 round de 3 min » au singulier ; prolongation 0 s → pas de « · prolongation … ». Le repos n'est pas affiché.
- Précédence de durée : celle de `combatTiming` (combat → finale du tableau → tableau → finale compétition → groupe d'âge), finale = `finalMatchIds(bracket).includes(matchId)`.
- Rien pour un kata. Pas d'affichage à l'impression (`printable`), ni sur la page publique, ni sur la planche.
- Interface en français ; « kg » et nombres comme ailleurs.
- Tester chaque changement visible sur Chrome (extension Claude in Chrome) ; ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte.

## Review Focus

- Exception de durée sur un seul combat (carte « Durée des combats ») : la file et la liste montrent l'exception, pas la durée du tableau.
- Finale avec durée de finale différente (compétition ou tableau) : la finale affiche sa propre durée.
- Triathlon : le nombre de rounds suit `triathlonRounds`.
- Prolongation à 0 : aucun « prolongation 0 s ».
- Impression d'un tableau (`printable`) : aucun texte de durée ajouté.

---

### Task 1: Formateur `timingLongText`

**Files:**
- Modify: `src/domain/schedule/durations.ts` (après `timingText`)
- Test: `tests/domain/schedule-durations.test.ts`

**Interfaces:**
- Produces: `export function timingLongText(t: CombatTiming): string`

- [ ] **Step 1: Tests qui échouent**

```ts
test('timingLongText : rounds, durée, prolongation', () => {
  expect(timingLongText({ rounds: 2, roundSec: 120, restSec: 30, overtimeSec: 60 })).toBe('2 rounds de 2 min · prolongation 1 min');
  expect(timingLongText({ rounds: 1, roundSec: 180, restSec: 0, overtimeSec: 0 })).toBe('1 round de 3 min');
  expect(timingLongText({ rounds: 3, roundSec: 90, restSec: 30, overtimeSec: 45 })).toBe('3 rounds de 1 min 30 · prolongation 45 s');
});
```

- [ ] **Step 2:** `npx vitest run tests/domain/schedule-durations.test.ts` → FAIL (`timingLongText` non exporté).
- [ ] **Step 3:** Implémenter `timingLongText` avec `minSecText`.
- [ ] **Step 4:** Même commande → PASS.
- [ ] **Step 5:** `git commit -m "feat(durées): texte long d'une durée de combat"`

### Task 2: Durée de chaque combat dans la file de zone

**Files:**
- Modify: `src/server/repositories/results.ts` (interface `QueueItem` ~l.228, fonction `schedule` ~l.253 et la construction des items combat ~l.340)
- Modify: `src/web/api.ts` (`QueueItem` ~l.845 : ajouter `timing`)
- Modify: `src/web/components/ZoneQueueCard.tsx` (`OnCall`, `Next`)
- Test: `tests/server/results.test.ts`, `tests/web/zone-cards.test.ts`

**Interfaces:**
- Consumes: `timingLongText` (Task 1), `combatTiming`, `ageGroupOf` (`src/domain/schedule/durations.ts`), `getCompetition`, `getGrid` (`src/server/repositories/competitions.js`).
- Produces: `QueueItem.timing: string | null` (serveur et client) — texte long pour un combat, `null` pour un kata.

- [ ] **Step 1: Test serveur qui échoue** (dans `results.test.ts`, à côté de « file des zones : club de chaque combattant », mêmes helpers `fourInElimination`, `queueOf`, `call`)

```ts
test('file des zones : durée de chaque combat, exception d’un combat comprise', async () => {
  const c = await fourInElimination();
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  const [first, second] = await queueOf(t1!.id);
  expect(first!.timing).toMatch(/^\d+ rounds? de .+/);
  await call('PATCH', `/categories/${c.id}`, { durations: { bracket: null, finals: null, matches: { [second!.matchId!]: { rounds: 1, roundSec: 90, restSec: 0, overtimeSec: 0 } } } });
  const after = await queueOf(t1!.id);
  expect(after.find((q) => q.matchId === second!.matchId)!.timing).toBe('1 round de 1 min 30');
});
```
Ajouter aussi `expect(q.timing).toBeNull()` dans le test kata existant « file des zones : bloc de kata, liste ordonnée qui avance, puis finale » sur l'élément kata.

- [ ] **Step 2:** `npx vitest run tests/server/results.test.ts -t "durée de chaque combat"` → FAIL.
- [ ] **Step 3:** Dans `schedule`, lire `getCompetition` et `getGrid` une fois ; pour chaque combat : `timingLongText(combatTiming(settings, ageGroupOf(c.key, grid), c.durations, m.id, finalIds.get(c.id)!.has(m.id)))` ; `timing: null` pour un kata. Ajouter le champ aux deux interfaces `QueueItem`.
- [ ] **Step 4:** Même commande → PASS.
- [ ] **Step 5: Test web qui échoue** (`zone-cards.test.ts` ; ajouter `timing: '2 rounds de 2 min · prolongation 1 min'` à `item()` et `timing: null` à `kata()`)

```ts
test('durée du combat : à l’appel et dans « Ensuite », jamais pour un kata', () => {
  const html = render([item(1, false), item(2, false)]);
  expect(html.match(/data-testid="match-timing"/g)).toHaveLength(2);
  expect(html).toContain('2 rounds de 2 min · prolongation 1 min');
  expect(render([kata(1, [{ name: 'A', club: 'X', done: false, absent: false }])])).not.toContain('match-timing');
});
```
- [ ] **Step 6:** `npx vitest run tests/web/zone-cards.test.ts` → FAIL.
- [ ] **Step 7:** Dans `OnCall` (sous `label(q)`) et `Next` (sous `label(q)`) : `{q.timing && <Text size="xs" c="dimmed|var(--sk-hero-sub)" data-testid="match-timing">{q.timing}</Text>}`.
- [ ] **Step 8:** `npx vitest run tests/web/zone-cards.test.ts tests/server/results.test.ts && npm run typecheck` → PASS.
- [ ] **Step 9:** `git commit -m "feat(combats): durée de chaque combat dans la file de zone"`

### Task 3: Durée de chaque combat dans Tableaux → Liste

**Files:**
- Create: `src/web/matchTimings.ts`
- Modify: `src/web/components/BracketView.tsx` (`Props` ~l.58 : prop `timings`; en-tête de `treeCard` ~l.208)
- Modify: `src/web/pages/BracketsPage.tsx` (~l.379, `BracketView` de la vue Liste)
- Test: `tests/web/match-timings.test.ts`

**Interfaces:**
- Consumes: `timingLongText` (Task 1), `combatTiming`, `ageGroupOf`, `finalMatchIds`.
- Produces: `export function matchTimings(category: Pick<Category, 'bracket' | 'key' | 'durations'>, settings: { schedule: ScheduleSettings; triathlonRounds: 3 | 6 }, grid: Grid): Map<string, string>` — matchId → texte long ; vide pour un kata ou sans tableau. `BracketView` prop `timings?: Map<string, string>`.

- [ ] **Step 1: Test qui échoue** (`tests/web/match-timings.test.ts`, catégorie combat à 4 en élimination construite comme dans les tests existants de `tests/domain/schedule-durations.test.ts`, réglages `defaultSettings`)

```ts
test('matchTimings : chaque combat, la finale avec sa durée de finale, une exception', () => {
  const t = matchTimings(cat4({ durations: { bracket: null, finals: { rounds: 3, roundSec: 120, restSec: 30, overtimeSec: 60 }, matches: { [semi1]: { rounds: 1, roundSec: 60, restSec: 0, overtimeSec: 0 } } } }), settings, grid);
  expect(t.get(semi1)).toBe('1 round de 1 min');
  expect(t.get(finalId)).toBe('3 rounds de 2 min · prolongation 1 min');
  expect(matchTimings(kataCat, settings, grid).size).toBe(0);
});
```
- [ ] **Step 2:** `npx vitest run tests/web/match-timings.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter `matchTimings` (tous les `bracket.matches`, hors exempts inutiles à filtrer : la carte d'un exempt n'affiche rien).
- [ ] **Step 4:** Même commande → PASS.
- [ ] **Step 5:** `BracketView` : dans `treeCard`, sous l'en-tête, `{!props.printable && !m.bye && props.timings?.get(m.id) && <Text size="xs" c="dimmed" px={6} data-testid="match-timing">{props.timings.get(m.id)}</Text>}`. `BracketsPage` (vue Liste) : `timings={competition && grid ? matchTimings(selected, competition.settings, grid) : undefined}` (`useCompetition`, `useGrid` de `../api.js`, mémoïsé sur `selected`).
- [ ] **Step 6:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 7: Vérifier sur Chrome** : Tableaux → Liste d'un tableau de combat (chaque combat montre sa durée ; une exception saisie dans « Durée des combats » se reflète) ; Combats → carte de zone (à l'appel et Ensuite) ; Imprimer → aucune durée.
- [ ] **Step 8:** `git commit -m "feat(tableaux): durée de chaque combat dans la vue Liste"`
