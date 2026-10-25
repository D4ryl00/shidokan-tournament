# Plan d'ensemble de la réaffectation — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer « Classer automatiquement tous les cas simples » et « Tout classer automatiquement » (un calcul carte par carte, dans l'ordre alphabétique) par un **plan d'ensemble**. Ce plan cherche, pour une session, le placement qui laisse le moins de combattants seuls. Il suit une liste de règles que l'organisateur range lui-même. Il montre ce que coûte chaque concession, puis il applique d'un coup les déplacements sans validation et ceux que l'organisateur a validés.

**Architecture :** la liste des règles est un réglage de la compétition (`settings.replacementRules`). Ses interrupteurs reprennent les quatre réglages de mélange existants : il n'y a qu'une seule source de vérité. Chaque proposition des cartes porte désormais ses **règles** (`Proposal.rules`) ; on en déduit sa validation et son coût. Le calcul (`src/domain/replacement/plan.ts`) est pur et déterministe :
- il applique d'abord les choix de l'organisateur (validations, « Modifier ») ;
- il découpe les cas en groupes indépendants ;
- il cherche le meilleur plan de chaque groupe, en partant de la solution « carte par carte » et en explorant le reste dans la limite d'un nombre de nœuds fixé.

Le serveur expose le diagramme et le plan (`POST /replacement/plan`), puis l'application (`POST /replacement/plan/apply`). L'écran Réaffectation affiche la liste des règles, ses barres et le plan rangé par coût.

**Tech Stack :** TypeScript 7 (natif), Fastify 5, Drizzle + better-sqlite3, React 19 + Mantine 8, Vitest, Playwright (Chrome).

**Spec :** `docs/superpowers/specs/2026-10-25-plan-d-ensemble-reaffectation-design.md`. Les maquettes sont dans `.superpowers/brainstorm/17415-1792954094/content/` : `pyramide-v2.html` et `cout-v2.html`. `plan.html` est dépassée pour les groupes et les boutons : c'est le texte qui fait foi.

## Global Constraints

- Travail sur la branche `etape-24-plan-d-ensemble`, partie de `main`. Fusion en avance rapide (ff) à la fin, après la relecture.
- Node 22.23.2 (`.tool-versions`). Avant chaque commit : `npm run typecheck` et `npm test` passent.
- Interface et messages en français, avec l'apostrophe typographique (’) dans les textes affichés, comme le code voisin. Les textes cités dans ce plan sont à reprendre mot pour mot.
- **Aucune migration de base.** La liste des règles vit dans `competitions.settings_json` (clé `replacementRules`). Les réglages par défaut vivent dans `app_settings` (clé `defaultReplacementRules`). Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte.
- Toute nouvelle route d'écriture que la Table centrale doit pouvoir appeler va dans `TABLE_WRITES` (`src/server/auth/permissions.ts`). ✅ La Table centrale peut tout changer dans la liste des règles.
- Les événements en direct (SSE) partent tout seuls après tout `POST`/`PUT`/`DELETE` réussi sous `/api/competitions/:id` : rien à faire.
- Le calcul du plan vit dans `src/domain/replacement/`. Il est pur : pas de `Date`, pas de `Math.random`, aucune entrée/sortie. Sa limite est un **nombre de nœuds**, jamais un temps, pour qu'un même état donne toujours le même plan.
- Performance : la liste et ses barres (jusqu'à 11 calculs) en moins de 2 s pour 500 inscriptions.
- Couleurs uniquement par les jetons `--sk-*` (`src/web/theme.ts`), en clair et en sombre. La couleur n'est jamais seule : numéro, nom de la règle et nom du groupe l'accompagnent.
- Identifiants des règles, dans l'ordre par défaut : `return`, `weight`, `split`, `weightGap`, `ageUp`, `ageDown`, `seniorsVeterans`, `discipline`, `shobuToJiyu`, `mixSexes`, `minorsAdults`. Ligne de coupure par défaut : après `discipline`.
- Commits au format conventionnel, en français (`feat(reaffectation): …`, `docs: …`).

## Review Focus

1. **Deux combattants seuls qui peuvent se rejoindre dans les deux sens** (A vers B ou B vers A) : le plan n'en déplace qu'un, et compte 0 seul. Test : tâche 3 (`deux seuls voisins : un seul déplacement`).
2. **Une pesée saisie sur un autre poste entre l'affichage et « Appliquer »** : réponse 409, rien n'est appliqué, et les choix (validations, « Modifier ») restent dans la page. Test : tâche 6 (`appliquer un plan périmé : 409, rien d’appliqué`).
3. **Un déplacement validé dont la cible a disparu** (la catégorie s'est vidée, une session a été lancée) : il est écarté et signalé dans `dropped`, sans planter. Test : tâche 3 (`choix devenu impossible : écarté et signalé`).
4. **Une catégorie lancée, ou d'une session lancée, dans le groupe** : elle n'est jamais ni une cible ni une source de déplacement. Test : tâche 3 (`catégorie lancée : ni cible ni source`).
5. **Un absent dans la catégorie cible**, ou un combattant seul lui-même absent : le compte des seuls ne prend que les présents. Un absent n'est jamais déplacé. Test : tâche 3 (`absents : ni comptés ni déplacés`).

---

### Task 1 : Liste des règles dans les réglages

**Files :**
- Modify : `src/domain/settings.ts` (schéma et `defaultSettings`)
- Create : `src/domain/replacement/rules.ts`
- Modify : `src/domain/replacement/index.ts` (exporter `rules.ts`)
- Test : `tests/domain/replacement/rules.test.ts`, `tests/domain/settings.test.ts`

**Interfaces :**
- Produces (`src/domain/settings.ts`) :
  - `const RULE_IDS = ['return', 'weight', 'split', 'weightGap', 'ageUp', 'ageDown', 'seniorsVeterans', 'discipline', 'shobuToJiyu', 'mixSexes', 'minorsAdults'] as const` ; `type RuleId = (typeof RULE_IDS)[number]`.
  - `const OWN_SWITCH_RULES = ['weight', 'split', 'weightGap', 'ageUp', 'ageDown', 'discipline'] as const` : les règles dont l'interrupteur est dans `replacementRules.off`.
  - `CompetitionSettings.replacementRules: { order: RuleId[]; off: (typeof OWN_SWITCH_RULES)[number][]; cutAfter: RuleId }`. Valide si `order` est une permutation de `RULE_IDS` qui commence par `return`. Défaut : `{ order: [...RULE_IDS], off: [], cutAfter: 'discipline' }`.
- Produces (`src/domain/replacement/rules.ts`) :
  - `interface RulesView { order: RuleId[]; on: Record<RuleId, boolean>; cutAfter: RuleId }` et `rulesViewSchema` (zod, strict, mêmes contraintes sur `order`, `on.return` toujours vrai).
  - `NO_VALIDATION_RULES: ReadonlySet<RuleId>` = `return`, `weight`, `split`.
  - `PRE_APPROVAL_RULES: ReadonlySet<RuleId>` = `weightGap`, `ageUp`, `ageDown`, `seniorsVeterans`, `minorsAdults`.
  - `RULE_LABELS: Record<RuleId, string>` : `Retour dans la catégorie d’origine`, `Catégorie de poids voisine`, `Split de la catégorie du dessous`, `Écart de poids au-dessus du réglage`, `Tranche d’âge au-dessus`, `Tranche d’âge au-dessous`, `Mélange seniors / vétérans`, `Autre discipline (préférences)`, `Shobu → jiyu`, `Mélange filles / garçons`, `Mélange mineurs / adultes`.
  - `isRuleOn(s: CompetitionSettings, r: RuleId): boolean`. `return` est toujours vrai. `mixMinorsAdults` → `minorsAdults`, `mixSeniorsVeterans` → `seniorsVeterans`, `mixSexes.enabled` → `mixSexes`, `shobuToJiyu` → `shobuToJiyu`. Pour les autres : `!off.includes(r)`.
  - `rulesView(s: CompetitionSettings): RulesView` et `applyRulesView(s: CompetitionSettings, v: RulesView): CompetitionSettings`. `applyRulesView` écrit les quatre booléens, garde `mixSexes.ageBandCodes`, et met `return` en tête et actif quoi qu'il reçoive.
  - `withAllRules(s: CompetitionSettings, grid: CategoryGrid): CompetitionSettings` : tout actif, `mixSexes.ageBandCodes` = toutes les tranches. Il sert à retrouver un déplacement validé même si sa règle a été désactivée depuis.
  - `ruleRank(s: CompetitionSettings, r: RuleId, m: Pick<Member, 'ruleset' | 'acceptsJiyuFirst'>): number` : l'index dans `order`. Pour un combattant shobu qui accepte le jiyu en priorité, `shobuToJiyu` prend le plus petit des deux index (`discipline`, `shobuToJiyu`) et `discipline` le plus grand.
  - `allowedAt(s: CompetitionSettings, level: RuleId): Set<RuleId>` : les règles actives d'index ≤ celui de `level`, `return` compris.
  - `type CostBand = 0 | 1 | 2 | 3 | 4` ; `COST_BAND_LABELS` : `Sans validation`, `Concessions légères`, `Concessions moyennes`, `Concessions fortes`, `Concessions très fortes`.
  - `costBand(s: CompetitionSettings, rule: RuleId | null, manual: boolean): CostBand`. Il vaut 0 si `!manual`. Sinon, on prend `L` = les règles d'`order` hors `NO_VALIDATION_RULES`, actives, d'index ≤ celui de `cutAfter`, et `n = L.length`. La bande vaut `1 + Math.floor(L.indexOf(rule) * 4 / n)`, ou 4 si `rule` n'est pas dans `L` (ou est `null`).

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
test('réglages : liste par défaut, et lecture tolérante d’une compétition existante', () => {
  expect(defaultSettings().replacementRules).toEqual({ order: [...RULE_IDS], off: [], cutAfter: 'discipline' });
  expect(readStoredSettings({ mixSexes: { enabled: true, ageBandCodes: [] } }).replacementRules.cutAfter).toBe('discipline');
  expect(readStoredSettings({ replacementRules: { order: ['weight'], off: [], cutAfter: 'weight' } }).replacementRules).toEqual(defaultSettings().replacementRules);
});
test('interrupteurs : les quatre mélanges sont les réglages existants', () => {
  const s = defaultSettings();
  expect(RULE_IDS.filter((r) => !isRuleOn(s, r))).toEqual(['shobuToJiyu', 'mixSexes', 'minorsAdults']);
  const t = applyRulesView(s, { ...rulesView(s), on: { ...rulesView(s).on, minorsAdults: true, ageDown: false, return: false } });
  expect([t.mixMinorsAdults, t.replacementRules.off, isRuleOn(t, 'return')]).toEqual([true, ['ageDown'], true]);
});
test('rang : jiyu préféré pour un shobu qui l’accepte en priorité', () => {
  const s = defaultSettings();
  expect([ruleRank(s, 'discipline', { ruleset: 'jiyu', acceptsJiyuFirst: null }), ruleRank(s, 'shobuToJiyu', { ruleset: 'jiyu', acceptsJiyuFirst: null })]).toEqual([7, 8]);
  expect([ruleRank(s, 'discipline', { ruleset: 'shobu', acceptsJiyuFirst: true }), ruleRank(s, 'shobuToJiyu', { ruleset: 'shobu', acceptsJiyuFirst: true })]).toEqual([8, 7]);
});
test('règles permises jusqu’à une ligne, et bandes de coût', () => {
  const s = defaultSettings();
  expect([...allowedAt(s, 'ageUp')]).toEqual(['return', 'weight', 'split', 'weightGap', 'ageUp']);
  // À valider au-dessus de la ligne : weightGap, ageUp, ageDown, seniorsVeterans, discipline (5).
  expect(['weightGap', 'ageUp', 'ageDown', 'seniorsVeterans', 'discipline'].map((r) => costBand(s, r as RuleId, true))).toEqual([1, 1, 2, 3, 4]);
  expect([costBand(s, 'weight', false), costBand(s, 'mixSexes', true), costBand(s, null, true)]).toEqual([0, 4, 4]);
});
```

- [ ] **Step 2 : Lancer les tests, ils échouent**

Run : `npx vitest run tests/domain/replacement/rules.test.ts tests/domain/settings.test.ts`
Expected : FAIL (`RULE_IDS` introuvable).

- [ ] **Step 3 : Implémenter le schéma, le défaut et `rules.ts` comme décrit dans Interfaces**

- [ ] **Step 4 : Lancer les tests, ils passent** — même commande. Puis `npm test` et `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): liste des règles dans les réglages de la compétition`

---

### Task 2 : Chaque proposition porte ses règles ; tranche d'âge au-dessous

**Files :**
- Modify : `src/domain/replacement/types.ts` (`Proposal.rules`, `checks.ageDirections`)
- Modify : `src/domain/replacement/propose.ts` (`ageCompatibility`, `evaluate`, `proposalsFor`, `pullProposals`)
- Modify : `src/server/repositories/replacement.ts` (`manualProposal` : `rules: []`, `ageDirections: []`)
- Test : `tests/domain/replacement/propose.test.ts`, `tests/domain/replacement/rules.test.ts`

**Interfaces :**
- Consumes : tâche 1 (`isRuleOn`, `NO_VALIDATION_RULES`, `PRE_APPROVAL_RULES`).
- Produces :
  - `Proposal.rules: RuleId[]` et `Proposal.checks.ageDirections: ('up' | 'down')[]` (vide si même tranche).
  - `ageCompatibility(...)` renvoie en plus `directions: ('up' | 'down')[]`. Un lien vers une tranche plus jeune est `down` seulement si la tranche du combattant n'est pas déjà dans la catégorie (le cas d'aujourd'hui reste « same »).
  - `evaluate` appelle `ageCompatibility(..., { bothWays: true })` : la descente d'une tranche devient une proposition de type `C`, avec `ageDirections: ['down']`.
  - `ruleProfile(state: State, p: Omit<Proposal, 'rules' | 'manual' | 'preApproved' | 'rank'>): { rules: RuleId[]; forced: boolean }`, exportée de `propose.ts`. Dans l'ordre :
    - `R` → `['return']`, forced ;
    - split (`p.registrationId` différent de l'inscription du `caseId`) → `['split']`, plus `weightGap` si l'écart dépasse le seuil ;
    - **correction de poids** (cas `weight_out`, `changes.weightClassId` défini, et cible = `{ newKey }` ou la catégorie de sa clé naturelle corrigée, d'après `categoryForKey`) → `[]`, plus `weightGap` si l'écart dépasse le seuil, forced ;
    - sinon, on ajoute dans cet ordre :
      - `discipline` si `changes.discipline` ;
      - `shobuToJiyu` si `changes.ruleset === 'jiyu'` ;
      - `mixSexes` si `checks.mixedSex` ;
      - pour l'âge : `minorsAdults` si `checks.crossesMinorAdult` ; sinon `seniorsVeterans` si `ageMove === 'D'` ; sinon `ageUp` et/ou `ageDown` selon `ageDirections` ;
      - `weightGap` si `weightGapKg > threshold + 1e-9` ;
      - `weight` si la liste est encore vide.
  - Dans `proposalsFor` et dans le split :
    - `manual = rules.some((r) => !NO_VALIDATION_RULES.has(r))` ;
    - `preApproved = m.clubPreApproval && pas de changement de session && rules.some((r) => PRE_APPROVAL_RULES.has(r))` ;
    - toute proposition non forcée dont une règle est désactivée (`!isRuleOn`) est retirée.
    - Le split dans l'écart réglé devient donc `manual: false`, et une correction de poids au-dessus de l'écart devient `manual: true`.
  - Le classement des cartes ne change pas : le type `C` garde sa place, montée ou descente.

- [ ] **Step 1 : Écrire les tests qui échouent** (dans `propose.test.ts`, describe `règles des propositions`)

```ts
test('tranche d’âge au-dessous : minime seule vers des benjamines dans l’écart', () => {
  const mini = member({ ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
  const benj = [member({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', approxWeightKg: 37 }), member({ ageBandCode: 'benjamin', weightClassId: 'benjamin:F:-40', approxWeightKg: 38 })];
  const p = props(makeState([mini, ...benj]), mini.registrationId).find((x) => 'categoryId' in x.target && x.target.categoryId === benj[0]!.categoryId)!;
  expect(p).toMatchObject({ type: 'C', manual: true, rules: ['ageDown'], checks: { ageDirections: ['down'] } });
});
test('interrupteur coupé : la règle n’est plus proposée sur les cartes', () => {
  // même état, `off: ['ageDown']` → aucune proposition vers les benjamines ; `off: ['weight']` → plus de type A
});
test('split dans l’écart réglé : cas simple', () => {
  // reprendre le test « poule de 3 d’abord » : les deux propositions de split ont `manual: false` et `rules: ['split']`
});
test('correction de poids au-dessus de l’écart : à valider, jamais retirée', () => {
  // weight_out vers une catégorie existante où l'écart dépasse 5 kg → { rules: ['weightGap'], manual: true } ; toujours là avec `off: ['weightGap']`
});
test('plusieurs règles : autre discipline et tranche au-dessus', () => {
  // minime karaté qui accepte le shido-boxing ; seule cible : des cadettes shido-boxing dans l'écart → rules ['discipline', 'ageUp']
});
test('pré-accord : aussi pour la tranche au-dessous, jamais pour une discipline', () => { /* clubPreApproval: true */ });
```

- [ ] **Step 2 : Lancer les tests, ils échouent** — `npx vitest run tests/domain/replacement/propose.test.ts`

- [ ] **Step 3 : Implémenter** comme décrit dans Interfaces. Mettre à jour les attentes existantes qui changent pour une raison voulue : split `manual: false`, et une descente d'âge qui apparaît désormais dans une liste de propositions (spec §2.2). Ne pas toucher aux autres attentes.

- [ ] **Step 4 : Lancer les tests, ils passent** — `npm test` et `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): règles de chaque proposition, tranche d’âge au-dessous`

---

### Task 3 : Le calcul du plan d'ensemble

**Files :**
- Create : `src/domain/replacement/manual.ts` (`manualProposal` déplacé du dépôt, sans erreurs serveur)
- Create : `src/domain/replacement/plan.ts`
- Modify : `src/server/repositories/replacement.ts` (`manualProposal` appelle le domaine et traduit `error` en `NotFoundError` / `CategoryLockedError` / `RegistrationValidationError`, avec les messages actuels)
- Modify : `src/domain/replacement/propose.ts` (exporter `rulesForMove`)
- Test : `tests/domain/replacement/plan.test.ts`

**Interfaces :**
- Consumes : tâches 1 et 2 ; `detectCases`, `proposalsFor`, `applyAll`, `casesOfWave`, `categoryWave`, `activeMembers`, `effectiveWeight`, `gapThreshold`, `isLocked`, `isClosedMember`, `categoryLabel`.
- Produces :
  - `manualProposal(state: State, registrationId: string, categoryId: string): { p: Proposal; warnings: string[] } | { error: 'not-found' | 'locked' | 'frozen' | 'closed' }`. Le corps est celui du dépôt aujourd'hui, avec `rules: []` et `checks.ageDirections: []`.
  - `rulesForMove(state: State, registrationId: string, categoryId: string): RuleId[] | null` : les règles d'un déplacement vers une catégorie existante, d'après `evaluate` puis `ruleProfile`. `null` si `evaluate` le refuse.
  - `type PlanChoice = { kind: 'validate'; proposalId: string; caseId: string } | { kind: 'manual'; registrationId: string; categoryId: string }`
  - `interface PlanMove extends Proposal { anchor: string | null; fromCategoryId: string | null; costRule: RuleId | null; band: CostBand; validated: boolean; outside: 'disabled' | 'below-cut' | 'breaks-rules' | null; details: { rule: RuleId; detail: string }[]; toLabel: string }`
    - `anchor` : la première inscription active de la cible (par `registrationId`) au moment du déplacement, hors le combattant déplacé. `null` pour une cible `{ newKey }`.
    - `costRule` : la règle de `rules` qui a le plus grand `ruleRank`.
    - `toLabel` : le libellé de la catégorie du combattant une fois le déplacement fait.
  - `interface PlanOptions { waveId: string | null; level: RuleId; choices: PlanChoice[]; forApply?: boolean; nodeBudget?: number }`
  - `interface PlanResult { moves: PlanMove[]; aloneBefore: string[]; aloneAfter: string[]; onCards: string[]; dropped: PlanChoice[]; proven: boolean; final: State; hash: string }`
  - `computePlan(state: State, opts: PlanOptions): PlanResult`
  - `aloneRegistrations(state: State, waveId: string | null): string[]`, triée. Elle compte :
    - les inscriptions présentes ou non pointées (pas `absent`) d'une catégorie non verrouillée de la session, qui y sont seules parmi les actifs ;
    - les inscrits non déplacés d'une catégorie fermée (`isClosedMember`).
  - `DEFAULT_NODE_BUDGET = 20_000` (par groupe).
  - `hash` = `moves.map((m) => m.id).join('|')`.
- Détails des pastilles (`details`), libellés et kg à virgule :
  - `weight` → `écart 2,5 kg` ;
  - `weightGap` → `6,5 kg (max 5)` ;
  - `ageUp` / `ageDown` / `minorsAdults` → `Cadets → Juniors` (libellés de tranche de la grille, de la tranche du combattant vers celles de la cible) ;
  - `discipline` → `Karaté → Shido-boxing` (libellés de `DISCIPLINES`) ;
  - `split` → `écart 4 kg` ;
  - les autres règles → `''`.

**Le calcul (`computePlan`)**, à écrire tel quel :
1. `allowed` = `NO_VALIDATION_RULES` si `forApply`, sinon `allowedAt(state.settings, opts.level)`.
2. **Choix d'abord**, dans l'ordre reçu, sur l'état courant (au départ : `state`).
   - `validate` : retrouver le cas `caseId` dans `detectCases(courant)` (pour un split, le cas du combattant seul). Chercher `proposalId` parmi `proposalsFor({ ...courant, settings: withAllRules(...) }, cas)`.
   - `manual` : `manualProposal(courant, …)`.
   - Introuvable, en erreur, ou avec un changement de session (`waveChange`, `waveShifts`) : le choix va dans `dropped`.
   - Sinon : `applyAll`, puis `PlanMove` avec `validated: true`. `outside` vaut :
     - `breaks-rules` si `M` a des avertissements (ses règles viennent alors de `rulesForMove`, `[]` si `null`) ;
     - sinon `disabled` si une règle est inactive ;
     - sinon `below-cut` si une règle est hors de `allowedAt(level)`.
3. **Cas ouverts** : `casesOfWave(courant, detectCases(courant), waveId)`, sans les cartes mises de côté, sans les cas `weight_gap`, sans les inscriptions déjà déplacées par un choix.
4. **Options d'un cas** dans un état `s` : `proposalsFor(s, cas)`, sans changement de session. Une correction de poids forcée est permise si `!forApply || !p.manual`. Les autres propositions sont permises si `p.rules.every((r) => allowed.has(r))`. Tri par `ruleRank` de `costRule` croissant, puis par `rank`.
5. **Groupes indépendants** (union-find). Les nœuds sont les inscriptions des cas ouverts et les catégories non verrouillées. On relie :
   - un cas et sa catégorie ;
   - un cas et une catégorie dont au moins un membre actif `x` vérifie `mayShare(m, x)` ;
   - deux cas qui vérifient `mayShare`.
   `mayShare(a, b)` est vrai si toutes ces conditions sont vraies :
   - **disciplines** : {a.discipline} ∪ (a.otherDisciplines si `discipline` est permise) croise l'ensemble équivalent de `b` ;
   - **règlements** : identiques, ou l'un shobu, l'autre jiyu, et `shobuToJiyu` permise ;
   - **sexe** : identique, ou `mixSexes` permise et les deux tranches dans `mixSexes.ageBandCodes` ;
   - **âge** : même tranche, ou tranches voisines dans la grille et au moins une règle d'âge permise (`ageUp`, `ageDown`, `seniorsVeterans`, `minorsAdults`) ;
   - **poids** : même tranche, même sexe et `weightGap` permise ; sinon |poids effectif a − b| ≤ le seuil le plus grand des deux (un poids inconnu passe).
   Une catégorie et ses membres forment un même nœud. L'idée : un combattant ne peut finir qu'avec des combattants de son groupe, donc les groupes se calculent séparément.
6. **Par groupe**, sous-état = ses catégories et leurs membres (même `grid`, `settings`, `waves`, `refused`, `closedEntries`, `setAside`). On cherche ensuite, en profondeur :
   - **Nœud** : budget −1. Si le budget est épuisé : `proven = false` et on remonte.
   - Les **cas restants** sont les cas ouverts du sous-état (on refait `detectCases` : un combattant laissé seul en route y entre), hors cas décidés, triés dans cet ordre : `return`, `weight_out`, `closed`, `alone`, puis `registrationId`.
   - **Feuille** (plus de cas restant) : calculer le score et garder le meilleur.
   - Sinon, prendre le premier cas et essayer chacune de ses options, dans l'ordre (appliquer, marquer le cas décidé). Puis la branche « le laisser » : interdite pour un cas `return` ou `weight_out` qui a au moins une option.
   - Un cas `weight_out` sans aucune option va dans `onCards`.
   - **Élagage** : seuls actuels − 2 × (cas restants) > seuls du meilleur → on abandonne la branche.
   - **Point de départ** : avant de chercher, la solution « carte par carte » (première option de chaque cas, dans l'ordre, sans jamais laisser un cas qui a une option) devient le meilleur provisoire. Le plan n'est donc jamais moins bon que l'ancien calcul.
7. **Score** (plus petit = meilleur), comparé terme à terme :
   1. le nombre de seuls (`aloneRegistrations` du sous-état), sans compter ceux de `onCards` ;
   2. pour chaque index de `order`, du dernier au premier : le nombre de déplacements dont la `costRule` a ce rang ;
   3. le nombre d'inscriptions déplacées (`alsoMoved` compris) ;
   4. la somme des rangs de préférence de discipline ;
   5. la somme des écarts de poids ;
   6. les `id` des déplacements joints par `|` (ordre alphabétique).
8. **Fusion** : appliquer les déplacements des groupes à l'état courant, dans l'ordre des groupes (trié par plus petit `registrationId`). `moves` = choix + déplacements des groupes. `aloneBefore` = `aloneRegistrations(state)`. `aloneAfter` = celles de l'état final, sans `onCards`.

- [ ] **Step 1 : Écrire les tests qui échouent** (`plan.test.ts`, fixtures `makeState` / `member`, `level: 'minorsAdults'` sauf mention)

```ts
const kgM = (label: string, wc: string, kg: number) => member({ label, weightClassId: wc, approxWeightKg: kg });
test('mieux que carte par carte : Alice avec Bruno, Chloé avec Fanny', () => {
  const [a, b, c, f] = [kgM('A', 'cadet:F:-54', 52), kgM('B', 'cadet:F:-47', 47), kgM('C', 'cadet:F:-61', 56), kgM('F', 'cadet:F:+61', 60)];
  const s = makeState([a, b, c, f]);
  s.settings.replacementRules.off = ['weightGap'];
  const r = computePlan(s, { waveId: null, level: 'minorsAdults', choices: [] });
  expect([r.aloneBefore.length, r.aloneAfter, r.proven]).toEqual([4, [], true]);
  expect(r.moves).toHaveLength(2);
});
test('deux seuls voisins : un seul déplacement', () => { /* -47 et -54 seules → moves.length 1, aloneAfter [] */ });
test('jamais une règle inactive ni sous la ligne', () => { /* seule solution = ageUp ; off ['ageUp'] → 0 déplacement ; level 'split' → 0 déplacement */ });
test('à égalité de seuls, la règle la plus haute de la liste', () => { /* une solution weight (écart 4), une autre ageUp → weight ; order avec ageUp avant weight → ageUp */ });
test('retour toujours inclus ; correction de poids toujours incluse', () => { /* R présent même sans gain ; weight_out corrigé */ });
test('correction impossible : sur sa carte, pas comptée seule', () => { /* catégorie du poids réel fermée → onCards = [id], aloneAfter sans lui */ });
test('laissé seul en route : replacé', () => { /* une correction de poids vide la catégorie d’un autre ; il est déplacé ensuite */ });
test('cartes mises de côté, changement de session : hors du plan', () => {});
test('pour appliquer : seulement sans validation et validés', () => {
  // ageUp seule solution : forApply → 0 déplacement ; avec choices [{ kind: 'validate', proposalId, caseId }] → ce déplacement, validated: true
});
test('choix gardés même si leur règle est coupée ensuite', () => { /* validate puis off ['ageUp'] → toujours là, outside 'disabled' */ });
test('choix devenu impossible : écarté et signalé', () => { /* cible lancée → dropped = [choix], pas d’exception */ });
test('catégorie lancée : ni cible ni source', () => {});
test('absents : ni comptés ni déplacés', () => {});
test('plusieurs règles : toutes doivent être permises ; coût = la plus basse', () => { /* rules ['discipline','ageUp'] avec level 'ageDown' → absent du plan ; level 'discipline' → costRule 'discipline' */ });
test('shobu qui accepte le jiyu en priorité : G préféré à H à égalité', () => {});
test('même état, même plan', () => { /* deux appels → même hash ; structuredClone de l’état → même hash */ });
test('détails des pastilles', () => { /* ageUp → 'Pupilles → Benjamins' ; weightGap → '6,5 kg (max 5)' */ });
```

- [ ] **Step 2 : Lancer les tests, ils échouent** — `npx vitest run tests/domain/replacement/plan.test.ts`

- [ ] **Step 3 : Déplacer `manualProposal` dans `manual.ts`, ajouter `rulesForMove`, écrire `plan.ts`** comme décrit ci-dessus. Les tests serveur existants du déplacement manuel doivent passer sans changement.

- [ ] **Step 4 : Lancer les tests, ils passent** — `npm test` et `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): calcul du plan d’ensemble`

---

### Task 4 : Diagramme, référence « carte par carte » et performance ; fin de l'ancien calcul

**Files :**
- Modify : `src/domain/replacement/plan.ts` (`planLadder`)
- Create : `tests/domain/replacement/greedy-reference.ts` (copie de l'ancien `bulkPlan` / `nextBulkStep`, en mode `all` seulement, pour comparer ; l'original reste dans `apply.ts` jusqu'à la tâche 6)
- Create : `tests/domain/replacement/random-state.ts`
- Test : `tests/domain/replacement/ladder.test.ts`

**Interfaces :**
- Produces :
  - `interface LadderRow { rule: RuleId | null; on: boolean; alone: number | null; moves: number; toValidate: number; proven: boolean }`
  - `planLadder(state: State, opts: { waveId: string | null; choices: PlanChoice[] }): { rows: LadderRow[]; plan: PlanResult }`.
    - La première ligne est `rule: null`, avec `alone` = nombre de seuls au départ, `moves: 0`, `toValidate: 0`, `proven: true`.
    - Ensuite, une ligne par règle d'`order`. Une règle inactive donne `alone: null` et ne calcule rien. Une règle active donne le `computePlan` avec `level` = cette règle : `alone = aloneAfter.length`, `toValidate` = déplacements `manual && !validated`.
    - `plan` = le résultat de la ligne `cutAfter` (calculé une seule fois).
- Consumes (tests) : `greedyAlone(state: State, waveId: string | null): number`, de `greedy-reference.ts`, et `randomState(seed: number, size: number): State`, de `random-state.ts`. `randomState` est construit avec `seededRandom` (`src/domain/brackets/seeding.ts`). Ses inscriptions sont réparties sur 3 disciplines, 6 tranches, 2 sexes et des poids réalistes (environ 1 sur 4 seule), avec des préférences de discipline et quelques absents.

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
test('diagramme : une ligne par règle, décroissante, règle coupée sans barre', () => {
  const s = randomState(7, 80);
  s.settings.replacementRules.off = ['ageDown'];
  const { rows, plan } = planLadder(s, { waveId: null, choices: [] });
  expect(rows.map((r) => r.rule)).toEqual([null, ...s.settings.replacementRules.order]);
  expect(rows.find((r) => r.rule === 'ageDown')).toMatchObject({ on: false, alone: null });
  const values = rows.filter((r) => r.alone !== null).map((r) => r.alone!);
  expect(values).toEqual([...values].sort((x, y) => y - x));
  expect(plan.aloneAfter.length).toBe(rows.find((r) => r.rule === 'discipline')!.alone);
});
test('jamais pire que l’ancien calcul carte par carte', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = randomState(seed, 60);
    s.settings.replacementRules.cutAfter = 'minorsAdults';
    expect(computePlan(s, { waveId: null, level: 'minorsAdults', choices: [] }).aloneAfter.length).toBeLessThanOrEqual(greedyAlone(s, null));
  }
});
test('500 inscriptions : le diagramme en moins de 2 s, et prouvé', () => {
  const s = randomState(42, 500);
  const t = performance.now();
  const { rows } = planLadder(s, { waveId: null, choices: [] });
  expect(performance.now() - t).toBeLessThan(2000);
  expect(rows.every((r) => r.alone === null || r.proven)).toBe(true);
});
```

- [ ] **Step 2 : Lancer les tests, ils échouent** — `npx vitest run tests/domain/replacement/ladder.test.ts`

- [ ] **Step 3 : Implémenter `planLadder` et copier l'ancien calcul dans `greedy-reference.ts`.** Si le test des 2 s ou celui de la preuve échoue, ajuster d'abord `DEFAULT_NODE_BUDGET` et l'ordre des options. Ne jamais remplacer la limite de nœuds par une limite de temps.

- [ ] **Step 4 : Lancer les tests, ils passent** — `npm test` et `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): diagramme des règles, comparaison avec l’ancien calcul`

---

### Task 5 : Réglages par défaut et routes de la liste

**Files :**
- Modify : `src/domain/app-settings.ts` (`AppSettings.defaultReplacementRules`, défaut, `appSettingsPatchSchema`)
- Modify : `src/server/repositories/competitions.ts` (`createCompetition`)
- Modify : `src/server/routes/replacement.ts` (deux routes)
- Modify : `src/server/auth/permissions.ts` (`TABLE_WRITES`)
- Test : `tests/server/app-settings.test.ts`, `tests/server/competitions-repo.test.ts`, `tests/server/replacement.test.ts`, `tests/server/permissions.test.ts`

**Interfaces :**
- Consumes : tâche 1 (`RulesView`, `rulesViewSchema`, `rulesView`, `applyRulesView`).
- Produces :
  - `AppSettings.defaultReplacementRules: RulesView`, défaut `rulesView(defaultSettings())`. Il se modifie par `PATCH /api/app-settings` (organisateur seulement, comme aujourd'hui).
  - `createCompetition` enregistre `applyRulesView(defaultSettings(), getAppSettings(db).defaultReplacementRules)`.
  - `PUT /api/competitions/:id/replacement/rules` : corps `RulesView`. Il passe par `updateCompetition(db, id, { settings: applyRulesView(current.settings, body) })` et renvoie `rulesView(...)`. 400 si le corps est invalide.
  - `POST /api/competitions/:id/replacement/rules/reset` : recopie `getAppSettings(db).defaultReplacementRules` et renvoie `rulesView(...)`.
  - Les deux routes vont dans `TABLE_WRITES`.

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
test('nouvelle compétition : copie des règles par défaut de l’application', async () => {
  updateAppSettings(db, { defaultReplacementRules: { ...rulesView(defaultSettings()), cutAfter: 'ageUp', on: { ...rulesView(defaultSettings()).on, mixSexes: true } } });
  const c = await createCompetition(db, { name: 'X', date: '2026-11-22' });
  expect([c.settings.replacementRules.cutAfter, c.settings.mixSexes.enabled]).toEqual(['ageUp', true]);
});
test('changer les règles par défaut ne touche pas les compétitions déjà créées', async () => {});
test('Table centrale : range, coupe et active les règles, mélange mineurs/adultes compris', async () => {
  // PUT /replacement/rules avec on.minorsAdults: true → 200, settings.mixMinorsAdults === true ; reset → revient aux défauts
});
test('liste invalide : 400', async () => { /* order sans 'return' en tête, ou règle manquante */ });
```

- [ ] **Step 2 : Lancer les tests, ils échouent** — `npx vitest run tests/server/app-settings.test.ts tests/server/competitions-repo.test.ts tests/server/replacement.test.ts tests/server/permissions.test.ts`

- [ ] **Step 3 : Implémenter** comme décrit dans Interfaces.

- [ ] **Step 4 : Lancer les tests, ils passent** — `npm test` et `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): règles par défaut de l’application, routes de la liste`

---

### Task 6 : Routes du plan ; fin des routes en masse

**Files :**
- Modify : `src/domain/replacement/apply.ts` (retirer `BulkMode`, `BulkStep`, `nextBulkStep`, `bulkPlan` ; garder `stateFingerprint` et les réexports)
- Modify : `tests/domain/replacement/apply.test.ts`, `closed.test.ts`, `propose.test.ts`, `waves.test.ts` (les tests qui utilisaient `bulkPlan` passent à `computePlan` : mêmes situations, mêmes attentes de fond)
- Modify : `src/server/repositories/replacement.ts` (`planResponse`, `applyPlan` ; retirer `bulkApply`, garder `bulkWave` sous le nom `planWave`)
- Modify : `src/server/routes/replacement.ts` (deux routes ; retirer `POST /replacement/bulk` et la branche `bulk` de `/replacement/preview`)
- Modify : `src/server/auth/permissions.ts` (ajouter les deux routes, retirer `POST /replacement/bulk`)
- Test : `tests/server/replacement.test.ts` (réécrire les tests `bulk` avec les nouvelles routes), `tests/server/permissions.test.ts`

**Interfaces :**
- Consumes : tâches 3 et 4 (`planLadder`, `computePlan`, `PlanChoice`, `PlanMove`, `LadderRow`), `previewTransition`, `displayedProposals`, `persistAll`, `stateFingerprint`.
- Produces :
  - `POST /api/competitions/:id/replacement/plan`, corps `{ waveId?: string; choices: PlanChoice[]; forApply?: boolean }` (`choices` : 500 au plus). Il renvoie `PlanResponse` :
    ```ts
    interface PlanResponse {
      view: RulesView;
      rows: LadderRow[];            // [] si forApply
      plan: { moves: PlanMove[]; aloneBefore: number; alone: string[]; onCards: string[]; dropped: PlanChoice[]; proven: boolean; hash: string;
              refused: { proposalId: string; registrationId: string; reason: string }[] };
      categories?: { label: string; before: string[][]; after: string[][] }[];  // forApply : previewTransition(état, final)
      fingerprint: string;
    }
    ```
    - Avec des sessions, `waveId` est obligatoire : 400 sans lui, 404 s'il est inconnu (comme `bulkWave` aujourd'hui).
    - `refused` : les propositions refusées des cas ouverts de la session (`displayedProposals`, marquées `refused`).
    - `forApply` : `computePlan(..., { level: cutAfter, forApply: true })`.
  - `POST /api/competitions/:id/replacement/plan/apply`, corps `{ waveId?: string; choices: PlanChoice[]; fingerprint: string; hash: string }`, réponse `{ applied: number }`.
    - Si l'empreinte a changé : `StaleProposalError()` (409, message actuel).
    - Le serveur recalcule ensuite le plan avec `forApply`. Si son `hash` diffère : `StaleProposalError('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.')`.
    - Puis, pour chaque déplacement, dans l'ordre :
      1. recharger l'état (`loadState`) ;
      2. si la cible commence par `new:` et que `anchor` est défini, prendre la catégorie de `anchor` dans l'état rechargé ;
      3. écrire avec `persistAll(db, id, état, déplacement, { bulk: true })`.
    - Un déplacement validé à la main garde `manual: true` dans le journal.

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
test('plan : diagramme, plan et empreinte', async () => { /* rows[0].rule null ; plan.moves non vide ; fingerprint === GET /replacement */ });
test('appliquer : sans validation et validés seulement, journal « en masse »', async () => {
  // une solution A et une solution C : apply sans choix → applied 1 (A) ; la C reste un cas ;
  // apply avec { kind: 'validate', … } → applied 1, recasements[0] { type: 'C', manual: true, bulk: true }
});
test('appliquer un plan périmé : 409, rien d’appliqué', async () => { /* pesée entre plan et apply */ });
test('appliquer un plan qui a changé : 409', async () => { /* hash différent */ });
test('nouvelle catégorie puis un autre combattant qui la rejoint : appliqué en entier', async () => { /* correction vers une catégorie vide, puis un seul qui la rejoint */ });
test('sessions : waveId obligatoire, inconnu 404, une seule session traitée', async () => {});
test('la route en masse n’existe plus', async () => { /* POST /replacement/bulk → 404 */ });
```

- [ ] **Step 2 : Lancer les tests, ils échouent** — `npx vitest run tests/server/replacement.test.ts tests/server/permissions.test.ts`

- [ ] **Step 3 : Implémenter** comme décrit dans Interfaces.

- [ ] **Step 4 : Lancer les tests, ils passent** — `npm test` et `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): routes du plan d’ensemble, fin des validations en masse`

---

### Task 7 : La liste des règles à l'écran (Réaffectation et Réglages de l'application)

**Files :**
- Modify : `src/web/theme.ts` (jetons `cost0` … `cost4`, clair et sombre : vert, vert clair, jaune, orange, rouge, lisibles avec un texte blanc)
- Create : `src/web/components/replacement/RuleLadder.tsx`
- Modify : `src/web/api.ts` (`usePlan`, `useSetRules`, `useResetRules`, types `PlanResponse`, `PlanMove`, `PlanChoice`, `LadderRow`, `RulesView`)
- Modify : `src/web/pages/AppSettingsPage.tsx` (section « Règles de réaffectation par défaut »)
- Test : `tests/e2e/plan-d-ensemble.spec.ts` (premier test)

**Interfaces :**
- Consumes : routes des tâches 5 et 6.
- Produces :
  - `usePlan(id: string, waveId: string | null, choices: PlanChoice[], enabled: boolean)` : `useQuery`, clé `['replacement-plan', id, waveId, choices]`, en `POST /plan`. Elle est rafraîchie par `useInvalidateDay`, dont le prédicat porte sur `queryKey[1]`.
  - `usePlanForApply(id)` (mutation : `{ waveId?, choices }` → `PlanResponse`, avec `forApply: true`), `useApplyPlan(id)` (mutation `/plan/apply`, via `useReplacementAction`), `useSetRules(id)` (`PUT /rules`) et `useResetRules(id)` (`POST /rules/reset`).
  - `RuleLadder({ view, rows, onChange, busy }: { view: RulesView; rows?: LadderRow[]; onChange: (v: RulesView) => void; busy?: boolean })`. Une ligne par règle d'`view.order`, avec :
    - une poignée (glisser HTML5 natif, sans nouvelle dépendance) et deux boutons « Monter » / « Descendre » (`aria-label`), absents pour `return` ;
    - le numéro, le nom (`RULE_LABELS`) et la mention « à valider » si la règle n'est pas dans `NO_VALIDATION_RULES` ;
    - une pastille de la couleur de `costBand(…, règle, à valider)` ;
    - un interrupteur (absent pour `return`) ;
    - si `rows` est fourni : la barre alignée à gauche (largeur = seuls / seuls au départ, avec le nombre écrit dedans) et `N déplacements · M à valider`.
    - Une règle inactive est grisée, sans barre. La ligne « Sans rien changer » vient en tête quand `rows` est fourni.
    - Un clic sur une ligne place la ligne de coupure après elle. Un séparateur pointillé marqué « je m’arrête ici » suit la ligne `cutAfter`.
  - `data-testid` : `rule-ladder`, `ladder-row` (avec `data-rule`), `ladder-switch`, `ladder-up`, `ladder-down`, `ladder-alone`, `ladder-cut`.
  - Réglages de l'application : une `SectionCard` « Règles de réaffectation par défaut », avec la description « Copiées dans chaque nouvelle compétition. Les compétitions déjà créées ne changent pas. ». Elle contient un `RuleLadder` sans `rows` et un bouton « Enregistrer » (`PATCH /api/app-settings`).

- [ ] **Step 1 : Écrire le test e2e qui échoue** : `réglages de l’application : ranger les règles par défaut, une nouvelle compétition les reprend`. Descendre `Tranche d’âge au-dessous`, couper `Mélange seniors / vétérans`, enregistrer, créer une compétition, ouvrir sa Réaffectation, vérifier l'ordre et l'interrupteur.

- [ ] **Step 2 : Lancer le test, il échoue** — `npx playwright test tests/e2e/plan-d-ensemble.spec.ts`

- [ ] **Step 3 : Implémenter** les jetons, `RuleLadder`, les hooks et la section des Réglages.

- [ ] **Step 4 : Lancer les tests, ils passent** — e2e ci-dessus, `npm test`, `npm run typecheck`.

- [ ] **Step 5 : Commit** — `feat(reaffectation): liste des règles à l’écran et règles par défaut`

---

### Task 8 : Le plan dans l'onglet Réaffectation

**Files :**
- Create : `src/web/components/replacement/PlanView.tsx`
- Create : `src/web/usePlanChoices.ts`
- Modify : `src/web/pages/ReplacementPage.tsx` (en haut : `RuleLadder` et le plan ; retirer les deux boutons en masse, la branche `bulk` du dialogue et `useBulkReplacement`)
- Modify : `src/web/api.ts` (retirer `useBulkReplacement` ; `usePreviewReplacement` sans `bulk`)
- Modify : `src/web/pages/CompetitionSettingsPage.tsx` (sous les interrupteurs de mélange : « L’ordre des règles et la ligne « je m’arrête ici » se règlent dans l’onglet Réaffectation. »)
- Test : `tests/e2e/plan-d-ensemble.spec.ts` ; adapter `tests/e2e/recasement.spec.ts` (`bulk-all`) et `tests/e2e/vagues.spec.ts` (`bulk-simple`, `bulk-all`) au plan

**Interfaces :**
- Consumes : tâche 7 (`usePlan`, `usePlanForApply`, `useApplyPlan`, `RuleLadder`, `useSetRules`, `useResetRules`), `useRefuseProposal`, `useUnrefuseProposal`, `data.moveTargets`, `ProposalPreview`.
- Produces :
  - `usePlanChoices(competitionId: string, waveId: string | null): [PlanChoice[], (c: PlanChoice[]) => void]`. Les choix sont gardés en `sessionStorage` sous la clé `plan-choices:<competitionId>:<waveId ?? ''>`, avec lecture et écriture dans un try/catch. Ils sont vidés après une application réussie.
  - `PlanView` affiche, dans l'ordre :
    - **le résumé** : `Restent seuls` (avec « (au lieu de N) »), `Déplacements`, `Validés x / y` ;
    - **le message de recalcul** (`plan-changes`). Il compare le plan précédent et le nouveau, inscription par inscription. Pour une destination changée : « {nom} passe en {toLabel} au lieu de {ancien toLabel}. » ; pour un ajout : « {nom} : {toLabel}. » ; pour un retrait : « {nom} n’est plus déplacé. ». Les lignes changées sont surlignées ;
    - **les groupes par bande**, de 4 à 0, sous un bandeau `COST_BAND_LABELS[b]`, avec « règles 8–9 · 2 déplacements » (les numéros sont les rangs + 1). Un groupe vide n'est pas affiché ;
    - **chaque ligne** : le nom, le club, `reason`, une pastille par règle (numéro, couleur de sa bande, `RULE_LABELS`, `detail`, la `costRule` en gras), « pré-accord coach » si besoin, « règle désactivée », « sous la ligne » ou « hors règles » selon `outside`. Puis les boutons :
      - `Valider` (si `manual && !validated`) ou `Annuler la validation` ;
      - `Refuser` (route de refus existante) ;
      - `Modifier` (un `Select` des `moveTargets` du cas, seulement si le combattant déplacé est celui du cas) ou `Annuler le choix` ;
    - le groupe **« Refusés »** (`plan.refused`), avec `Annuler le refus` ;
    - **« Restent seuls »** (les noms) et **« À traiter sur sa carte »** (`onCards`) ;
    - un avertissement si `dropped` n'est pas vide : « Certains choix ne sont plus possibles et ont été retirés : {noms}. » ;
    - « Aucune combinaison dans ces règles ne laisse moins de {n} seuls. » si `proven`, sinon « Meilleur plan trouvé. ».
  - En haut de l'onglet, sous le choix de la session : le `RuleLadder` avec `rows`, un lien « Revenir aux réglages par défaut » (`useResetRules`), puis le bouton `Voir le plan jusqu’à la règle {k} ({n} déplacements, {s} seuls)` (`plan-show`), qui ouvre ou referme le `PlanView`.
  - `Appliquer le plan` appelle `usePlanForApply` et ouvre une confirmation. Celle-ci montre exactement les déplacements qui seront appliqués et `ProposalPreview` des `categories`. Le bouton `Confirmer (n)` appelle `/plan/apply` avec `hash` et `fingerprint`, puis affiche « {n} réaffectations appliquées. ».
  - Historique : « en masse · validé à la main » pour une réaffectation `bulk && manual`.
  - Sur les cartes : la mention « · âge : une tranche au-dessous » quand `checks.ageDirections` contient `down` (« · âge : une tranche au-dessus » sinon).
  - `data-testid` : `plan-view`, `plan-band` (avec `data-band`), `plan-move` (avec `data-registration`), `plan-move-validate`, `plan-move-unvalidate`, `plan-move-refuse`, `plan-move-modify`, `plan-move-unchoose`, `plan-unrefuse`, `plan-alone`, `plan-proven`, `plan-changes`, `plan-apply`, `plan-apply-confirm`, `plan-show`.

- [ ] **Step 1 : Écrire les tests e2e qui échouent** (dans `plan-d-ensemble.spec.ts`) :
  - `le diagramme baisse règle par règle ; déplacer la ligne change le plan` ;
  - `valider un déplacement à valider, appliquer : seuls lui et les cas simples sont appliqués` (l'historique montre « en masse ») ;
  - `modifier puis annuler le choix : le plan revient` ;
  - `refuser puis annuler le refus`.

- [ ] **Step 2 : Lancer les tests, ils échouent** — `npx playwright test tests/e2e/plan-d-ensemble.spec.ts`

- [ ] **Step 3 : Implémenter** `PlanView`, `usePlanChoices` et l'intégration ; retirer les boutons en masse ; adapter `recasement.spec.ts` et `vagues.spec.ts`. `bulk-simple` devient `plan-apply` sans validation. `bulk-all` devient « valider chaque déplacement à valider », puis `plan-apply`.

- [ ] **Step 4 : Lancer les tests, ils passent** — `npm run test:e2e`, `npm test`, `npm run typecheck`. Vérifier aussi `tests/e2e/mise-en-page.spec.ts` (contenu coupé à 1280 px et à 390 px).

- [ ] **Step 5 : Commit** — `feat(reaffectation): plan d’ensemble dans l’onglet Réaffectation`

---

### Task 9 : Aide, documents, vérification complète

**Files :**
- Modify : `src/web/help.ts` (`reaffectation`, `recasement.de-cote`)
- Modify : `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (§9.2, §9.3, §9.4, §10 : renvoi au nouveau document ; tranche au-dessous ; plan d'ensemble à la place du bouton global ; deux sortes de déplacements)
- Modify : `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (étape 24), `docs/superpowers/plans/2026-10-21-99-bilan.md`

**Textes de l'aide** (mot pour mot), dans `reaffectation.details` :
- On remplace la puce « Classer automatiquement… » par trois puces :
  - « « Plan d’ensemble » : la liste des règles, de la plus acceptable à la moins acceptable, montre pour chacune combien de combattants resteraient seuls si on l’autorise avec toutes celles du dessus. Rangez les règles, activez-les ou non, et placez la ligne « je m’arrête ici ». »
  - « « Voir le plan » liste les déplacements, du plus coûteux au moins coûteux. « Valider » confirme un déplacement à valider (il ne bougera plus), « Refuser » l’écarte, « Modifier » choisit une autre catégorie : le plan est recalculé à chaque fois, et chaque choix s’annule. »
  - « « Appliquer le plan » applique les déplacements sans validation et ceux que vous avez validés ; les autres restent en attente. »
- La phrase du split devient : « Un combattant seul dans sa catégorie peut aussi recevoir le ou les deux plus lourds de la catégorie de poids juste en dessous, s’il y en reste au moins deux (« pour donner une poule à… »). Dans l’écart de poids réglé, c’est un cas simple. »
- « Certains déplacements demandent normalement l’accord des coachs ; … » devient : « Seul un déplacement qui ne change que la catégorie de poids, dans l’écart réglé, se fait sans validation ; tous les autres se valident à la main. « Pré-accord coach » rappelle que le club a accepté d’avance les déplacements d’âge et de poids. »
- Dans la puce des sessions, « les validations automatiques » devient « le plan d’ensemble ».
- Dans `recasement.de-cote.short`, « ni dans le classement automatique » devient « ni dans le plan d’ensemble ».

- [ ] **Step 1 : Mettre à jour l'aide et les documents**
- [ ] **Step 2 : Vérification complète** — `npm run typecheck`, `npm test`, `npm run test:e2e`, puis `docker compose up --build`. Ouvrir la Réaffectation de la compétition Démo et vérifier que la liste, les barres et le plan s'affichent en moins de 2 s.
- [ ] **Step 3 : Commit** — `docs: plan d’ensemble — aide, conception principale, feuille de route, bilan`
