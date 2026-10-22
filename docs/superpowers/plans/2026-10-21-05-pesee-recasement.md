# Étape 5 : Pesée et recasement — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** saisir la pesée (présence, poids réel), détecter les combattants à recaser, **proposer des solutions classées** (types A à H et R, spec §9), les montrer avec un **aperçu** des tableaux, et les appliquer **uniquement après validation**, une par une ou en masse. Les recasements validés sont signalés partout par des badges (spec §10), et le recasement anticipé reste possible avant le jour J.

**Architecture :**
- `src/domain/replacement/` : moteur **pur**.
  - `buildState` décrit la compétition : catégories, inscriptions, combattants, réglages, grille.
  - `detectCases` trouve les cas : seul, poids hors catégorie, écart de poids trop grand, retour possible.
  - `proposalsFor` génère et classe les propositions.
  - `applyProposal` applique une proposition à un état **en mémoire**. Il sert à l'aperçu, à l'application en masse et aux tests.
  - `bulkPlan` enchaîne : meilleure proposition du premier cas, nouvel état, nouveau calcul, et ainsi de suite.
- Le serveur charge l'état, appelle le moteur et **persiste** une proposition validée (inscription, catégorie cible, journal). Les identifiants de proposition sont **déterministes**, et une empreinte protège la validation en masse.
- L'interface ajoute deux onglets : « Pesée » et « Recasement » (tableau de bord).

**Spec :** §2 (aucun déplacement sans validation humaine), §8 (pesée), §9 (recasement : déclencheurs, paramètres, types, ordre, contraintes), §10 (tableau de bord, badges, boutons), §11.3 (catégories lancées verrouillées).

## Global Constraints

- **Rien n'est déplacé sans validation humaine** (spec §2). Le bouton global applique quand même les cas manuels (spec §10) **après confirmation**.
- **Types** et validation (spec §9.3) :
  - A : catégorie de poids voisine, même âge, écart ≤ seuil (y compris la correction d'un poids hors catégorie) → **simple** ;
  - B : poids voisin, écart > seuil → manuel ;
  - C : une tranche d'âge au-dessus → manuel ;
  - D : seniors ↔ vétérans (si `mixSeniorsVeterans`) → manuel ;
  - E : mineurs ↔ adultes (si `mixMinorsAdults`) → manuel ;
  - F : filles ↔ garçons (si `mixSexes.enabled` et tranche dans `ageBandCodes`) → manuel ;
  - G : shobu → jiyu → manuel ;
  - H : autre discipline selon les préférences → manuel ;
  - R : retour dans la catégorie d'origine → **simple**.
- **Ordre** : R, A, B, C/D, puis G et H (G d'abord si `acceptsJiyuFirst`, sinon H d'abord ; H suit l'ordre des préférences), puis E, puis F.
- **Contraintes absolues** (jamais proposées) :
  - shobu pour un mineur ;
  - jiyu → shobu ;
  - plus d'une tranche d'âge (`ageMove` ≠ C ou D) ;
  - une discipline absente des préférences ;
  - une option désactivée ;
  - une catégorie cible `started` ou `finished` ;
  - le kata et le triathlon dans H.
- **Écart de poids** d'une catégorie = poids max − poids min de ses membres. Le poids d'un membre est, dans l'ordre :
  1. le poids de pesée ;
  2. sinon le poids approximatif ;
  3. sinon la limite de sa catégorie ;
  4. pour une catégorie ouverte, la limite précédente.

  Le seuil est celui des enfants si au moins un membre est mineur, sinon celui des adultes.
- **Pré-accord** : si le club du combattant déplacé a `preApproval`, les propositions B et C portent la mention « pré-accord coach ».
- **Badges** (spec §10) : couleur + icône + texte, 5 couleurs au maximum, remplissage selon l'état (contour = proposé, plein = validé). Ils restent **à l'écran** ; les impressions n'en montrent aucun.
- Tolérance de pesée : `settings.weighInToleranceKg` (300 g pour les hommes, 500 g pour les femmes).

## Review Focus

1. **Recalcul après chaque validation** : valider la fusion de deux combattants seuls résout les **deux** cas. Le bouton global ne propose jamais deux fois le même combattant. Test en Task 3.
2. **Retour (R)** : un combattant recasé revient dans sa catégorie d'origine quand un adversaire y apparaît (inscription sur place, autre recasement), mais **jamais** si sa catégorie actuelle est lancée. Tests en Tasks 2 et 4.
3. **Absents** : un absent sort des tableaux non lancés, ce qui peut rendre seul son adversaire (nouveau cas). Un absent n'est jamais proposé comme cible ni comme combattant à déplacer. Test en Task 4.
4. **Contraintes absolues** : un mineur n'est jamais proposé en shobu, aucun saut de deux tranches, aucune discipline hors préférences, aucune catégorie lancée. Tests de propriété sur toutes les propositions d'un état généré, en Task 2.
5. **Annulation** d'une validation : remet l'inscription dans son état d'avant ; refusée si la catégorie est lancée. Test en Task 4.

---

## Structure des fichiers

```
src/domain/replacement/types.ts      State, Member, CaseKind, Proposal, ProposalType, BulkMode
src/domain/replacement/weights.ts    effectiveWeight, categoryWeightGap, weighInClass
src/domain/replacement/detect.ts     detectCases
src/domain/replacement/propose.ts    proposalsFor, rankProposals
src/domain/replacement/apply.ts      applyProposal, bulkPlan, stateFingerprint
src/domain/replacement/index.ts      réexports + PROPOSAL_TYPES (libellés, icônes, couleurs, simple/manuel)
src/server/db/schema.ts              fighters.presence, fighters.weigh_in_kg ; registrations.original_json, recasement_type ; categories.alias_keys ; recasements (journal) ; refusals
src/server/repositories/replacement.ts   loadState, applyAndPersist, undo, refuse, weigh-in
src/server/routes/replacement.ts
src/web/pages/WeighInPage.tsx, ReplacementPage.tsx ; src/web/components/ReplacementBadge.tsx, ProposalPreview.tsx
tests/domain/replacement/*.test.ts, tests/server/replacement.test.ts, tests/e2e/recasement.spec.ts
```

---

### Task 1 : Domaine — état, poids effectifs, pesée

**Files :** `src/domain/replacement/types.ts`, `weights.ts`, `index.ts` ; tests `tests/domain/replacement/weights.test.ts`, `tests/domain/replacement/fixtures.ts`

**Interfaces :**

```ts
export type Presence = 'unknown' | 'present' | 'absent';
export interface Member {                // une inscription active, avec ce qu'il faut pour décider
  registrationId: string; fighterId: string; clubId: string | null; clubPreApproval: boolean; label: string;
  sex: Sex; ageBandCode: string; discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null;
  weighInKg: number | null; approxWeightKg: number | null; presence: Presence;
  otherDisciplines: DisciplineId[]; acceptsJiyuFirst: boolean | null;
  categoryId: string | null; placementLocked: boolean;
  original: { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null } | null; // avant le 1er recasement
  recasementType: ProposalType | null;
}
export interface CategoryState { id: string; key: CategoryKey; status: CategoryStatus; aliasKeys: string[] }
export interface State { grid: CategoryGrid; settings: CompetitionSettings; categories: CategoryState[]; members: Member[]; refused: string[] } // refused : ids de propositions refusées
export function effectiveWeight(m: Member, grid: CategoryGrid): number | null; // pesée > approx > limite (ouverte : limite précédente) ; kata → null
export function categoryWeightGap(members: Member[], grid: CategoryGrid): number; // max − min des poids effectifs (0 si < 2)
export function gapThreshold(members: Member[], state: State): number;          // enfants si au moins un mineur
export function weighInClass(m: Member, state: State): WeightClass | null;      // catégorie du poids pesé (tolérance du sexe), null si pas pesé ou kata
export function activeMembers(state: State, categoryId: string): Member[];      // absents exclus
```

- [ ] **Step 1 : Fixtures.** `fixtures.ts` : `makeState(partial)` et `member(over)`, sur la grille FFK et les réglages par défaut.
- [ ] **Step 2 : Tests.**
  - Poids effectif : pesée 55,2, sinon approx 54, sinon limite 54 ; catégorie ouverte cadettes `+61` → 61 ; kata → null.
  - Écart : membres 50, 54, 55,2 → 5,2. Seuil : enfants si un cadet, adultes si seulement des seniors (régler enfants 4 et adultes 6 pour distinguer).
  - `weighInClass` : senior M pesé 67,3 avec une tolérance de 0,3 → `-67` ; 67,31 → `-75` ; senior F pesée 55,5 → `-55` ; non pesé → null.
  - `activeMembers` exclut les absents.
- [ ] **Step 3 : Lancer** → échec. **Step 4 : Implémenter.** **Step 5 : Lancer** → réussite.
- [ ] **Step 6 : Commit** `feat(domain): état du recasement, poids effectifs et pesée`

---

### Task 2 : Domaine — détection des cas et propositions

**Files :** `src/domain/replacement/detect.ts`, `propose.ts` ; tests `tests/domain/replacement/detect.test.ts`, `propose.test.ts`

**Interfaces :**

```ts
export type CaseKind = 'alone' | 'weight_out' | 'weight_gap' | 'return';
export interface Case { id: string; kind: CaseKind; registrationId: string; categoryId: string | null; detail: string } // id = `${kind}:${registrationId}`
export type ProposalType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'R';
export interface Proposal {
  id: string;                         // déterministe : `${type}:${registrationId}>${cible}`
  caseId: string; type: ProposalType; registrationId: string;
  target: { categoryId: string } | { newKey: CategoryKey };   // catégorie existante (dont la clé s'élargit) ou nouvelle
  changes: { discipline?: DisciplineId; ruleset?: Ruleset; weightClassId?: string };  // H, G, correction de poids
  checks: { weightGapKg: number; threshold: number; ageMove: 'same' | 'C' | 'D'; crossesMinorAdult: boolean; mixedSex: boolean };
  manual: boolean; preApproved: boolean; reason: string;       // libellé FR (« Seule en Cadettes -47 → Cadettes -54 (écart 4,5 kg) »)
  rank: number;
}
export function detectCases(state: State): Case[];
export function proposalsFor(state: State, c: Case): Proposal[];  // classées, sans les refusées
```

  Règles :
  - **Cas** :
    - `alone` : inscription présente ou non encore pesée, seule active dans sa catégorie, catégorie non lancée ;
    - `weight_out` : pesée dont `weighInClass` diffère de `weightClassId`, inscription non verrouillée ;
    - `weight_gap` : catégorie non lancée dont l'écart dépasse le seuil (le cas porte sur le membre le plus éloigné de la médiane) ;
    - `return` : inscription `placementLocked` dont la catégorie **naturelle** (d'après `original`) existe, contient au moins un membre actif autre qu'elle, et dont la catégorie actuelle n'est pas lancée.
  - **Propositions** pour `alone` et `weight_gap` : déplacer l'inscription vers une catégorie cible existante qui a au moins un membre actif, n'est pas lancée, et est compatible :
    - même discipline (sauf H) ;
    - règlement identique (sauf G) ;
    - même sexe (sauf F, mixte → `sex: 'X'`) ;
    - tranche d'âge identique (sinon C, D ou E selon `ageMove` et les réglages) ;
    - catégorie de poids identique ou **voisine** (adjacente dans la grille) d'au moins une des catégories de la cible. Le type est A si l'écart après fusion est ≤ seuil, sinon B.

    Le type retenu est le plus « fort » des critères : F > E > H > G > C/D > B > A. Les `checks` détaillent tout.
  - `weight_out` → **une** proposition A, `changes.weightClassId`, vers la catégorie naturelle correspondante (existante, ou `newKey`).
  - `return` → R vers la catégorie naturelle, avec `changes` = valeurs d'origine.
  - Classement : par type (ordre global), puis cible contenant **un seul** membre d'abord (une fusion résout deux cas), puis écart croissant, puis libellé.

- [ ] **Step 1 : Tests.**
  - **Seule, voisine dans l'écart** : cadette -47 seule ; cadette -54 seule ; poids approx 46 et 50 → proposition A de -47 vers -54 (écart 4 ≤ 5), cible à un seul membre en premier.
  - **B** : écart 7 → B.
  - **C** : minime -45 seule ; une cadette -47 existe (`ageMove` minime→cadet = C) → C. Junior → senior : proposé **seulement** si `mixMinorsAdults` (E). Senior ↔ V1 : D seulement si `mixSeniorsVeterans`.
  - **F** : sans réglage, rien ; avec `mixSexes` sur `cadet` → F vers un cadet M de -52, clé mixte.
  - **G** : senior shobu seul, catégorie jiyu senior de même poids → G ; ordre G avant H si `acceptsJiyuFirst`, sinon H avant G.
  - **H** : préférences `['shido-mix', 'shido-boxing']` → H vers shido-mix avant shido-boxing ; discipline hors préférences jamais proposée.
  - **Kata seul** : pas de H, pas de G ; propositions d'âge seulement (C), pas de poids.
  - **Contraintes (propriété)** : sur un état de 40 inscriptions générées au hasard (graine fixe), aucune proposition n'a :
    - un mineur en shobu ;
    - un passage de jiyu à shobu ;
    - un saut de deux tranches ;
    - une discipline hors préférences ;
    - une cible lancée ;
    - un membre absent, ni comme combattant déplacé ni comme seul membre de la cible.
  - **Pré-accord** : B et C portent `preApproved` si le club a coché la case ; A non (inutile).
  - **weight_out** : pesée 58 en cadette -54 → A, `changes.weightClassId = 'cadet:F:-61'`.
  - **return** : inscription recasée (`placementLocked`, `original` -47) ; un nouveau membre -47 apparaît → R. Si sa catégorie actuelle est lancée → pas de R.
  - **Refus** : un id dans `state.refused` n'est plus proposé.
- [ ] **Step 2 : Lancer** → échec. **Step 3 : Implémenter.** **Step 4 : Lancer** → réussite.
- [ ] **Step 5 : Commit** `feat(domain): détection des cas et propositions de recasement`

---

### Task 3 : Domaine — application en mémoire, masse, empreinte

**Files :** `src/domain/replacement/apply.ts` ; tests `tests/domain/replacement/apply.test.ts`

**Interfaces :**

```ts
export function applyProposal(state: State, p: Proposal): State;   // nouvel état : inscription déplacée/modifiée, clé cible élargie (+ aliasKeys), original mémorisé, recasementType
export type BulkMode = 'simple' | 'all';                           // simple : A et R ; all : meilleure proposition de chaque cas
export interface BulkStep { proposal: Proposal; manual: boolean }
export function bulkPlan(state: State, mode: BulkMode): { steps: BulkStep[]; final: State; unresolved: Case[] }; // recalcul après chaque étape ; au plus une étape par inscription
export function stateFingerprint(state: State): string;           // empreinte des membres, catégories et refus
```

- [ ] **Step 1 : Tests.**
  - `applyProposal` A (fusion -47 → -54) :
    - la cible a les deux poids, son libellé est « -47 / -54 kg » ;
    - `aliasKeys` contient l'ancienne clé ;
    - l'inscription est `placementLocked`, avec `original` mémorisé et `recasementType: 'A'` ;
    - `detectCases` ne trouve plus de cas `alone`.
  - H : l'inscription change de discipline (et de règlement si G est combiné) ; `original` garde la discipline d'avant.
  - Correction de poids : `weightClassId` changé, **pas** de verrouillage, catégorie naturelle cible.
  - R : retour, `placementLocked` faux, `original` effacé, `recasementType` effacé.
  - `bulkPlan('simple')` sur 4 seuls (deux paires voisines) → 2 étapes, 0 cas restant ; jamais deux étapes pour la même inscription.
  - `bulkPlan('all')` inclut une C et la marque `manual` ; `bulkPlan('simple')` ne l'inclut pas.
  - `stateFingerprint` change quand un membre change de catégorie ou de pesée.
- [ ] **Step 2 : Lancer** → échec. **Step 3 : Implémenter.** **Step 4 : Lancer** → réussite.
- [ ] **Step 5 : Commit** `feat(domain): application des propositions, recasement en masse, empreinte`

---

### Task 4 : Serveur — pesée, persistance, journal, routes

**Files :** schéma et migration ; `src/server/repositories/replacement.ts`, `src/server/routes/replacement.ts` ; `categories.ts` (alias, absents) ; `app.ts` ; tests `tests/server/replacement.test.ts`

**Interfaces :**
- Schéma :
  - `fighters.presence` (`unknown`|`present`|`absent`, défaut `unknown`), `fighters.weigh_in_kg` (réel, nullable) ;
  - `registrations.original_json` (nullable), `registrations.recasement_type` (nullable) ;
  - `categories.alias_keys` (JSON, défaut `[]`) ;
  - table `recasements` : id, competition_id, registration_id, proposal_id, type, from_label, to_label, manual, pre_approved, bulk, status (`validated`|`undone`), snapshot_json (inscription et clé cible d'avant, pour annuler), created_at ;
  - table `refusals` : competition_id, proposal_id (clé primaire composite) ;
  - `competitions.weigh_in_closed` (booléen).
- Synchronisation des catégories :
  - une inscription non verrouillée va dans la catégorie dont la `keyString` **ou** un des `aliasKeys` vaut sa clé naturelle ;
  - les membres **absents** sont exclus des tableaux (catégories non lancées) ;
  - une catégorie dont tous les membres sont absents reste en place sans tableau, au lieu d'être supprimée.
- Dépôt :

```ts
export async function loadState(db, competitionId): Promise<State>;
export async function setWeighIn(db, competitionId, fighterId, data: { presence?: Presence; weighInKg?: number | null }): Promise<void>;
export async function closeWeighIn(db, competitionId): Promise<{ markedAbsent: number }>; // 'unknown' → 'absent'
export async function applyProposalById(db, competitionId, proposalId: string, opts: { bulk?: boolean }): Promise<void>; // recalcule l'état, retrouve la proposition (sinon 409 « Proposition périmée »), persiste
export async function refuseProposal(db, competitionId, proposalId: string): Promise<void>;
export async function undoRecasement(db, competitionId, recasementId: string): Promise<void>; // refusé (409) si la catégorie actuelle ou d'origine est lancée
export async function listRecasements(db, competitionId): Promise<RecasementEntry[]>;
export async function manualMove(db, competitionId, registrationId: string, targetCategoryId: string): Promise<{ warnings: string[] }>; // déplacement libre, avec avertissements si une règle est enfreinte
```

- Routes (préfixe `/api/competitions/:id`) :

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/weigh-in` | `{ fighters: { fighterId, label, club, sex, ageBandCode, presence, weighInKg, registrations: { id, discipline, weightClassLabel, weighInClassLabel, outOfClass }[] }[], closed }` |
| PUT | `/weigh-in/:fighterId` | `{ presence?, weighInKg? }` |
| POST | `/weigh-in/close` | `{ markedAbsent }` |
| GET | `/replacement` | `{ cases, proposals: Record<caseId, Proposal[]>, summary: { present, absent, unknown, cases, alone, readyCategories, startedCategories }, fingerprint, recasements }` |
| POST | `/replacement/preview` | `{ proposalId }` ou `{ bulk: BulkMode }` → `{ steps, categories: { label, before: string[][], after: string[][] }[] }` (paires du 1er tour, ou membres pour une poule ou un kata) |
| POST | `/replacement/apply` | `{ proposalId }` |
| POST | `/replacement/bulk` | `{ mode, fingerprint }` → `{ applied }` (409 si l'empreinte a changé) |
| POST | `/replacement/refuse` | `{ proposalId }` |
| POST | `/replacement/undo` | `{ recasementId }` |
| POST | `/replacement/move` | `{ registrationId, categoryId }` → `{ warnings }` |

- [ ] **Step 1 : Tests.**
  - Pesée :
    - présent avec 58 kg en cadette -54 → `outOfClass` et un cas `weight_out` ;
    - `close` → les « inconnus » deviennent absents ;
    - un absent sort du tableau de sa catégorie, et son adversaire devient `alone`.
  - Application : deux seules voisines → `apply` de la proposition A →
    - une catégorie de 2 avec tableau ;
    - l'autre catégorie est supprimée ;
    - journal à 1 entrée ;
    - `GET /replacement` sans cas restant.
  - **Inscription sur place après recasement** : une nouvelle cadette -47 arrive → cas `return` et proposition R ; `apply` R → la combattante revient en -47 (2 membres), et la catégorie fusionnée retrouve sa composition.
  - **Annulation** : `undo` → état d'avant ; si la catégorie est lancée → 409.
  - **Masse** : `bulk simple` avec l'empreinte courante → toutes les A appliquées ; empreinte périmée → 409.
  - `refuse` → la proposition n'est plus listée.
  - `move` libre vers une catégorie d'un autre sexe sans réglage → effectué, avec un avertissement.
  - Une catégorie lancée n'est jamais cible, et son contenu n'est pas modifié par `bulk`.
- [ ] **Step 2 : Lancer** → échec. **Step 3 : Implémenter.** **Step 4 : Lancer** `npm test` et `npm run typecheck` → réussite.
- [ ] **Step 5 : Commit** `feat(server): pesée, recasement persisté, journal et annulation`

---

### Task 5 : Interface — Pesée

**Files :** `src/web/pages/WeighInPage.tsx` ; `api.ts` ; onglet « Pesée » ; impression des feuilles de pesée (`/competitions/:id/impression/pesee?club=…`)

- [ ] **Step 1 : Page.**
  - Recherche par nom ou club.
  - Une ligne par combattant : présence (« ? », « Présent », « Absent »), poids (saisie et Entrée → enregistrement, puis focus sur la ligne suivante), catégorie inscrite, catégorie du poids pesé, badge « ⚖ hors catégorie ».
  - Compteurs (présents, absents, non pesés). Bouton « Clôturer la pesée », avec confirmation.
  - Le kata n'a que la présence.
  - `data-testid` : `weighin-row`, `weighin-presence`, `weighin-weight`, `weighin-out`, `weighin-close`, `weighin-counters`.
- [ ] **Step 2 : Feuilles de pesée imprimables** : par club, nom, catégorie inscrite, cases « poids » et « présent » vides.
- [ ] **Step 3 : Vérifier dans Chrome**, puis commit `feat(web): pesée et feuilles de pesée`.

---

### Task 6 : Interface — tableau de bord du recasement et badges

**Files :** `src/web/pages/ReplacementPage.tsx`, `src/web/components/ReplacementBadge.tsx`, `src/web/components/ProposalPreview.tsx` ; `RegistrationsPage.tsx` et `BracketView.tsx` (badges à l'écran) ; onglet « Recasement »

- [ ] **Step 1 : `ReplacementBadge`** : type → couleur, icône et texte. Le contour indique « proposé », le plein « validé ». Les couleurs se répartissent ainsi :
  - poids (A, B) : bleu, « ⚖ » ;
  - âge (C, D, E) : orange, « ↑ Âge », « ⇄ Sen./Vét. », « Min./Adultes » ;
  - discipline (H) : violet, « ⇄ Discipline » ;
  - règlement (G) : cyan, « Shobu → Jiyu » ;
  - mixité (F) : rose, « ⚥ Mixte » ;
  - retour (R) : gris, « ↩ Retour ».
- [ ] **Step 2 : Page Recasement.**
  - Résumé en haut, données de `GET /replacement` (spec §10).
  - Liste des cas (`replacement-case`) : combattant, club, catégorie, motif. Ses propositions, classées (`replacement-proposal`), affichent :
    - le badge et le texte ;
    - les contrôles (écart, âge, mixité) ;
    - la mention « pré-accord coach » le cas échéant ;
    - des boutons : « Aperçu » (`proposal-preview`, fenêtre montrant avant/après), « Valider » (`proposal-apply` ; pour un cas simple, libellé « Classer automatiquement » avec confirmation « Êtes-vous sûr ? »), « Refuser » (`proposal-refuse`).
  - « Déplacer manuellement… » ouvre une liste de toutes les catégories ; les avertissements s'affichent.
  - Boutons globaux : « Classer automatiquement tous les cas simples » (`bulk-simple`) et « Tout classer automatiquement » (`bulk-all`). Ils ouvrent un aperçu global qui **sépare les cas simples des cas manuels**, puis une confirmation (`bulk-confirm`).
  - Historique des recasements validés (`recasement-row`), avec badge plein et « Annuler » (`recasement-undo`).
- [ ] **Step 3 : Badges ailleurs.**
  - Page Inscriptions : badge plein sur les inscriptions recasées.
  - `BracketView` (écran seulement, pas `printable`) : petit badge à côté du nom.
  - Liste des catégories : nombre de cas.
- [ ] **Step 4 : Vérifier dans Chrome** (clair et sombre), puis commit `feat(web): tableau de bord du recasement et badges`.

---

### Task 7 : Tests d'interface (Chrome)

**Files :** `tests/e2e/recasement.spec.ts`

- [ ] **Step 1 : Scénario** (données créées par l'API) :
  - cadettes : -47 seule (approx 46), -54 seule (approx 50), -61 × 2 ; un senior shobu seul ; une minime seule à côté d'une cadette -47.
  1. Pesée : marquer la -54 présente à 52 kg ; une -61 absente → l'autre -61 devient seule.
  2. Recasement : les cas sont listés. Aperçu de la proposition A (-47 → -54) : les paires avant et après sont visibles. « Classer automatiquement », puis confirmer → la catégorie fusionnée existe ; le badge plein « ⚖ » apparaît dans Inscriptions et Tableaux.
  3. Refuser une proposition : elle disparaît.
  4. « Tout classer automatiquement » : l'aperçu sépare les cas simples et manuels ; après confirmation, il ne reste aucun cas avec proposition.
  5. Inscription sur place d'une nouvelle cadette -47 → proposition R ; la valider → la combattante revient.
  6. Annuler un recasement depuis l'historique.
  7. Impression : aucun badge dans `/impression`.
- [ ] **Step 2 : Lancer `npm run test:e2e`** → tout passe. **Step 3 : Commit** `test(e2e): pesée et recasement sur Chrome`.

---

## Fin de l'étape 5
- [ ] `npm run typecheck && npm test && npm run test:e2e` : tout passe ; feuille de route à jour (étape 5 ✅).
