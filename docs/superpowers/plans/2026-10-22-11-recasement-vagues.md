# Étape 11 : Recasement par vague — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le tableau de bord du recasement traite la vague choisie ; une proposition qui ferait changer un combattant de vague est marquée « change de vague : Matin → Dimanche », jamais pré-approuvée ni appliquée par la validation globale ; validée une à une, elle remet le combattant « non pesé » dans sa nouvelle vague (son poids est gardé).

**Architecture:** l'état du moteur (`State`) connaît les vagues et les choix individuels des catégories ; la vague d'une catégorie s'y calcule comme dans l'app (`waveOfCategory` avec les tranches des combattants d'origine). Chaque proposition porte `waveChange` (vague de départ et d'arrivée) quand elles diffèrent. Le serveur filtre cas et propositions par vague (`?vague=`), la validation globale ne prend que les cas de la vague et saute les changements de vague. L'écran Recasement reprend le choix de vague de la Pesée.

**Tech Stack:** TypeScript (domaine pur `src/domain/replacement`), Fastify, React 19 + Mantine 8, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` §1.5. Hors de cette étape : vague lancée fermée au recasement et réouverture (étapes 12-13, il n'existe pas encore de lancement de vague).

## Global Constraints
- Sans vague : moteur, écran et validations **exactement** comme aujourd'hui (`waveChange` toujours `null`).
- **Vague d'une catégorie** dans le moteur = celle de l'app (choix individuel, sinon règles appliquées aux tranches des combattants non recasés, sinon clé). Nouvelle catégorie proposée (`newKey`) : vague d'après sa clé.
- `Proposal.waveChange: { from: string | null; to: string | null } | null` — non nul quand la vague d'arrivée diffère de celle de départ (`null` = en attente). Une telle proposition : `preApproved = false` ; libellé « ↪ change de vague : <départ> → <arrivée> » (« en attente » pour `null`).
- **Validation globale** (« cas simples » comme « tout ») : seulement les cas de la vague choisie ; jamais une proposition avec `waveChange` (la meilleure proposition **sans** changement de vague est prise si elle existe, sinon le cas reste à traiter).
- **Validation unitaire** d'une proposition avec `waveChange` : permise ; l'inscription déplacée repasse `presence = 'unknown'` (à pointer dans sa nouvelle vague), poids du combattant inchangé ; « Annuler » rétablit aussi sa présence d'avant.
- Avec des vagues, la validation globale sans vague est refusée (400), comme la pesée.
- Compteurs du tableau de bord : ceux de la vague choisie (combattants ayant une inscription dans la vague, présence agrégée dans la vague).
- Aides (`src/web/help.ts`) : recasement par vague, badge de changement de vague.
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **Sans vague** : propositions, validation globale et annulation identiques — suites existantes (domaine, serveur, e2e) inchangées.
- **Seule proposition = changement de vague** : le cas reste dans la liste après la validation globale, sa proposition est affichée et validable à la main — test Task 1.
- **Annuler un changement de vague** : catégorie, vague et présence d'avant rétablies — test Task 2.
- **Catégorie fusionnée par un recasement** : garde la vague d'arrivée (étape 10) aussi dans le moteur — test Task 1.
- **Empreinte** : changer les vagues ou les choix individuels entre l'aperçu et la validation → 409 — test Task 2.

---

### Task 1 : Vagues dans le moteur de recasement

**Files:**
- Modify: `src/domain/replacement/types.ts` (`State.waves: Wave[]` ; `CategoryState.waveOverride: string | null` ; `Proposal.waveChange`), `src/domain/replacement/propose.ts` (calcul de `waveChange`, `preApproved` faux si changement), `src/domain/replacement/apply.ts` (`nextBulkStep(state, mode, moved, waveId?)`, `bulkPlan(state, mode, waveId?)` ; `stateFingerprint` inclut vagues et choix individuels), `src/domain/replacement/index.ts`
- Create: `src/domain/replacement/waves.ts` : `categoryWave(state, cat: CategoryState): string | null`, `keyWave(state, key): string | null`, `memberWave(state, m: Member): string | null`, `casesOfWave(state, cases, waveId: string | null): Case[]` (`waveId` null = tous)
- Modify: `tests/domain/replacement/fixtures.ts` (états avec `waves: []`, `waveOverride: null` par défaut)
- Test: `tests/domain/replacement/waves.test.ts`

- [ ] **Step 1 : tests** (`waves.test.ts`, vagues Matin = poussin…minime, Après-midi = cadet+)
  - `sans vague : waveChange toujours null` (toutes les propositions d'un état existant des fixtures).
  - `proposition vers une catégorie d'une autre vague : waveChange { from: matin, to: aprem }, preApproved faux` (minime seule, cadette proposée en tranche au-dessus ; club en pré-accord).
  - `même vague : waveChange null`.
  - `catégorie d'arrivée fusionnée : garde sa vague` (après application d'un recasement minime → cadets, `categoryWave` des cadets = Après-midi).
  - `validation globale « tout » : pas de changement de vague` (seule proposition = changement de vague → aucune étape, le cas reste ; s'il existe aussi une proposition sans changement, c'est elle qui est prise).
  - `validation globale limitée à la vague` (cas du Matin et de l'Après-midi ; `bulkPlan(state, 'all', aprem)` ne touche que ceux de l'Après-midi).
  - `empreinte : change si une règle de vague change`.
- [ ] **Step 2 :** `npx vitest run tests/domain/replacement` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npx vitest run tests/domain && npm run typecheck` → PASS.
- [ ] **Step 5 : Commit** — `feat(domain): recasement par vague (changement de vague signalé, validation globale limitée)`

---

### Task 2 : Recasement par vague côté serveur

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`loadState` : vagues et `waveOverride` ; `persist` : inscription déplacée vers une autre vague → `presence = 'unknown'`, présence d'avant dans l'instantané d'annulation ; `undo` la rétablit ; `bulkApply(db, id, mode, fingerprint, waveId?)`), `src/server/routes/replacement.ts` (`GET /replacement?vague=` : cas, propositions et compteurs de la vague ; `POST /replacement/bulk` `{ mode, fingerprint, waveId? }`, 400 sans vague quand il y en a ; aperçu de masse `{ bulk, waveId? }` idem)
- Test: `tests/server/replacement.test.ts`

- [ ] **Step 1 : tests** (`describe('recasement par vague')`)
  - `GET ?vague= : cas de la vague seulement ; compteurs de la vague`.
  - `proposition vers une autre vague : marquée, validable à la main ; l'inscription repasse « non pesé » ; le poids reste` (pesée « présent 52 kg » au Matin, application → présence `unknown`, `weighInKg` 52, catégorie dans l'Après-midi ; elle apparaît dans `GET /weigh-in?vague=aprem`).
  - `annuler : catégorie et présence d'avant rétablies`.
  - `validation globale de la vague : changements de vague exclus ; sans vague alors qu'il y en a → 400`.
  - `empreinte : vagues modifiées entre l'aperçu et la validation → 409`.
- [ ] **Step 2 :** `npx vitest run tests/server/replacement.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npx vitest run` → PASS.
- [ ] **Step 5 : Commit** — `feat(server): recasement par vague (filtre, changement de vague validé un par un, présence à repointer)`

---

### Task 3 : Écran Recasement par vague

**Files:**
- Create: `src/web/useSelectedWave.ts` (hook déplacé depuis `WeighInPage.tsx` : vague de l'adresse `?vague=`, sinon première non clôturée, écrite dans l'adresse ; `ready`)
- Modify: `src/web/pages/WeighInPage.tsx` (utilise le hook partagé), `src/web/pages/ReplacementPage.tsx` (choix de la vague en tête comme la Pesée ; cas, propositions, compteurs et validations de la vague ; badge « ↪ change de vague : Matin → Dimanche » sur les propositions concernées ; sous les boutons de validation globale : « Les changements de vague se valident un par un. »), `src/web/components/ReplacementBadge.tsx` (si besoin pour le badge), `src/web/api.ts` (`useReplacement(id, waveId)`, bulk avec `waveId`), `src/web/help.ts` (`recasement` : vagues et changement de vague), `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (11 ✅)
- Test: `tests/e2e/vagues.spec.ts`

- [ ] **Step 1 : test e2e** — vagues Matin / Après-midi, une minime seule (Matin) dont la seule proposition est la catégorie cadette (Après-midi) et un cas simple dans l'Après-midi : Recasement › Après-midi → seul le cas de l'Après-midi ; « Classer automatiquement tous les cas simples » le résout ; Recasement › Matin → le cas de la minime, sa proposition porte « change de vague : Matin → Après-midi » ; « Tout classer automatiquement » ne la valide pas ; validation unitaire → Pesée › Après-midi : la minime y apparaît « non pesée » avec son poids.
- [ ] **Step 2 :** `npx playwright test tests/e2e/vagues.spec.ts` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5 :** bilan et feuille de route ; commit — `feat(web): recasement par vague ; bilan de l'étape 11`
