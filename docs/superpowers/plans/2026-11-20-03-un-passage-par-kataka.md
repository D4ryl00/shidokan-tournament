# Un passage par kataka — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque kataka devient un passage à part entière (sa clé, son numéro, sa zone) ; la carte de zone et la page publique montrent une personne par passage.

**Architecture:** Les clés de passage de kata (`null`, `'kata:tour1'`, `'kata:finale'`) sont remplacées par des clés par kataka (`kata:tour1:<registrationId>`, `kata:finale:1|2`) définies dans un nouveau module `src/domain/passages/kata-keys.ts`. `Passage.matchId` devient `string` (jamais null) : le compilateur signale chaque endroit qui supposait un bloc. L'ordre de passage ne change pas (katas d'abord, catégorie par catégorie, ordre du tirage), seul le nombre de numéros change. Tout le reste (figeage, déplacements, zone des finales, joué/non joué, file, page publique) travaille kataka par kataka.

**Tech Stack:** TypeScript, React + Mantine, Fastify, SQLite (aucune migration), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-kata-par-kataka-duree-recap-mail-design.md` (partie 3)

## Global Constraints

- Clés : tour 1 `kata:tour1:<registrationId>` pour chaque id de `bracket.order` (dans cet ordre, absents tardifs compris) — seulement si `bracket.order.length > 2` ; finale `kata:finale:1`, `kata:finale:2` (`min(entrants, 2)` passages ; position = ordre de `resolveKata(...).finalists`).
- Bloc non séparé (`!kataSplit`) : clés du tour 1 puis clés de finale, consécutives, sur la zone de la catégorie. Bloc séparé : clés de finale ensemble, placées comme l'ancien bloc `'kata:finale'`.
- Ordre par défaut inchangé : sur chaque zone, katas d'abord (rang de catégorie), puis combats.
- Joué : `kata:tour1:<rid>` ⇔ au moins une note `round1` de `rid` ; `kata:finale:k` ⇔ le k-ième finaliste a au moins une note `final`. **Absent tardif** : sa clé du tour 1 est dans l'ensemble « joué » (`playedKeys`) → jamais renumérotée, jamais déplacée, jamais appelée ; l'ouverture de la finale garde sa règle actuelle (`round1Scored`).
- Durée estimée d'un passage de kata : `kataPassageSec`, plus `changeoverSec` seulement pour la première clé du tour 1 (`bracket.order[0]`) et pour `kata:finale:1`.
- Les combats ne changent pas (numéros, ordre, repos).
- Aucune migration : d'anciennes lignes figées (`'kata'`, `'kata:tour1'`, `'kata:finale'`) rendent la catégorie « à numéroter ». Aucune session n'est lancée en production ; **ne lancer aucune session avant la mise en ligne**.
- Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte ; tester chaque changement visible sur Chrome (et la page publique sur téléphone : simulateur iOS + idb).

## Review Focus

- Kata à 2 katakas : deux passages de finale seulement, noms connus d'emblée, pas de tour 1.
- Absent tardif après lancement puis « Mélangés » sur la zone : l'absent garde son numéro ; aucun autre numéro ne le double.
- Égalité du tour 1 qui sépare finaliste et non-finaliste : les deux passages de finale s'affichent « Finaliste 1 / 2 » sans nom (comme `finalistsKnown` aujourd'hui).
- Finale de kata sur la zone des finales « Dès que finie » : ses deux passages restent consécutifs et se rangent selon la fin estimée du tour 1.
- Page publique d'un kata suivi (★) : le kataka a sa ligne et son heure ; après sa note, la ligne passe « joué » avec l'heure de sa note.

---

### Task 1: Clés de kata et plan de passage (domaine)

**Files:**
- Create: `src/domain/passages/kata-keys.ts`
- Modify: `src/domain/passages/order.ts` (`OrderCategory`, `Passage`, `zoneOrder`)
- Modify: `src/domain/passages/plan.ts` (`FrozenPassage.matchId`, `kataEntry`, `orderWave`, `stillValid`, `PlanInput.durationSec`/`played` docs)
- Modify: `src/domain/passages/finals.ts` (`isFinalPassage`)
- Modify: `src/domain/passages/index.ts` (exports)
- Modify: `src/domain/schedule/durations.ts` (`kataPassages` : supprimer si plus utilisé après Task 4, sinon garder)
- Test: `tests/domain/passages/kata-keys.test.ts`, mettre à jour `order.test.ts`, `frozen.test.ts`, `finals-order.test.ts`, `moves.test.ts`

**Interfaces:**
- Produces (`kata-keys.ts`) :
  - `export type KataKey = { round: 'tour1'; registrationId: string } | { round: 'finale'; slot: 1 | 2 }`
  - `export const kataTour1Key = (registrationId: string) => \`kata:tour1:${registrationId}\``
  - `export const kataFinaleKey = (slot: 1 | 2) => \`kata:finale:${slot}\``
  - `export function parseKataKey(matchId: string): KataKey | null`
  - `export const isKataKey = (matchId: string) => matchId.startsWith('kata:')`
  - `export function kataKeys(bracket: KataBracket, part: 'whole' | 'tour1' | 'finale'): string[]`
- Produces (`order.ts`) : `OrderCategory.kataKeys: string[] | null` (remplace `kataEntrants` et `kataBlock`) ; `Passage.matchId: string`.
- Produces (`plan.ts`) : `FrozenPassage.matchId: string` ; clé « joué » = `\`${categoryId}:${matchId}\`` partout (plus de `?? 'kata'`).
- Produces (`finals.ts`) : `isFinalPassage(bracket, matchId: string)` vrai pour `kata:finale:*`.

- [ ] **Step 1: Tests qui échouent** (`kata-keys.test.ts`)

```ts
test('kataKeys : tour 1 dans l’ordre du tirage, puis finale', () => {
  const b = kataBracket(entrants(['r1', 'r2', 'r3']), 1, 1, entrants(['r3', 'r1', 'r2']));
  expect(kataKeys(b, 'whole')).toEqual(['kata:tour1:r3', 'kata:tour1:r1', 'kata:tour1:r2', 'kata:finale:1', 'kata:finale:2']);
  expect(kataKeys(b, 'tour1')).toEqual(['kata:tour1:r3', 'kata:tour1:r1', 'kata:tour1:r2']);
  expect(kataKeys(b, 'finale')).toEqual(['kata:finale:1', 'kata:finale:2']);
});
test('kataKeys : à deux, la finale seule', () => {
  expect(kataKeys(kataBracket(entrants(['a', 'b']), 1, 1), 'whole')).toEqual(['kata:finale:1', 'kata:finale:2']);
});
test('parseKataKey', () => {
  expect(parseKataKey('kata:tour1:r3')).toEqual({ round: 'tour1', registrationId: 'r3' });
  expect(parseKataKey('kata:finale:2')).toEqual({ round: 'finale', slot: 2 });
  expect(parseKataKey('w1-0')).toBeNull();
});
```
Dans `order.test.ts` : un kata de 5 au rang 1 et une catégorie de combats → numéros 1-7 pour les clés du kata (5 tour 1 + 2 finale), puis les combats à partir de 8.
Dans `frozen.test.ts` : lignes figées avec l'ancienne clé `'kata'` → catégorie dans `pending` avec `reason: 'shape'` ; lignes figées avec les nouvelles clés → pas « à numéroter » ; une clé de tour 1 absente de `played` mais présente parmi les figées, après retrait d'un inscrit → « à numéroter ».
Dans `moves.test.ts` : `reshuffleZone` avec `played` contenant `cat:kata:tour1:r2` (absent) → la ligne de `r2` n'est pas réémise et garde son numéro ; les autres katakas sont renumérotés autour.
Dans `finals-order.test.ts` : kata séparé, finale « Dès que finie » sur la zone des finales → `kata:finale:1` et `kata:finale:2` consécutifs.

- [ ] **Step 2:** `npx vitest run tests/domain/passages` → FAIL.
- [ ] **Step 3:** Implémenter `kata-keys.ts`, puis : `zoneOrder` émet une ligne par clé de `kataKeys` (numéro croissant) ; `orderWave` construit `kataKeys` avec `kataKeys(bracket, part)` filtrées par `kept` clé par clé (bloc non séparé → `'whole'` ; séparé → `'tour1'` sur la zone, `'finale'` en finales) ; `stillValid` compare l'ensemble des clés figées avec `kataKeys(bracket, kataSplit ? … : 'whole')` (union tour1 + finale quel que soit le découpage) et considère `kata:finale:*` comme finales ; `isFinalPassage` ; `Passage.matchId: string`.
- [ ] **Step 4:** `npx vitest run tests/domain` → PASS (mettre à jour les attentes des tests existants qui supposaient un bloc : un bloc de N devient N lignes).
- [ ] **Step 5:** `git commit -m "feat(passages): un passage par kataka dans le plan de passage"`

### Task 2: Serveur — plan, joué, figeage, déplacements, droits

**Files:**
- Modify: `src/server/repositories/passages.ts` (`playedKeys`, `planInput.durationSec`, `passageNumbers`, `loadFrozen`)
- Modify: `src/server/repositories/launches.ts` (`rowOf`, `keyOf`, `playedKey`, `replaceRows`, `moveCategory` : `pinned` des finales de kata = `isKataKey` + `parseKataKey(...).round === 'finale'`)
- Modify: `src/server/repositories/wave-finals.ts` (~l.190 : `isFinalPassage`)
- Modify: `src/server/repositories/estimate.ts` (~l.38 `keyOf`)
- Modify: `src/server/auth/permissions.ts` (~l.75 `entryZones` : zones des passages dont `parseKataKey(m)?.round` correspond au tour visé)
- Test: `tests/server/passages.test.ts`, `tests/server/launches.test.ts`, `tests/server/permissions.test.ts`, `tests/server/moves.test.ts`, `tests/server/estimate.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `playedKeys(db, competitionId): Set<string>` avec les clés par kataka (et les absents tardifs du tour 1) ; `passageNumbers(plan)` : clés `\`${categoryId}:${matchId}\`` ; durées par clé (constante globale).

- [ ] **Step 1: Tests qui échouent** (`passages.test.ts`, mêmes helpers que les tests de kata existants)

```ts
test('passages joués : par kataka, absent tardif compris, finale par finaliste', async () => {
  // kata de 3 (r1, r2, r3), r3 absent tardif ; r1 noté au tour 1
  const keys = playedKeys(db, competitionId);
  expect(keys.has(`${k}:kata:tour1:${r1}`)).toBe(true);
  expect(keys.has(`${k}:kata:tour1:${r2}`)).toBe(false);
  expect(keys.has(`${k}:kata:tour1:${r3}`)).toBe(true);
  expect(keys.has(`${k}:kata:finale:1`)).toBe(false);
});
test('durée estimée : un changement par tour, pas par kataka', async () => {
  const input = await planInput(db, competitionId);
  const [first, second] = bracket.order;
  expect(input.durationSec!(k, `kata:tour1:${first}`)).toBe(kataPassageSec + changeoverSec);
  expect(input.durationSec!(k, `kata:tour1:${second}`)).toBe(kataPassageSec);
  expect(input.durationSec!(k, 'kata:finale:1')).toBe(kataPassageSec + changeoverSec);
  expect(input.durationSec!(k, 'kata:finale:2')).toBe(kataPassageSec);
});
```
`launches.test.ts` : lancer une session avec un kata de 4 → 6 lignes figées (`kata:tour1:*` ×4, `kata:finale:1|2`) aux numéros consécutifs ; relancer après « Refiger » → mêmes numéros.
`permissions.test.ts` : poste de zone dont la zone porte les passages du tour 1 d'un kata séparé → peut noter `round1`, pas `final` (finale sur la zone des finales).

- [ ] **Step 2:** `npx vitest run tests/server/passages.test.ts tests/server/launches.test.ts tests/server/permissions.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter. `playedKeys` : finalistes par `resolveKata(bracket, scores, tb.kata, tb.kataFinal)` (scores et départages lus comme `getResults`), absents par `categories.absentIds`. `loadFrozen`/`rowOf` : plus de conversion `'kata'` ↔ null.
- [ ] **Step 4:** `npm test` → PASS hors tests de la file et de la page publique (Tasks 3-4) ; `npm run typecheck` → seules erreurs restantes dans `results.ts`, `public/*`, `web/*` (traitées ensuite).
- [ ] **Step 5:** `git commit -m "feat(passages): figeage, déplacements et droits par kataka"`

### Task 3: File de zone et carte « À l'appel » par kataka

**Files:**
- Modify: `src/server/repositories/results.ts` (`QueueItem` ~l.228, `schedule` ~l.300-345 : `kataDone`, `isKataPassage`, `unplayed`, `queue`, `readyFinal`, `waitingOtherZones`)
- Modify: `src/web/api.ts` (`QueueItem`, supprimer `QueueKataka`)
- Modify: `src/web/components/ZoneQueueCard.tsx`
- Delete: `src/web/kataCall.ts`, `tests/web/kata-call.test.ts`
- Modify: `src/web/help.ts` (`combats.zone` l.671-679 et toute aide qui dit « toute la catégorie de kata sous un seul numéro »)
- Test: `tests/server/results.test.ts` (tests « file des zones : … kata … » l.238-300 réécrits), `tests/web/zone-cards.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `QueueItem` (serveur et client) : supprime `katakas` et `lineup` ; `kataPart: 'tour1' | 'finale' | null` (null : combat) ; ajoute `kata: { name: string | null; club: string | null; position: number; total: number } | null` — `name`/`club` null : finaliste pas encore connu ; `position` = rang parmi les présents du tour (finale : 1 ou 2), `total` = présents du tour 1 (finale : 2). `matchId` reste `string | null` côté client mais vaut la clé du passage pour un kata (`kata:…`) ; un kata se reconnaît à `kataPart !== null`.

- [ ] **Step 1: Tests serveur qui échouent** (remplacent « bloc de kata, liste ordonnée qui avance, puis finale »)

```ts
test('file des zones : un élément par kataka, dans l’ordre du tirage, puis la finale', async () => {
  // kata de 3 sur t1
  let q = await queueOf(t1);
  expect(q.map((i) => [i.kataPart, i.kata?.name, i.kata?.position, i.kata?.total])).toEqual([
    ['tour1', n1, 1, 3], ['tour1', n2, 2, 3], ['tour1', n3, 3, 3], ['finale', null, 1, 2], ['finale', null, 2, 2],
  ]);
  expect(new Set(q.map((i) => i.number)).size).toBe(5);
  await score(order[0], 'round1');
  q = await queueOf(t1);
  expect(q[0]!.kata!.name).toBe(n2);
  // tour 1 entièrement noté → finalistes nommés
});
test('file des zones : absent tardif jamais appelé, son numéro sauté', async () => { /* … */ });
test('file des zones : kata à 2, deux passages de finale nommés d’emblée', async () => { /* … */ });
test('file des zones : égalité finaliste / non-finaliste → « Finaliste 1/2 » sans nom', async () => { /* … */ });
```
- [ ] **Step 2:** `npx vitest run tests/server/results.test.ts -t "file des zones"` → FAIL.
- [ ] **Step 3:** Implémenter côté serveur : un élément par clé non jouée (règles de Global Constraints), `kata` rempli depuis `bracket.order` / `finalists` ; `early` : un passage de finale de kata est « prêt » si `finalistsKnown`.
- [ ] **Step 4:** Même commande → PASS.
- [ ] **Step 5: Tests web qui échouent** (`zone-cards.test.ts` : réécrire `kata()` avec le nouveau `QueueItem`)

```ts
test('kata à l’appel : une seule personne, pas de « Se prépare »', () => {
  const html = render([kataItem(1, 'tour1', { name: 'DURAND Léa', club: 'Club A', position: 1, total: 3 }), kataItem(2, 'tour1', { name: 'MARTIN Zoé', club: 'Club B', position: 2, total: 3 })]);
  expect(html.match(/data-testid="kata-current"/g)).toHaveLength(1);
  expect(html).not.toContain('Se prépare');
  expect(html).toContain('kataka 1 sur 3');
  expect(html.indexOf('MARTIN Zoé')).toBeGreaterThan(html.indexOf('Ensuite'));
});
test('finale aux finalistes inconnus : « Finaliste 1 »', () => {
  expect(render([kataItem(4, 'finale', { name: null, club: null, position: 1, total: 2 })])).toContain('Finaliste 1');
});
```
- [ ] **Step 6:** `npx vitest run tests/web/zone-cards.test.ts` → FAIL.
- [ ] **Step 7:** `ZoneQueueCard` : `OnCall` kata = n°, « catégorie (tour 1|finale) », nom + club en grand (`data-testid="kata-current"`) ou « Finaliste {position} », « kataka {position} sur {total} » (tour 1 seulement) ; `Next` kata = n°, nom · club (ou « Finaliste k »), catégorie et tour en petit. Supprimer `kataCall`, `Called` « Se prépare », la liste `kata-lineup`. Clé React : `${categoryId}-${matchId}-${number}`. Mettre à jour l'aide.
- [ ] **Step 8:** `npx vitest run tests/web tests/server/results.test.ts` → PASS.
- [ ] **Step 9:** `git commit -m "feat(combats): un kataka par passage dans la file de zone"`

### Task 4: Page publique par kataka

**Files:**
- Modify: `src/domain/public/types.ts` (`PublicQueueItem`, `PublicCategory.numbers` doc)
- Modify: `src/domain/public/view.ts` (~l.217 `numberOf`, ~l.262 `numbers`, ~l.313-325 éléments de kata)
- Modify: `src/server/public/load.ts` (`endedAtOf` ~l.42)
- Modify: `src/domain/public/times.ts` (~l.20, ~l.89 heure de finale d'une catégorie)
- Modify: `src/domain/public/follow.ts` (~l.92-125 lignes d'un kataka suivi)
- Modify: `src/web/pages/public/ZonesTab.tsx`, `src/web/components/public/zoneRows.ts`, `src/web/components/public/bracketsModel.ts`, `src/web/pages/public/FollowedTab.tsx` si besoin
- Test: `tests/domain/public-view.test.ts`, `tests/domain/public-times.test.ts`, `tests/domain/public-follow.test.ts`, fixtures `tests/domain/public-fixtures.ts`, `tests/web/public-brackets.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `PublicQueueItem` pour un kata : `matchId` = clé de passage (`kata:…`), `kataPart: 'tour1' | 'finale'`, `a` = registrationId du kataka (null : finaliste inconnu), `b: null`, `kataPassages: 1`, `durationSec: kataPassageSec`, `state` : `played` (clé jouée), `waiting` (finale avant le tour 1 noté ou finalistes inconnus), sinon `ready` ; `endedAt` = heure de la note du kataka pour ce tour.
  - `PublicSource.endedAt[categoryId].kata: Record<string, string>` — clé `\`${round}:${registrationId}\`` (`round1`/`final`), valeur `updated_at` de la ligne `kata_scores` ; `round1`/`final` globaux conservés tant qu'ils servent.
  - `PublicCategory.numbers` : clé de passage → numéro (plus de `'kata'`).

- [ ] **Step 1: Tests qui échouent**

```ts
test('vue publique : un passage par kataka, nom public, heure de fin à sa note', () => {
  const view = buildPublicView(srcKataDe3({ scored: { r1: '2026-11-22T09:01:00Z' } }));
  const items = view.queues[0]!.items.filter((i) => i.categoryId === 'k');
  expect(items.map((i) => [i.matchId, i.a, i.state])).toEqual([
    ['kata:tour1:r1', 'r1', 'played'], ['kata:tour1:r2', 'r2', 'ready'], ['kata:tour1:r3', 'r3', 'ready'],
    ['kata:finale:1', null, 'waiting'], ['kata:finale:2', null, 'waiting'],
  ]);
  expect(items[0]!.endedAt).toBe('2026-11-22T09:01:00Z');
  expect(view.categories.find((c) => c.id === 'k')!.numbers['kata:tour1:r2']).toBe(items[1]!.number);
});
test('suivi d’un kataka : sa ligne du tour 1, puis la finale s’il est finaliste', () => { /* follow.ts */ });
test('heure estimée de la finale d’un kata : premier passage de finale non joué', () => { /* times.ts */ });
```
- [ ] **Step 2:** `npx vitest run tests/domain/public-view.test.ts tests/domain/public-times.test.ts tests/domain/public-follow.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter domaine + `load.ts` (lire `registration_id`, `round`, `updated_at` de `kata_scores`).
- [ ] **Step 4:** Même commande → PASS.
- [ ] **Step 5:** Web public : une ligne Zones par kataka (n°, nom public ou « Finaliste k », catégorie et tour, « vers … », ★ du suivi) ; onglet Tableaux (`bracketsModel`) : numéro par kataka. `npx vitest run tests/web && npm run typecheck` → PASS.
- [ ] **Step 6:** `git commit -m "feat(public): un passage par kataka sur la page publique"`

### Task 5: Numéros de kata à l'écran et à l'impression

**Files:**
- Modify: `src/web/passages.ts` (`categoryPassages` : `kata` devient la liste des passages de kata `{ key, number, zoneId }` ; `numbers` contient aussi les clés de kata ; `kataPassageText`)
- Modify: `src/web/components/planche/CategoryCard.tsx` (~l.99), `src/web/pages/BracketsPage.tsx` (~l.331 badge `category-kata-passage`)
- Modify: `src/web/components/BracketView.tsx` (`KataView` ~l.393 : numéro à côté de chaque kataka du tour 1 quand `numbers` le connaît ; ligne « Finale : n° 19 et 20 »)
- Modify: `src/web/pages/PrintPage.tsx` si elle ne passe pas déjà `numbers` aux katas
- Test: `tests/web/passages.test.ts` (créer s'il n'existe pas), test de rendu `KataView` dans `tests/web/` (modèle : `zone-cards.test.ts`, `renderToStaticMarkup`)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `kataPassageText(p, zones): string` — tour 1 et finale non séparés : `« n° 14 à 20 »` ; séparés : `« tour 1 : n° 14 à 18 · finale : n° 3 et 4 (Ring) »` ; à deux : `« finale : n° 14 et 15 »`. `KataView` affiche `n° {numbers.get(kataTour1Key(id))}` dans sa première colonne quand connu (sinon le rang).

- [ ] **Step 1: Tests qui échouent**

```ts
test('kataPassageText : plage du kata entier, ou tour 1 et finale séparés', () => {
  expect(kataPassageText(passagesOf([14, 15, 16, 17, 18], [19, 20], 'z1', 'z1'), zones)).toBe('n° 14 à 20');
  expect(kataPassageText(passagesOf([14, 15, 16, 17, 18], [3, 4], 'z1', 'ring'), zones)).toBe('tour 1 : n° 14 à 18 · finale : n° 3 et 4 (Ring)');
  expect(kataPassageText(passagesOf([], [14, 15], 'z1', 'z1'), zones)).toBe('finale : n° 14 et 15');
});
test('feuille de kata : numéro de chaque kataka et de la finale', () => {
  const html = renderKata({ numbers: new Map([['kata:tour1:r3', 14], ['kata:tour1:r1', 15], ['kata:tour1:r2', 16], ['kata:finale:1', 17], ['kata:finale:2', 18]]) });
  expect(html.indexOf('n° 14')).toBeLessThan(html.indexOf('n° 15'));
  expect(html).toContain('n° 17 et 18');
});
```
- [ ] **Step 2:** `npx vitest run tests/web/passages.test.ts tests/web/kata-view.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS (toute la suite).
- [ ] **Step 5:** `git commit -m "feat(tableaux): numéro de chaque kataka sur la planche, la liste et l'impression"`

### Task 6: Bout en bout et vérification

**Files:**
- Modify: `tests/e2e/jour-j.spec.ts`, `tests/e2e/ordre-de-passage.spec.ts`, `tests/e2e/figeage.spec.ts`, `tests/e2e/spectateur.spec.ts`, `tests/e2e/finales.spec.ts` (attentes sur les numéros et la carte de kata) ; ajouter un scénario « kata par kataka » dans `jour-j.spec.ts`.

- [ ] **Step 1:** Scénario e2e : kata de 3 + une catégorie de combats sur une zone ; lancer la session ; carte « À l'appel » = 1er kataka ; noter → le 2e passe à l'appel ; noter tout le tour 1 → finalistes nommés ; numéros des combats = après les 5 passages du kata.
- [ ] **Step 2:** `npm run test:e2e` → PASS (toute la suite).
- [ ] **Step 3: Vérifier sur Chrome** (serveur de test jetable, `BACKUP_INTERVAL_MIN` ≤ 1440) : Combats (carte de zone, Ensuite, absent tardif, finale), Tableaux → Liste (badge des numéros, feuille de kata), Planche, Imprimer, Sessions (lancement, numéros), Réaffectation (déplacement d'un kata « à la suite » / « mélangés »), page publique (Zones, Suivis, ★) ; page publique sur le simulateur iOS.
- [ ] **Step 4:** `git commit -m "test(e2e): kata par kataka, de la file à la page publique"`
