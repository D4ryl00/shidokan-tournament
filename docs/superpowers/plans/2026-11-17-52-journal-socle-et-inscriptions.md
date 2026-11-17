# Journal de la compétition — socle et inscriptions (étape 52) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un onglet « Journal » (organisateur) qui montre, du plus récent au plus ancien, tout ce qui modifie la compétition ; cette étape pose le socle (table, qui / comment, filet de sécurité, synchronisation, purge, écran) et détaille les inscriptions et la pesée. Les autres opérations apparaissent déjà en « Opération non détaillée ».

**Architecture:** Une table `journal_entries` (entrées et lignes de détail, ajout seul). Un contexte par requête (`AsyncLocalStorage`) porte qui (compte, poste déclaré, club) et comment ; `recordJournal` l'écrit dans la transaction de l'opération. Un crochet `onResponse` écrit une entrée brute pour toute écriture réussie qui n'a rien noté ; un test classe chaque route d'écriture (détaillée, exclue, à venir). Le texte affiché est produit à la lecture par le domaine (`journalText`), partagé avec l'écran.

**Tech Stack:** TypeScript, Fastify 5, Drizzle/better-sqlite3, React + Mantine + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-journal-de-la-competition-design.md` (étape 1 de son §11). Maquette : `.superpowers/brainstorm/58534-1794902304/content/journal-v1.html`.

## Global Constraints

- **Ajout seul** : aucune route ni fonction ne modifie ou supprime une entrée, hors purge de conservation, suppression de la compétition (cascade) et remplacement par un paquet synchronisé.
- **Même transaction** : une entrée détaillée est écrite dans la transaction de sa modification ; une requête en échec (≥ 400) n'écrit rien.
- **Libellés recopiés** : l'affichage d'une entrée ne relit jamais les combattants, clubs, catégories ou comptes (ils peuvent avoir disparu).
- **Lecture réservée à l'organisateur** : rôle serveur → refusée aux comptes Table et Zone (403) ; rôle local → onglet caché aux postes Table et Zone. Jamais lisible par un lien de club.
- **Jamais de journal sur un portable de zone** ; l'empreinte de la compétition ne compte pas le journal.
- **Pas de jeton de lien club, de mot de passe ni de corps de requête** dans une entrée.
- Recherche : tous les mots tapés, sans accents ni casse (`normalizeName`).
- Libellés des types (filtre) : `Inscription`, `Import`, `Pesée · présence`, `Catégorie`, `Réaffectation`, `Plan`, `Tableau`, `Session · zone`, `Résultat`, `Club`, `Mail`, `Main`, `Compétition`, `Non détaillé`.
- Libellés des manières : `Saisie`, `Inscription sur place`, `Inscription en ligne`, `Fiche club importée`, `Import FFK`, `Plan automatique`, `À la main`, `Historique`, `Pesée`, `Tableaux`, `Sessions`, `Combats`, `Clubs`, `Envoi de mails`, `Synchronisation`, `Ligne de commande`, `Autre`.
- Qui : `orga@exemple.fr` (compte), `poste Organisation` / `poste Table centrale` / `poste Zone 2` / `poste inconnu` (local), `<Nom du club> · lien du club`, `l’appli`.
- Jamais la base vivante `data/shidokan.sqlite` depuis l'hôte (copie pour les vérifications à l'écran) ; chaque changement visible vérifié sur Chrome.

## Review Focus

- Modification d'un combattant qui ne change rien (enregistrer sans toucher) → **aucune** entrée détaillée, et pas d'entrée brute non plus. Test : Task 6.
- Requête refusée pour conflit de révision (409) ou validation (400) → aucune entrée, ni détaillée ni brute. Test : Task 3.
- Combattant supprimé puis journal relu → l'entrée « ajouté » d'avant affiche toujours « NOM Prénom (Club) ». Test : Task 6.
- Recherche « lea lyon » (sans accent, deux mots, l'un dans le nom, l'autre dans le club) → trouve « DUPONT Léa (Shidokan Lyon) » ; un mot qui n'est que dans une ligne de détail → l'entrée revient avec `open: true`. Test : Task 5.
- Compte Table qui appelle `GET …/journal` sur le serveur → 403 ; portable de zone qui suit la compétition → reçoit une copie sans `journal_entries`, et l'ajout d'une entrée seule ne change pas l'empreinte. Test : Task 4.

---

### Task 1: Domaine du journal (types, textes, écarts d'un combattant)

**Files:**
- Create: `src/domain/journal/types.ts`, `src/domain/journal/text.ts`, `src/domain/journal/fighter-diff.ts`
- Test: `tests/domain/journal-text.test.ts`, `tests/domain/journal-fighter-diff.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type JournalType = 'inscription' | 'import' | 'pesee' | 'categorie' | 'reaffectation' | 'plan' | 'tableau' | 'session' | 'resultat' | 'club' | 'mail' | 'main' | 'competition' | 'non-detaille'` ; `JOURNAL_TYPES: JournalType[]` (cet ordre) ; `JOURNAL_TYPE_LABELS: Record<JournalType, string>` (Global Constraints).
  - `type JournalVia = 'saisie' | 'sur-place' | 'en-ligne' | 'fiche-club' | 'import-ffk' | 'plan' | 'a-la-main' | 'historique' | 'pesee' | 'tableaux' | 'sessions' | 'combats' | 'clubs' | 'mails' | 'synchronisation' | 'ligne-de-commande' | 'autre'` ; `JOURNAL_VIA_LABELS`.
  - `type JournalActor = { kind: 'account'; email: string; role: 'organisateur' | 'table' | 'zone' } | { kind: 'poste'; poste: 'organisation' | 'table' | 'zone' | 'inconnu'; zoneName?: string } | { kind: 'club'; clubName: string } | { kind: 'app' }` ; `actorLabel(a: JournalActor): string`.
  - `interface JournalChange { label: string; before: string | null; after: string | null }`.
  - `type JournalAction = 'competition-created' | 'journal-opened' | 'fighter-added' | 'fighter-removed' | 'fighter-changed' | 'weigh-in' | 'presence' | 'weigh-in-closed' | 'raw'` (les étapes suivantes en ajoutent).
  - `interface JournalData { subject?: string; detail?: string; changes?: JournalChange[]; route?: string; method?: string; params?: Record<string, string> }`.
  - `interface JournalEntryView { id: string; seq: number; type: JournalType; action: JournalAction; at: string; clientAt: string | null; actor: JournalActor; via: JournalVia; data: JournalData; children: JournalEntryView[]; open: boolean }`.
- Produces (`text.ts`): `journalText(e: Pick<JournalEntryView, 'action' | 'data'>): { title: string; detail: string | null; changes: JournalChange[] }` ; `journalSearchText(e: Pick<JournalEntryView, 'action' | 'data' | 'actor' | 'via'>): string` (= `normalizeName` de titre, détail, changements, `actorLabel`, libellé de la manière).
- Produces (`fighter-diff.ts`): `interface FighterSnapshot { name: string; club: string | null; fields: Record<string, string | null>; registrations: Record<string, Record<string, string | null>> }` (clé de `registrations` : libellé « Karaté Jiyu », « Kata » ; `fields` et champs d'inscription indexés par leur libellé affiché) ; `subjectOf(s: FighterSnapshot): string` → `"DUPONT Léa (Shidokan Lyon)"` ou `"DUPONT Léa"` sans club ; `diffFighter(before: FighterSnapshot, after: FighterSnapshot): JournalChange[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/journal-text.test.ts
test('combattant modifié : titre, changements', () => {
  const t = journalText({ action: 'fighter-changed', data: { subject: 'DUPONT Léa (Shidokan Lyon)', changes: [{ label: 'Grade', before: '2e kyu', after: '1er kyu' }] } });
  expect(t.title).toBe('DUPONT Léa (Shidokan Lyon) · modifié');
  expect(t.changes).toEqual([{ label: 'Grade', before: '2e kyu', after: '1er kyu' }]);
});
test.each([
  ['fighter-added', 'DUPONT Léa (Shidokan Lyon) · ajouté'],
  ['fighter-removed', 'DUPONT Léa (Shidokan Lyon) · supprimé'],
  ['presence', 'DUPONT Léa (Shidokan Lyon) · présence'],
])('titre de %s', (action, title) => expect(journalText({ action, data: { subject: 'DUPONT Léa (Shidokan Lyon)' } } as never).title).toBe(title));
test('poids : saisi ou corrigé selon l’avant', () => {
  expect(journalText({ action: 'weigh-in', data: { subject: 'MARTIN Hugo', changes: [{ label: 'Poids', before: null, after: '53,1 kg' }] } }).title).toBe('MARTIN Hugo · poids saisi');
  expect(journalText({ action: 'weigh-in', data: { subject: 'MARTIN Hugo', changes: [{ label: 'Poids', before: '52,4 kg', after: '53,1 kg' }] } }).title).toBe('MARTIN Hugo · poids corrigé');
});
test('entrée brute', () => expect(journalText({ action: 'raw', data: { method: 'PUT', route: '/api/competitions/:id/wave-schedules' } }).title)
  .toBe('Opération non détaillée : PUT /api/competitions/:id/wave-schedules'));
test('qui', () => {
  expect(actorLabel({ kind: 'poste', poste: 'zone', zoneName: 'Zone 2' })).toBe('poste Zone 2');
  expect(actorLabel({ kind: 'poste', poste: 'table' })).toBe('poste Table centrale');
  expect(actorLabel({ kind: 'club', clubName: 'Shidokan Lyon' })).toBe('Shidokan Lyon · lien du club');
  expect(actorLabel({ kind: 'account', email: 'orga@exemple.fr', role: 'organisateur' })).toBe('orga@exemple.fr');
  expect(actorLabel({ kind: 'app' })).toBe('l’appli');
});
test('texte de recherche : sans accents, majuscules, qui et comment compris', () => {
  const s = journalSearchText({ action: 'fighter-added', data: { subject: 'DUPONT Léa (Shidokan Lyon)' }, actor: { kind: 'poste', poste: 'table' }, via: 'sur-place' });
  expect(s).toContain('LEA'); expect(s).toContain('LYON'); expect(s).toContain('TABLE CENTRALE'); expect(s).toContain('INSCRIPTION SUR PLACE');
});
// tests/domain/journal-fighter-diff.test.ts
const base: FighterSnapshot = { name: 'DUPONT Léa', club: 'Shidokan Lyon', fields: { Grade: '2e kyu', Licence: null }, registrations: { 'Karaté Jiyu': { 'Catégorie de poids': '-45 kg' } } };
test('aucun écart', () => expect(diffFighter(base, structuredClone(base))).toEqual([]));
test('champ, club, inscription changée, ajoutée, retirée', () => {
  const after = { ...base, club: 'Dojo Marseille', fields: { Grade: '1er kyu', Licence: '11462640R' },
    registrations: { 'Karaté Jiyu': { 'Catégorie de poids': '-50 kg' }, Kata: {} } };
  expect(diffFighter(base, after)).toEqual([
    { label: 'Club', before: 'Shidokan Lyon', after: 'Dojo Marseille' },
    { label: 'Grade', before: '2e kyu', after: '1er kyu' },
    { label: 'Licence', before: null, after: '11462640R' },
    { label: 'Karaté Jiyu · Catégorie de poids', before: '-45 kg', after: '-50 kg' },
    { label: 'Kata', before: null, after: 'inscrit' },
  ]);
  expect(diffFighter(after, base).at(-1)).toEqual({ label: 'Kata', before: 'inscrit', after: null });
});
test('nom changé', () => expect(diffFighter(base, { ...base, name: 'DUPOND Léa' })[0]).toEqual({ label: 'Nom', before: 'DUPONT Léa', after: 'DUPOND Léa' }));
```

- [ ] **Step 2: Run** `npx vitest run tests/domain/journal-text.test.ts tests/domain/journal-fighter-diff.test.ts` — Expected: FAIL (modules absents).
- [ ] **Step 3: Implement** the three modules (ordre des changements : Nom, Club, champs de `fields` dans leur ordre, puis inscriptions par libellé, champs avant ajout / retrait).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(journal): domaine — types, textes, écarts d'un combattant"`

---

### Task 2: Table, migration et écriture d'une entrée

**Files:**
- Modify: `src/server/db/schema.ts` (nouvelle table `journalEntries` après `historyEntries`)
- Create: `drizzle/0038_journal.sql` (via `npm run db:generate`, puis l'insertion « Journal ouvert » ajoutée à la main), `src/server/journal/context.ts`, `src/server/journal/write.ts`
- Test: `tests/server/journal-write.test.ts`, `tests/server/migration-0038.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - Table `journal_entries` : `id` text pk ; `competition_id` text not null → `competitions.id` on delete cascade ; `seq` integer not null ; `parent_id` text null ; `type`, `action`, `via` text not null ; `at` text not null (ISO, serveur) ; `client_at` text null ; `actor_json`, `data_json`, `search_text` text not null ; `...rowMeta()`. Index unique `(competition_id, seq)`, index `(competition_id, parent_id)`.
  - `context.ts` : `interface JournalContext { actor: JournalActor; via: JournalVia; competitionId: string | null; parentId: string | null; written: number }` ; `journalStore: AsyncLocalStorage<JournalContext>` ; `currentJournal(): JournalContext | undefined` ; `setJournalVia(via: JournalVia): void` ; `setJournalActor(actor: JournalActor, competitionId?: string): void` ; `runJournal<T>(ctx: Partial<JournalContext>, fn: () => T): T` (hors requête : tests, CLI, tâches ; défauts `{ actor: { kind: 'app' }, via: 'autre' }`).
  - `write.ts` : `interface NewJournalEntry { type: JournalType; action: JournalAction; data: JournalData; via?: JournalVia; clientAt?: string; actor?: JournalActor }` ; `recordJournal(db: AppDb, competitionId: string, e: NewJournalEntry): string` (synchrone ; `seq` = max + 1 de la compétition ; parent = `currentJournal()?.parentId` ; acteur et manière du contexte sauf ceux de `e` ; incrémente `written`) ; `withJournalGroup<T>(db: AppDb, competitionId: string, parent: NewJournalEntry, fn: () => T): T` (écrit le parent, puis les `recordJournal` de `fn` deviennent ses lignes de détail).
  - Migration : une entrée `journal-opened` (type `competition`, acteur `{"kind":"app"}`, manière `autre`, `seq` 1) pour chaque compétition existante dont `owner_instance_id is null`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/journal-write.test.ts
test('numéros croissants par compétition, acteur et manière du contexte', () => {
  runJournal({ actor: { kind: 'poste', poste: 'table' }, via: 'sur-place' }, () => {
    recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: { subject: 'A' } });
    recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: { subject: 'B' } });
  });
  const rows = raw(`select seq, actor_json, via from journal_entries where competition_id = ? order by seq`, c1);
  expect(rows.map((r) => r.seq)).toEqual([1, 2]);  // (après « Compétition créée » de Task 4 : partir du max existant)
  expect(JSON.parse(rows[0].actor_json)).toEqual({ kind: 'poste', poste: 'table' });
  expect(rows[0].via).toBe('sur-place');
});
test('groupe : lignes de détail rattachées au parent', () => {
  const parentId = runJournal({}, () => withJournalGroup(db, c1, { type: 'pesee', action: 'weigh-in-closed', data: {} }, () => {
    recordJournal(db, c1, { type: 'pesee', action: 'presence', data: { subject: 'X' } });
    return currentJournal()!.parentId;
  }));
  expect(raw('select count(*) n from journal_entries where parent_id = ?', parentId)[0].n).toBe(1);
});
test('annulée avec la transaction', () => {
  expect(() => db.transaction(() => { recordJournal(db, c1, { type: 'inscription', action: 'fighter-added', data: {} }); throw new Error('x'); })).toThrow();
  expect(raw('select count(*) n from journal_entries where action = ?', 'fighter-added')[0].n).toBe(0);
});
test('supprimée avec la compétition', async () => { /* deleteCompetition → plus aucune ligne */ });
// tests/server/migration-0038.test.ts (modèle : migration-0036.test.ts, olderDb(37))
test('migration 0038 : « Journal ouvert » dans les compétitions tenues ici seulement', () => { /* c1 owner null → 1 entrée journal-opened seq 1 ; c2 owner 'x' → 0 */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/server/journal-write.test.ts tests/server/migration-0038.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, migration (`npm run db:generate`, puis l'`INSERT … SELECT` ajouté à la fin du SQL), `context.ts`, `write.ts`. `search_text` = `journalSearchText(…)` à l'écriture.
- [ ] **Step 4: Run** the same tests, then `npx vitest run tests/server/row-versions.test.ts tests/server/sync-package.test.ts` — Expected: PASS, sauf `unclassifiedTables` (`journal_entries` non classée) : réglé en Task 4 ; si ce test bloque le commit, faire Task 4 Step 3 (classement seul) ici.
- [ ] **Step 5: Commit** `git commit -m "feat(journal): table journal_entries, contexte et écriture d'une entrée"`

---

### Task 3: Qui et comment à chaque requête ; filet de sécurité

**Files:**
- Create: `src/server/journal/hooks.ts`, `src/server/journal/coverage.ts`
- Modify: `src/server/app.ts` (enregistrer les crochets après `registerGuard`), `src/server/routes/club-entry.ts` (`access()` appelle `setJournalActor({ kind: 'club', clubName }, competitionId)` et `setJournalVia('en-ligne')`)
- Test: `tests/server/journal-hooks.test.ts`, `tests/server/journal-coverage.test.ts`

**Interfaces:**
- Consumes: Task 2 `journalStore`, `recordJournal`.
- Produces:
  - `registerJournalHooks(app: FastifyInstance, db: AppDb): void` : `preHandler` (forme à rappel : `journalStore.run(ctx, done)`) qui construit le contexte : `req.user` → `{ kind: 'account', email, role }` ; sinon en-tête `x-poste` (`organisation` | `table` | `zone:<zoneId>`, zone nommée d'après `zones.name`, inconnue → `poste: 'zone'` sans nom) ; sinon `{ kind: 'poste', poste: 'inconnu' }`. `competitionId` = `req.params.id` s'il y en a un. `req.journal` = le même objet (décoration) pour l'`onResponse`.
  - Filet : `onResponse` — méthode ≠ GET/HEAD, statut < 400, route d'écriture d'une compétition (`/api/competitions/:id…`, `/api/inscription/:token…`, `POST /api/competitions`), pas dans `JOURNAL_EXEMPT`, `written === 0`, `competitionId` connu, la compétition **existe encore** et est **tenue ici** (`getManagement(db, id).managedHere`) → `recordJournal(db, id, { type: 'non-detaille', action: 'raw', data: { method, route, params } })` (paramètres de route sans `token`), puis `competitionChanged(id)`.
  - `coverage.ts` : `JOURNAL_COVERED`, `JOURNAL_EXEMPT`, `JOURNAL_PENDING` : `Set<string>` de clés `"MÉTHODE motif"`. EXEMPT = `DELETE /api/competitions/:id` (le journal part avec elle), aperçus et calculs sans effet (`…/preview`, `POST …/replacement/plan`, `…/export…`, envois de journal de zone de test s'il y en a…), chacun commenté. COVERED (cette étape) : `POST|PUT|DELETE` registrations, `POST|PUT|DELETE …/clubs/:clubId/lines…`, `POST|PUT|DELETE /api/inscription/:token/lines…`, `PUT …/fighters/:fighterId/public-name`, `PUT …/weigh-in/:fighterId`, `POST …/weigh-in/close`, `POST /api/competitions`. PENDING = toutes les autres routes d'écriture de compétition, groupées par étape à venir (commentaires `// étape 53 : imports et clubs`, `// étape 54 : réaffectation et tableaux`, `// étape 55 : jour J et le reste`).
  - Routes hors compétition qui en modifient (§8 de la spec : annuaire, Google Contacts, changements de clubs, restauration) : dans PENDING (étapes 53 et 55), pas dans le filet de cette étape.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/journal-hooks.test.ts
test('rôle local : poste déclaré, zone nommée', async () => {
  // zone « Zone 2 » créée ; POST registrations avec en-tête x-poste: zone:<id> → l'entrée a actor { kind:'poste', poste:'zone', zoneName:'Zone 2' }
});
test('rôle serveur : le compte connecté', async () => { /* buildApp role serveur, compte organisateur → actor.kind 'account', email */ });
test('lien du club : le club, « Inscription en ligne », jamais le jeton', async () => {
  // POST /api/inscription/:token/lines → actor { kind:'club', clubName }, via 'en-ligne' ; le jeton n'apparaît dans aucune colonne
});
test('filet : écriture réussie sans entrée → entrée brute', async () => {
  const res = await app.inject({ method: 'PUT', url: `${base}/wave-schedules`, payload: {...} });
  expect(res.statusCode).toBeLessThan(400);
  expect(lastEntry()).toMatchObject({ type: 'non-detaille', action: 'raw', data: { method: 'PUT', route: '/api/competitions/:id/wave-schedules' } });
});
test('filet : rien sur 400, 409, ni sur un aperçu', async () => { /* PUT registration avec If-Match périmé → 409, nombre d'entrées inchangé ; …/preview → inchangé */ });
test('filet : rien de plus quand la route a déjà noté', async () => { /* POST registration → une seule entrée, fighter-added */ });
// tests/server/journal-coverage.test.ts (helper registeredRoutes de tests/helpers/routes.ts)
test('chaque route d’écriture est détaillée, exclue ou à venir — une seule fois', async () => {
  const writes = registeredRoutes(app).filter((r) => !['GET', 'HEAD'].includes(r.method) && /^\/api\/(competitions|inscription)\b/.test(r.pattern)).map((r) => `${r.method} ${r.pattern}`);
  const known = [...JOURNAL_COVERED, ...JOURNAL_EXEMPT, ...JOURNAL_PENDING];
  expect(writes.filter((w) => !known.includes(w))).toEqual([]);
  expect(known.filter((k) => !writes.includes(k))).toEqual([]);
  expect(new Set(known).size).toBe(known.length);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/server/journal-hooks.test.ts tests/server/journal-coverage.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `hooks.ts`, `coverage.ts`, branchement dans `app.ts` et `club-entry.ts`. Le contexte doit être visible dans le gestionnaire **après un `await`** (le test du lien club le couvre, `saveClubLine` est async).
- [ ] **Step 4: Run** the same tests — Expected: PASS (« lien du club » et « rien de plus » passent une fois Task 6 faite : les marquer `test.todo` ici, les activer en Task 6).
- [ ] **Step 5: Commit** `git commit -m "feat(journal): qui et comment par requête, filet de sécurité et classement des routes"`

---

### Task 4: Synchronisation, purge, accès, création de compétition

**Files:**
- Modify: `src/server/sync/package.ts` (`PACKAGE_TABLES` + `'journal_entries'` ; `buildPackage(…, opts: { handOver; role; withJournal?: boolean })` — défaut `true` ; `competitionFingerprint` ignore la table), `src/server/routes/sync-local.ts:133` (`export.json?zone=1` → `withJournal: false`), `src/server/zone/link.ts:112` (ajoute `?zone=1`), `src/server/repositories/retention.ts` (`journal_entries` dans la liste effacée), `src/server/auth/permissions.ts` (`'/journal'` dans `ORGANISER_GETS`), `src/server/repositories/competitions.ts` (`createCompetition` écrit `competition-created`, type `competition`, dans sa transaction)
- Test: `tests/server/sync-package.test.ts`, `tests/server/retention.test.ts`, `tests/server/permissions.test.ts`, `tests/server/competitions-repo.test.ts`

**Interfaces:**
- Consumes: Task 2 `recordJournal`.
- Produces: `buildPackage(db, id, { handOver, role, withJournal })`. Importer un paquet sans `journal_entries` laisse la table de la compétition vide (comportement actuel pour une table absente) : seul un portable de zone en reçoit, et il n'en a pas.

- [ ] **Step 1: Write the failing tests**

```ts
// sync-package.test.ts
test('journal : dans le paquet et la reprise ; pas pour un portable de zone ; hors empreinte', () => {
  recordJournal(db, id, { type: 'inscription', action: 'fighter-added', data: { subject: 'A' } });
  expect(buildPackage(db, id, { handOver: true, role: 'local' }).tables.journal_entries).toHaveLength(2); // + « Compétition créée »
  expect(buildPackage(db, id, { handOver: false, role: 'local', withJournal: false }).tables.journal_entries).toBeUndefined();
  const before = competitionFingerprint(db, id);
  recordJournal(db, id, { type: 'mail', action: 'raw', data: {} });
  expect(competitionFingerprint(db, id)).toBe(before);
});
test('import d’un paquet : le journal du paquet remplace celui de la copie', () => { /* importPackage dans une 2e base → mêmes lignes */ });
// retention.test.ts
test('la purge efface le journal de la compétition expirée, pas celui des autres', () => { /* … */ });
// permissions.test.ts
test('GET journal : organisateur oui, Table et Zone non', () => {
  expect(routeAccess(table, 'GET', '/api/competitions/:id/journal')).toBe('deny');
  expect(routeAccess(orga, 'GET', '/api/competitions/:id/journal')).toBe('allow');
});
// competitions-repo.test.ts
test('création : première entrée « Compétition créée »', async () => { /* seq 1, action competition-created, type competition */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/server/sync-package.test.ts tests/server/retention.test.ts tests/server/permissions.test.ts tests/server/competitions-repo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the modifications listed above.
- [ ] **Step 4: Run** the same tests plus `npx vitest run tests/server/sync-*.test.ts tests/server/zone*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(journal): synchronisation (pas les portables de zone), purge, accès organisateur, création"`

---

### Task 5: Lecture — fil paginé, recherche, filtre

**Files:**
- Create: `src/server/repositories/journal.ts`, `src/server/routes/journal.ts`
- Modify: `src/server/app.ts` (enregistrer `journalRoutes`)
- Test: `tests/server/journal-read.test.ts`

**Interfaces:**
- Consumes: Task 1 `JournalEntryView`, Task 2 table.
- Produces:
  - `interface JournalQuery { before?: number; q?: string; types?: JournalType[]; limit?: number }` ; `interface JournalPage { entries: JournalEntryView[]; nextBefore: number | null; total: number }` ; `listJournal(db: AppDb, competitionId: string, query: JournalQuery): JournalPage`.
  - Règles : entrées sans parent seulement, `seq < before`, `seq` décroissant, `limit` 100 par défaut (max 200) ; `types` filtre le type du parent ; chaque mot de `normalizeName(q)` doit se trouver dans le `search_text` du parent **ou** d'une de ses lignes de détail ; `children` toujours complets, par `seq` croissant ; `open` = vrai si `q` n'est pas vide et qu'une ligne de détail contient au moins un des mots ; `total` = nombre d'entrées sans parent de la compétition (hors filtre) ; `nextBefore` = `seq` de la dernière entrée rendue si la page est pleine, sinon null.
  - Route `GET /api/competitions/:id/journal?before=&q=&types=inscription,pesee&limit=` → `JournalPage` (zod ; 404 si compétition inconnue).

- [ ] **Step 1: Write the failing tests**

```ts
test('ordre, pages, total', () => { /* 150 entrées → page 1 : 100, nextBefore = seq de la 100e ; page 2 : 50 (+ entrées initiales), nextBefore null */ });
test('recherche sans accent, plusieurs mots répartis entre nom et club', () => {
  // entrée subject 'DUPONT Léa (Shidokan Lyon)' ; autre entrée 'MARTIN Hugo (Karaté Club Nice)'
  expect(listJournal(db, id, { q: 'lea lyon' }).entries.map((e) => e.data.subject)).toEqual(['DUPONT Léa (Shidokan Lyon)']);
});
test('mot trouvé dans une ligne de détail : entrée rendue, ouverte', () => {
  // groupe « Pesée close » avec ligne 'LEROY Emma (Dojo Marseille)'
  const [e] = listJournal(db, id, { q: 'leroy' }).entries;
  expect(e.action).toBe('weigh-in-closed'); expect(e.open).toBe(true); expect(e.children).toHaveLength(1);
});
test('filtre par types', () => { /* types: ['pesee'] → seulement type pesee */ });
test('route : 404 compétition inconnue, types inconnus refusés (400)', async () => {});
```

- [ ] **Step 2: Run** `npx vitest run tests/server/journal-read.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `listJournal` (`like '%MOT%'` sur `search_text`, une condition par mot : `(p.search_text like ? or exists (select 1 from journal_entries c where c.parent_id = p.id and c.search_text like ?))`) et la route.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(journal): lecture paginée avec recherche et filtre"`

---

### Task 6: Inscriptions détaillées

**Files:**
- Create: `src/server/journal/fighters.ts`
- Modify: `src/server/repositories/registrations.ts` (`createRegistration`, `updateRegistration`, `deleteRegistration`), `src/server/repositories/club-entry.ts` (`writeClubLineInTx`, `deleteClubLine`), `src/server/routes/fighters.ts` (nom public), `src/server/journal/coverage.ts` (rien à déplacer : déjà COVERED en Task 3)
- Test: `tests/server/journal-registrations.test.ts`

**Interfaces:**
- Consumes: Task 1 `FighterSnapshot`, `diffFighter`, `subjectOf` ; Task 2 `recordJournal`.
- Produces:
  - `fighterSnapshot(t: AppDb, competitionId: string, fighterId: string): FighterSnapshot | null` : nom « NOM Prénom », nom du club, `fields` dans cet ordre : `Sexe` (« F » / « M »), `Catégorie d'âge` (libellé de la tranche), `Grade`, `Licence`, `Nom public` (« affiché » / « masqué ») ; par inscription (clé « Karaté Jiyu », « Kata »…, libellés de `DISCIPLINES` et `RULESETS`) : `Catégorie de poids` (libellé), `Poids annoncé` (« 48 kg », virgule décimale), `Origine` (libellé de la source : Saisie, Inscription sur place, Inscription en ligne, Fiche club importée, Import FFK). Pas le poids de pesée ni la présence (Task 7).
  - `recordFighterChange(t: AppDb, competitionId: string, before: FighterSnapshot | null, after: FighterSnapshot | null, via?: JournalVia): void` : `null → snap` = `fighter-added` (détail : libellés des inscriptions joints par « · ») ; `snap → null` = `fighter-removed` ; sinon `fighter-changed` avec `diffFighter`, **rien** si la liste est vide. Sujet = `subjectOf(after ?? before)`.
  - Manière : `createRegistration` → d'après `input.source` (`onsite` → `sur-place`, `online` → `en-ligne`, `club_form` → `fiche-club`, `ffk` → `import-ffk`, `manual` → `saisie`) ; `writeClubLineInTx` → coach `en-ligne`, organisateur `fiche-club` si `source === 'club_form'`, sinon `sur-place` pour une création et `saisie` pour une modification ; suppressions et nom public → `saisie` (coach : `en-ligne`).

- [ ] **Step 1: Write the failing tests** (par l'API, `app.inject`, comme `registrations-api.test.ts`)

```ts
test('ajout sur place → « ajouté », poste et manière', async () => {
  await post(`${base}/registrations`, { ...input, source: 'onsite' }, { 'x-poste': 'table' });
  expect(last()).toMatchObject({ type: 'inscription', action: 'fighter-added', via: 'sur-place', actor: { kind: 'poste', poste: 'table' }, data: { subject: 'DUPONT Léa (Shidokan Lyon)' } });
});
test('modification : seulement ce qui a changé ; enregistrer sans rien changer → aucune entrée', async () => {
  await put(rid, { ...input, grade: '1er kyu' });
  expect(last().data.changes).toEqual([{ label: 'Grade', before: '2e kyu', after: '1er kyu' }]);
  const n = count(); await put(rid, { ...input, grade: '1er kyu' }); expect(count()).toBe(n);
});
test('suppression puis relecture : l’ajout d’avant reste lisible', async () => {
  await del(rid);
  const entries = listJournal(db, id, {}).entries;
  expect(entries[0]).toMatchObject({ action: 'fighter-removed', data: { subject: 'DUPONT Léa (Shidokan Lyon)' } });
  expect(entries.find((e) => e.action === 'fighter-added')!.data.subject).toBe('DUPONT Léa (Shidokan Lyon)');
});
test('ligne du club par son lien : club, en ligne, inscriptions ajoutées', async () => {});
test('ligne organisateur depuis une fiche renvoyée : « Fiche club importée »', async () => {});
test('nom public masqué : « Nom public : affiché → masqué »', async () => {});
test('validation refusée (400) : aucune entrée', async () => {});
```

- [ ] **Step 2: Run** `npx vitest run tests/server/journal-registrations.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `fighters.ts` ; dans chaque fonction modifiée, `before = fighterSnapshot(t, …)` au début de la transaction et `recordFighterChange(t, …, before, fighterSnapshot(t, …))` à la fin, **dans** la même transaction. Activer les `test.todo` de Task 3.
- [ ] **Step 4: Run** `npx vitest run tests/server/journal-*.test.ts tests/server/registrations-*.test.ts tests/server/club-entry.test.ts tests/server/club-lines-organiser.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(journal): inscriptions détaillées (ajout, modification, suppression, lien du club, nom public)"`

---

### Task 7: Pesée et présence détaillées

**Files:**
- Modify: `src/server/repositories/replacement.ts` (`setWeighIn` l.815, `closeWeighIn` l.837)
- Test: `tests/server/journal-weigh-in.test.ts`

**Interfaces:**
- Consumes: Task 2 `recordJournal`, `withJournalGroup` ; Task 6 `subjectOf`, `fighterSnapshot`.
- Produces: `setWeighIn` écrit `weigh-in` (changement `Poids`, « 52,4 kg ») si le poids change, `presence` (changement `Présence` : « inconnue » / « présent(e) » / « absent(e) » selon le sexe) si la présence change, les deux si les deux changent, rien sinon ; manière `pesee`. `closeWeighIn` écrit **toujours** un groupe `weigh-in-closed` (type `pesee`, détail `"<n> marqué(s) absent(s)"`, nom de la session dans `subject` si `waveId`) dont chaque combattant marqué absent est une ligne `presence`.

- [ ] **Step 1: Write the failing tests**

```ts
test('poids saisi puis corrigé', async () => { /* 2 entrées weigh-in : before null → '52,4 kg' ; '52,4 kg' → '53,1 kg' */ });
test('présence : absente', async () => { /* changes [{ label: 'Présence', before: 'inconnue', after: 'absente' }] */ });
test('même valeur renvoyée : rien', async () => {});
test('clôture : un groupe, une ligne par absent marqué', async () => { /* 2 non pesés → parent weigh-in-closed, 2 enfants presence */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/server/journal-weigh-in.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** in `setWeighIn` / `closeWeighIn`, inside their transactions.
- [ ] **Step 4: Run** the test and `npx vitest run tests/server/replacement.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(journal): pesée, présence et clôture de la pesée"`

---

### Task 8: Onglet Journal

**Files:**
- Create: `src/web/pages/JournalPage.tsx`, `src/web/journal.ts` (fonctions pures de l'écran)
- Modify: `src/web/tabs.ts` (`{ path: 'journal', label: 'Journal' }` en dernier), `src/web/App.tsx` (route `journal`), `src/web/api.ts` (`useJournal` ; en-tête `X-Poste` sur les écritures), `src/web/poste.ts` (`posteHeader(url: string): string | null`), `src/web/help.ts` (sujet `journal`)
- Test: `tests/web/journal.test.ts`, `tests/web/poste.test.ts`, `tests/e2e/journal.spec.ts`

**Interfaces:**
- Consumes: Task 1 `journalText`, `actorLabel`, `JOURNAL_TYPE_LABELS`, `JOURNAL_VIA_LABELS` ; Task 5 route.
- Produces:
  - `posteHeader(url)` : pour une adresse `/api/competitions/<id>/…`, le poste lu comme `usePoste` le lit (`poste:<id>` du stockage) → `'organisation' | 'table' | 'zone:<zoneId>'` ; null hors compétition. `api()` l'envoie en `X-Poste` sur toute méthode ≠ GET.
  - `useJournal(competitionId, { q, types })` : `useInfiniteQuery`, clé `['journal', id, q, types]`, page suivante via `nextBefore`.
  - `journal.ts` : `groupByDay(entries: JournalEntryView[]): { day: string; entries: JournalEntryView[] }[]` (jour local, « Samedi 22 novembre ») ; `highlight(text: string, q: string): { text: string; hit: boolean }[]` (mots sans accents ni casse).
  - Écran conforme à la maquette : en-tête « Journal » + `total` + témoin « en direct » ; phrase d'aide courte (sujet `journal`) ; recherche (attente de 250 ms) ; pastilles de type multi-choix avec « Tous » ; jours ; ligne = heure · type · titre / détail / changements (ancienne valeur barrée, « → ») · qui (`actorLabel`) + étiquette de la manière ; « saisi HH:MM sur le portable, reçu HH:MM » quand `clientAt` ; « ▸ Voir le détail » / « ▾ Masquer le détail » (ouvert d'office si `open`) ; entrée `non-detaille` sur fond `--sk-warn` ; suite chargée au défilement (IntersectionObserver) ; « Aucun événement ne correspond. » ; rangées empilées sous 720 px. Couleurs : jetons `--sk-*` seulement. L'onglet n'apparaît pas dans `TABLE_TABS` / `ZONE_TABS` (rien à changer dans `poste.ts` pour ça).
  - Aide `journal` : court « Tout ce qui a modifié la compétition, du plus récent au plus ancien. » ; détails : ce qui y est noté, qui (compte, poste déclaré, club par son lien), rien ne s'efface, effacé avec les données de la compétition à la fin de la conservation, réservé à l'organisateur.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/web/journal.test.ts
test('groupByDay : jours décroissants, libellé français', () => {
  expect(groupByDay([e('2026-11-22T10:42:00'), e('2026-11-22T09:58:00'), e('2026-11-18T18:30:00')]).map((g) => g.day))
    .toEqual(['Samedi 22 novembre', 'Mercredi 18 novembre']);
});
test('highlight sans accents', () => expect(highlight('DUPONT Léa', 'lea').filter((p) => p.hit).map((p) => p.text)).toEqual(['Léa']));
// tests/web/poste.test.ts
test('posteHeader : poste de la compétition de l’adresse', () => {
  localStorage.setItem('poste:c1', JSON.stringify({ kind: 'zone', zoneId: 'z2' }));
  expect(posteHeader('/api/competitions/c1/registrations')).toBe('zone:z2');
  expect(posteHeader('/api/competitions')).toBeNull();
});
// tests/e2e/journal.spec.ts
test('ajout sur place, puis Journal : entrée, recherche, filtre', async ({ page }) => {
  // inscrire « DUPONT Léa » ; onglet Journal → ligne « DUPONT Léa … · ajouté », « Inscription sur place », « poste Organisation »
  // taper « lea » → surligné ; pastille « Pesée · présence » seule → « Aucun événement ne correspond. »
});
test('poste Table : pas d’onglet Journal', async ({ page }) => {});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/journal.test.ts tests/web/poste.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the page, hooks, header, tab, route and help text.
- [ ] **Step 4: Run** `npx vitest run tests/web && npm run typecheck && npx playwright test tests/e2e/journal.spec.ts` — Expected: PASS.
- [ ] **Step 5: Vérifier sur Chrome** (copie de démonstration, pas la base vivante) : clair et sombre, 1280 px et 360 px, recherche, filtre, groupe « Pesée close » déplié, entrée brute (ex. modifier les horaires d'une session) ; poste Table → pas d'onglet.
- [ ] **Step 6: Commit** `git commit -m "feat(journal): onglet Journal (fil, recherche, filtre, pages, en direct) et poste déclaré"`

---

### Task 9: Vérification complète et documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md` (section « Étape 52 : journal — socle et inscriptions » ; annonce des étapes 53 imports et clubs, 54 réaffectation et tableaux, 55 jour J et le reste, chacune avec son plan à écrire)
- Create: bilan en fin de ce plan (« Bilan »)

- [ ] **Step 1: Run** `npm run typecheck && npx vitest run && npx playwright test` — Expected: tout vert (noter les nombres).
- [ ] **Step 2: Mesure** : import FFK de la plus grosse donnée de test et application du plan, avant / après cette étape (`npm run test:perf` si couvert) — écart négligeable attendu ; noter les chiffres.
- [ ] **Step 3: Commit** `git commit -m "docs(journal): bilan de l'étape 52 et feuille de route"`

## Bilan

Étape faite le 2026-11-17 sur la branche `etape-52-journal` (commits `1e6fbc0..b903a65` avant ce bilan).

- Exécution : tâches 1 à 8 faites avec des sous-agents (un par tâche, chacune relue), commits `1e6fbc0..90693e6`. Relecture de toute la branche : 0 critique, 3 importants, 3 mineurs. Une vague de corrections `90693e6..b903a65` les a tous traités ; nouvelle relecture ciblée sans remarque.
  - Importants : (1) l'entrée brute était omise sur une route pas encore détaillée dès qu'une entrée détaillée avait été écrite ; (2) la recherche du journal (`exists` sur les lignes de détail) n'était pas bornée à la compétition : 2,6 s sur 10 000 lignes, 9,5 s avec 40 000 lignes en base, 5 ms après correction (index de la compétition) ; (3) un portable de zone recevait encore le journal par « Recevoir une copie plus récente » (réseau et fichier USB).
  - Mineurs : texte des lignes de détail d'un groupe (« NOM Prénom (Club) : absente »), test de l'ajout seul (seuls la purge de conservation et le paquet synchronisé modifient ou suppriment), test de bout en bout d'une zone.
- Vérifié (HEAD `b903a65`) :
  - `npm run typecheck` : sans erreur.
  - `npx vitest run` : 212 fichiers, 2442 tests réussis.
  - `npx playwright test` : 242 tests réussis (13,3 min), sans reprise.
  - Chrome (copie de démonstration) : fil par jour en thème sombre et clair, recherche surlignée, filtre par type, entrée brute, groupe déplié / replié, poste déclaré, onglet Journal masqué pour le poste Table, lignes de détail « NOM Prénom (Club) : absente ». Largeur de téléphone vérifiée dans le simulateur iPhone (iPhone 18 Pro, Safari, base de démonstration) : en-tête, pastilles de type qui passent à la ligne, entrées, groupe déplié « DUPONT Léa (…) : absente », pas de débordement horizontal.
- Mesure de durée : `npm run test:perf` ne couvre pas l'import FFK (galaxie et échelle seulement). Mesure ad hoc (script jetable, supprimé ensuite) : import FFK par l'API (aperçu puis import, 600 lignes de 20 clubs, 300 combattants créés par import), base neuve, 3 exécutions, chiffres arrondis, `main` à `1e6fbc0` contre `b903a65`, deux copies de travail séparées. Premier import 580 → 695 ms ; réimport identique (rien à écrire) 760 → 950 ms ; import suivant (300 créations) 1 190 → 1 470 ms. Soit environ +20 à +25 %, environ 1 ms par combattant écrit ; en absolu, moins d'une demi-seconde pour 300 combattants. Ce n'est pas « négligeable » en proportion, mais sans conséquence pour l'organisateur ; pas de piste d'optimisation retenue. Le réimport identique (rien à écrire) ralentit aussi, d'environ 190 ms (+25 %) : une partie du coût est fixe, cause non identifiée. Mesure faite sur un portable, un seul jeu de données : à prendre comme un ordre de grandeur.
- Limites connues, reportées aux étapes suivantes :
  - Un import FFK écrit une entrée par combattant changé plus une entrée brute, sans groupe, jusqu'à l'étape 53 qui le groupe.
  - Les lignes de détail d'un combattant ajouté, retiré ou modifié sont au masculin tant que les données copiées ne portent pas le sexe du combattant (étape 53).
  - Le texte de recherche stocké d'une ligne de présence contient encore « Présence inconnue » : chercher « inconnue » ouvre le groupe sans surlignage visible.
  - L'onglet Journal, d'abord placé dans l'étape « Après », a été rangé dans « Préparer », après Réglages (demande de l'organisateur, 2026-11-17). Les comptes sont dits avec leur rôle : « orga@… · compte Organisateur », « … · compte Table », « … · compte Zone ».
  - Mineurs reportés : `fighters.ts` lit toutes les catégories de poids à chaque écriture (instantané) ; `registrations.ts`, `existingFighter` interrogé deux fois ; clés d'inscription de libellé en double « (2) » dépendantes de l'ordre ; `replacement.ts` lit `f` avant les `await` (valeur « avant » possiblement périmée) ; `JournalPage` : total périmé pendant le rechargement, gras en ligne sur « Tous », clé du libellé de jour, groupes dépliés conservés quand le type change ; `hooks.ts` cherche la zone à chaque requête.
- Suite : étapes 53 (imports et clubs), 54 (réaffectation et tableaux), 55 (jour J et le reste), plans à écrire (voir la feuille de route).
