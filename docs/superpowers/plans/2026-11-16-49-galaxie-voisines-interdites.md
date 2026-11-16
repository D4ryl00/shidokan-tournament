# Galaxie : voisines interdites par les réglages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autour de l'étoile survolée ou choisie, montrer aussi les catégories voisines interdites par les réglages de la compétition (lien gris pointillé « Interdit : … »), les rapprocher en cartes après les voisines permises, et pouvoir y glisser un combattant avec la confirmation habituelle.

**Architecture:** Approche A de la spec : `galaxyLinks` est appelé une seconde fois avec `withAllRules(settings, grid)` ; les paires qui n'existent que dans ce second calcul sont les liens interdits (`forbiddenLinks`). `galaxyLinks` lui-même ne change pas. La scène les reçoit à part (`Scene.forbidden`), les dessine seulement pour l'étoile en focus, et les voisines interdites prennent les cases restantes après les permises. Le moteur ajoute un avertissement de confirmation pour les règles désactivées dans la liste.

**Tech Stack:** TypeScript 7, React 19, Mantine 8, Vitest, Playwright (Chrome).

**Spec:** `docs/superpowers/specs/2026-11-16-galaxie-voisines-interdites-design.md` (complète l'étape 48 : `docs/superpowers/specs/2026-11-15-galaxie-des-categories-design.md`).

## Global Constraints

- `galaxyLinks`, `galaxyLayout` et les places des étoiles ne changent pas ; les liens permis gardent leurs couleurs et leur ordre.
- Interdits par les réglages = mélange mineurs / adultes, seniors / vétérans, filles / garçons (interrupteur ou tranche non cochée), shobu → jiyu, et toute règle de `replacementRules.off`. Les interdits qui ne viennent pas des réglages (mineur en shobu, jiyu → shobu, discipline hors préférences, plus d'une tranche d'écart) restent sans lien.
- Une paire déjà reliée par un lien permis (dans un sens ou l'autre) n'a pas de lien interdit (pas de double trait) — décision de ce plan.
- Lien interdit : couleur `#8a93ad`, pointillés `[2, 5]`, largeur 1,5 px ; dessiné seulement s'il touche l'étoile survolée ou choisie ; jamais avec « Tous les liens » sans focus.
- Étiquette (lien rapproché et bord de carte) : `Interdit : ` suivi des `RULE_LABELS` des réglages en cause joints par ` + ` (exemple exact : `Interdit : Mélange mineurs / adultes`).
- Cartes : voisines permises d'abord (tri actuel), puis interdites (même tri, selon leurs règles), au plus 14 en tout (`SLOTS.length`).
- Légende : ligne trait gris pointillé, texte exact `interdit par les réglages (déplacement à la main, avec confirmation)`.
- Avertissement de confirmation d'une règle de la liste désactivée, texte exact : `Règle « <RULE_LABELS[r]> » désactivée (réglages de réaffectation).` — pour `weight`, `split`, `ageUp`, `ageDown`, `discipline` (pas `weightGap`, déjà signalé par l'écart de poids).
- Textes de l'interface en français ; aucune donnée réelle dans les tests ; chaque changement visible vérifié dans Chrome (extension Claude in Chrome) et au téléphone dans le simulateur iOS.

## Review Focus

1. Paire permise dans un sens et interdite dans l'autre : un seul lien, le permis (test tâche 1).
2. Réglages pas encore chargés (`settings` null) : aucun lien interdit, rien ne casse (test tâche 1 via la vue : `forbiddenLinks` n'est appelé qu'avec des réglages ; tâche 4 garde `[]`).
3. Catégorie choisie dont les seules voisines sont interdites : elles viennent quand même en cartes (test tâche 3).
4. Mélange filles / garçons interdit par une tranche non cochée alors que l'interrupteur est ouvert : l'étiquette nomme « Mélange filles / garçons » (test tâche 1).
5. Voisine interdite d'une autre session : badge de session et dépôt possible (e2e tâche 4).

---

### Task 1: Liens interdits par les réglages (domaine)

**Files:**
- Modify: `src/domain/galaxy/links.ts`
- Test: `tests/domain/galaxy-links.test.ts`

**Interfaces:**
- Produces:
  - `forbiddenLinks(nodes: GalaxyNode[], grid: CategoryGrid, settings: CompetitionSettings, allowed: GalaxyLink[]): GalaxyLink[]` — liens de `galaxyLinks(nodes, grid, withAllRules(settings, grid))` dont la paire (a, b) n'est pas dans `allowed` ; `fromA`/`fromB` = règles du calcul ouvert ; triés comme `galaxyLinks`.
  - `blockedRules(rules: RuleId[], settings: CompetitionSettings): RuleId[]` — règles de `rules` éteintes (`!isRuleOn`) ; si aucune et `rules` contient `mixSexes`, `['mixSexes']` (tranche non cochée).

- [ ] **Step 1: Write the failing tests** (avec les aides du fichier : `kj`, `node`, `key`, `between`, `from`, `settings`)

```ts
describe('forbiddenLinks', () => {
  const mixJ = node(key('shido-mix', 'jiyu', 'M', ['junior'], ['junior:M:+76']));
  const mixS = node(key('shido-mix', 'jiyu', 'M', ['senior'], ['senior:M:-84']));
  const mixJ76 = node(key('shido-mix', 'jiyu', 'M', ['junior'], ['junior:M:-76']));

  test('juniors → seniors, mélange mineurs / adultes fermé : interdit, la règle en cause nommée', () => {
    const s = settings({ mixMinorsAdults: false });
    const nodes = [mixJ, mixS, mixJ76];
    const allowed = galaxyLinks(nodes, grid, s);
    expect(between(allowed, mixJ, mixS)).toBeUndefined();
    const forbidden = forbiddenLinks(nodes, grid, s, allowed);
    const l = between(forbidden, mixJ, mixS)!;
    expect(from(l, mixJ)).toEqual(['minorsAdults']);
    expect(blockedRules(rulesFrom(l, mixJ.id), s)).toEqual(['minorsAdults']);
    // La voisine de poids, permise, n'est pas dans les interdits.
    expect(between(forbidden, mixJ, mixJ76)).toBeUndefined();
  });

  test('mélange ouvert : plus rien d’interdit entre ces deux-là', () => {
    const s = settings({ mixMinorsAdults: true });
    const allowed = galaxyLinks([mixJ, mixS], grid, s);
    expect(between(allowed, mixJ, mixS)).toBeDefined();
    expect(forbiddenLinks([mixJ, mixS], grid, s, allowed)).toEqual([]);
  });

  test('paire permise dans un sens : pas de lien interdit en plus', () => {
    // ageUp éteint, ageDown allumé (comme R4) : cadets ↔ juniors reste relié par le sens permis.
    const s = settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['ageUp'] } });
    const [c, j] = [kj('F', 'cadet', '-54'), kj('F', 'junior', '-53')];
    const allowed = galaxyLinks([c, j], grid, s);
    expect(between(allowed, c, j)).toBeDefined();
    expect(between(forbiddenLinks([c, j], grid, s, allowed), c, j)).toBeUndefined();
  });

  test('règle de la liste éteinte : interdit, nommée', () => {
    const s = settings({ replacementRules: { ...defaultSettings().replacementRules, off: ['discipline'] } });
    const karate = kj('F', 'cadet', '-54');
    const mix = node(key('shido-mix', 'jiyu', 'F', ['cadet'], ['cadet:F:-54']));
    const allowed = galaxyLinks([karate, mix], grid, s);
    const l = between(forbiddenLinks([karate, mix], grid, s, allowed), karate, mix)!;
    expect(blockedRules(rulesFrom(l, karate.id), s)).toEqual(['discipline']);
  });

  test('filles / garçons : interrupteur ouvert mais tranche non cochée → « mixSexes »', () => {
    const s = settings({ mixSexes: { enabled: true, ageBandCodes: [] } });
    const [f, m] = [kj('F', 'cadet', '-54'), kj('M', 'cadet', '-52')];
    const allowed = galaxyLinks([f, m], grid, s);
    const l = between(forbiddenLinks([f, m], grid, s, allowed), f, m)!;
    expect(blockedRules(rulesFrom(l, f.id), s)).toEqual(['mixSexes']);
  });

  test('jamais possible (cadette vers le shobu) : pas de lien interdit', () => {
    const s = settings();
    const cadet = kj('F', 'cadet', '-54');
    const shobu = node(key('karate', 'shobu', 'F', ['senior'], ['senior:F:-55']));
    expect(forbiddenLinks([cadet, shobu], grid, s, galaxyLinks([cadet, shobu], grid, s))).toEqual([]);
  });
});
```

Les classes `junior:M:+76`, `senior:M:-84`, `junior:M:-76`, `cadet:M:-52`, `junior:F:-53`, `senior:F:-55` sont celles de `ffkDefaultGrid()` ; si l'une manque, prendre la classe la plus proche qui existe et garder l'assertion.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/domain/galaxy-links.test.ts`
Expected: FAIL — `forbiddenLinks` / `blockedRules` non exportés.

- [ ] **Step 3: Implement `forbiddenLinks` and `blockedRules` in `src/domain/galaxy/links.ts`** (import `withAllRules` déjà présent ; une paire se repère par `${a}\n${b}`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/domain/galaxy-links.test.ts`
Expected: PASS, tous les tests du fichier.

- [ ] **Step 5: Commit**

```bash
git add src/domain/galaxy/links.ts tests/domain/galaxy-links.test.ts
git commit -m "feat(galaxie): liens interdits par les réglages (domaine)"
```

### Task 2: La confirmation nomme une règle désactivée

**Files:**
- Modify: `src/domain/replacement/propose.ts` (`moveViolations`)
- Test: `tests/domain/replacement/propose.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `ruleProfile` (même fichier), `isRuleOn`, `RULE_LABELS` (`rules.ts`).
- Produces: `moveViolations` ajoute `Règle « <RULE_LABELS[r]> » désactivée (réglages de réaffectation).` pour chaque règle `weight | split | ageUp | ageDown | discipline` du déplacement (profil de `evaluate` + `ruleProfile`, comme `rulesForMove`) éteinte dans `replacementRules.off`. Rien de plus si `evaluate` rend null (les autres messages couvrent déjà ces cas).

- [ ] **Step 1: Write the failing test** (aides `member`, `makeState` de `./fixtures.js`)

```ts
test('déplacement libre : une règle désactivée dans la liste est nommée', () => {
  const karate = member({ weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-mix'] });
  const mix = member({ weightClassId: 'cadet:F:-54', discipline: 'shido-mix' });
  const s = makeState([karate, mix], { settings: { ...defaultSettings(), replacementRules: { ...defaultSettings().replacementRules, off: ['discipline'] } } });
  const target = s.categories.find((c) => c.id === mix.categoryId)!;
  expect(moveViolations(s, karate, target)).toContain('Règle « Autre discipline (préférences) » désactivée (réglages de réaffectation).');
  const on = { ...s, settings: defaultSettings() };
  expect(moveViolations(on, karate, target)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/domain/replacement/propose.test.ts -t "règle désactivée"`
Expected: FAIL — le message manque.

- [ ] **Step 3: Implement in `moveViolations`.**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/domain/replacement`
Expected: PASS (aucun autre test de la Réaffectation ne change).

- [ ] **Step 5: Commit**

```bash
git add src/domain/replacement/propose.ts tests/domain/replacement/propose.test.ts
git commit -m "feat(reaffectation): la confirmation d'un déplacement nomme une règle désactivée"
```

### Task 3: Scène et dessin des liens interdits

**Files:**
- Modify: `src/web/components/galaxy/scene.ts`, `src/web/components/galaxy/drawGalaxy.ts`
- Test: `tests/web/galaxy-scene.test.ts`, `tests/web/galaxy-draw.test.ts`

**Interfaces:**
- Consumes: `blockedRules`, `rulesFrom` (tâche 1).
- Produces:
  - `FORBIDDEN_COLOR = '#8a93ad'` (scene.ts).
  - `forbiddenLabel(link: GalaxyLink, fromId: string, settings: CompetitionSettings): string` → `Interdit : …`.
  - `orderedNeighbors(id: string, allowed: GalaxyLink[], forbidden: GalaxyLink[], settings: CompetitionSettings): { id: string; rules: RuleId[]; forbidden: boolean }[]` — `sortedNeighbors(allowed)` puis `sortedNeighbors(forbidden)` sans les id déjà vus, coupé à `SLOTS.length`.
  - `Scene` gagne `forbidden: GalaxyLink[]` et `forbiddenLabel: (l: GalaxyLink, fromId: string) => string` ; `drawGalaxy` les dessine (contraintes globales), compte leurs voisines dans le focus (pas pâlies), et met l'étiquette sur ceux qui vont vers une voisine rapprochée.

- [ ] **Step 1: Write the failing tests**

```ts
// galaxy-scene.test.ts
test('orderedNeighbors : permises d’abord, puis interdites ; sans doublon ; 14 au plus ; seules interdites gardées', () => {
  const s = defaultSettings();
  const allowed = [link('a', 'w', ['weight'])];
  const forbidden = [link('a', 'm', ['minorsAdults']), link('a', 'w', ['minorsAdults'])];
  expect(orderedNeighbors('a', allowed, forbidden, s)).toEqual([
    { id: 'w', rules: ['weight'], forbidden: false },
    { id: 'm', rules: ['minorsAdults'], forbidden: true },
  ]);
  expect(orderedNeighbors('a', [], forbidden.slice(0, 1), s).map((n) => n.id)).toEqual(['m']);
  const many = Array.from({ length: 20 }, (_, i) => link('a', `f${String(i).padStart(2, '0')}`, ['minorsAdults']));
  expect(orderedNeighbors('a', allowed, many, s)).toHaveLength(14);
});

test('forbiddenLabel : « Interdit : » et les réglages en cause', () => {
  const s = { ...defaultSettings(), mixMinorsAdults: false };
  expect(forbiddenLabel(link('a', 'b', ['minorsAdults']), 'a', s)).toBe('Interdit : Mélange mineurs / adultes');
});

// galaxy-draw.test.ts (scène de base complétée par forbidden: [], forbiddenLabel: () => '')
test('lien interdit : gris, seulement pour l’étoile en focus, jamais avec « Tous les liens » seul', () => {
  // scène a, b ; forbidden = [lien a–b] ; allLinks: true
  // sans focus : aucun trait #8a93ad ; avec hoverId 'a' : un trait #8a93ad
});
```

Le test de dessin relève `strokeStyle` à chaque `stroke()` (contexte factice du fichier) ; écrire les deux cas avec les assertions `expect(strokes).not.toContain(FORBIDDEN_COLOR)` puis `expect(strokes).toContain(FORBIDDEN_COLOR)`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/web/galaxy-scene.test.ts tests/web/galaxy-draw.test.ts`
Expected: FAIL — exports manquants.

- [ ] **Step 3: Implement** in `scene.ts` and `drawGalaxy.ts` (les liens interdits sont tracés après les permis, avant les étiquettes ; étiquette en `FORBIDDEN_COLOR` sur fond `#0b0e16`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/web/galaxy-scene.test.ts tests/web/galaxy-draw.test.ts && npm run typecheck`
Expected: PASS, typecheck sans erreur (GalaxyStage passe encore `forbidden: []` en attendant la tâche 4 si besoin).

- [ ] **Step 5: Commit**

```bash
git add src/web/components/galaxy/scene.ts src/web/components/galaxy/drawGalaxy.ts tests/web/galaxy-scene.test.ts tests/web/galaxy-draw.test.ts
git commit -m "feat(galaxie): scène et dessin des liens interdits"
```

### Task 4: Vue, cartes, légende, aide, e2e et documents

**Files:**
- Modify: `src/web/components/galaxy/GalaxyView.tsx`, `src/web/components/galaxy/GalaxyStage.tsx`, `src/web/components/galaxy/GalaxyLegend.tsx`, `src/web/help.ts` (entrée `tableaux`), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (« Étape 49 »), `docs/superpowers/plans/2026-10-21-99-bilan.md`
- Test: `tests/e2e/galaxie.spec.ts`

**Interfaces:**
- Consumes: tâches 1 et 3.
- Produces (vue) : `forbidden = grid && settings ? forbiddenLinks(nodes, grid, settings, links) : []` (mêmes nœuds que `links`) ; voisines = `orderedNeighbors(sel, adjacency, forbiddenAdjacency, settings)` ; étoiles dessinées = portée + sélection + toutes ses voisines (permises et interdites) ; liens interdits dessinés = ceux entre étoiles dessinées ; badge du bord de carte d'une voisine interdite : `data-testid="galaxy-card-rule"`, `data-forbidden="true"`, texte `forbiddenLabel`, bordure pointillée `FORBIDDEN_COLOR`.

- [ ] **Step 1: Write the failing e2e test** (dans `galaxie.spec.ts`, avec `seed`, `openGalaxy`, `card`, `canvas`)

```ts
test('galaxie : voisine interdite par les réglages : lien gris, carte, dépôt avec confirmation', async ({ page, request }) => {
  const id = await createCompetition(page, 'Galaxie interdite');
  const ids = await seed(request, id);
  const comp = await (await request.get(`/api/competitions/${id}`)).json();
  const settings = { ...comp.settings, replacementRules: { ...comp.settings.replacementRules, off: ['discipline'] } };
  expect((await request.patch(`/api/competitions/${id}`, { data: { settings } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGalaxy(page, id);
  await page.getByTestId('planche-search').fill('-61 Karaté');
  await expect(canvas(page)).toHaveAttribute('data-selected', ids.c61);
  const mix = card(page, ids.mix);
  await expect(mix).toBeVisible();
  const badge = page.locator(`[data-testid="galaxy-card"][data-category="${ids.mix}"] [data-testid="galaxy-card-rule"]`);
  await expect(badge).toHaveAttribute('data-forbidden', 'true');
  await expect(badge).toHaveText('Interdit : Autre discipline (préférences)');
  await expect(mix.getByTestId('card-session')).toHaveText('Soir');
  // Clic-clic : SOLO vers la carte interdite → la confirmation nomme la règle désactivée.
  await card(page, ids.c61).getByText('SOLO').click();
  await mix.click({ position: { x: 20, y: 12 } });
  await expect(page.getByRole('dialog')).toContainText('Règle « Autre discipline (préférences) » désactivée (réglages de réaffectation).');
});
```

(Ouvrir la légende dans le même test et vérifier la ligne `interdit par les réglages (déplacement à la main, avec confirmation)`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/e2e/galaxie.spec.ts -g "interdite"`
Expected: FAIL — la carte Mix n'est pas rapprochée.

- [ ] **Step 3: Implement** the view wiring, the legend line, and one help sentence in `help.ts` (`tableaux`) : « Les voisines interdites par les réglages de la compétition ont un lien gris en pointillés : on peut quand même y glisser un combattant, la confirmation dit ce qui est enfreint. »

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npx vitest run && npx playwright test tests/e2e/galaxie.spec.ts`
Expected: tout passe.

- [ ] **Step 5: Vérifier à l'écran** : Chrome (copie de démonstration, port 3200 : `PORT=3200 DATABASE_PATH=<copie d'une sauvegarde> WEB_DIST_DIR=<build> npx tsx src/server/main.ts`) — compétition avec le mélange mineurs / adultes fermé : choisir une catégorie juniors seule, voir la voisine seniors en gris, glisser, lire la confirmation, annuler ; aucune erreur console. Simulateur iPhone : toucher l'étoile, la carte interdite vient en colonne. Jamais la base vivante `data/shidokan.sqlite` depuis l'hôte.

- [ ] **Step 6: Documents** : « Étape 49 » dans la feuille de route ; section étape 49 dans le bilan (décisions, contrôles à l'écran, « Vérifié » avec les chiffres réels).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(galaxie): voisines interdites par les réglages en cartes, légende, aide ; étape 49"
```
