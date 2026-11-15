# Galaxie des catégories — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une troisième vue « Galaxie » dans Jour J → Tableaux. Chaque catégorie y est une étoile, reliée à ses voisines selon les règles de réaffectation. Un clic sur une étoile rapproche ses voisines en cartes de la planche, où l'on peut glisser un combattant.

**Architecture :**
- Deux fonctions pures dans `src/domain/galaxy/` :
  - les liens, calculés par règle et dans chaque sens ;
  - les places, fixes et calculées sur toutes les cases possibles de la grille.
- Côté web, `src/web/components/galaxy/` contient :
  - des fonctions pures pour la caméra, le rapprochement des voisines et les couleurs ;
  - un `<canvas>` qui dessine les étoiles, les noms et les liens ;
  - par-dessus, de vraies `CategoryCard`, avec le glisser-déposer de la planche extrait dans un hook commun.
- Aucune dépendance ajoutée.

**Tech Stack:** TypeScript 7 (natif), React 19, Mantine 8, Vitest, Playwright (Chrome).

**Spec :** `docs/superpowers/specs/2026-11-15-galaxie-des-categories-design.md`. Maquette qui fait foi pour le comportement : `.superpowers/brainstorm/63519-1794775947/content/galaxie-v14.html` (vue D ; git-ignorée, à ouvrir dans un navigateur).

## Global Constraints

- Aucune nouvelle dépendance npm.
- Textes en français, dans le ton de l'appli. Libellé d'une étoile : « Karaté J · Cadets F · -54 kg ».
- Couleurs des liens en dégradé continu, réparti sur les règles actives jusqu'à `cutAfter` : `#2fd27a` → `#b6dc3c` → `#ffd23c` → `#ff8a2a` → `#ff3b3b`. Au-delà de la coupure : `#ff3b3b` en pointillés.
- Catégorie à un seul combattant présent (`activeEntrantCount === 1`) : anneau blanc qui pulse, nom en gras. Jamais en rouge.
- Longueurs relatives des liens pour le placement : poids 1 ; âge 1,6 ; shobu ↔ jiyu 2,2 ; autre discipline 2,8 ; filles / garçons 3,2.
- Places : déterministes et ne dépendant que de la grille. Le calcul prend au plus environ 1 s sur le PC du jour J.
- Zoom maximal = celui des cartes rapprochées (`K_FULL`). Clic sur une étoile : animation de 1,1 à 1,8 s (accélération puis ralentissement, zoom en échelle logarithmique).
- Au plus 14 voisines rapprochées, dans l'ordre des règles. Cartes rapprochées compactes : 4 noms au plus, puis « + n autres ».
- Poste de Zone : on regarde, rien ne bouge (comme la planche).
- Fond en ciel sombre dans les deux thèmes ; les cartes gardent le thème de l'appli.
- Au téléphone (360 px) : pas de débordement horizontal ; un doigt déplace, deux doigts zooment ; le clic-clic marche.
- Tests e2e : le nom de compétition d'un nouveau test ne doit ni contenir ni être contenu dans un autre (`createCompetition` cherche par sous-chaîne). Ne jamais lancer deux `npx playwright test` en même temps.
- Ne jamais ouvrir la base vivante `data/shidokan.sqlite` depuis l'hôte.

## Review Focus

1. **Catégorie dont la clé n'est plus dans la grille** (classe de poids supprimée, tranche inconnue) : elle doit apparaître quand même, sans faire planter la vue. Test dans la tâche 2.
2. **Voisine hors de la session affichée** : elle apparaît avec son badge de session et accepte le dépôt. Test e2e dans la tâche 5.
3. **Règle désactivée ou au-delà de la coupure** : pas de lien dans le premier cas, des pointillés dans le second. Pas de lien non plus « mélange filles / garçons » pour une tranche non cochée. Tests dans les tâches 1 et 3.
4. **Catégorie dont la clé s'élargit après un dépôt** (regroupement, sexe `X`) : elle reste sélectionnée, sa place devient le barycentre de ses cases, et la vue ne plante pas. Tests dans les tâches 2 et 5.
5. **Compétition vide ou portée vide** (aucune catégorie, session sans catégorie) : message vide et aucune erreur dans la console. Test e2e dans la tâche 5.

---

### Task 1 : Les liens entre catégories (domaine)

**Files :**
- Create: `src/domain/galaxy/links.ts`
- Test: `tests/domain/galaxy-links.test.ts`

**Interfaces :**
- Consomme : `CategoryKey`, `keyString` (`src/domain/categories.ts`) ; `CategoryGrid` (`src/domain/types.ts`) ; `ageMove` (`src/domain/ages.ts`) ; `neighborWeightClasses` (`src/domain/weights.ts`) ; `DISCIPLINES` ; `CompetitionSettings`, `RuleId` (`src/domain/settings.ts`) ; `isRuleOn` (`src/domain/replacement/rules.ts`).
- Produit :

```ts
export interface GalaxyNode { id: string; key: CategoryKey }
/** Règles pour aller de a vers b (`fromA`) et de b vers a (`fromB`) ; null = ce sens est interdit. a < b (ordre des id). */
export interface GalaxyLink { a: string; b: string; fromA: RuleId[] | null; fromB: RuleId[] | null }
export type LinkKind = 'weight' | 'age' | 'ruleset' | 'discipline' | 'sex';
/** settings null = placement : toutes les règles actives, toutes les tranches au mélange F/M, ordre par défaut (RULE_IDS). */
export function galaxyLinks(nodes: GalaxyNode[], grid: CategoryGrid, settings: CompetitionSettings | null): GalaxyLink[];
export function linkKind(rules: RuleId[]): LinkKind;   // mixSexes > discipline > shobuToJiyu > (ageUp|ageDown|seniorsVeterans|minorsAdults) > weight
/** Rang d'un ensemble de règles = indice, dans replacementRules.order, de sa règle la plus loin ; beyondCut si cet indice dépasse celui de cutAfter. */
export function rulesRank(rules: RuleId[], settings: CompetitionSettings): { rank: number; beyondCut: boolean };
/** Règles vues depuis `fromId` ; si ce sens est interdit, l'autre sens. */
export function rulesFrom(link: GalaxyLink, fromId: string): RuleId[];
```

**Comportement** (spec §5.1). On travaille sur des **cases**. Une case est une clé à une seule tranche et un seul poids, de sexe F ou M. Une clé regroupée se développe en cases : tranches × classes de poids de la tranche, et F + M si le sexe vaut `X`. Pour chaque sens a → b, on garde la paire de cases la moins coûteuse, c'est-à-dire le plus petit `rulesRank`. Avec `settings` null, on classe selon `RULE_IDS`.

| Règles de a → b | Condition entre case a et case b |
|---|---|
| `['weight']` | même discipline, règlement, sexe et tranche ; b est `lighter` ou `heavier` de a (`neighborWeightClasses`) |
| `['ageUp']` / `['ageDown']` | même discipline, règlement et sexe ; `ageMove(a→b)` vaut `C` (ageUp) ou `ageMove(b→a)` vaut `C` (ageDown) ; on ajoute `'minorsAdults'` si `crossesMinorAdult` |
| `['seniorsVeterans']` | idem avec un lien de type `D` |
| `['discipline']` (+ `'weight'` si la classe diffère) | même sexe et tranche ; deux disciplines `inPreferences` ; poids égal ou voisin ; même règlement, ou shobu → jiyu (on ajoute alors `'shobuToJiyu'`) |
| `['shobuToJiyu']` (+ `'weight'`) | même discipline, sexe et tranche ; a shobu, b jiyu ; poids égal ou voisin. Le sens jiyu → shobu est interdit (`null`) |
| `['mixSexes']` | même discipline, règlement et tranche ; sexes différents ; tranche de a dans `mixSexes.ageBandCodes` |

Pour les liens d'âge et de sexe, la classe de b est **la plus proche en kg** parmi les cases candidates de cette discipline, de ce règlement, de ce sexe et de cette tranche, et parmi les nœuds fournis. On compare les `maxKg`. Une classe ouverte (`maxKg` null) compte comme la limite précédente + 10.

Les règles sont filtrées avec `isRuleOn(settings, r)` : un sens qui utilise une règle éteinte est mis à `null`, et un lien sans aucun sens possible disparaît. Les tableaux libres (`key.free`) n'ont aucun lien.

- [ ] **Step 1 : Écrire les tests qui échouent.** Ils s'appuient sur `ffkDefaultGrid()` et `defaultSettings()`. Chaque nœud est une clé construite à la main ; l'id vaut `keyString(key)`.
  - `relie Cadets F -54 à -47 et -61 par weight, pas à +61` : liens `fromA` et `fromB` égaux à `['weight']`.
  - `cadets → juniors : ageUp vu des cadets, ageDown vu des juniors` : `rulesFrom(link, cadet)` contient `'ageUp'` et `rulesFrom(link, junior)` contient `'ageDown'`.
  - `juniors → seniors ajoute minorsAdults` ; `seniors ↔ v1 = seniorsVeterans`.
  - `karaté jiyu ↔ shido-mix même poids = discipline ; kata n'a aucun lien de discipline`.
  - `shobu → jiyu possible, jiyu → shobu null` : `fromA` (shobu) vaut `['shobuToJiyu']` et `fromB` vaut `null`.
  - `mixSexes seulement pour les tranches cochées` : avec `mixSexes: { enabled: true, ageBandCodes: ['pupille'] }`, il y a un lien F/M pupilles et aucun lien F/M cadets.
  - `règle éteinte = pas de lien` : avec `ageDown` dans `replacementRules.off`, le lien cadets ↔ juniors existe encore avec `fromB === null`. Avec `ageUp` et `ageDown` éteints, il n'y a plus de lien.
  - `rulesRank : la règle la plus loin compte ; beyondCut au-delà de cutAfter` : `['ageUp','minorsAdults']` a le rang de `minorsAdults`. Avec `cutAfter: 'discipline'`, `['mixSexes']` donne `beyondCut === true`.
  - `catégorie regroupée Cadets+Juniors F -54+-53 : reliée par chacune de ses cases`.
  - `poids le plus proche parmi les nœuds fournis` : si Juniors F -53 manque, cadets -54 se relie à juniors -59 par ageUp.
  - `tableau libre : aucun lien`.
  - `settings null : toutes les règles, ordre RULE_IDS` (mixSexes pour les cadets aussi).
- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Commande : `npx vitest run tests/domain/galaxy-links.test.ts`. Attendu : échec (module absent).
- [ ] **Step 3 : Écrire `src/domain/galaxy/links.ts`** avec les signatures ci-dessus. Indexer les cases par (discipline, règlement, sexe, tranche) pour rester linéaire. Exporter aussi `cellsOf(key: CategoryKey, grid: CategoryGrid): CategoryKey[]` : la tâche 2 en a besoin.
- [ ] **Step 4 : Relancer les tests.** Commande : `npx vitest run tests/domain/galaxy-links.test.ts`. Attendu : tout passe. Puis lancer `npm run typecheck`.
- [ ] **Step 5 : Commit** — `git add src/domain/galaxy/links.ts tests/domain/galaxy-links.test.ts && git commit -m "feat(galaxie): liens entre catégories selon les règles de réaffectation"`

### Task 2 : Les places fixes (domaine)

**Files :**
- Create: `src/domain/galaxy/layout.ts`
- Test: `tests/domain/galaxy-layout.test.ts`
- Test: `tests/perf/galaxy-layout.test.ts`

**Interfaces :**
- Consomme : `galaxyLinks(nodes, grid, null)`, `linkKind`, `cellsOf` (tâche 1) ; `DISCIPLINES`, `RULESETS` (pour savoir que le shobu est réservé aux adultes).
- Produit :

```ts
export const CARD_W = 40;                 // largeur d'une carte, en unités de la galaxie
export const CARD_H = (34 + 13 * 5) * 40 / 150; // carte pleine : 4 noms + « + n autres »
export interface Point { x: number; y: number }
/** Toutes les cases possibles : discipline avec poids × {jiyu ; shobu si tranche adulte} × F/M × tranche × classe ; kata × F/M × tranche. */
export function gridCells(grid: CategoryGrid): CategoryKey[];
/** Place de chaque case (clé : keyString). Déterministe, ne dépend que de la grille. */
export function galaxyLayout(grid: CategoryGrid): Map<string, Point>;
/** Place d'une catégorie : barycentre de ses cases connues ; tableaux libres et clés inconnues dans un amas à part (droite du nuage), rangés par libellé. */
export function placeCategories(cats: { id: string; key: CategoryKey; label: string }[], layout: Map<string, Point>, grid: CategoryGrid): Map<string, Point>;
```

**Algorithme**, repris de la maquette (`pos.nuage` puis `pos.nuage2d`) :
- Point de départ déterministe : x selon la tranche et le sexe, y selon le rang de poids, et un décalage par discipline et règlement. Bruit tiré d'un générateur à graine fixe (graine 7, `seed * 16807 % 2147483647`).
- 500 itérations :
  - répulsion `1400 / d²` entre étoiles à moins de 200 unités ;
  - ressort de raideur 0,12 vers la longueur `70 × longueur relative de linkKind` (voir les Global Constraints) ;
  - pas borné à ±25 et refroidi.
- Puis 120 passes d'écartement : deux cases dont les rectangles se recouvrent (largeur `CARD_W + 6`, hauteur `CARD_H + 5`) s'écartent sur l'axe du plus petit recouvrement.
- Pour la répulsion et l'écartement, utiliser un découpage en seaux (grille spatiale) : un calcul en n² sur environ 780 cases est trop lent.

- [ ] **Step 1 : Écrire les tests qui échouent.**
  - `gridCells(ffkDefaultGrid())` : contient karaté jiyu cadet F `cadet:F:-54`, contient karaté shobu senior, ne contient pas karaté shobu cadet, contient kata cadet F sans poids, et n'a aucun doublon de `keyString`.
  - `galaxyLayout est déterministe` : deux appels donnent des `Map` égales (`toEqual`).
  - `aucune carte ne chevauche une autre` : pour toute paire de cases, `|dx| >= CARD_W` ou `|dy| >= CARD_H`.
  - `les voisines sont plus proches que les autres` : en moyenne sur les cases, la distance à une voisine `weight` est plus petite que la distance à une voisine `discipline`, elle-même plus petite que la distance médiane entre deux cases quelconques.
  - `placeCategories : Cadets+Juniors F -54+-53 est au barycentre de ses deux cases ; sexe X entre ses cases F et M`.
  - `placeCategories : tableau libre et clé inconnue (weightClassIds ['cadet:F:-99']) placés dans l'amas à part, à droite de toutes les cases, sans chevauchement`.
  - Fichier de durée `tests/perf/galaxy-layout.test.ts` : `galaxyLayout(ffkDefaultGrid())` en moins de 1000 ms.
- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Commande : `npx vitest run tests/domain/galaxy-layout.test.ts`. Attendu : échec.
- [ ] **Step 3 : Écrire `src/domain/galaxy/layout.ts`** avec les signatures et l'algorithme ci-dessus.
- [ ] **Step 4 : Relancer les tests.** Commandes : `npx vitest run tests/domain/galaxy-layout.test.ts` puis `npm run test:perf -- tests/perf/galaxy-layout.test.ts`. Attendu : tout passe et le temps mesuré est inférieur à 1000 ms (noter la mesure dans le message de commit).
- [ ] **Step 5 : Commit** — `git commit -m "feat(galaxie): places fixes des catégories, calculées sur la grille"`

### Task 3 : Caméra, rapprochement et couleurs (web, fonctions pures)

**Files :**
- Create: `src/web/components/galaxy/scene.ts`
- Test: `tests/web/galaxy-scene.test.ts`

**Interfaces :**
- Consomme : `rulesRank`, `rulesFrom`, `GalaxyLink` (tâche 1) ; `isRuleOn`, `RULE_LABELS` ; `CARD_W` (tâche 2).
- Produit :

```ts
export const K_FULL = 4;               // zoom des cartes rapprochées = zoom maximal
export const PULL_FROM = 0.9, PULL_TO = 3.2;
export const SLOTS: [number, number][]; // [-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1],[-2,0],[2,0],[-2,-1],[2,-1],[-2,1],[2,1]
export interface Camera { k: number; px: number; py: number }
export function pullFactor(k: number): number;      // smoothstep(PULL_FROM, PULL_TO, k)
export function cardScale(k: number, pull: number): number; // (CARD_W*k/220)*(1-pull) + min(1, k/K_FULL)*pull
/** Places affichées : les voisines (déjà triées, ≤ 14) glissent vers les cases autour de la sélection selon `pull`. */
export function displayedPositions(base: Map<string, Point>, selectedId: string | null, neighborIds: string[], cam: Camera, viewport: { w: number; h: number }): Map<string, Point>;
/** Voisines d'une catégorie, triées par rang (règles les plus hautes d'abord), au plus 14. */
export function sortedNeighbors(id: string, links: GalaxyLink[], settings: CompetitionSettings): { id: string; rules: RuleId[] }[];
/** Couleur et pointillés d'un lien vu depuis `fromId`. */
export function linkStyle(link: GalaxyLink, fromId: string, settings: CompetitionSettings): { color: string; dashed: boolean };
/** Légende : règles actives jusqu'à la coupure, dans l'ordre, avec leur couleur. */
export function legendRules(settings: CompetitionSettings): { rule: RuleId; label: string; color: string }[];
export function flyDuration(distancePx: number, k0: number): number; // min(1800, 1100 + 0.6*d + |ln(K_FULL/k0)|*150)
```

Écart entre deux cases, en pixels écran : `min(265, (w-40)/cols) * min(1,k/K_FULL)` en largeur et `min(205, (h-130)/3) * min(1,k/K_FULL)` en hauteur, avec `cols = n > 8 ? 5 : 3`. On le convertit en unités de la galaxie en le divisant par `k`.

- [ ] **Step 1 : Écrire les tests qui échouent.**
  - `pullFactor(0.5) === 0`, `pullFactor(K_FULL) === 1`, et la fonction est croissante.
  - `displayedPositions` avec `k = K_FULL` : la 1re voisine est à gauche de la sélection et la 2e à droite. Sans sélection, ou avec `k = 0.5`, les places sont inchangées. Les catégories non liées sont inchangées dans tous les cas.
  - `sortedNeighbors` : la voisine `weight` passe avant la voisine `discipline` avec l'ordre par défaut, et l'ordre s'inverse quand on inverse ces deux règles dans `replacementRules.order`. Le résultat est coupé à 14 voisines.
  - `linkStyle` : la 1re règle active donne `#2fd27a` ; la dernière avant la coupure donne `#ff3b3b` ; une règle au-delà de la coupure donne `dashed: true`.
  - `legendRules` : n'inclut pas `return`, `split` ni `weightGap`, n'inclut aucune règle éteinte, et suit l'ordre de la compétition.
  - `flyDuration` : entre 1100 et 1800 ms.
- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent.** Commande : `npx vitest run tests/web/galaxy-scene.test.ts`. Attendu : échec.
- [ ] **Step 3 : Écrire `scene.ts`.** Le dégradé interpole les cinq teintes des Global Constraints selon `i / (n-1)` (une seule règle : vert).
- [ ] **Step 4 : Relancer les tests.** Commande : `npx vitest run tests/web/galaxy-scene.test.ts`. Attendu : tout passe.
- [ ] **Step 5 : Commit** — `git commit -m "feat(galaxie): caméra, rapprochement des voisines et couleurs des règles"`

### Task 4 : Glisser-déposer de la planche partagé, badge de session sur la carte

**Files :**
- Create: `src/web/components/planche/usePlancheDrop.tsx`
- Modify: `src/web/components/planche/Planche.tsx` (le bloc `swap`/`onAction`/`drag`/`chipProps`/`cardProps` et `<DropConfirmDialog>` passent dans le hook)
- Modify: `src/web/components/planche/CategoryCard.tsx` (nouvelle prop `sessionName`)
- Test: `tests/e2e/planche.spec.ts` (existant, ne doit pas changer de résultat)

**Interfaces :**
- Produit :

```ts
export function usePlancheDrop(o: { competitionId: string; categories: Category[]; entrants: Map<string, EntrantInfo>; waves: Wave[]; readOnly: boolean }): {
  drag: ReturnType<typeof useDragMove>;
  chipProps: (registrationId: string, c: Category) => HTMLAttributes<HTMLDivElement>;
  cardProps: (c: Category) => DragAttrs;
  dialog: ReactNode;          // <DropConfirmDialog …/>, à rendre une fois
  nameOf: (rid?: string) => string;
};
```

- `CardProps.sessionName?: string | null` : quand la valeur est renseignée, la carte affiche un `StatusBadge tone="neutral"` avec `data-testid="card-session"` contenant ce texte, placé avant le badge de zone.
- Le libellé d'une session suit la même règle que `loneItems` dans `Planche.tsx` : « En attente » si `waveId === null` et qu'il y a des vagues, sinon le nom de la vague, et `null` si c'est la session affichée. L'extraire en `sessionLabel(category: Category, waves: Wave[], shownWaveId: string | null): string | null` dans `src/web/components/planche/model.ts`, et l'utiliser aux deux endroits.

- [ ] **Step 1 : Extraire le hook.** `Planche` l'appelle, et le comportement ne change pas.
- [ ] **Step 2 : Ajouter `sessionName` à `CategoryCard` et `sessionLabel` à `model.ts`.** Faire utiliser `sessionLabel` par `loneItems`.
- [ ] **Step 3 : Vérifier.** Commandes : `npm run typecheck && npx vitest run && npx playwright test tests/e2e/planche.spec.ts tests/e2e/historique.spec.ts`. Attendu : tout passe, sans modifier aucun test.
- [ ] **Step 4 : Commit** — `git commit -m "refactor(planche): glisser-déposer dans un hook partagé ; badge de session sur une carte"`

### Task 5 : La vue Galaxie dans Tableaux

**Files :**
- Create: `src/web/components/galaxy/GalaxyView.tsx` (barre d'outils, canevas, calque de cartes, légende)
- Create: `src/web/components/galaxy/drawGalaxy.ts` (dessin du canevas, sans React)
- Modify: `src/web/pages/BracketsPage.tsx` (`View` reçoit `'galaxie'` ; le sélecteur affiche « Planche / Liste / Galaxie » ; lecture de `?vue=galaxie&categorie=<id>` au chargement, comme `voir`)
- Modify: `src/web/components/planche/PlancheToolbar.tsx` (`onSort` optionnel : sans lui, pas de « Classer par »)
- Modify: `src/web/help.ts` (entrée `tableaux` : une phrase sur la Galaxie)
- Test: `tests/e2e/galaxie.spec.ts`

**Interfaces :**
- Consomme :
  - tâche 1 : `galaxyLinks(nodes, grid, settings)` sur **toutes** les catégories de la compétition, ce qui donne aussi les voisines hors de la session ;
  - tâche 2 : `galaxyLayout(grid)` en `useMemo` sur la grille, et `placeCategories` ;
  - tâche 3 : `displayedPositions`, `pullFactor`, `cardScale`, `sortedNeighbors`, `linkStyle`, `legendRules`, `flyDuration`, `K_FULL` ;
  - tâche 4 : `usePlancheDrop`, `CategoryCard` (avec `sessionName`), `sessionLabel` ;
  - existants : `useGrid`, `useCompetition` (pour `settings`), `usePassages`, `useZones`, `useSelectedWave`, `cardTitle`, `activeEntrantCount`, `normalizeName`.
- Produit :

```ts
export function GalaxyView(p: {
  competitionId: string; categories: Category[]; waves: Wave[]; waveId: string | null; scope: Scope; onScope: (v: string) => void;
  readOnly: boolean; entrants: Map<string, EntrantInfo>; badges: Map<string, ProposalType>; badgeDetails: Map<string, RecasementEntry>;
  cases: Map<string, number>; aside: Map<string, number>; historyCount: number; onHistory?: () => void;
  /** Catégorie à sélectionner à l'ouverture (lien de la Réaffectation). */
  initialCategoryId: string | null;
  onSeeInPlanche: (categoryId: string) => void;
}): JSX.Element;
```

**Comportement** (spec §3 et §4 ; reprendre la maquette v14 pour la caméra et le dessin) :
- `<canvas data-testid="galaxy-canvas">` en plein espace sous la barre d'outils. Hauteur : `calc(100vh - <barre>)`.
- Ce que dessine le canevas : un fond étoilé, les étoiles de la portée (`inScope`), et en plus, quand une catégorie est sélectionnée, ses voisines hors de la portée. Pour chaque étoile : le nom (sans chevauchement, les catégories à un seul combattant en priorité), l'anneau qui pulse, les liens au survol ou pour la sélection (« Tous les liens » les montre tous, très légers), et le nom de la règle sur chaque lien rapproché quand `pullFactor > 0,3`. Au-delà de `CARD_W * k ≥ 70` px, les étoiles deviennent des cartes dessinées.
- Étoiles : une teinte par discipline · règlement (celles de la maquette), taille selon le nombre d'inscrits présents ;
  catégorie lancée ou terminée plus pâle (sa carte est verrouillée par `CategoryCard`).
- Après un déplacement : la sélection reste sur la même catégorie et la caméra suit sa nouvelle place si sa clé s'est
  élargie ; si la catégorie sélectionnée a disparu (vidée), plus de sélection, sans erreur.
- `requestAnimationFrame` seulement tant que quelque chose bouge (animation, anneaux qui pulsent visibles) : pas de boucle permanente inutile.
- Calque de cartes : la sélection et ses voisines rapprochées sont des `CategoryCard` positionnées par `transform` à chaque image, mises à l'échelle `cardScale`, et visibles quand `pullFactor > 0,2` et `cardScale * 220 ≥ 70`. Elles reçoivent `cardProps`/`chipProps` de `usePlancheDrop`, sauf en lecture seule, et `sessionName = sessionLabel(...)`. Elles ont un lien « Voir dans la planche » (`data-testid="galaxy-see-planche"`, appelle `onSeeInPlanche`), et la sélection a en plus « Réaffectation ↗ » si `cases.get(id) > 0`.
- Clic sur une étoile (test de position sur les places affichées) : sélection et vol (`flyDuration`). Clic sur le titre d'une carte voisine : elle devient la sélection. Clic dans le vide ou Échap : plus de sélection. Molette ou pincement : zoom borné à `[0.15, K_FULL]` qui annule le vol en cours. Glisser le fond ou glisser à un doigt : déplacement.
- Barre d'outils : `PlancheToolbar` réutilisée pour la session, la recherche et l'historique (son « Classer par » est sans objet ici : le masquer par une prop optionnelle `onSort` absente). S'y ajoutent les puces « Seulement les seuls » (`data-testid="galaxy-only-lone"` : pâlit les autres étoiles et recadre sur les seules) et « Tous les liens » (`data-testid="galaxy-all-links"`). Une recherche qui ne trouve **qu'une** catégorie la sélectionne.
- Légende (`data-testid="galaxy-legend"`) : teintes des disciplines, anneau, `legendRules(settings)`. Elle s'efface quand `pullFactor > 0,5`.
- Ouverture : la vue cadre les étoiles de la portée. Avec `initialCategoryId`, la vue sélectionne cette catégorie (portée « Toutes » si elle est hors de la session, comme `onSee`).
- Pour les tests : le canevas porte `data-selected="<id ou vide>"` et `data-stars="<nombre d'étoiles dessinées>"`.
- Portée vide : `EmptyState` « Aucune catégorie. » à la place du canevas.

- [ ] **Step 1 : Écrire le test e2e qui échoue, `tests/e2e/galaxie.spec.ts`.** Compétition « Galaxie bleue ». Inscrire par l'API, en karaté jiyu cadettes : ALBA et BRUN en -54, SOLO en -61 (seule), MIXA en Shido-mix -61. Créer deux sessions par convocation avec MIXA dans l'autre session (s'appuyer sur `vagues.spec.ts`). Scénarios :
  - `galaxie : choisir la vue, chercher, voir les voisines en cartes, déplacer au clic-clic et annuler` :
    1. Tableaux → `brackets-view` « Galaxie » → `galaxy-canvas` visible, `data-stars` vaut au moins 2.
    2. Taper « -61 » puis « Karaté » dans la recherche → `data-selected` vaut l'id de SOLO.
    3. Attendre la fin du vol : les `planche-card` de -61 et de -54 sont visibles. La carte Mix -61 porte `card-session` avec le nom de l'autre session.
    4. Clic sur la pastille SOLO, puis sur la carte -54 → la confirmation s'ouvre → « Déplacer » → le -61 vidé n'est plus sélectionné (`data-selected` vide ou celui du -54 élargi, au choix du constructeur, mais pas l'id disparu) et la console n'a aucune erreur → toast « Annuler » → « Annuler » → SOLO est de retour dans -61.
  - `galaxie : la vue est retenue sur le poste, Échap désélectionne, portée vide sans erreur` : la vue reste après un rechargement ; Échap remet `data-selected` à vide ; une session sans catégorie affiche « Aucune catégorie. » ; la console ne contient aucune erreur.
  - `galaxie : 360 px sans débordement horizontal` (helper `clipped` et largeur du document).
- [ ] **Step 2 : Lancer le test e2e et vérifier qu'il échoue.** Commande : `npx playwright test tests/e2e/galaxie.spec.ts`. Attendu : échec (pas de vue Galaxie).
- [ ] **Step 3 : Écrire `drawGalaxy.ts`, `GalaxyView.tsx`, le branchement dans `BracketsPage` et la phrase d'aide.** Phrase d'aide (`help.ts`, entrée `tableaux`, à la suite du paragraphe des vues) : « La galaxie montre chaque catégorie comme une étoile, près de ses voisines : du vert (proche, en haut de la liste des règles) au rouge (loin). Les liens sont possibles en principe : la confirmation dit ce qui serait enfreint pour ce combattant. Cliquez sur une étoile : ses voisines viennent autour d’elle en cartes, où l’on glisse un combattant comme sur la planche. Dézoomez pour les renvoyer à leur place. »
- [ ] **Step 4 : Relancer les tests.** Commandes : `npx playwright test tests/e2e/galaxie.spec.ts tests/e2e/planche.spec.ts`, puis `npm run typecheck && npx vitest run`. Attendu : tout passe.
- [ ] **Step 5 : Commit** — `git commit -m "feat(galaxie): vue Galaxie dans Tableaux (étoiles, liens, voisines rapprochées en cartes)"`

### Task 6 : Lien depuis la Réaffectation, vérifications à l'écran, documents

**Files :**
- Modify: `src/web/pages/ReplacementPage.tsx` (`caseCard` : lien « Voir dans la galaxie » si `c.categoryId`)
- Modify: `tests/e2e/galaxie.spec.ts` (un scénario de plus)
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (« Étape 48 : galaxie des catégories »), `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1 : Écrire le scénario e2e qui échoue.** Nom : `galaxie : « Voir dans la galaxie » depuis un cas de la Réaffectation`. Réaffectation → sur la carte de cas de SOLO, cliquer `case-see-galaxy` → l'URL contient `/tableaux`, `galaxy-canvas` est visible, `data-selected` vaut la catégorie de SOLO, et sa `planche-card` est visible.
- [ ] **Step 2 : Lancer le scénario et vérifier qu'il échoue.** Commande : `npx playwright test tests/e2e/galaxie.spec.ts -g Réaffectation`. Attendu : échec.
- [ ] **Step 3 : Ajouter le lien.** `Button component={Link} size="compact-xs" variant="subtle" data-testid="case-see-galaxy"` vers `/competitions/${id}/tableaux?vue=galaxie&categorie=${c.categoryId}`, avec le libellé « Voir dans la galaxie ». Le placer sous le bouton « Mettre de côté ».
- [ ] **Step 4 : Relancer les tests.** Commande : la même. Attendu : tout passe. Puis lancer toute la suite e2e une fois : `npx playwright test`.
- [ ] **Step 5 : Vérifier à l'écran.**
  - Sur Chrome avec Claude in Chrome, sur une copie de démo (port 3200, jamais la base vivante) : vue d'ensemble lisible, survol, clic, vol, rapprochement, dézoom, glisser-déposer d'une pastille à la souris, lien depuis la Réaffectation, thème clair et sombre.
  - Sur le simulateur iPhone (idb) : un doigt, deux doigts, clic-clic, pas de débordement.
  - Corriger ce qui cloche, puis relancer les tests concernés.
- [ ] **Step 6 : Mettre à jour les documents.** Feuille de route : étape 48 faite, avec un résumé et les chemins de la spec et du plan, sur le modèle de l'étape 47. Bilan : décisions prises et points reportés.
- [ ] **Step 7 : Commit** — `git commit -m "feat(galaxie): « Voir dans la galaxie » depuis la Réaffectation ; étape 48 réalisée"`
