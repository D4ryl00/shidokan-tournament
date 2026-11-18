# Réaffectation : retrouver le plan où on l’a laissé — plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** au retour sur Réaffectation (après Tableaux ou un autre onglet), le plan d’ensemble est déplié s’il l’était et n’est pas recalculé si rien n’a changé.

**Architecture:** le plan calculé reste dans le cache TanStack sans limite de temps ni péremption au remontage ; ce qui le périme déjà (gestes de l’onglet, événements des autres postes, révision du flux) continue de l’oublier. Un calcul annulé marque le plan périmé pour qu’un retour le recalcule. Quitter la compétition oublie ses plans (le flux d’événements n’écoute plus). L’état déplié est gardé en `sessionStorage`, par compétition et par session, comme les choix.

**Tech Stack:** React 19, TanStack Query 5, Vitest (node), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-reaffectation-retour-sur-la-page-design.md`

## Global Constraints

- Interface en français ; aucun texte nouveau à l’écran (le bandeau « Calcul annulé… » reste tel quel).
- Clé de stockage : `plan-open:${competitionId}:${waveId ?? ''}` ; défaut replié ; accès au stockage dans `try/catch` (stockage bloqué : l’état vit dans la page), comme `usePlanCardDecisions`.
- Position dans la page, « Détails » ouverts, « Modifier » en cours : non gardés.
- Choix toujours en `sessionStorage` (pas de changement de durée de vie).
- « Repartir de zéro » oublie l’état déplié ; « Recommencer le plan » ne replie pas.

## Review Focus

1. Quitter la compétition (logo, liste des compétitions) puis y revenir après un changement fait ailleurs : le plan doit être recalculé (le flux d’événements ne tournait pas) — tâche 1 (nettoyage du flux) et test e2e de la tâche 2.
2. Plan annulé puis départ de la page : au retour, pas de plan périmé présenté comme à jour — tâches 1 et 2.
3. Deux sessions : déplier le plan d’une session ne déplie pas celui de l’autre — tâche 2.
4. « Repartir de zéro » : le plan revient replié (le test existant « valider, appliquer, repartir de zéro… » clique `plan-show` après la remise à zéro et casserait sinon) — tâche 2.
5. Serveur redémarré pendant qu’on est sur Tableaux : la révision du flux change, `refreshPlansLive` oublie les plans cachés → recalcul au retour. Mécanisme existant, non testé ici : à relire.

---

### Task 1: plan gardé au retour, sauf changement ou annulation

**Files:**
- Modify: `src/web/api.ts` (`usePlan`, vers les lignes 672-705 ; nouvelles exportations près de `refreshPlansLive`)
- Modify: `src/web/liveUpdates.ts` (nettoyage de l’effet de `useCompetitionEvents`)
- Test: `tests/web/plan-live.test.ts`

**Interfaces:**
- Produces: `export const PLAN_CACHE = { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false } as const;` (étalé dans les options de `usePlan`, à la place de son `refetchOnWindowFocus: false`).
- Produces: `export async function cancelPlan(qc: QueryClient, queryKey: QueryKey): Promise<void>` — `await qc.cancelQueries({ queryKey })`, puis marque la requête exacte périmée sans la relancer (`qc.getQueryCache().find({ queryKey, exact: true })?.invalidate()`). `usePlan.cancel` l’appelle au lieu de `qc.cancelQueries`.
- `useCompetitionEvents` : au démontage (retour de l’effet), en plus de l’existant, `qc.removeQueries({ queryKey: [PLAN_KEY, competitionId] })`.

- [ ] **Step 1: Write the failing tests** dans `tests/web/plan-live.test.ts`

Le helper `planQuery` étale `...PLAN_CACHE` dans les options de son `QueryObserver` ; ajouter un helper `observe(p)` qui abonne un nouvel observateur sur la même clé et la même `queryFn` (retour sur la page) et rend sa fonction de désabonnement.

```ts
test('plan quitté puis revenu sans changement : pas de nouveau calcul', async () => {
  const p = planQuery();
  await p.release();
  p.unsubscribe();
  const back = observe(p);
  await new Promise((r) => setTimeout(r, 5));
  expect(p.counts.starts).toBe(1);
  expect(p.query().state.data).toBe(1);
  back();
});

test('plan quitté, mise à jour en direct pendant l’absence : recalculé au retour', async () => {
  const p = planQuery();
  await p.release();
  p.unsubscribe();
  refreshPlansLive(p.qc);
  const back = observe(p);
  expect(p.counts.starts).toBe(2);
  back();
});

test('plan annulé puis quitté : recalculé au retour', async () => {
  const p = planQuery();
  await p.release();
  void p.qc.invalidateQueries({ queryKey: p.queryKey });
  expect(p.counts.starts).toBe(2);
  await cancelPlan(p.qc, p.queryKey);
  expect(p.query().state.data).toBe(1);
  expect(p.counts.starts).toBe(2);
  p.unsubscribe();
  const back = observe(p);
  expect(p.counts.starts).toBe(3);
  back();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/web/plan-live.test.ts`
Expected: FAIL (`PLAN_CACHE` / `cancelPlan` non exportés).

- [ ] **Step 3: Implement `PLAN_CACHE`, `cancelPlan`, their use in `usePlan`, and the cleanup in `useCompetitionEvents`**

Mettre à jour le commentaire de `usePlan` (« gardé tant que rien ne change : ni péremption au retour sur la page, ni oubli au bout de 5 minutes ») et celui de `useCompetitionEvents` (compétition quittée : ses plans sont oubliés, faute d’événements pour les tenir à jour).

- [ ] **Step 4: Run the web tests**

Run: `npx vitest run tests/web`
Expected: PASS (les tests existants de `plan-live` aussi).

- [ ] **Step 5: Commit**

```bash
git add src/web/api.ts src/web/liveUpdates.ts tests/web/plan-live.test.ts
git commit -m "fix(reaffectation): plan gardé au retour sur la page s'il n'a pas changé ; recalculé après une annulation ou en revenant dans la compétition"
```

### Task 2: plan déplié gardé par session

**Files:**
- Modify: `src/web/usePlanChoices.ts` (nouveau hook ; `clearPlanChoices` oublie aussi `plan-open:`)
- Modify: `src/web/pages/ReplacementPage.tsx:123` (`const [open, setOpen] = useState(false)` → le hook)
- Test: `tests/e2e/plan-d-ensemble.spec.ts`

**Interfaces:**
- Consumes: Task 1 (aucun appel de plan au retour sans changement).
- Produces: `export function usePlanOpen(competitionId: string, waveId: string | null): [boolean, (open: boolean) => void]` — même forme que `usePlanCardDecisions` (état `{ key, open }` relu quand la clé change, écriture `'true'` / suppression de la clé). `ReplacementPage` remplace `setOpen((o) => !o)` par `setOpen(!open)`.

- [ ] **Step 1: Write the failing e2e tests** (à la suite de « plan : les choix sont gardés par session » ; helpers existants `seedPlan`, `openPlan`, `seedSessions`, `openSession`, `slowPlan`, `isPlanPost`, `openTab`)

```ts
test('plan : retour depuis Tableaux, déplié, choix gardés, sans nouveau calcul ; replié, il le reste', async ({ page, request }) => {
  // seedPlan, openPlan ; valider MINI Léa ; attendre « Validés 1 / » ; compter les POST du plan (isPlanPost) à partir d’ici.
  // openTab(page, 'Tableaux') ; openTab(page, 'Réaffectation').
  // expect(page.getByTestId('plan-view')).toBeVisible() sans cliquer ; plan-show aria-expanded="true" ;
  // MINI Léa : plan-move-unvalidate visible ; plan-progress : 0 ; après 1 s, aucun nouveau POST du plan.
  // Replier (plan-show), Tableaux, retour : plan-show aria-expanded="false", plan-view absent.
});

test('plan : changé ailleurs pendant l’absence, recalculé au retour (autre onglet ou hors de la compétition)', async ({ page, request }) => {
  // seedPlan, openPlan ; openTab 'Tableaux' ; un autre poste inscrit TARDIVE Léa (même POST que le test « annuler un calcul long ») ;
  // openTab 'Réaffectation' : un nouveau POST du plan part, la vue contient « (au lieu de 4) ».
  // Puis : retour à la liste par le lien « Shidokan France — compétitions » (navigation dans l’appli, pas page.goto) ;
  // un autre poste inscrit TARDIVE Zoé (cadet:F:-54, approxWeightKg 52 : seule dans sa catégorie) ;
  // rouvrir la compétition depuis la liste puis Réaffectation : un nouveau POST du plan part, la vue contient « (au lieu de 5) ».
});

test('plan : calcul annulé puis départ, recalculé au retour', async ({ page, request }) => {
  // seedPlan, openPlan ; page.route slowPlan(5000) ; basculer mixSexes (comme le test « annuler un calcul long ») ;
  // « Annuler le calcul » ; bandeau « Calcul annulé… » visible ; page.unroute.
  // openTab 'Tableaux' ; openTab 'Réaffectation' : un nouveau POST du plan part ; bandeau absent ; plan-apply activé.
});

test('plan : déplié dans une session, replié dans l’autre', async ({ page, request }) => {
  // seedSessions ; page.goto réaffectation ; openSession 'Matin' (déplie) ;
  // clic sur la session « Après-midi » sans openSession : plan-show aria-expanded="false" ;
  // retour au Matin : aria-expanded="true".
});
```

Les chiffres « (au lieu de N) » sont à confirmer en lançant le test une première fois sur le code de la tâche 1 seule : le point fixe est qu’un nouveau calcul part et que la vue reflète l’inscription ajoutée.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/plan-d-ensemble.spec.ts -g "retour depuis Tableaux|déplié dans une session"`
Expected: FAIL (plan replié au retour).

- [ ] **Step 3: Implement `usePlanOpen`, use it in `RulesPanel`, clear it in `clearPlanChoices`**

Mettre à jour le commentaire de `clearPlanChoices` (« les choix du plan, la coche et l’état déplié »).

- [ ] **Step 4: Run the whole plan spec and the unit tests**

Run: `npx playwright test tests/e2e/plan-d-ensemble.spec.ts tests/e2e/details-reaffectation.spec.ts && npm test && npm run typecheck`
Expected: PASS, y compris « valider, appliquer, repartir de zéro… » (le plan revient replié après « Repartir de zéro »).

- [ ] **Step 5: Commit**

```bash
git add src/web/usePlanChoices.ts src/web/pages/ReplacementPage.tsx tests/e2e/plan-d-ensemble.spec.ts
git commit -m "feat(reaffectation): plan déplié gardé au retour sur la page, par session"
```

### Task 3: vérification sur Chrome

- [ ] **Step 1:** `npm run build`, puis un serveur de test sur une copie de sauvegarde (jamais la base du conteneur) : copier la dernière sauvegarde de `data/sauvegardes/` dans `tmp/`, `PORT=3100 DATABASE_PATH=tmp/<copie>.sqlite node dist/server/main.js`.
- [ ] **Step 2:** avec l’extension Claude in Chrome, sur la démo (`localhost:3100`) : déplier le plan, Valider une ligne et Modifier une autre, onglet Tableaux, retour → plan déplié, « Validés » inchangé, pas de barre de progression ; replier, aller-retour → replié ; aller-retour par les boutons Préparer / Jour J et par le retour du navigateur.
- [ ] **Step 3:** arrêter le serveur de test, supprimer la copie dans `tmp/`. Dire dans le bilan ce qui n’a pas été vu sur Chrome.
