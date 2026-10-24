# Refonte de l'interface (UI et UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** donner à toute l'app (rôle local et serveur en ligne) le style « B » en sombre et en clair, une navigation par étapes, et des écrans sans défauts, sans changer aucune fonction.

**Architecture:** les fondations d'abord : jetons de couleur des deux thèmes injectés par Mantine (`cssVariablesResolver`), police embarquée, valeurs par défaut des composants, quelques composants communs (`src/web/components/ui/`), un module pur pour les étapes et un pour les pluriels. Puis le cadre (barre de l'app, barre compacte d'une compétition, onglets par étape), puis les écrans groupe par groupe. Tout se fait sur une branche fusionnée une seule fois, quand tout est vérifié.

**Tech Stack:** React 19, Mantine 8 (+ `@mantine/dates`, `dayjs`), `@fontsource-variable/inter`, TypeScript, Vitest, Playwright (Chrome), Claude in Chrome pour la revue visuelle.

**Spec:** `docs/superpowers/specs/2026-10-24-refonte-ui-ux-design.md`

## Global Constraints
- Prête pour le 22 novembre 2026 : terminée, vérifiée et fusionnée **avant la répétition générale des 20-21 novembre** ; branche `refonte-ui`, fusionnée dans `main` seulement quand **tous** les écrans sont refaits (une fusion publie une version et une image Docker).
- Hors ligne : aucune ressource chargée depuis internet (police, icônes, images) ; police Inter embarquée par npm.
- Mantine 8 reste ; paquets officiels Mantine permis.
- Adresses inchangées (`/competitions/:id/<onglet>`, `/parametres`, `/annuaire`, `/comptes`, `/inscription/:jeton`, `/competitions/:id/impression…`).
- `data-testid` existants gardés ; un parcours e2e qui cherche un élément déplacé est mis à jour, jamais supprimé ; `npm run typecheck && npm test && npm run test:e2e` verts à la fin de chaque tâche.
- Postes (Organisation, Table centrale, Zone), comptes (Organisateur, Table, Zone) et zone autonome : mêmes droits et même contenu visible qu'avant.
- Feuilles imprimées (`PrintPage`, `print.css`, impressions de pesée, de podiums, fiche club PDF/ODS) : allure inchangée.
- Couleurs uniquement par les jetons du §4.1 de la conception (variables CSS `--sk-*`), aucune couleur écrite en dur dans un écran.
- Français, typographie française, vrais pluriels : plus aucun « (s) » dans un texte affiché (écran, messages du serveur).
- Écrans revus dans Chrome, sombre et clair, à 1440 et 1280 px (et 1024 px) ; Combats avec 1, 2, 3 et 4 zones.
- Étapes : **Préparer** = inscriptions, clubs, fiche-club, import-ffk, sessions, grille, reglages ; **Jour J** = pesee, reaffectation, tableaux, combats ; **Après** = podiums.

## Review Focus
- **Petit portable (1024 px) et noms longs** (compétition « Démo — Coupe Shidokan (24/10/2026 01:53) », club « Arts Martiaux du Cap (démo) », zone « Tatami principal du gymnase ») : rien ne passe à la ligne de travers ni ne déborde ; texte trop long coupé proprement (points de suspension, nom complet au survol). Vérifié au Task 10 avec une compétition aux noms longs.
- **Postes et comptes** : le poste Zone ne voit que Jour J → Tableaux, Combats (sans barre d'étapes) ; Table centrale : Préparer (Inscriptions, Clubs), Jour J, Après. Test `stages.test.ts` (Task 2) et `roles.spec.ts` (e2e).
- **Bandeaux de la main** (copie du serveur, secours, copie du PC principal, zone autonome) toujours visibles dans la nouvelle barre. e2e existants sur `management-banner` et `zone-autonomy-bar` (Task 2, Task 7).
- **Compétition neuve, sans données** : chaque écran a un état vide qui dit quoi faire, jamais une page blanche. Vérifié au Task 10 sur une compétition vide.
- **Contraste des deux thèmes** : texte courant ≥ 4,5:1 sur ses fonds. Test `theme.test.ts` (Task 1).

---

### Task 1: Fondations — jetons, police, composants par défaut, pluriels

**Files:**
- Modify: `src/web/theme.ts`, `src/web/main.tsx`, `package.json`
- Create: `src/domain/plural.ts`, `src/web/components/ui/PageHeader.tsx`, `src/web/components/ui/SectionCard.tsx`, `src/web/components/ui/EmptyState.tsx`, `src/web/components/ui/StatusBadge.tsx`
- Test: `tests/web/theme.test.ts`, `tests/domain/plural.test.ts`

**Interfaces:**
- Produces:
  - `TOKENS: Record<'dark' | 'light', Record<TokenName, string>>` et `cssVariablesResolver` dans `theme.ts` ; `TokenName` = `bg, bar, line, card, cardLine, row, text, soft, muted, accent, onAccent, hero, heroText, heroSub, chip, chipText, ok, okText, warn, warnText` → variables `--sk-bg`, `--sk-bar`, … (valeurs exactes du tableau §4.1 de la conception ; `row`, ligne alternée des tableaux, pris des maquettes : `#1a1620` sombre, `#faf8fb` clair) ; Mantine `--mantine-color-body` = `bg`, texte = `text`.
  - `plural(n: number, one: string, many?: string): string` → `"0 présent"`, `"1 présent"`, `"3 présents"` (0 et 1 au singulier, `many` par défaut = `one + 's'`, nombre formaté `fr-FR`).
  - `<PageHeader title summary? help? actions? />`, `<SectionCard title help? actions? children />`, `<EmptyState title text action? />`, `<StatusBadge tone: 'ok' | 'warn' | 'accent' | 'neutral' | 'danger' children />`.

- [ ] **Step 1: tests** — `theme.test.ts` : `les deux thèmes ont les mêmes jetons` (mêmes clés, aucune vide) ; `contraste : text, soft sur bg et card ≥ 4,5:1 ; onAccent sur accent ≥ 4,5:1 ; okText/ok, warnText/warn ≥ 4,5:1` (calcul de luminance relative WCAG dans le test, sur les deux thèmes) ; `valeurs de la conception` (`TOKENS.dark.bg === '#141118'`, `TOKENS.light.accent === '#722f82'`). `plural.test.ts` : `0 et 1 au singulier, au-delà au pluriel ; pluriel irrégulier` (`plural(2, 'cas', 'cas') === '2 cas'`, `plural(1200, 'inscription') === '1 200 inscriptions'`).
- [ ] **Step 2:** `npx vitest run tests/web/theme.test.ts tests/domain/plural.test.ts` → FAIL (modules absents).
- [ ] **Step 3:** implémenter : jetons et `cssVariablesResolver` passés au `MantineProvider` ; `npm i @fontsource-variable/inter` et import dans `main.tsx`, `fontFamily: 'Inter Variable, system-ui, …'`, `fontFeatureSettings` tabulaires pour `.num` ; palette `shidokan` recalculée autour de `#722f82` / `#c17ad3` (`primaryShade` clair 6, sombre ≈ `#c17ad3`) ; valeurs par défaut : `Badge` (`tt="none"`, taille lisible, `variant="light"`), `Card`/`Paper` (bord `--sk-card-line`, fond `--sk-card`, rayon 12), `Table` (survol, alternance `--sk-row`), `Button` (rayon 8), `Tabs` (soulignement `--sk-accent`). Composants `ui/` selon les Interfaces (SectionCard remplace les `Fieldset`).
- [ ] **Step 4:** les deux tests PASS ; `npm run typecheck` ; `npm test`.
- [ ] **Step 5:** contrôle Chrome (app de démo, §Verification du Task 10) : l'app entière prend les nouveaux fonds et la police, rien de cassé ; commit `feat(interface): fondations du nouveau style (jetons, police, composants)`.

### Task 2: Cadre — barre de l'application, barre de compétition, onglets par étape

**Files:**
- Create: `src/web/stages.ts`, `src/web/components/CompetitionBar.tsx`, `src/web/components/UserMenu.tsx`
- Modify: `src/web/components/AppHeader.tsx`, `src/web/components/ThemeToggle.tsx`, `src/web/components/CompetitionLayout.tsx`, `src/web/components/SyncPanel.tsx` (`ManagementBanner` en puce), `src/web/components/ZoneAutonomyBar.tsx` (place sous les onglets), `src/web/App.tsx`
- Modify (e2e): `tests/e2e/helpers.ts` (+ `openTab`), `tests/e2e/socle.spec.ts`, `roles.spec.ts`, `figeage.spec.ts`, `ordre-de-passage.spec.ts`, `inscriptions.spec.ts`, et tout spec qui clique `nav-*`, `logout`, `theme-toggle` ou un onglet d'une autre étape
- Test: `tests/web/stages.test.ts`

**Interfaces:**
- Consumes: `posteTabs(poste)` (`src/web/poste.ts`), `COMPETITION_TABS` (`src/web/tabs.ts`).
- Produces:
  - `type StageId = 'preparer' | 'jour-j' | 'apres'` ; `STAGES: { id: StageId; label: 'Préparer' | 'Jour J' | 'Après'; tabs: string[] }[]` (Global Constraints) ; `stageOf(tab: string): StageId` ; `visibleStages(poste: Poste): { id: StageId; label: string; tabs: string[] }[]` (onglets permis seulement, étapes vides retirées) ; `rememberTab(competitionId, tab)` / `lastTab(competitionId, stage): string | null` (localStorage, protégé par try/catch).
  - `data-testid` nouveaux : `stage-preparer`, `stage-jour-j`, `stage-apres`, `user-menu` ; `theme-toggle` reste sur le bouton du thème (menu Auto, Clair, Sombre) ; `nav-directory`, `nav-settings`, `nav-accounts`, `nav-password`, `logout` restent sur les entrées (dans le menu du compte si elles y sont rangées).
  - e2e : `openTab(page: Page, label: string): Promise<void>` (clique l'étape qui contient l'onglet si besoin, puis l'onglet).

- [ ] **Step 1: tests** `stages.test.ts` : `chaque onglet a une étape, dans l'ordre des onglets` ; `stageOf('combats') === 'jour-j'`, `stageOf('reglages') === 'preparer'` ; `poste Zone : une seule étape, Jour J → tableaux, combats` ; `Table centrale : Préparer → inscriptions, clubs ; Jour J → les quatre ; Après → podiums` ; `Organisation : tout` ; `lastTab : null au départ, puis le dernier onglet retenu de l'étape ; stockage indisponible → null sans erreur`.
- [ ] **Step 2:** `npx vitest run tests/web/stages.test.ts` → FAIL.
- [ ] **Step 3:** implémenter `stages.ts` ; barre de l'app sur une ligne (logo + « Shidokan France », liens Compétitions, Annuaire, Réglages, Comptes ; `UserMenu` : e-mail, Mon mot de passe / Comptes, Se déconnecter ; thème en bouton icône avec menu) ; sur les écrans d'une compétition, `CompetitionBar` remplace la barre de l'app et l'en-tête : logo (lien vers `/`), nom (date · lieu en discret, nom tronqué avec `title`), étapes (`visibleStages`, cachées s'il n'y en a qu'une), puce de la main, poste compact (`poste-select` / `poste-account`), menu du compte ; dessous les onglets de l'étape (`role="tab"` conservé), l'aide, puis les bandeaux (`management-banner` quand il n'est pas « Gérée ici », `zone-autonomy-bar`, alertes) ; clic sur une étape → `lastTab` sinon son premier onglet.
- [ ] **Step 4:** `stages.test.ts` PASS ; mettre à jour les e2e (helper `openTab`, menus) ; `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5:** contrôle Chrome à 1440, 1280, 1024 px, deux thèmes, PC et serveur connecté, postes Organisation / Table / Zone : rien de coupé ; commit `feat(interface): barre compacte et onglets par étape`.

### Task 3: Accueil, connexion, annuaire, comptes, réglages de l'application

**Files:**
- Modify: `src/web/pages/CompetitionsPage.tsx`, `LoginPage.tsx`, `DirectoryPage.tsx`, `AccountsPage.tsx`, `AppSettingsPage.tsx`, `src/web/components/ZoneLinkCard.tsx`, `MirrorPanels.tsx`, `SyncPanel.tsx` (cartes des réglages de synchronisation), `DayChecklist.tsx`, `src/server/app.ts` (`GET /api/competitions`), `src/web/api.ts`
- Test: `tests/server/api.test.ts` (compléter)

**Interfaces:**
- Produces: `GET /api/competitions` renvoie en plus, pour chaque compétition, `registrationCount: number` et `management: { managedHere: boolean; ownerName: string | null }` (lecture seule ; la liste d'un compte Zone reste filtrée).

- [ ] **Step 1: test** `liste des compétitions : nombre d'inscrits et état de la main` (2 inscriptions → `registrationCount: 2`, `management: { managedHere: true, ownerName: null }` ; après import d'une copie en lecture seule → `managedHere: false` et le nom).
- [ ] **Step 2:** `npx vitest run tests/server/api.test.ts` → FAIL.
- [ ] **Step 3:** implémenter le champ côté serveur ; écrans avec `PageHeader`, `SectionCard`, `EmptyState` : accueil (liste avec date, lieu, inscrits, puce de la main ; « Nouvelle compétition » principal, import à côté ; état vide), connexion (logo et nom en grand), annuaire et comptes (tableaux §4.3, actions de ligne à droite), réglages de l'application en sections.
- [ ] **Step 4:** test PASS ; `npm run typecheck && npm test && npm run test:e2e`.
- [ ] **Step 5:** contrôle Chrome (deux thèmes, deux largeurs, deux rôles) ; commit `feat(interface): accueil, connexion, annuaire, comptes et réglages`.

### Task 4: Préparer — inscriptions, clubs, fiche club, import FFK

**Files:**
- Modify: `src/web/pages/RegistrationsPage.tsx`, `ClubsPage.tsx`, `ClubFormPage.tsx`, `FfkImportPage.tsx`, `src/web/components/RegistrationForm.tsx`, `OnlineEntryPanel.tsx`, `InvitationMail.tsx`, `PaperEntryTable.tsx`, `ClubFormPreviewTable.tsx`, `ClubLineForm.tsx`, `package.json` (`@mantine/dates`, `dayjs`)

- [ ] **Step 1:** Inscriptions : `PageHeader` « N inscriptions » + résumé (clubs, catégories), filtres sur une ligne, « Ajouter » principal, origine en `StatusBadge`, actions de ligne discrètes, état vide.
- [ ] **Step 2:** Clubs : plus de champ dans chaque case — ligne lisible, modification au clic (édition en ligne ou fenêtre, au choix), pré-accord modifiable d'un clic ; mêmes `data-testid`.
- [ ] **Step 3:** Fiche club : trois `SectionCard` (inscriptions en ligne ; envoyer le modèle ; importer ou saisir) ; date limite avec `DateInput` de `@mantine/dates` en français (`dayjs/locale/fr`, format `JJ/MM/AAAA`), même valeur envoyée au serveur (`AAAA-MM-JJ`) ; Import FFK en sections.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run test:e2e` → PASS (`inscriptions.spec.ts`, `inscription-en-ligne.spec.ts`, `import-ffk.spec.ts` inclus).
- [ ] **Step 5:** contrôle Chrome ; commit `feat(interface): inscriptions, clubs, fiche club et import FFK`.

### Task 5: Préparer — sessions, grille, réglages de la compétition

**Files:**
- Modify: `src/web/pages/WavesPage.tsx`, `GridEditorPage.tsx`, `CompetitionSettingsPage.tsx`, `src/web/components/Help.tsx` (`SectionHeader` dans le nouveau style)

- [ ] **Step 1:** Réglages de la compétition : `SectionCard` sur toute la largeur utile (plus de `Fieldset`), deux colonnes quand la place le permet, sommaire des sections en haut (ancres).
- [ ] **Step 2:** Grille : tableau éditable propre (même règle que Clubs) ; Sessions : cartes de session et liste « En attente » aérées.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run test:e2e` → PASS (`vagues.spec.ts`, `aides.spec.ts` inclus).
- [ ] **Step 4:** contrôle Chrome ; commit `feat(interface): sessions, grille et réglages de la compétition`.

### Task 6: Jour J — pesée, réaffectation, tableaux

**Files:**
- Modify: `src/web/pages/WeighInPage.tsx`, `ReplacementPage.tsx`, `BracketsPage.tsx`, `src/web/components/BracketView.tsx`, `src/web/bracket.css` (écran seulement, pas `print.css`), `ProposalPreview.tsx`, `ReplacementBadge.tsx`

- [ ] **Step 1:** Pesée : recherche et compteurs (`plural`) en haut, champ poids en grands caractères, présence en contrôle segmenté net, actions de feuilles regroupées.
- [ ] **Step 2:** Réaffectation : compteurs et cartes de cas dans le nouveau style, « Valider » constant.
- [ ] **Step 3:** Tableaux : liste à gauche (filtre, badges lisibles), barre d'actions de la catégorie (format, repêchage, 3e place, tirage, prête, imprimer) ; `bracket.css` passe aux jetons `--sk-*` à l'écran, l'impression ne change pas.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run test:e2e` → PASS (`recasement.spec.ts`, `tableaux.spec.ts`, `jour-j.spec.ts` inclus).
- [ ] **Step 5:** contrôle Chrome (et aperçu avant impression d'un tableau inchangé) ; commit `feat(interface): pesée, réaffectation et tableaux`.

### Task 7: Jour J — Combats

**Files:**
- Create: `src/web/components/ZoneQueueCard.tsx`, `src/web/components/CategoryZoneBadge.tsx`
- Modify: `src/web/pages/MatchesPage.tsx`, `src/web/components/WaveLaunchPanel.tsx`, `ResultDialog.tsx`, `KataScoring.tsx`, `TieBreakDialog.tsx`, `MoveDialog.tsx`, `ZoneCards.tsx`, `ZonesImpossibleAlert.tsx`

**Interfaces:**
- Consumes: `QueueItem` et `schedule` (`src/web/api.ts`), inchangés.
- Produces: `<ZoneQueueCard zone queue waitingOtherZones held… onEnter(item) onScore(item) />` ; `<CategoryZoneBadge category zones onPick(zoneId) />` (un clic : menu des zones ; catégorie figée → `MoveDialog` comme aujourd'hui).

- [ ] **Step 1:** `ZoneQueueCard` : premier passage de la file en « À l'appel » (`--sk-hero`, grand numéro, deux noms, catégorie, « Saisir le résultat » ou « Noter ») ; suivants en liste compacte, chacun avec son bouton plus discret ; passage `held` à sa place, badge « En attente d'une décision à la table centrale », sans bouton ; `waitingOtherZones` en zone autonome ; mêmes `data-testid` (`zone-card`, `next-match`, `next-kata`, `no-rest`, `queue-held`, `waiting-other-zones`).
- [ ] **Step 2:** grille des zones : 1 à 4 cartes côte à côte sans texte coupé à 1280 px (largeur mini de carte, la liste des catégories se replie quand la place manque) ; une seule zone ne s'étire pas sur toute la largeur.
- [ ] **Step 3:** liste des catégories : zone en `CategoryZoneBadge` (`schedule-zone` gardé), champ ordre (`schedule-order`) déplacé dans le panneau de la catégorie choisie ; barre de session (état + « Figer et imprimer ») en haut ; fenêtres de saisie (résultat, kata, départage, déplacement), cartes « À trancher » et bandeau de zone autonome dans le nouveau style, noms lisibles dans la saisie d'un résultat.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run test:e2e` → PASS (`figeage`, `ordre-de-passage`, `deplacements`, `jour-j`, `plusieurs-postes`, `zones-autonomes`, `roles` inclus).
- [ ] **Step 5:** contrôle Chrome avec 1, 2, 3 et 4 zones (régler les zones de la démo), deux thèmes, 1280 et 1440 px, poste Zone ; commit `feat(interface): écran Combats du jour J`.

### Task 8: Après — podiums ; page publique des clubs

**Files:**
- Modify: `src/web/pages/PodiumsPage.tsx`, `src/web/pages/ClubEntryPage.tsx`
- Test: `tests/web/podiums.test.ts`

**Interfaces:**
- Produces: `podiumState(c: { complete: boolean; status: 'not_started' | 'started' | 'finished' }): 'À disputer' | 'En cours' | 'Terminée'` (exporté de `PodiumsPage.tsx` ou d'un petit module voisin).

- [ ] **Step 1: test** `podiumState : jamais commencée → À disputer ; commencée → En cours ; podium complet → Terminée`.
- [ ] **Step 2:** `npx vitest run tests/web/podiums.test.ts` → FAIL.
- [ ] **Step 3:** implémenter ; exports regroupés de façon homogène (boutons ou menu « Exporter », `export-results-xlsx` et `export-podiums-xlsx` gardés) ; sauvegardes en section ; page publique d'un club dans la même identité (logo, police, couleurs, thèmes), toujours utilisable sur téléphone (400 px).
- [ ] **Step 4:** test PASS ; `npm run typecheck && npm test && npm run test:e2e`.
- [ ] **Step 5:** contrôle Chrome (page publique aussi à 400 px) ; commit `feat(interface): podiums et page des clubs`.

### Task 9: Textes — vrais pluriels partout

**Files:**
- Modify: chaque fichier qui affiche « (s) » (`src/web/pages/*`, `src/web/components/*`, `src/server/repositories/competitions.ts`, `src/server/repositories/categories.ts`, `src/domain/api-schemas.ts`, et ceux que le test trouve), `src/web/help.ts` (seulement les textes qui citent un bouton ou un onglet déplacé)
- Test: `tests/web/textes.test.ts`

- [ ] **Step 1: test** `aucun « (s) » dans un texte` : parcourt `src/web`, `src/server`, `src/domain` (fichiers `.ts`/`.tsx`) et échoue sur toute ligne qui contient une lettre suivie de `(s)` (`/\p{L}\(s\)/u`), hors lignes de commentaire (`//`, `*`).
- [ ] **Step 2:** `npx vitest run tests/web/textes.test.ts` → FAIL (liste des fichiers et lignes).
- [ ] **Step 3:** remplacer par `plural()` ou une tournure sans pluriel ; adapter les tests serveur qui comparent ces messages.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5:** commit `fix(interface): vrais pluriels dans tous les textes`.

### Task 10: Vérification complète et documents

**Files:**
- Modify: ce que la revue trouve ; `docs/superpowers/specs/2026-10-24-refonte-ui-ux-design.md` (*construit*, écarts), `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (ligne 22), `docs/superpowers/plans/2026-10-21-99-bilan.md`

- [ ] **Step 1:** préparer trois jeux dans un dossier temporaire (jamais `data/shidokan.sqlite`) : la démo (`DATABASE_PATH=<tmp> npm run seed:dev`), une compétition vide, une compétition aux noms longs (Review Focus) ; lancer un PC (rôle local) et un serveur (rôle serveur, compte créé par `dist/server/cli.js add-user`).
- [ ] **Step 2:** revue Chrome de chaque page et fenêtre : sombre et clair, 1440, 1280, 1024 px, PC et serveur connecté, postes Organisation / Table / Zone, portable de zone (copie du PC principal et zone autonome), Combats avec 1 à 4 zones ; cocher chaque défaut du §1 de la conception ; corriger ce qui reste.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 4:** documents ; commit `docs: étape 22 — refonte de l'interface`.
