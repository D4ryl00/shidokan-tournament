# Clubs dans les cartes des zones — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jour J → Combats : chaque carte de zone montre le club de chaque combattant, et pour un bloc de kata la liste
des katakas (avec club), « Se présente / Se prépare » quand il est à l'appel.

**Architecture:** `schedule()` (`src/server/repositories/results.ts`) enrichit chaque `QueueItem` : `aClub`/`bClub`
pour un combat, `katakas` (tour, liste ordonnée des présents avec nom, club, noté ou non) pour un bloc de kata. Un helper
de domaine pur construit la liste ; un helper web pur en tire « kataka i sur n / se présente / se prépare ».
`ZoneQueueCard` affiche.

**Tech Stack:** TypeScript, Fastify, Drizzle/SQLite, React + Mantine, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-clubs-dans-les-cartes-des-zones-design.md`

## Global Constraints

- Club absent : « Sans club » (déjà fourni par `labels()`).
- Libellés exacts : « Se présente : », « Se prépare : », « kataka 3 sur 8 », « contre ».
- Les absents (`c.absentIds`) ne figurent pas dans la liste des katakas et ne comptent pas dans « sur n ».
- L'écran public, l'ordre des passages et la limite de 5 lignes « Ensuite » ne changent pas.
- Tests e2e existants intacts (`next-kata` contient toujours « 3 katakas »).

## Review Focus

- Bloc « kata entier » (tour 1 puis finale, `matchId` null) : après le tour 1 noté, la liste devient les 2 finalistes,
  tour `finale`. → test serveur, tâche 2.
- Kata à 2 katakas (pas de tour 1) : la liste est d'emblée la finale, dans l'ordre `bracket.order`. → couvert par `resolveKata` (2 inscrits : `finalists` = `order`), vérifié sur Chrome.
- Finale de kata séparée (`kata:finale`) dont le tour 1 n'est pas fini : `katakas` null, l'écran garde « N katakas ». → test serveur, tâche 2.
- Dernier kataka à passer : pas de ligne « Se prépare ». → test web, tâche 3.
- Tous notés mais bloc encore dans la file (finale à égalité à départager) : pas de « Se présente », carte lisible. → test web, tâche 3.

---

### Task 1: Liste des katakas d'un bloc (domaine)

**Files:**
- Create: `src/domain/passages/kata-lineup.ts`
- Modify: `src/domain/passages/index.ts` (ré-export)
- Test: `tests/domain/passages/kata-lineup.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface KatakaSlot { registrationId: string; done: boolean }
  /** Présents de `ids` dans cet ordre ; `done` : notes déjà saisies dans ce tour. */
  export function kataLineup(ids: string[], absentIds: string[], notes: Record<string, number[]>): KatakaSlot[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('kataLineup : ordre gardé, absents retirés, noté = au moins une note', () => {
  expect(kataLineup(['a', 'b', 'c', 'd'], ['b'], { a: [8, 8], c: [] })).toEqual([
    { registrationId: 'a', done: true }, { registrationId: 'c', done: false }, { registrationId: 'd', done: false },
  ]);
});
test('kataLineup : liste vide', () => expect(kataLineup([], [], {})).toEqual([]));
```

- [ ] **Step 2:** `npx vitest run tests/domain/passages/kata-lineup.test.ts` → FAIL (module absent).
- [ ] **Step 3:** Implémenter `kataLineup` (filter + map).
- [ ] **Step 4:** Relancer → PASS.
- [ ] **Step 5:** Commit `feat(combats): liste des katakas d'un bloc`.

### Task 2: File des zones enrichie (serveur)

**Files:**
- Modify: `src/server/repositories/results.ts` (`QueueItem` ~l. 227, `schedule()` ~l. 250-325)
- Test: `tests/server/results.test.ts`

**Interfaces:**
- Consumes: `kataLineup` (tâche 1), `resolveKata` (`src/domain/brackets/kata.ts`), `labels()` (déjà `{ name, club }`).
- Produces (ajouts à `QueueItem`, copiés tels quels dans `src/web/api.ts` à la tâche 3) :
  ```ts
  aClub: string | null; bClub: string | null;   // null pour un kata
  /** Bloc de kata : katakas présents dans l'ordre de passage du tour joué ; null pour un combat ou finale aux finalistes inconnus. */
  katakas: { round: 'tour1' | 'finale'; list: { name: string; club: string; done: boolean }[] } | null;
  ```

Règles dans `queue()` pour un passage de kata (garder dans `state` les `scores`, `tieBreaks` et le bracket, déjà lus dans `describe`) :
- `kata:tour1` → tour `tour1`, `kataLineup(bracket.order, absentIds, scores.round1)`.
- `kata:finale` → si `finalistsKnown` : tour `finale`, `kataLineup(resolveKata(bracket, scores, tb.kata, tb.kataFinal).finalists, absentIds, scores.final)` ; sinon `null`.
- bloc entier (`null`) → tour 1 si `bracket.order.length > 2 && !round1Done`, sinon la finale comme ci-dessus.
- `katakas: number` (nombre d'inscrits) reste inchangé.

- [ ] **Step 1: Write the failing tests** (étendre le type `QItem` de `results.test.ts` avec `a`, `aClub`, `bClub`, `katakas`)

```ts
test('file des zones : club de chaque combattant', async () => {
  const c = await fourInElimination();          // clubs alternés « Club A » / « Club B »
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  const q = (await queueOf(t1!.id))[0]!;
  expect(q.aClub).toMatch(/^Club [AB]$/);
  expect(q.bClub).toMatch(/^Club [AB]$/);
  expect(q.katakas).toBeNull();
});

test('file des zones : bloc de kata, liste ordonnée qui avance, puis finale', async () => {
  const k = [/* 3 reg kata */];
  // catégorie kata sur t1 ; ordre = (await cats()) kata.bracket.order
  // avant notes : katakas = { round: 'tour1', list: 3 entrées, toutes done: false, club /^Club [AB]$/ }, noms dans l'ordre du tirage
  // noter order[0] → list[0].done === true, list[1].done === false
  // noter les 3 (notes distinctes) → katakas.round === 'finale', list.length === 2, aClub null
});
```
Et dans le test existant « finale de kata prête avant son tour » : avant les notes, l'élément `kataPart === 'finale'` a `katakas: null`.

- [ ] **Step 2:** `npx vitest run tests/server/results.test.ts` → les nouveaux tests échouent.
- [ ] **Step 3:** Implémenter (garder `labels` complet : `who.get(rid)` donne `name` et `club`).
- [ ] **Step 4:** Relancer → PASS ; `npm run typecheck` propre.
- [ ] **Step 5:** Commit `feat(combats): clubs et katakas dans la file des zones`.

### Task 3: Affichage dans les cartes des zones (web)

**Files:**
- Create: `src/web/kataCall.ts`
- Modify: `src/web/api.ts:705-719` (`QueueItem`), `src/web/components/ZoneQueueCard.tsx`, `src/web/help.ts` (`combats.zone`)
- Test: `tests/web/kata-call.test.ts`, `tests/e2e/ordre-de-passage.spec.ts`

**Interfaces:**
- Consumes: champs `aClub`, `bClub`, `katakas` (tâche 2).
- Produces:
  ```ts
  type Slot = { name: string; club: string; done: boolean };
  /** Premier non noté = se présente, suivant non noté = se prépare ; position 1-based sur les présents. */
  export function kataCall(list: Slot[]): { position: number; total: number; current: Slot | null; next: Slot | null };
  ```

- [ ] **Step 1: Write the failing tests** (`tests/web/kata-call.test.ts`)

```ts
const s = (name: string, done = false) => ({ name, club: 'C', done });
test('se présente / se prépare', () =>
  expect(kataCall([s('A', true), s('B'), s('C')])).toEqual({ position: 2, total: 3, current: s('B'), next: s('C') }));
test('dernier : pas de suivant', () => expect(kataCall([s('A', true), s('B')]).next).toBeNull());
test('tous notés : personne', () => expect(kataCall([s('A', true)])).toEqual({ position: 1, total: 1, current: null, next: null }));
```
(`position` quand tous sont notés : `total`.)

- [ ] **Step 2:** `npx vitest run tests/web/kata-call.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter `kataCall`.
- [ ] **Step 4:** Relancer → PASS.
- [ ] **Step 5: Afficher dans `ZoneQueueCard.tsx`**
  - `OnCall` combat : sous `q.a` et `q.b`, `<Text size="sm" c="var(--sk-hero-sub)" data-testid="club">{club}</Text>`.
  - `OnCall` kata avec `q.katakas` : à côté de « N katakas », « kataka {position} sur {total} » ; puis « Se présente : NOM · Club »
    (gras, grand) et « Se prépare : NOM · Club » (si `next`) ; `data-testid="kata-current"` / `"kata-next"`. Le tour
    affiché suit `q.katakas.round` quand `kataPart` est null (« (tour 1) » / « (finale) »).
  - `Next` combat : « NOM · <dimmed>Club</dimmed> contre NOM · <dimmed>Club</dimmed> » (deux lignes si ça déborde).
  - `Next` kata avec `q.katakas` : liste `<ol>` compacte, `size="xs"`, « NOM · Club » par ligne, `data-testid="kata-lineup"`.
  - Sans `katakas` : affichage actuel.
- [ ] **Step 6:** Aide `combats.zone` : une phrase sur le club et sur « Se présente / Se prépare » pour les katas.
- [ ] **Step 7: e2e** : dans `ordre-de-passage.spec.ts`, après `toContainText('3 katakas')`, vérifier
  `tatami.getByTestId('kata-current')` contient « Se présente » et un club. `npm run test:e2e -- ordre-de-passage jour-j` → PASS.
- [ ] **Step 8:** `npm test` et `npm run typecheck` → tout vert.
- [ ] **Step 9:** Vérifier sur Chrome (Claude in Chrome) et sur le simulateur iOS : combat à l'appel, lignes « Ensuite »,
  bloc de kata à l'appel qui avance après « Noter », bloc de kata dans « Ensuite ».
- [ ] **Step 10:** Commit `feat(combats): clubs et katakas dans les cartes des zones`, puis note de réalisation dans la feuille de route.
