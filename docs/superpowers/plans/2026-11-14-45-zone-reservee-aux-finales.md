# Zone réservée aux finales — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une case « Réservée aux finales » sur chaque zone : la répartition automatique ne lui donne aucune catégorie, mais
elle accepte les finales des disciplines cochées.

**Architecture:** booléen `finals_only` sur la table `zones`, porté par `Zone` / `ZoneInput` / `ZoneSpec` ; seul
`distributeZones` le lit (une zone réservée n'est jamais choisie pour une catégorie non épinglée). L'acceptation des finales
(`accepts` dans `plan.ts`, `wave-finals.ts`) et « Déplacer vers… » ne changent pas. Le paquet de synchronisation copie
les colonnes de façon générique (absente d'un vieux paquet → défaut de la base).

**Tech Stack:** TypeScript, Drizzle (SQLite), Fastify + zod, React + Mantine, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-zone-reservee-aux-finales-design.md`

## Global Constraints

- Libellé exact de la case : « Réservée aux finales » ; marque dans la liste de zone de Combats : « (réservée aux finales) ».
- N'importe quelle zone peut être réservée ; plusieurs aussi.
- Défaut : faux (zones existantes, nouvelles zones, vieux paquets).
- `ZoneInput.finalsOnly` omis = inchangé (comme `disciplines`) ; nouvelle zone sans valeur = faux.
- Une catégorie épinglée sur une zone réservée y reste (l'épinglage l'emporte).
- Aucune donnée réelle dans les tests ou les commits.

## Review Focus

1. Toutes les zones qui acceptent une discipline sont réservées → ses catégories sont « impossibles » (alerte existante), pas placées sur la zone réservée.
2. Une zone réservée avec catégories déjà réparties automatiquement (session non lancée) : elles repartent sur les autres zones au prochain calcul.
3. Enregistrer les Réglages sans toucher à la case ne la décoche pas (round-trip PUT/GET).
4. Paquet d'avant (sans `finals_only`) importé sur une base à jour : zones à faux, import accepté.
5. Session déjà lancée : la répartition est figée (épinglage au lancement) ; cocher la case ne déplace rien.

---

### Task 1: Données, répartition et API

**Files:**
- Modify: `src/domain/zones.ts` (types `Zone`, `ZoneInput`)
- Modify: `src/domain/passages/distribute.ts` (`ZoneSpec`, `zonesFor` inchangé, `distributeZones`)
- Modify: `src/server/db/schema.ts:270-280` (table `zones`)
- Create: `drizzle/0037_zone_reservee_finales.sql` (+ snapshot/journal via `npx drizzle-kit generate --name zone_reservee_finales`)
- Modify: `src/server/repositories/zones.ts` (`listZones`, `replaceZones`)
- Modify: `src/server/routes/zones.ts` (schéma zod)
- Modify: `src/server/repositories/passages.ts:99` (passer `finalsOnly` au plan)
- Test: `tests/domain/passages/distribute.test.ts`, `tests/server/zone-finals-only.test.ts` (nouveau)

**Interfaces:**
- Produces: `Zone.finalsOnly: boolean` ; `ZoneInput.finalsOnly?: boolean` ; `ZoneSpec.finalsOnly?: boolean` (optionnel : les
  appels existants restent valides, absent = faux) ; colonne `zones.finals_only` (`integer` mode boolean, `notNull`,
  défaut `false`), champ Drizzle `finalsOnly` ; API `PUT /zones` accepte `finalsOnly` booléen optionnel, `GET /zones`
  le renvoie.

- [ ] **Step 1: tests de répartition qui échouent** (dans `distribute.test.ts`)

```ts
test('zone réservée aux finales : aucune catégorie automatique, l’épinglage l’emporte', () => {
  const ring: ZoneSpec = { id: 'ring', order: 0, disciplines: null, finalsOnly: true };
  const r = distributeZones([cat('a', 9), cat('b', 1), cat('pin', 2, { pinnedZoneId: 'ring' })], [ring, t1, t2]);
  expect(zonesOf(r)).toEqual({ a: 't1', b: 't2', pin: 'ring' });
  expect(r.impossible).toEqual([]);
});

test('discipline accueillie seulement par une zone réservée : impossible', () => {
  const ring: ZoneSpec = { id: 'ring', order: 1, disciplines: ['shido-boxing'], finalsOnly: true };
  const r = distributeZones([cat('box', 3, { discipline: 'shido-boxing' })], [{ ...t1, disciplines: ['karate'] }, ring]);
  expect(zonesOf(r)).toEqual({ box: null });
  expect(r.impossible).toEqual(['box']);
});
```

- [ ] **Step 2:** `npx vitest run tests/domain/passages/distribute.test.ts` → FAIL (le ring reçoit `a`).

- [ ] **Step 3:** dans `distributeZones`, les zones autorisées d'une catégorie non épinglée sont `zonesFor(...)` sans
  celles où `finalsOnly` est vrai. `zonesFor` garde son sens (« accueille la discipline »).

- [ ] **Step 4:** même commande → PASS.

- [ ] **Step 5: tests serveur qui échouent** (`tests/server/zone-finals-only.test.ts`, mise en place copiée de
  `tests/server/wave-finals.test.ts` : `buildApp` sur `tmpDbPath()`, compétition « Coupe », `call`, `register`)

  - `test('la case se lit, s’enregistre, et reste telle quelle quand elle est omise')` : `PUT /zones`
    `[{ name: 'Tatami 1' }, { name: 'Ring', finalsOnly: true }]` → réponse `[{finalsOnly:false},{finalsOnly:true}]` ;
    puis `PUT` des deux zones avec leur `id` et `name` seulement → `GET /zones` garde `finalsOnly: true` sur Ring ;
    puis `PUT` avec `finalsOnly: false` → faux.
  - `test('aucune catégorie sur la zone réservée ; ses finales y passent dès que la catégorie est finie')` : zones
    Tatami 1, Tatami 2, Ring (`finalsOnly: true`) ; 4 cadettes `cadet:F:-54` et 4 minimes `minime:F:-45` (karaté jiyu, sans
    session) ; tirer les tableaux comme le fait `wave-finals.test.ts` ; `passagePlan(db, id)` → aucune
    `plan.categories[*].zoneId` ne vaut l'id du Ring ; puis `setFinalsZone(db, id, null, ringId)` et
    `setCategoryFinals` « Dès que finie » pour les deux catégories (signature dans `wave-finals.ts:99`) → la file du Ring
    (`plan.zones` du Ring) ne contient que des finales (`finalMatchIds`) des deux catégories, et `plan.impossible` est vide.
  - `test('paquet d’avant sans finals_only : zones à faux')` : exporter la compétition avec la fonction d'export de
    `src/server/sync/package.ts`, retirer `finals_only` de chaque ligne de `tables.zones`, l'importer sur une nouvelle base
    (même chemin que `tests/server/` existants pour `importPackage`) → `listZones` renvoie `finalsOnly: false` partout.

- [ ] **Step 6:** `npx vitest run tests/server/zone-finals-only.test.ts` → FAIL.

- [ ] **Step 7:** colonne `finalsOnly: integer('finals_only', { mode: 'boolean' }).notNull().default(false)` dans
  `zones` (commentaire : « Réservée aux finales : la répartition automatique ne lui donne aucune catégorie. ») ; générer
  la migration `0037_zone_reservee_finales` ; `listZones` renvoie `finalsOnly` ; `replaceZones` l'écrit comme
  `disciplines` (omis = inchangé, nouvelle zone = faux) ; zod `finalsOnly: z.boolean().optional()` ; `planInput` passe
  `finalsOnly: z.finalsOnly`.

- [ ] **Step 8:** `npx vitest run tests/server/zone-finals-only.test.ts tests/domain` puis `npm run typecheck` → PASS.

- [ ] **Step 9: commit** `feat(zones): zone réservée aux finales (données, répartition, API)`

### Task 2: Écrans, aide, guide

**Files:**
- Modify: `src/web/pages/CompetitionSettingsPage.tsx` (état `zones`, ligne de zone, enregistrement l.124)
- Modify: `src/web/pages/MatchesPage.tsx:72-75` (`zoneOptions`)
- Modify: `src/web/help.ts` (`reglages.zones`, aide de l'onglet Finales l.434-447)
- Modify: `docs/guide-utilisateur.md` (§ Réglages l.61, § « Les finales : où et quand » l.74)
- Test: `tests/e2e/finales.spec.ts`

**Interfaces:**
- Consumes: `Zone.finalsOnly`, `ZoneInput.finalsOnly` (Task 1).

- [ ] **Step 1: e2e qui échoue** dans `finales.spec.ts`,
  `test('zone réservée aux finales : cochée dans Réglages, aucune catégorie dessus, choisie comme zone des finales')` :
  compétition au nom unique (« Coupe réservée finales ») ; Réglages → `zone-add`, nommer « Ring », cocher la case
  `getByTestId('zone-finals-only').nth(2)` (libellé « Réservée aux finales »), Enregistrer, recharger → case cochée ;
  inscrire par l'API 4 cadettes `cadet:F:-54` ; dans Combats, la puce `schedule-zone` de la catégorie ne montre pas
  « Ring » (« Automatique (Tatami 1) » ou « Tatami 2 ») et la liste ouverte montre l'option « Ring (réservée aux finales) » ;
  onglet Finales : zone des finales « Ring » sélectionnable.

- [ ] **Step 2:** `npx playwright test tests/e2e/finales.spec.ts -g "réservée"` → FAIL.

- [ ] **Step 3:** Réglages : `finalsOnly` dans l'état de chaque zone (faux pour une zone ajoutée), un `Checkbox`
  `data-testid="zone-finals-only"` « Réservée aux finales » dans la ligne de zone, à côté des disciplines, envoyé dans
  `input`. Combats : libellé `${z.name} (réservée aux finales)` pour une zone réservée dans `zoneOptions`.
  Aide `reglages.zones` : une puce « Réservée aux finales : l’app n’y répartit aucune catégorie (vous pouvez encore en
  épingler une à la main) ; choisissez-la ensuite comme zone des finales dans l’onglet Finales, ses finales « Dès que
  finie » y passent dès que leur catégorie est terminée. Les disciplines cochées disent quelles finales elle accepte. »
  Aide Finales et guide : une phrase équivalente renvoyant à la case.

- [ ] **Step 4:** même commande → PASS ; puis `npx playwright test tests/e2e/socle.spec.ts -g "zones"` → PASS.

- [ ] **Step 5: commit** `feat(web): case « Réservée aux finales » sur les zones`

### Task 3: Vérifications finales

- [ ] `npm run typecheck && npm test` → tout vert ; `npm run test:e2e` → tout vert.
- [ ] Contrôle sur Chrome (Claude in Chrome) sur une copie de démo : Réglages (case, clair/sombre, largeur téléphone),
  Combats (puce de zone), Finales (Ring comme zone des finales, résumé par zone).
- [ ] Bilan (`docs/superpowers/plans/2026-10-21-99-bilan.md`) et feuille de route : étape 45.
