# Mode spectateur, lot 1 — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page publique, sans compte, où parents, coachs et combattants suivent une compétition publique (zone et
numéro de chaque combat, tableaux qui se remplissent, podiums) et consultent l'historique, avec la visibilité privée /
publique et le masquage du nom d'un combattant.

**Architecture:** Une fonction pure du domaine (`src/domain/public/`) fabrique, à partir des données déjà chargées, une
vue publique en **liste blanche** (aucun champ d'organisation). Le serveur l'expose sous `/api/public/…` (ouvert sans
connexion, mis en cache en mémoire jusqu'au prochain changement, ETag), avec un flux d'événements public. Le web ajoute
des pages `/public` et `/public/:id` hors de la garde de connexion ; `/` les montre au visiteur non connecté du serveur.

**Tech Stack:** TypeScript 7 (natif), Fastify, better-sqlite3 + drizzle, React + Mantine 8 + TanStack Query, Vitest,
Playwright sur Chrome.

**Spec:** `docs/superpowers/specs/2026-11-08-mode-spectateur-design.md` (lot 1 du §8 seulement). Maquette :
`.superpowers/brainstorm/24610-1794159383/content/spectateur-detail.html` (locale, git-ignorée).

## Global Constraints

- Interface en français ; composants et jetons existants (`src/web/components/ui/`, `--sk-*`), clair et sombre.
- Utilisable à **360 px** de large sans défilement horizontal (helper e2e `clipped()`).
- Visibilité : `'private' | 'public'`, **privée** par défaut et pour toutes les compétitions existantes.
- Rien d'une vague **non lancée** (ou rouverte) sur la page publique : ni tableau, ni numéro, ni zone.
- Jamais en public : poids, grade, licence, coordonnées du coach, état de pesée / présence, raisons de retrait, comptes,
  liens des clubs, notes internes, compétition privée.
- Nom affiché : « NOM Prénom » complet ; forme courte « NOM P. » dans les files des zones. Combattant masqué :
  « Combattant masqué », club gardé, absent de la recherche, non épinglable.
- Une compétition privée et une compétition inconnue répondent **exactement** la même chose (404, même corps).
- Pas de limite par adresse sur les lectures publiques (spec §7) ; la protection vient du cache et de l'ETag.
- Lot 2 (heures, durées, avance / retard) **hors de ce plan** : aucun champ d'heure n'est créé ici.
- Vérification sur Chrome (Claude in Chrome) de chaque changement visible, y compris à largeur de téléphone.
- e2e du serveur (port 3101) : **aucune connexion de plus** (limite 10 / IP / 15 min) — utiliser `SERVER_SESSION` pour
  l'organisateur et un contexte sans session pour le visiteur.
- Ne jamais ouvrir `data/shidokan.sqlite` avec sqlite3 depuis l'hôte.

## Review Focus

1. **Nom masqué qui fuit** par un chemin détourné : `bracket.entrants[].label` (contient le nom), adversaire d'un autre
   combattant, podium, décompte par club, recherche, historique. → test `masked fighter name never appears in public json`
   (Task 3) et e2e (Task 9).
2. **Vague rouverte** après lancement : ses catégories doivent disparaître de la page publique. → test
   `reopened wave disappears` (Task 4).
3. **Compétition repassée en privée** pendant que des téléphones l'affichent : la relecture renvoie 404 et la page dit
   « Cette compétition n'est plus affichée ». → test serveur (Task 4) + e2e (Task 9).
4. **Combattant inscrit dans deux disciplines** : une seule carte, une ligne par catégorie. → test `fighterTimeline groups
   registrations of the same fighter` (Task 3).
5. **Stockage du navigateur indisponible** (navigation privée, cookies bloqués) : la page marche, sans épingles gardées.
   → test `pins survive a throwing localStorage` (Task 6).

---

## Fichiers

- Create `drizzle/0034_mode_spectateur.sql` (+ `drizzle/meta/0034_snapshot.json` par `npm run db:generate`)
- Modify `src/server/db/schema.ts` (colonnes), `src/domain/competition.ts`, `src/domain/api-schemas.ts`,
  `src/server/repositories/competitions.ts`, `src/server/repositories/registrations.ts`
- Create `src/server/routes/fighters.ts` (masquage), Modify `src/server/app.ts`, `src/server/auth/permissions.ts`
- Create `src/domain/public/types.ts`, `src/domain/public/view.ts` (fabrication de la vue), `src/domain/public/follow.ts`
  (suivis, recherche, files)
- Create `src/server/public/load.ts` (lecture en base), `src/server/public/cache.ts`, `src/server/routes/public.ts`
- Modify `src/server/events.ts` (écoute de tous les changements, flux public), `src/server/auth/guard.ts`
- Create `src/web/publicApi.ts`, `src/web/publicLive.ts`, `src/web/publicPins.ts`
- Create `src/web/pages/public/PublicHomePage.tsx`, `src/web/pages/public/PublicCompetitionPage.tsx`,
  `src/web/components/public/{PublicHeader,FollowTab,ZonesTab,BracketsTab,ResultsTab}.tsx`
- Modify `src/web/App.tsx`, `src/web/components/BracketView.tsx` (surlignage), `src/web/pages/CompetitionSettingsPage.tsx`,
  `src/web/pages/CompetitionsPage.tsx`, formulaire d'inscription (`src/web/components/RegistrationForm.tsx` ou la page),
  `src/web/help.ts`, `src/domain/app-settings.ts`, `src/server/repositories/app-settings.ts`, `src/web/pages/AppSettingsPage.tsx`
- Tests : `tests/server/migration-0034.test.ts`, `tests/server/visibility.test.ts`, `tests/server/public-routes.test.ts`,
  `tests/domain/public-view.test.ts`, `tests/domain/public-follow.test.ts`, `tests/web/public-pins.test.ts`,
  `tests/e2e/spectateur.spec.ts`, plus les listes de `tests/server/permissions.test.ts`

---

### Task 1: Visibilité d'une compétition

**Files:**
- Create: `drizzle/0034_mode_spectateur.sql`, `tests/server/migration-0034.test.ts`, `tests/server/visibility.test.ts`
- Modify: `src/server/db/schema.ts` (`competitions`, `fighters`), `src/domain/competition.ts`, `src/domain/api-schemas.ts:19`,
  `src/server/repositories/competitions.ts:87-125`, `src/web/pages/CompetitionSettingsPage.tsx`, `src/web/help.ts`

**Interfaces:**
- Produces: colonne `competitions.visibility text not null default 'private'` (drizzle :
  `visibility: text('visibility', { enum: ['private', 'public'] }).notNull().default('private')`) ;
  colonne `fighters.public_name_hidden integer not null default false` (drizzle `publicNameHidden`, boolean) — créée ici,
  utilisée en Task 2 ; `Competition.visibility: 'private' | 'public'` ; `competitionPatchSchema` accepte
  `visibility: z.enum(['private','public'])`.

- [ ] **Step 1: Tests qui échouent**

`tests/server/migration-0034.test.ts` (modèle : `migration-0032.test.ts`, `olderDb(33)`) :
`'migration 0034 : compétitions privées, aucun nom masqué'` — une compétition et un combattant insérés avant ;
après `openDb`, `visibility === 'private'` et `public_name_hidden === 0`, les autres colonnes intactes.

`tests/server/visibility.test.ts` (rôle local, `buildApp({ dbPath, role: 'local' })`) :
- `'a new competition is private'` : `POST /api/competitions` → `GET` → `visibility: 'private'`.
- `'PATCH visibility public then private'` : 200, relu `'public'`, puis `'private'`.
- `'PATCH rejects an unknown visibility'` : `{ visibility: 'brouillon' }` → 400.
- `'visibility travels in the sync package'` : comme `sync-package.test.ts`, exporter une compétition publique, l'importer
  ailleurs → `visibility: 'public'`.

- [ ] **Step 2: Lancer, vérifier l'échec** — `npx vitest run tests/server/migration-0034.test.ts tests/server/visibility.test.ts` → FAIL.

- [ ] **Step 3: Implémenter**

Migration SQL (deux `ALTER TABLE … ADD`), schéma, puis `npm run db:generate` pour le snapshot (vérifier que le SQL généré
est identique à celui écrit). `updateCompetition` écrit `visibility` si présent. Réglages de la compétition : un
`SegmentedControl` « Visibilité : Privée · Publique » avec l'aide « Publique : affichée sur la page d'accueil, sans
compte. Les tableaux et numéros n'y apparaissent qu'au lancement de chaque session. » ; le lien « Voir la page publique »
(`/public/:id`) quand elle est publique. Organisateur seulement (la route PATCH l'est déjà ; le contrôle est désactivé pour
la Table centrale comme les autres réglages). Une entrée dans `help.ts` pour ce réglage.

- [ ] **Step 4: Lancer, vérifier** — mêmes tests → PASS ; `npm run typecheck` → 0 erreur.

- [ ] **Step 5: Commit** — `feat(spectateur): visibilité privée ou publique d'une compétition`

### Task 2: Masquer le nom d'un combattant

**Files:**
- Create: `src/server/routes/fighters.ts`
- Modify: `src/server/app.ts` (enregistrement), `src/server/auth/permissions.ts` (`TABLE_WRITES`),
  `src/server/repositories/registrations.ts` (ligne de liste), formulaire d'inscription, `src/web/api.ts`, `src/web/help.ts`
- Test: `tests/server/visibility.test.ts` (suite), `tests/server/permissions.test.ts` (liste `TABLE_WRITES`),
  `tests/server/retention.test.ts`

**Interfaces:**
- Consumes: `fighters.publicNameHidden` (Task 1).
- Produces: `PUT /api/competitions/:id/fighters/:fighterId/public-name` corps `{ hidden: boolean }` → 204 ; 404 si le
  combattant n'est pas dans la compétition. Chaque ligne de `GET …/registrations` porte `publicNameHidden: boolean`.
  Web : `useSetPublicNameHidden(competitionId)` mutation `{ fighterId, hidden }`.

- [ ] **Step 1: Tests qui échouent**
- `'hide then show a fighter name'` : PUT `{hidden:true}` → 204 ; la liste des inscriptions montre
  `publicNameHidden: true` sur **toutes** les inscriptions de ce combattant ; PUT `{hidden:false}` → `false`.
- `'hiding a fighter of another competition is 404'`.
- permissions : ajouter `'PUT /fighters/:fighterId/public-name'` à la liste `TABLE_WRITES` du test (Table centrale permise,
  Zone refusée).
- retention : après `purgeExpiredData`, `public_name_hidden` est gardé.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter** — la route met à jour `fighters.public_name_hidden` (la version de ligne suit par les
déclencheurs) ; elle est sous `/api/competitions/:id`, donc la garde « gérée ailleurs » et le flux d'événements
s'appliquent sans rien de plus. Dans le formulaire de modification d'une inscription : un `Switch` « Masquer le nom sur la
page publique » enregistré tout de suite par la route (pas par le PUT de l'inscription) ; dans la liste des inscriptions,
un badge discret « nom masqué en ligne ». Entrée d'aide.

- [ ] **Step 4: Lancer** — tests + `npx vitest run tests/server/permissions.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(spectateur): masquer le nom d'un combattant sur la page publique`

### Task 3: Vue publique (domaine, pur)

**Files:**
- Create: `src/domain/public/types.ts`, `src/domain/public/view.ts`, `src/domain/public/follow.ts`
- Test: `tests/domain/public-view.test.ts`, `tests/domain/public-follow.test.ts`

**Interfaces:**
- Produces (dans `types.ts`, consommés par Tasks 4 à 8) :

```ts
export type PublicPhase = 'upcoming' | 'today' | 'past';
// DisciplineId : src/domain/types.ts ; Bracket, MatchResult, Podium, KataScores : src/domain/brackets ; MedalRow : src/domain/results.ts
export interface PublicCompetitionSummary { id: string; name: string; date: string; location: string | null; phase: PublicPhase; launched: boolean }
export interface PublicEntrant {
  registrationId: string;
  /** null si masqué (non épinglable). */
  fighterId: string | null;
  name: string;      // « MARTIN Léa » ou « Combattant masqué »
  shortName: string; // « MARTIN L. » ou « Combattant masqué »
  club: string;
  clubId: string | null;
  hidden: boolean;
}
export type SideSource = { kind: 'winner' | 'loser'; number: number | null };
export interface PublicQueueItem {
  number: number; categoryId: string;
  matchId: string | null;            // null : bloc de kata
  kataPart: 'tour1' | 'finale' | null;
  a: string | null; b: string | null; // registrationIds connus
  aFrom: SideSource | null; bFrom: SideSource | null; // « vainqueur du n° 12 »
  state: 'played' | 'ready' | 'waiting';
  waveId: string | null;
}
export interface PublicCategory {
  id: string; label: string; discipline: DisciplineId; waveId: string | null; zoneId: string | null;
  status: 'upcoming' | 'started' | 'finished';
  /** Heure du dernier résultat quand elle est terminée (tri des podiums). */
  finishedAt: string | null;
  bracket: Bracket;                 // libellés des inscrits remplacés par PublicEntrant.name
  registrationIds: string[]; absentIds: string[];
  results: Record<string, MatchResult>;
  kataScores: KataScores | null;
  tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] };
  numbers: Record<string, number>;  // matchId (ou 'kata', 'kata:tour1', 'kata:finale') → numéro
  matchZones: Record<string, string>; // combat joué sur une autre zone → « Zone des finales : Ring »
  podium: Podium;
}
export interface PublicCompetition {
  id: string; name: string; date: string; location: string | null; phase: PublicPhase;
  waves: { id: string | null; name: string; launched: boolean }[];
  zones: { id: string; name: string }[];
  entrants: Record<string, PublicEntrant>;
  categories: PublicCategory[];      // seulement celles d'une vague lancée
  queues: { zoneId: string; items: PublicQueueItem[] }[];
  medals: MedalRow[];
}
```

- `view.ts` : `publicPhase(date: string, today: string, anyWaveLaunched: boolean): PublicPhase` ;
  `todayInParis(now: Date): string` (AAAA-MM-JJ, fuseau `Europe/Paris`) ;
  `toPublicCompetition(src: PublicSource): PublicCompetition` où `PublicSource` (défini dans `view.ts`) est la donnée
  brute chargée par la Task 4 : compétition, vagues + lancements, zones, combattants (`lastName`, `firstName`, `clubId`,
  `publicNameHidden`), clubs (`id`, `name`), inscriptions (`id`, `fighterId`), catégories (`Category` du domaine),
  résultats / kata / départages par catégorie, horodatage du dernier résultat par catégorie, plan de passage
  (`PassagePlan`) et ensemble des catégories lancées.
- `follow.ts` :
  - `searchPublic(pub: PublicCompetition, q: string): { clubs: { clubId: string; club: string; count: number }[]; fighters: PublicFighter[] }`
    — insensible aux accents et majuscules (`normalizeName` de `src/domain/names.ts`), au moins 2 caractères, masqués exclus.
  - `PublicFighter = { fighterId: string; name: string; club: string; clubId: string | null; registrationIds: string[] }`
  - `fighterTimeline(pub: PublicCompetition, fighterId: string): FighterLine[]` avec
    `FighterLine = { categoryId: string; label: string; discipline: DisciplineId; next: { number: number; zoneId: string; before: number; opponent: { name: string; club: string } | { from: SideSource } | null } | null; played: { number: number | null; opponent: string; won: boolean }[]; state: 'upcoming' | 'waiting' | 'eliminated' | 'finished' | { medal: 1 | 2 | 3 } }`
  - `zoneQueue(pub: PublicCompetition, zoneId: string): { next: PublicQueueItem | null; following: PublicQueueItem[] }`
    (les `played` exclus ; `next` = premier `ready` ou `waiting` dans l'ordre).

- [ ] **Step 1: Tests qui échouent** (`public-view.test.ts`, données construites à la main avec les générateurs de tableaux
du domaine, sans base) :
- `publicPhase` : `('2026-11-22','2026-11-22',false) → 'today'` ; `('2026-11-21','2026-11-22',true) → 'past'` ;
  `('2026-12-06','2026-11-22',false) → 'upcoming'` ; `('2026-12-06','2026-11-22',true) → 'today'`.
- `todayInParis(new Date('2026-11-21T23:30:00Z')) === '2026-11-22'`.
- `'only launched categories are public'` : deux catégories, une seule dans `launched` → `categories.length === 1`, et
  `entrants` ne contient que ses inscrits.
- `'masked fighter name never appears in public json'` : un combattant masqué « SECRET Zoé » → `JSON.stringify(view)` ne
  contient ni `SECRET` ni `Zoé` ; son entrée vaut `{ name: 'Combattant masqué', fighterId: null, hidden: true, club: … }` ;
  `bracket.entrants[].label` remplacé.
- `'no organisation field leaks'` : source avec poids 41.5, grade « 2e kyu », licence « L123 » → aucune de ces valeurs dans
  le JSON, et les clés de premier niveau sont exactement celles de `PublicCompetition`.
- `'queue states'` : un combat joué → `played`, son suivant aux deux inscrits connus → `ready`, un combat dont un côté
  attend un résultat → `waiting` avec `aFrom: { kind: 'winner', number: <numéro du combat d'origine> }`.

`public-follow.test.ts` :
- `searchPublic` : « mart » et « LEA » trouvent « MARTIN Léa » (nom, prénom et club, sans accents ni majuscules) ;
  « m » (1 caractère) ne rend rien ; « dojo ly » trouve le club avec `count` = nombre de combattants non masqués ; un
  masqué n'est jamais trouvé, ni par son nom ni dans la liste des combattants de son club.
- `'fighterTimeline groups registrations of the same fighter'` : un combattant en karaté et en kata → 2 lignes.
- `fighterTimeline` : prochain combat avec `before` = nombre de passages non joués avant lui sur sa zone ; adversaire
  connu → `{ name, club }` ; adversaire à venir → `{ from: { kind: 'winner', number: 12 } }` ; médaille → `{ medal: 1 }` ;
  élimination directe sans repêchage, combat perdu → `'eliminated'` ; poule non terminée sans combat jouable → `'waiting'`.
- `zoneQueue` : `next` est le premier non joué, `following` la suite.

- [ ] **Step 2: Lancer, vérifier l'échec** — `npx vitest run tests/domain/public-view.test.ts tests/domain/public-follow.test.ts`.

- [ ] **Step 3: Implémenter** — `toPublicCompetition` construit les objets champ par champ (jamais de `...row`) ; les
files viennent de `plan.zones[].passages` filtrés sur les catégories lancées, l'état d'un combat de `resolveBracket`, le
bloc de kata comme dans `schedule()` (`src/server/repositories/results.ts:245`) ; `aFrom`/`bFrom` depuis la source du
créneau (`SlotSource` du combat) et le numéro du combat d'origine ; `medals` par `medalTable` sur les podiums complets.
Élimination : `'eliminated'` seulement si la catégorie est terminée sans médaille, ou si le format est
`single_elimination` sans repêchage et que le combattant a perdu ; sinon `'waiting'` quand il n'a aucun combat à jouer.

- [ ] **Step 4: Lancer** → PASS ; `npm run typecheck`.

- [ ] **Step 5: Commit** — `feat(spectateur): vue publique en liste blanche, suivis et recherche`

### Task 4: Routes publiques, cache et flux

**Files:**
- Create: `src/server/public/load.ts`, `src/server/public/cache.ts`, `src/server/routes/public.ts`, `tests/server/public-routes.test.ts`
- Modify: `src/server/events.ts`, `src/server/auth/guard.ts:46-48`, `src/server/app.ts`

**Interfaces:**
- Consumes: `toPublicCompetition`, `publicPhase`, `todayInParis`, types (Task 3) ; `passagePlan`, `listCategories`,
  `getResults`, `launchedCategoryIds`, `launchedWaveKeys`, `listZones`, `listWaves`.
- Produces:
  - `GET /api/public/competitions` → `{ today: PublicCompetitionSummary[]; upcoming: PublicCompetitionSummary[]; past: PublicCompetitionSummary[] }`
    (publiques seulement ; `today`/`upcoming` par date croissante, `past` décroissante).
  - `GET /api/public/competitions/:id` → `PublicCompetition` ; 404 `{ error: 'Compétition introuvable.' }` si inconnue
    **ou** privée.
  - `GET /api/public/competitions/:id/events` → flux SSE (`event: change`, sans origine) ; 404 identique si privée.
  - Les deux GET renvoient `ETag` et `Cache-Control: no-cache` ; `If-None-Match` égal → 304 sans corps.
  - `events.ts` : `onAnyCompetitionChange(listener: () => void): () => void` (tous les `competitionChanged` et
    `everythingChanged`).
  - `cache.ts` : `publicCompetition(db, id, now = new Date()): { etag: string; body: string } | null` et
    `publicList(db, now = new Date())` — calculés au premier appel, effacés à chaque changement de la compétition (ou de
    n'importe laquelle pour la liste), clé incluant `todayInParis(now)`.

- [ ] **Step 1: Tests qui échouent** (rôle **serveur**, sans cookie pour le visiteur ; préparation comme `setup()` de
`permissions.test.ts`) :
- `'private competition is 404 like an unknown one'` : corps et statut identiques pour l'id privé et `'inconnu'`, sur la
  fiche et sur `/events`.
- `'public list shows public competitions only'` et classement today / upcoming / past.
- `'nothing before launch'` : compétition publique non lancée → `categories: []`, `queues: []` ; après `POST /launch` →
  catégories présentes avec `numbers`.
- `'reopened wave disappears'` : `POST /launch/reopen` → catégories de la vague absentes.
- `'turning private again returns 404'`.
- `'etag answers 304'` ; `'a result changes the etag'` (PUT d'un résultat par l'organisateur → nouvel ETag).
- `'no organisation data in public json'` : poids pesé, e-mail et téléphone du coach, grade → absents du corps.
- `'public routes need no session'` : statut ≠ 401 sans cookie ; et `tests/server/permissions.test.ts` : ajouter
  `/^\/api\/public\//` à la liste `PUBLIC`.

- [ ] **Step 2: Lancer, vérifier l'échec** — `npx vitest run tests/server/public-routes.test.ts`.

- [ ] **Step 3: Implémenter** — `load.ts` lit la base et remplit `PublicSource` ; `isPublicRoute` accepte
`route.startsWith('/api/public/')` ; le flux public reprend l'en-tête et le ping de `registerCompetitionEvents` (factoriser
une petite fonction commune `openStream(reply, onChange)` dans `events.ts`), vérifie la visibilité à l'ouverture, et ne
transporte que `change`. ETag = empreinte SHA-1 du corps.

- [ ] **Step 4: Lancer** → PASS ; `npx vitest run tests/server/permissions.test.ts tests/server/events.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(spectateur): routes publiques en lecture, cache et flux d'événements`

### Task 5: Pages publiques, accueil et connexion

**Files:**
- Create: `src/web/publicApi.ts`, `src/web/publicLive.ts`, `src/web/pages/public/PublicHomePage.tsx`,
  `src/web/pages/public/PublicCompetitionPage.tsx`, `src/web/components/public/PublicHeader.tsx`
- Modify: `src/web/App.tsx`, `src/web/pages/CompetitionsPage.tsx`

**Interfaces:**
- Consumes: routes et types des Tasks 3–4.
- Produces:
  - `usePublicList()`, `usePublicCompetition(id)` (TanStack Query, clés `['public', 'list']`, `['public', id]`) ;
    une 404 donne `{ gone: true }` plutôt qu'une erreur.
  - `usePublicEvents(id): { connected: boolean; lastUpdate: Date | null }` — comme `useCompetitionEvents`
    (`src/web/liveUpdates.ts`) mais sur `/api/public/competitions/:id/events`, relecture des seules clés `['public', …]`
    après une attente **aléatoire de 0 à 2 s**, flux fermé quand l'onglet est caché.
  - `PublicCompetitionPage` rend un onglet par nom : `'suivis' | 'zones' | 'tableaux' | 'resultats'`, dans l'adresse
    (`?onglet=`), `suivis` par défaut ; pour une compétition `past`, seulement `tableaux` et `resultats`.
    Les composants d'onglet reçoivent `{ pub: PublicCompetition; followed: Set<string> }`.

- [ ] **Step 1: Routage** — dans `App.tsx` : `/public` et `/public/:id` **hors** d'`AuthGate` ; `/connexion` sous
`AuthGate` → `<Navigate to="/" replace />` ; dans `AuthGate`, quand il n'y a pas de session **et** que l'adresse est `/`,
rendre `PublicHomePage` au lieu de `LoginPage`. Sur une installation locale, `/` reste la page de l'organisateur.

- [ ] **Step 2: En-tête public** — logo, nom de l'application, **bouton « Connexion organisateurs »** (bien visible, en
haut à droite) vers `/connexion`, sur l'accueil et sur les pages d'une compétition ; bouton thème.

- [ ] **Step 3: Accueil** — trois blocs « Aujourd'hui » (« ● EN DIRECT »), « À venir » (nom, date, lieu), « Historique »,
textes de l'écran 1 de la maquette ; état vide « Aucune compétition affichée pour le moment. ».

- [ ] **Step 4: Page d'une compétition** — en-tête (nom, « ● EN DIRECT · mis à jour à HH:MM », bandeau « Connexion
perdue, nouvel essai… » quand `connected` est faux), barre d'onglets en bas sur téléphone (en haut au-delà de 768 px 💡) ;
compétition sans vague lancée : « Numéros et horaires au lancement de la session. » ; `gone` : « Cette compétition n'est
plus affichée. » avec un lien vers l'accueil. Les onglets sont des emplacements vides remplis par les Tasks 6 à 8.

- [ ] **Step 5: Liste des compétitions de l'organisateur** — lien « Voir la page publique » (`/public`).

- [ ] **Step 6: Vérifier** — `npm run typecheck` ; `npm run build` ; Chrome : `/` non connecté sur une instance
serveur de développement → accueil public ; « Connexion organisateurs » → connexion → liste des compétitions.

- [ ] **Step 7: Commit** — `feat(spectateur): accueil public, page d'une compétition et bouton de connexion`

### Task 6: Onglet Suivis et recherche

**Files:**
- Create: `src/web/publicPins.ts`, `src/web/components/public/FollowTab.tsx`, `tests/web/public-pins.test.ts`
- Modify: `src/web/pages/public/PublicCompetitionPage.tsx`

**Interfaces:**
- Consumes: `searchPublic`, `fighterTimeline` (Task 3).
- Produces: `type Pins = { fighters: string[]; clubs: string[] }` ;
  `readPins(competitionId: string, storage: Pick<Storage, 'getItem'> | null = browserStorage()): Pins`,
  `writePins(competitionId: string, pins: Pins, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void`
  (`browserStorage()` rend `window.localStorage` ou null, dans un `try/catch` ; clé `spectateur:<competitionId>` ;
  lectures et écritures dans `try/catch` ; valeur invalide = vide ; les tests, en environnement `node`, passent un faux
  stockage) ; `usePins(competitionId)` hook React autour des deux ; `followedFighters(pub, pins): string[]` (épinglés + tous les combattants non
  masqués des clubs suivis, sans doublon).

- [ ] **Step 1: Tests qui échouent** (`tests/web/public-pins.test.ts`, environnement de test web existant) :
`'pins round-trip'`, `'pins survive a throwing localStorage'` (`getItem`/`setItem` qui lèvent → `readPins` rend des
listes vides, `writePins` ne lève pas), `'followedFighters adds club members and skips masked'`.

- [ ] **Step 2: Lancer, vérifier l'échec.**

- [ ] **Step 3: Implémenter** — `FollowTab` selon les écrans 2 et 3 de la maquette : champ « Nom, prénom ou club… »,
résultats (club avec « ★ Suivre tout le club » et nombre de combattants ; combattants avec ★ / ☆), cartes des suivis
(prochain combat en gros : zone, n°, « N combats avant le sien », adversaire ou « contre le vainqueur du n° 12 » ;
combats joués « a battu … » / « battu(e) par … » ; pastille d'état ; kata : bloc, zone, puis place). Rien d'épinglé :
« Cherchez un combattant ou un club pour le suivre. ». Pas d'heure (lot 2).

- [ ] **Step 4: Lancer** → PASS ; Chrome à 360 px.

- [ ] **Step 5: Commit** — `feat(spectateur): onglet Suivis, recherche et suivi d'un club`

### Task 7: Onglet Zones

**Files:**
- Create: `src/web/components/public/ZonesTab.tsx`
- Modify: `src/web/pages/public/PublicCompetitionPage.tsx`

**Interfaces:**
- Consumes: `zoneQueue` (Task 3), `pub.waves`, `pub.zones`, `followed`.

- [ ] **Step 1: Implémenter** — selon l'écran 4 de la maquette, **sans heure ni avance / retard** : une carte par zone,
le prochain passage mis en avant avec le libellé « À suivre » (l'application ne sait pas qu'un combat a commencé), les
deux noms courts (ou « vainqueur du n° 12 »), puis 3 suivants et « voir les N suivants » qui déplie ; kata :
« Kata · <catégorie> · N passages » ; un combattant suivi marqué ★ ; toucher un passage ouvre l'onglet Tableaux sur sa
catégorie. Sessions non lancées : « <nom> : numéros au lancement de la session. ». Zone sans passage restant :
« Terminé sur cette zone. ».

- [ ] **Step 2: Vérifier** — `npm run typecheck` ; Chrome à 360 px et en sombre.

- [ ] **Step 3: Commit** — `feat(spectateur): onglet Zones`

### Task 8: Onglets Tableaux et Résultats, historique

**Files:**
- Create: `src/web/components/public/BracketsTab.tsx`, `src/web/components/public/ResultsTab.tsx`
- Modify: `src/web/components/BracketView.tsx` (prop `highlighted?: Set<string>`), `src/web/pages/public/PublicCompetitionPage.tsx`

**Interfaces:**
- Consumes: `PublicCategory`, `pub.entrants`, `pub.medals`, `followed`.
- Produces: `BracketView` accepte `highlighted?: Set<string>` (inscriptions surlignées, fond `--sk-accent` léger) et un
`category` réduit : son type de prop devient `Pick<Category, 'bracket' | 'registrationIds'>` (seuls champs lus).

- [ ] **Step 1: Tableaux** — liste des catégories avec filtres discipline et session, zone, état ; un tableau : en-tête
« zone · format (`format-labels.ts`) », `BracketView` en lecture seule (`entrants` depuis `pub.entrants`, `numbers`,
`results`, `kataScores`, `matchZones`, `tieBreaks`, `highlighted`), et une vue « Combats » (passages de la catégorie dans
l'ordre, numéro, zone, noms, résultat). Recherche en haut qui surligne (aussi dans l'historique).

- [ ] **Step 2: Résultats** — podiums des catégories terminées, du `finishedAt` le plus récent au plus ancien, filtre par
discipline ; tableau « Par club » depuis `pub.medals`.

- [ ] **Step 3: Historique** — pour `phase === 'past'`, seulement ces deux onglets ; aucun « EN DIRECT ».

- [ ] **Step 4: Vérifier** — `npx vitest run` (les tests existants de `BracketView` passent toujours), `npm run typecheck`,
Chrome : élimination directe, poules, kata, à 360 px.

- [ ] **Step 5: Commit** — `feat(spectateur): onglets Tableaux et Résultats, historique`

### Task 9: Mention, test de bout en bout, documentation

**Files:**
- Modify: `src/domain/app-settings.ts:107`, `src/server/repositories/app-settings.ts:9`, `src/web/pages/AppSettingsPage.tsx`,
  `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`
- Create: `tests/e2e/spectateur.spec.ts`
- Test: `tests/server/app-settings.test.ts`

**Interfaces:**
- Produces: `PREVIOUS_DEFAULT_PRIVACY_NOTICES: string[]` et `currentPrivacyNotice(text: string): string` (même principe
  que `currentInvitationMail`, appliqué dans `getAppSettings`).

- [ ] **Step 1: Test qui échoue** — `'old default privacy notice is replaced, a custom one is kept'`.

- [ ] **Step 2: Nouveau texte par défaut** (exact) :
« Les informations saisies sur cette page sont traitées par Shidokan France pour organiser la compétition (inscriptions,
catégories, tableaux). Le poids, le grade et les coordonnées du coach sont effacés 13 mois après la compétition ; les
résultats (nom, club, catégorie, classement) sont conservés comme archive sportive. Les tableaux et les résultats (nom,
prénom, club, catégorie, résultats des combats) sont publiés sur le site des compétitions ; l'organisateur masque le nom
d'un combattant sur simple demande. Pour toute question, ou pour exercer vos droits sur ces données : {contact}. »
L'ancien texte va dans `PREVIOUS_DEFAULT_PRIVACY_NOTICES`. Dans les Réglages, si le texte gardé ne contient pas
« publiés », un rappel : « La mention ne dit pas que les résultats sont publiés sur la page publique. ».

- [ ] **Step 3: e2e `tests/e2e/spectateur.spec.ts`** (serveur, port 3101 ; organisateur par `SERVER_SESSION`, visiteur
dans un contexte sans session ; nom de compétition unique, par exemple « Spectateurs Démo ») :
1. compétition créée et lancée par l'API, encore privée → absente de l'accueil public ;
2. rendue publique dans les Réglages → le visiteur la voit sur `/` « Aujourd'hui » et voit le bouton « Connexion
   organisateurs » ;
3. le visiteur cherche un nom, l'épingle, lit zone et numéro ;
4. l'organisateur saisit un résultat → la page du visiteur affiche le vainqueur sans recharger ;
5. un combattant masqué n'apparaît nulle part dans le texte de la page ;
6. repassée en privée → « Cette compétition n'est plus affichée. » ;
7. à 360 px : `clipped(page)` vide sur les quatre onglets.

- [ ] **Step 4: Lancer** — `npx vitest run` (tout) puis `npx playwright test tests/e2e/spectateur.spec.ts` → PASS ; puis la
suite e2e entière une fois (jamais deux lancements en même temps).

- [ ] **Step 5: Vérification sur Chrome** (Claude in Chrome) sur une copie d'une sauvegarde de démonstration : accueil,
quatre onglets, téléphone 360 px, clair et sombre, coupure de réseau (bandeau), compétition repassée privée.

- [ ] **Step 6: Documentation** — feuille de route : étape 39 « Mode spectateur, lot 1 » ; bilan : choix faits, écarts,
points reportés au lot 2.

- [ ] **Step 7: Commit** — `feat(spectateur): mention des résultats publiés, test de bout en bout et bilan`
