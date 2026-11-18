# Fiche d'un combattant dans Tableaux — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une icône ⓘ à côté de chaque nom de Tableaux (planche, liste, galaxie) ouvre la fiche du combattant dans une bulle, sans
changer ce que fait le clic sur le nom.

**Architecture:** un composant `FighterInfoButton` (bouton ⓘ + `Popover` Mantine contenant l'en-tête et `FighterSheet` de la
Réaffectation) ; branché dans `FighterChip` (planche, bac, galaxie) et, sur demande, dans les cases de `BracketView` (Liste,
carte agrandie). Le bouton et la bulle arrêtent la propagation des événements pour ne jamais déclencher clic-clic, échange ou
glisser.

**Tech Stack:** React 19, Mantine (`Popover`, `ActionIcon`/`UnstyledButton`), TanStack Query (hooks existants), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-18-fiche-combattant-tableaux-design.md`

## Global Constraints

- Interface en français ; thème clair et sombre : variables `--sk-*` uniquement.
- Fiche identique à celle de Réaffectation : réutiliser `FighterSheet` (`src/web/components/replacement/FighterSheet.tsx`) tel
  quel, sans coordonnées du club.
- Le clic (et Entrée/Espace) sur un nom garde son rôle actuel dans les trois vues.
- `BracketView` ne montre ⓘ que si l'appelant le demande : impression, vue publique, Combats (Matches) et Détails de
  Réaffectation inchangés.
- Poste de Zone : ⓘ présent, fiche en lecture ; le clic sur le nom n'ouvre pas la fiche.
- Écran étroit : ⓘ touchable (zone ≈ 24 px) sans élargir les pastilles ; bulle bornée (`width` ≤ `min(340px, 100vw - 32px)`),
  rien ne déborde à 360 px.
- Tests unitaires : vitest en environnement `node` (pas de rendu de composant) → la couverture est en e2e Playwright.
- Chaque changement visible vérifié dans Chrome (extension Claude in Chrome) et dans le simulateur iOS.

## Review Focus

1. **Clic dans la bulle pendant un clic-clic** : la bulle est rendue dans un portail, mais les événements React remontent
   l'arbre des composants jusqu'à la pastille ou la carte. Pastille A choisie, ⓘ de B ouvert, clic dans la fiche de B : rien ne
   bouge, A reste choisie. (Test : tâche 1.)
2. **Entrée/Espace sur ⓘ** : la pastille capte `onKeyDown` (clic-clic au clavier) ; ⓘ au clavier ouvre la fiche sans choisir
   la pastille. (Test : tâche 1.)
3. **Glisser depuis ⓘ** : un glisser commencé sur l'icône ne déplace pas la pastille (`draggable` sur le parent). (Test : tâche 1.)
4. **Liste : ⓘ dans une case du tableau** ne choisit pas l'inscrit pour l'échange ni n'ouvre « Déplacer vers… ». (Test : tâche 2.)
5. **Téléphone 360 px** : bulle ouverte sans défilement horizontal de la page. (Test : tâche 2.)

---

### Task 1: `FighterInfoButton` et pastilles (planche, bac, galaxie)

**Files:**
- Create: `src/web/components/FighterInfoButton.tsx`
- Modify: `src/web/components/planche/FighterChip.tsx` (nouvelle prop, ⓘ à droite du nom, avant le badge)
- Modify: `src/web/components/planche/CategoryCard.tsx`, `src/web/components/planche/LoneTray.tsx` (passer `competitionId`)
- Modify: `src/web/components/planche/Planche.tsx` (passer `competitionId` au bac s'il ne l'a pas)
- Test: `tests/e2e/planche.spec.ts`, `tests/e2e/galaxie.spec.ts`

**Interfaces:**
- Produces: `export function FighterInfoButton({ competitionId, registrationId, name, club }: { competitionId: string; registrationId: string; name: string; club: string }): JSX.Element`
  - Bouton : `data-testid="fighter-info"`, `aria-label={`Fiche de ${name}`}`, `title="Fiche du combattant"`, texte « ⓘ »,
    couleur `var(--sk-muted)`, zone cliquable ≈ 24 px (padding négatif ou `ActionIcon size="sm" variant="subtle"`).
  - Bulle : `Popover withArrow shadow="md" position="bottom-start" width="min(340px, calc(100vw - 32px))"` (fermeture au clic
    dehors et Échap = défauts Mantine) ; `Popover.Dropdown data-testid="fighter-info-sheet"` contient
    `<Text size="sm"><b>{name}</b> · {club}</Text>` puis `<FighterSheet competitionId registrationId />`.
  - Sur le bouton : `onClick`, `onKeyDown`, `onPointerDown`, `onMouseDown` → `stopPropagation()` ; `draggable={false}` et
    `onDragStart` → `preventDefault(); stopPropagation()`.
  - Sur `Popover.Dropdown` : `onClick`, `onKeyDown`, `onPointerDown`, `onMouseDown`, `onDragStart` → `stopPropagation()`
    (portail : les événements React remontent sinon à la pastille et à la carte).
- `FighterChip` gagne `competitionId?: string` ; ⓘ affiché si `competitionId && info`. Club passé : `info.club`.

- [ ] **Step 1: Write the failing e2e tests**

Dans `tests/e2e/planche.spec.ts` (réutiliser `seed`, `card`, `chip`) :

```ts
test('planche : ⓘ ouvre la fiche sans choisir la pastille ; clic-clic intact', async ({ page, request }) => {
  const id = await createCompetition(page, 'Coupe fiche planche');
  const ids = await seed(request, id);
  await page.goto(`/competitions/${id}/tableaux`);
  const c54 = card(page, ids.c54);
  const alba = chip(page, c54, 'ALBA');
  await alba.getByTestId('fighter-info').click();
  const sheet = page.getByTestId('fighter-info-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('ALBA x');
  await expect(sheet.getByTestId('fighter-sheet')).toContainText('Licence');
  await expect(alba).toHaveAttribute('aria-pressed', 'false');
  // Clic ailleurs : fermée ; une seule bulle à la fois.
  await chip(page, c54, 'BRUN').getByTestId('fighter-info').click();
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(1);
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('BRUN x');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fighter-info-sheet')).toHaveCount(0);
  // Pastille choisie, puis fiche d'une autre et clic dedans : rien ne bouge, la première reste choisie.
  await alba.click();
  await expect(alba).toHaveAttribute('aria-pressed', 'true');
  await chip(page, c54, 'CARO').getByTestId('fighter-info').click();
  await page.getByTestId('fighter-info-sheet').getByTestId('fighter-sheet').click();
  await expect(page.getByTestId('drop-dialog')).toHaveCount(0);
  await expect(alba).toHaveAttribute('aria-pressed', 'true');
  // Clavier : Entrée sur ⓘ ouvre la fiche sans choisir la pastille.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await chip(page, c54, 'DIDI').getByTestId('fighter-info').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('DIDI x');
  await expect(chip(page, c54, 'DIDI')).toHaveAttribute('aria-pressed', 'false');
  // Le bac aussi ; glisser depuis ⓘ ne déplace rien.
  const solo = page.getByTestId('planche-tray').getByTestId('planche-chip').filter({ hasText: 'SOLO' });
  await solo.getByTestId('fighter-info').dragTo(chip(page, c54, 'ALBA'));
  await expect(page.getByTestId('drop-dialog')).toHaveCount(0);
  await solo.getByTestId('fighter-info').click();
  await expect(page.getByTestId('fighter-info-sheet')).toContainText('SOLO x');
});
```

Ajuster l'ordre « Échap » si le premier Échap ferme à la fois la bulle et le choix : l'assertion qui compte est « aucun
`drop-dialog`, `aria-pressed` inchangé ».

Dans `tests/e2e/galaxie.spec.ts` (réutiliser `seed`, `openGalaxy`, `card`) :

```ts
test('galaxie : ⓘ d’une pastille ouvre la fiche', async ({ page, request }) => {
  const id = await createCompetition(page, 'Galaxie fiche');
  const ids = await seed(request, id);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGalaxy(page, id);
  await page.getByTestId('planche-search').fill('-61 Karaté');
  const c61 = card(page, ids.c61);
  await expect(c61).toBeVisible();
  await c61.getByTestId('planche-chip').first().getByTestId('fighter-info').click();
  await expect(page.getByTestId('fighter-info-sheet').getByTestId('fighter-sheet')).toContainText('Licence');
  await expect(page.getByTestId('galaxy-canvas')).toHaveAttribute('data-selected', ids.c61);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/planche.spec.ts tests/e2e/galaxie.spec.ts -g "ⓘ"`
Expected: FAIL (`fighter-info` introuvable).

- [ ] **Step 3: Implement `FighterInfoButton` and wire it into `FighterChip`, `CategoryCard`, `LoneTray`**

Dans `FighterChip`, ⓘ dans le `Group` du nom (entre le nom et le badge), `flexShrink: 0`. `CategoryCard` passe
`competitionId={p.competitionId}` à chaque pastille ; `LoneTray` reçoit `competitionId: string` et le passe.

- [ ] **Step 4: Run them to verify they pass, and the existing planche/galaxie tests**

Run: `npx playwright test tests/e2e/planche.spec.ts tests/e2e/galaxie.spec.ts`
Expected: all PASS (les tests de glisser et de clic-clic existants inchangés).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` → aucune erreur.

```bash
git add src/web/components/FighterInfoButton.tsx src/web/components/planche tests/e2e/planche.spec.ts tests/e2e/galaxie.spec.ts
git commit -m "feat(tableaux): fiche d'un combattant (ⓘ) sur les pastilles de la planche, du bac et de la galaxie"
```

### Task 2: cases du tableau (Liste, carte agrandie), poste de Zone, aide

**Files:**
- Modify: `src/web/components/BracketView.tsx` (prop `fighterInfo`, dans `EntrantLine` hors `inline`/`printable`)
- Modify: `src/web/pages/BracketsPage.tsx` (Liste : `fighterInfo={id}`)
- Modify: `src/web/components/planche/CategoryCard.tsx` (carte agrandie : `fighterInfo={p.competitionId}`)
- Modify: `src/web/help.ts` (section Tableaux)
- Test: `tests/e2e/tableaux.spec.ts`, `tests/e2e/planche.spec.ts`, `tests/web/help.test.ts` si elle vérifie des textes

**Interfaces:**
- Consumes: `FighterInfoButton` (tâche 1).
- Produces: `BracketView` prop `fighterInfo?: string` — id de la compétition ; si présent et `!printable`, ⓘ après le nom dans
  chaque case d'inscrit (`name = info.name`, `club = info.club`), aussi dans la case « Sans adversaire ».

- [ ] **Step 1: Write the failing e2e tests**

Dans `tests/e2e/tableaux.spec.ts` (créer quatre inscrits d'une même catégorie comme les tests voisins) :

```ts
test('liste : ⓘ d’une case ouvre la fiche sans choisir l’inscrit ; l’échange au clic reste', async ({ page, request }) => {
  // … compétition + 4 inscrits même catégorie, vue Liste choisie (brackets-view → « Liste »)
  const entrant = page.getByTestId('bracket-entrant').filter({ hasText: 'ALBA' });
  await entrant.getByTestId('fighter-info').click();
  await expect(page.getByTestId('fighter-info-sheet').getByTestId('fighter-sheet')).toContainText('Licence');
  await expect(page.getByTestId('swap-select')).toHaveText('Échange manuel : cliquez sur deux inscrits.');
  await page.getByTestId('fighter-info-sheet').click();
  await expect(page.getByTestId('swap-select')).toHaveText('Échange manuel : cliquez sur deux inscrits.');
  await page.keyboard.press('Escape');
  await entrant.click();
  await expect(page.getByTestId('swap-select')).toContainText('Cliquez sur l’inscrit à échanger avec ALBA');
});

test('liste : 360 px, bulle ouverte sans débordement', async ({ page, request }) => {
  // … même préparation, viewport { width: 360, height: 740 }
  await page.getByTestId('bracket-entrant').first().getByTestId('fighter-info').click();
  await expect(page.getByTestId('fighter-info-sheet')).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
```

Dans `tests/e2e/planche.spec.ts` :

```ts
test('planche : carte agrandie et poste de zone, ⓘ ouvre la fiche', async ({ page, request }) => {
  // poste de zone comme « un poste de zone voit le bac… » ; carte -54 : « Agrandir » (card-grow)
  // ⓘ d'une case bracket-entrant → fighter-info-sheet contient 'Licence' ; ⓘ d'une pastille du bac idem.
});
```

Et vérifier que `PrintPage` ne montre pas ⓘ : dans un test d'impression existant de `tableaux.spec.ts`, ajouter
`await expect(page.getByTestId('fighter-info')).toHaveCount(0);`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/tableaux.spec.ts tests/e2e/planche.spec.ts -g "ⓘ|360 px, bulle"`
Expected: FAIL.

- [ ] **Step 3: Implement `fighterInfo` in `BracketView`, wire Liste and carte agrandie**

ⓘ dans la ligne du nom de `EntrantLine` (même `Text` que le badge), seulement si `props.fighterInfo && !props.printable && id && info`.

- [ ] **Step 4: Add the help sentence**

Dans `help.ts`, section `tableaux`, premier sous-tableau, ajouter après la phrase « Cherchez une catégorie… » :
`'« ⓘ » à côté d’un nom ouvre la fiche du combattant (âge, licence, grade, présence et poids, discipline, autres inscriptions) dans une bulle, sans quitter la page ; le clic sur le nom garde son rôle (choisir, échanger).'`
Et dans le second sous-tableau, rien d'autre. Lancer `npx vitest run tests/web/help.test.ts`.

- [ ] **Step 5: Run the whole suites**

Run: `npm run typecheck && npm test && npx playwright test`
Expected: tout PASS (y compris impression, public, Combats, Réaffectation inchangés).

- [ ] **Step 6: Commit**

```bash
git add src/web/components/BracketView.tsx src/web/pages/BracketsPage.tsx src/web/components/planche/CategoryCard.tsx src/web/help.ts tests/e2e
git commit -m "feat(tableaux): fiche d'un combattant (ⓘ) dans les cases du tableau (liste, carte agrandie), aussi sur un poste de zone ; aide"
```

### Task 3: vérification Chrome et iPhone

- [ ] **Step 1:** serveur de test (jamais la base vivante, cf. mémoire), Claude in Chrome : planche (pastille, bac, carte
  agrandie), liste (case du tableau, échange toujours au clic), galaxie (pastille d'une carte), poste de Zone ; thème clair et
  sombre ; clic-clic pastille A puis ⓘ de B puis clic dans la bulle → rien ne bouge.
- [ ] **Step 2:** simulateur iOS (idb) : toucher ⓘ ouvre la bulle, lisible, sans débordement ; toucher le nom choisit toujours
  la pastille.
- [ ] **Step 3:** noter dans le résumé ce qui n'a pas pu être vu.
