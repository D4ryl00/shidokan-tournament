# Étape 15 (étape 0 du spec) : données compatibles avec l'inscription en ligne et la synchronisation — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** préparer la base pour les étapes futures sans rien changer de visible. Concrètement :
- chaque installation reçoit une identité ;
- les clubs sont reliés à un annuaire indépendant des compétitions ;
- chaque compétition sait qui a la main et dans quel état sont ses inscriptions en ligne ;
- chaque ligne d'une compétition porte une version qui ne se répète jamais, et sa date de modification ;
- des tests garantissent qu'une compétition reste transférable d'un bloc.

**Architecture :**
- Une migration drizzle (`0014_donnees_compatibles`) ajoute les tables et les colonnes.
- Trois étapes jouées à chaque ouverture de base (`openDb`, après les migrations), idempotentes :
  1. `ensureRowVersions` crée le compteur et les déclencheurs des tables versionnées. La liste des tables est calculée, pas écrite à la main.
  2. `linkAllClubs` relie à l'annuaire les clubs qui ne le sont pas encore.
  3. L'identité de l'installation est créée par `buildApp` (pas par `openDb`, qui tourne aussi sur la copie temporaire d'une restauration).

**Tech Stack:** TypeScript, Drizzle (SQLite, better-sqlite3), Fastify, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §3 (étape 0) uniquement. Hors de cette étape : tout écran (annuaire, page du club, mails, postes, synchronisation), la conservation (§8.4).

## Global Constraints
- **Rien de visible ne change** : mêmes écrans, mêmes réponses d'API. Les nouvelles colonnes (`version`, `updatedAt`, `directoryClubId`, `ownerInstanceId`, `lastSyncAt`, `clubEntryStatus`, `clubEntryDeadline`) ne sortent pas dans les réponses JSON de cette étape.
- **Ne jamais ouvrir `data/shidokan.sqlite` depuis l'hôte** pendant que le conteneur tourne. Les essais sur données réelles se font sur une copie d'une sauvegarde de `data/sauvegardes/`, rangée dans `tmp/` (Task 5).
- **Tables versionnées** = `competitions` + `club_directory` + toutes les tables qui ont une colonne `competition_id`, sauf `uploads`.
- **Tables sans `competition_id` autorisées** : `competitions`, `instance`, `change_counter`, `club_directory`, `club_aliases`, `import_mappings`, `grid_templates`, `__drizzle_migrations`. Les tables `sqlite_%` sont ignorées.
- `owner_instance_id` **vide = « gérée ici »**. Rien ne l'écrit dans cette étape, sauf la restauration, qui le vide (Task 3).
- `club_entry_status` ∈ `closed` | `open` | `frozen`, `closed` par défaut.
- `registrations.source` reçoit la valeur `online`, avec le libellé « En ligne ».
- Horodatages au format de `created_at` : `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`.
- Tous les tests restent verts : `npm run typecheck && npm test && npm run test:e2e`.

## Review Focus
- **La vraie base de la Coupe migre sans perte**, et ses clubs sont reliés sans doublon évident : essai sur une copie de sauvegarde, Task 5.
- **Restauration d'une sauvegarde d'avant cette étape** : elle est mise à niveau, ses lignes ont une version, ses clubs sont reliés, et l'identité locale est conservée. Test Task 3.
- **Résultat effacé puis ressaisi** : sa version est strictement supérieure à toutes celles qu'il a eues. Test Task 2.
- **Les réponses d'API n'exposent aucune nouvelle colonne** (clubs, inscriptions, combattants, catégories). Test Task 2.
- **Déclencheurs perdus** après une reconstruction de table (comme le fait drizzle-kit) : ils sont recréés à l'ouverture suivante. Test Task 2.

---

### Task 1 : Schéma et migration `0014_donnees_compatibles`

**Files:**
- Modify: `src/server/db/schema.ts`, `src/domain/registration.ts` (`RegistrationSource`, `SOURCE_LABELS`)
- Create: `drizzle/0014_donnees_compatibles.sql`, plus le snapshot et l'entrée de journal générés
- Test: `tests/server/migration-0014.test.ts`

**Interfaces:**
- Produces (schéma drizzle) :
  ```ts
  // colonnes communes, ajoutées par décomposition à chaque table versionnée : les 16 tables qui ont competition_id
  // (toutes sauf uploads), plus competitions et club_directory
  const rowMeta = () => ({ version: integer('version'), updatedAt: text('updated_at') });
  export const instance = sqliteTable('instance', { id: text('id').primaryKey(), name: text('name').notNull(), createdAt: text('created_at').notNull().default(sql`(strftime(...))`) });
  export const changeCounter = sqliteTable('change_counter', { id: integer('id').primaryKey(), value: integer('value').notNull() });
  export const clubDirectory = sqliteTable('club_directory', {
    id, name (notNull), nameKey: text('name_key').notNull(), affiliationNumber: text('affiliation_number').unique(), ffkEntity: text('ffk_entity'),
    coachName, coachPhone, coachEmail, notes (text, nullables), archived: integer({ mode: 'boolean' }).notNull().default(false),
    createdAt (défaut comme ailleurs), ...rowMeta(),
  }); // index non unique sur name_key
  // clubs : directoryClubId: text('directory_club_id').references(() => clubDirectory.id, { onDelete: 'set null' })
  // competitions : ownerInstanceId: text('owner_instance_id'), lastSyncAt: text('last_sync_at'),
  //   clubEntryStatus: text('club_entry_status', { enum: ['closed', 'open', 'frozen'] }).notNull().default('closed'),
  //   clubEntryDeadline: text('club_entry_deadline')
  // registrations.source : enum + 'online'
  ```
- `RegistrationSource` reçoit `'online'`. `SOURCE_LABELS.online = 'En ligne'`.

- [ ] **Step 1 : tests** (`migration-0014.test.ts`). Chaque test part de `olderDb(13)`, insère des lignes en SQL brut (better-sqlite3 sur le fichier temporaire), puis ouvre la base avec `openDb`.
  - `une base de l'étape 14 migre : compétitions, clubs, inscriptions et résultats intacts`. Les valeurs relues sont identiques à celles insérées.
  - `competitions : club_entry_status = 'closed', owner_instance_id, last_sync_at et club_entry_deadline vides`.
  - `tables créées : instance, change_counter, club_directory ; clubs.directory_club_id existe`. Vérifié avec `pragma_table_info` et `sqlite_master`.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/migration-0014.test.ts`. Attendu : FAIL (colonnes absentes).
- [ ] **Step 3 : modifier `schema.ts`** selon les Interfaces, puis lancer `npx drizzle-kit generate --name donnees_compatibles`.
  - Relire le SQL généré. Les `ALTER TABLE … ADD` sont attendus. Si une table est reconstruite (`__new_…`), vérifier qu'elle recopie toutes ses lignes.
  - N'ajouter **aucun** déclencheur dans la migration : ils sont créés par Task 2.
- [ ] **Step 4 : ajouter `'online'`** à `RegistrationSource` et à `SOURCE_LABELS` (`'En ligne'`). Ne pas l'ajouter à l'énumération zod de `src/server/routes/registrations.ts` : l'organisateur ne crée pas d'inscription « en ligne ».
- [ ] **Step 5 : lancer les tests et le typecheck**, qui doivent passer : `npx vitest run tests/server/migration-0014.test.ts && npm run typecheck`.
- [ ] **Step 6 : commit**
  ```bash
  git add src/server/db/schema.ts src/domain/registration.ts drizzle tests/server/migration-0014.test.ts
  git commit -m "feat(données): migration 0014 — instance, annuaire des clubs, main et inscriptions en ligne, colonnes de version"
  ```

### Task 2 : Versions des lignes (compteur unique et déclencheurs) et règle de garde

**Files:**
- Create: `src/server/db/row-versions.ts`
- Modify: `src/server/db/client.ts` (`openDb` appelle `ensureRowVersions` après `migrate`), `src/server/repositories/registrations.ts` (`toClub`, `toFighter`, `toRegistration`), et tout autre convertisseur ligne → objet d'API qui ferait sortir les nouvelles colonnes
- Test: `tests/server/row-versions.test.ts`

**Interfaces:**
- Consumes: le schéma de Task 1.
- Produces:
  ```ts
  /** Tables versionnées, calculées depuis sqlite_master : competitions, club_directory, et les tables qui ont competition_id sauf uploads. Triées. */
  export function versionedTables(db: AppDb): string[];
  /** Crée la ligne du compteur et les déclencheurs (IF NOT EXISTS), puis donne une version aux lignes qui n'en ont pas. Idempotente.
   *  Ne fait rien si la table change_counter n'existe pas (base d'avant 0014, ouverte par le helper de test olderDb).
   *  Sinon, lève une Error « La table <t> n'a pas les colonnes version et updated_at » si une table versionnée ne les a pas. */
  export function ensureRowVersions(db: AppDb): void;
  /** Retire version et updatedAt d'une ligne avant de la renvoyer par l'API. */
  export function withoutRowMeta<T extends { version: unknown; updatedAt: unknown }>(row: T): Omit<T, 'version' | 'updatedAt'>;
  ```
- Déclencheurs, pour chaque table versionnée `<t>`. Le SQL est donné ici, car c'est lui qui garantit qu'une version ne se répète jamais :
  ```sql
  INSERT OR IGNORE INTO change_counter (id, value) VALUES (1, 0);
  CREATE TRIGGER IF NOT EXISTS "<t>__version_insert" AFTER INSERT ON "<t>" WHEN NEW.version IS NULL BEGIN
    UPDATE change_counter SET value = value + 1 WHERE id = 1;
    UPDATE "<t>" SET version = (SELECT value FROM change_counter WHERE id = 1),
      updated_at = coalesce(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
  END;
  -- ligne arrivée avec sa version (restauration, futur transfert) : elle la garde ; le compteur ne redescend jamais en dessous
  CREATE TRIGGER IF NOT EXISTS "<t>__version_keep" AFTER INSERT ON "<t>" WHEN NEW.version IS NOT NULL BEGIN
    UPDATE change_counter SET value = max(value, NEW.version) WHERE id = 1;
  END;
  CREATE TRIGGER IF NOT EXISTS "<t>__version_update" AFTER UPDATE ON "<t>" BEGIN
    UPDATE change_counter SET value = value + 1 WHERE id = 1;
    UPDATE "<t>" SET version = (SELECT value FROM change_counter WHERE id = 1),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
  END;
  -- lignes existantes sans version : le déclencheur de mise à jour leur en donne une
  UPDATE "<t>" SET updated_at = updated_at WHERE version IS NULL;
  ```
  Le déclencheur de mise à jour ne se relance pas lui-même, car `recursive_triggers` est désactivé, comme par défaut. Celui d'insertion peut le déclencher une fois, ce qui augmente le compteur de deux au lieu d'un : c'est sans conséquence.

- [ ] **Step 1 : tests** (`row-versions.test.ts`, sur une base `tmpDbPath()` ouverte avec `openDb`) :
  - `versionedTables : liste exacte`. Attendu : `['age_bands','age_links','categories','club_directory','clubs','competitions','fighters','frozen_passages','kata_scores','match_results','recasements','refusals','registrations','tie_breaks','wave_launches','waves','weight_classes','zones']`.
  - `règle de garde : chaque table a competition_id ou est déclarée globale`. Liste globale = Global Constraints. Tables `sqlite_%` ignorées.
  - `chaque table versionnée a version, updated_at et ses trois déclencheurs`.
  - `insertion → version et updated_at renseignés ; modification → version strictement plus grande, updated_at mis à jour`.
  - `résultat effacé puis ressaisi (même category_id, match_id) → version strictement supérieure à toutes ses versions précédentes`.
  - `ligne insérée avec sa version → version gardée ; le compteur passe au moins à cette valeur`.
  - `déclencheur supprimé (DROP TRIGGER) → recréé à l'ouverture suivante`.
  - `une base de l'étape 14 (olderDb(13)) : après ouverture, toutes les lignes existantes ont une version et un updated_at`.
  - `API inchangée`. Via `buildApp` et `inject` : une compétition avec un club, une inscription et une catégorie générée. Les réponses de `GET /api/competitions/:id`, `/clubs`, `/registrations`, `/categories` ne contiennent aucune des clés `version`, `updatedAt`, `directoryClubId`, `ownerInstanceId`, `lastSyncAt`, `clubEntryStatus`, `clubEntryDeadline`. La recherche porte sur le texte JSON, à toute profondeur.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/row-versions.test.ts`. Attendu : FAIL (`row-versions.js` introuvable).
- [ ] **Step 3 : écrire `row-versions.ts`** selon les Interfaces, puis appeler `ensureRowVersions(db)` dans `openDb` juste après `migrate`.
- [ ] **Step 4 : retirer les nouvelles colonnes des réponses.** Dans `toClub` (retirer aussi `directoryClubId`), `toFighter` et `toRegistration`, utiliser `withoutRowMeta`. Puis lancer `npm test`. Pour chaque échec dû à une clé en plus, retirer cette clé dans le convertisseur concerné ; **ne pas modifier le test**.
- [ ] **Step 5 : lancer les tests**, qui doivent passer : `npm run typecheck && npm test`.
- [ ] **Step 6 : commit**
  ```bash
  git add src/server/db/row-versions.ts src/server/db/client.ts src/server/repositories tests/server/row-versions.test.ts
  git commit -m "feat(données): versions de lignes qui ne se répètent jamais (compteur unique, déclencheurs recréés à l'ouverture), règle de garde des tables"
  ```

### Task 3 : Identité de l'installation et restauration

**Files:**
- Create: `src/server/repositories/instance.ts`
- Modify: `src/server/app.ts` (`AppOptions.instanceName`, appel à `ensureInstance`), `src/server/main.ts`, `compose.yaml`, `src/server/repositories/backups.ts` (`restoreFrom`)
- Test: `tests/server/instance.test.ts`, `tests/server/backups.test.ts` (ajouts)

**Interfaces:**
- Produces:
  ```ts
  export interface Instance { id: string; name: string }
  /** Crée la ligne unique si elle manque (nouvel UUID, nom `name`) ; sinon la renvoie telle quelle (le nom n'est pas écrasé). */
  export function ensureInstance(db: AppDb, name: string): Instance;
  export function getInstance(db: AppDb): Instance | null;
  // AppOptions : instanceName?: string  (défaut 'PC')
  ```
- `main.ts` passe `process.env.INSTANCE_NAME || process.env.COMPUTERNAME || 'PC'`. `compose.yaml` ajoute à `environment` : `- INSTANCE_NAME=${INSTANCE_NAME:-}` et `- COMPUTERNAME=${COMPUTERNAME:-}`.
- `restoreFrom` :
  - `instance` est exclue des tables copiées, comme `__drizzle_migrations`.
  - Après la copie, dans la même transaction, **si la sauvegarde a une table `instance`** : `UPDATE main.competitions SET owner_instance_id = NULL WHERE owner_instance_id IN (SELECT id FROM src.instance UNION SELECT id FROM main.instance)`. Restaurer, c'est reprendre la main sur ce que gérait l'installation d'origine, et une installation ne peut pas être « l'autre » pour elle-même. Ce second cas précise le §3.3 du spec (Task 5, Step 4).

- [ ] **Step 1 : tests**
  - `instance.test.ts` :
    - `ensureInstance crée une ligne puis la renvoie identique au second appel, même avec un autre nom`.
    - `buildApp crée l'identité avec instanceName ; un redémarrage sur la même base garde le même id`.
  - `backups.test.ts` :
    - `restauration : l'identité locale ne change pas`. La sauvegarde vient d'une autre application, construite sur un autre `tmpDbPath()`.
    - `restauration : une compétition gérée par l'installation d'origine ou par l'installation locale redevient « gérée ici » ; une gérée par une troisième installation garde sa valeur`. Les valeurs `owner_instance_id` sont posées en SQL brut sur une copie de la sauvegarde écrite dans le dossier temporaire du test.
    - `restauration d'une sauvegarde de l'étape 14 (olderDb(13), avec un club) : mise à niveau, lignes versionnées, club relié à l'annuaire`. Ce test-là passe après Task 4.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/instance.test.ts tests/server/backups.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : écrire `instance.ts`**, puis le brancher dans `buildApp` (après `openDb`), dans `main.ts` et dans `compose.yaml`.
- [ ] **Step 4 : modifier `restoreFrom`** selon les Interfaces.
- [ ] **Step 5 : lancer les tests**, qui doivent passer : `npx vitest run tests/server/instance.test.ts tests/server/backups.test.ts`. Seul le dernier test de restauration est encore en échec ; le marquer `test.todo` jusqu'à Task 4.
- [ ] **Step 6 : commit**
  ```bash
  git add src/server/repositories/instance.ts src/server/app.ts src/server/main.ts compose.yaml src/server/repositories/backups.ts tests/server
  git commit -m "feat(données): identité de l'installation, gardée à la restauration ; restaurer reprend la main sur les compétitions de l'installation d'origine"
  ```

### Task 4 : Annuaire des clubs (rapprochement, reprise des clubs existants, création)

**Files:**
- Create: `src/server/repositories/club-directory.ts`
- Modify: `src/server/db/client.ts` (`openDb` appelle `linkAllClubs` après `ensureRowVersions`), `src/server/repositories/registrations.ts` (`upsertClubSync`, `updateClub`), `src/server/repositories/ffk-import.ts` (étape « 2. Clubs »)
- Test: `tests/server/club-directory.test.ts`, et le test laissé en `todo` dans `tests/server/backups.test.ts`

**Interfaces:**
- Consumes: `clubDirectory`, `clubs.directoryClubId` (Task 1). Dans une transaction, passer `tx as unknown as AppDb`, comme le fait déjà `registrations.ts`.
- Produces:
  ```ts
  /** Relie le club de compétition à son entrée d'annuaire (règle ci-dessous), en la créant au besoin ; complète les coordonnées vides de l'entrée
   *  et lui donne l'entité FFK et le numéro d'affiliation du club si elle ne les a pas. Ne change jamais un lien existant. Renvoie l'id de l'entrée. */
  export function linkClub(db: AppDb, clubId: string): string;
  /** Relie tous les clubs non reliés, de la compétition la plus récente à la plus ancienne (date, puis created_at). Renvoie le nombre de clubs reliés.
   *  Ne fait rien si la table club_directory n'existe pas (base d'avant 0014, comme pour ensureRowVersions). */
  export function linkAllClubs(db: AppDb): number;
  /** Numéro d'affiliation FFK : les chiffres en tête de l'entité (« 0060808 ISSA KYOKUSHIN SCHOOL » → « 0060808 »), sinon null. */
  export function affiliationNumber(entity: string | null): string | null;
  ```
- **Règle de rapprochement** (spec §3.2) :
  - Soit `entity = club.ffkEntity ?? club_aliases[club.nameKey] ?? null`, et `number = affiliationNumber(entity)`.
  - (1) Si `number` : l'entrée dont `affiliation_number = number`.
  - (2) Sinon, ou si (1) ne trouve rien : une entrée de même `name_key` dont `affiliation_number` est vide ou égal à `number` (n'importe laquelle si `number` est vide). On préfère celle qui a le même numéro, puis la plus ancienne (`created_at`, puis `id`).
  - (3) Sinon, une nouvelle entrée : `name`, `name_key`, `ffk_entity = entity`, `affiliation_number = number`, coordonnées du club.
  - L'entrée trouvée ou créée reçoit l'entité et le numéro si elle ne les a pas, ainsi que les coordonnées (coach, téléphone, e-mail) qui lui manquent.
- **Branchements :**
  - `upsertClubSync` appelle `linkClub` après création **et** après mise à jour.
  - `updateClub` appelle `linkClub` après la mise à jour. Le lien existant ne change pas, même si le club est renommé.
  - `ffk-import.ts` appelle `linkClub` pour chaque club créé ou lié à l'étape « 2. Clubs ». Pour un lien « sûr », l'appel a lieu après l'enregistrement de l'entité.

- [ ] **Step 1 : tests** (`club-directory.test.ts`, via les repositories sur une base `tmpDbPath()`) :
  - `affiliationNumber : « 0060808 ISSA KYOKUSHIN SCHOOL » → « 0060808 » ; « ISSA » → null ; null → null`.
  - `même numéro d'affiliation, orthographes différentes (alias) → une seule entrée`.
  - `même numéro d'affiliation, nom de l'entité FFK changé entre deux exports → une seule entrée`.
  - `même nom sans entité dans deux compétitions → une entrée ; coordonnées prises dans la compétition la plus récente`.
  - `même nom, numéros d'affiliation différents → deux entrées`.
  - `une fiche importée ne change pas un téléphone déjà présent dans l'annuaire, mais remplit un e-mail vide`.
  - `renommer un club de compétition garde son entrée`.
  - `import FFK : club créé → relié avec son entité ; lien sûr vers un club existant → son entrée reçoit l'entité`. S'appuyer sur `tests/helpers/ffk-fixture.ts`, comme `tests/server/ffk-import.test.ts`.
  - `base de l'étape 14 (olderDb(13)) avec trois clubs, dont deux de même nom dans deux compétitions → après ouverture, tous reliés, deux entrées`.
  - Retirer le `todo` du test de restauration de Task 3.
- [ ] **Step 2 : lancer les tests**, qui doivent échouer : `npx vitest run tests/server/club-directory.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : écrire `club-directory.ts`**, puis faire les branchements listés dans les Interfaces.
- [ ] **Step 4 : lancer les tests**, qui doivent passer : `npm run typecheck && npm test`.
- [ ] **Step 5 : commit**
  ```bash
  git add src/server/repositories src/server/db/client.ts tests/server
  git commit -m "feat(données): annuaire des clubs — rapprochement par numéro d'affiliation puis par nom, reprise des clubs existants, liaison à chaque création"
  ```

### Task 5 : Essai sur une copie de la vraie base, documents

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`, `docs/superpowers/plans/2026-10-21-99-bilan.md`, `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` (§3.3)

- [ ] **Step 1 : essai sur une copie de sauvegarde.**
  - Copier la plus récente des sauvegardes de `data/sauvegardes/` dans `tmp/essai-0014.sqlite`.
  - Lancer `npm run build`, puis `PORT=3100 DATABASE_PATH=tmp/essai-0014.sqlite node dist/server/main.js`.
  - Attendu : démarrage sans erreur ; `GET http://localhost:3100/api/competitions` renvoie les mêmes compétitions qu'avant ; les inscriptions et les tableaux s'ouvrent dans le navigateur sur le port 3100.
  - Arrêter le serveur, puis compter avec `sqlite3 tmp/essai-0014.sqlite` (copie, pas la base vivante) : `select count(*) from clubs where directory_club_id is null` donne 0 ; noter le nombre d'entrées de `club_directory` et le nombre de `name_key` distincts dans `clubs`.
  - Noter dans le bilan les doublons visibles (même club, deux entrées).
- [ ] **Step 2 : lancer toute la suite**, qui doit passer : `npm run typecheck && npm test && npm run test:e2e`.
- [ ] **Step 3 : mettre à jour la feuille de route.** Ajouter l'étape 15 (« données compatibles », étape 0 du spec du 2026-10-23), faite. Dans le bilan, noter les décisions de cette étape :
  - le compteur unique de versions ;
  - la restauration qui vide la main de l'installation locale et de l'installation d'origine ;
  - `online` absent de l'énumération de la route.
- [ ] **Step 4 : spec §3.3.** À la ligne « Restauration », préciser que la main revient aussi « ici » quand elle était notée au nom de l'installation locale elle-même.
- [ ] **Step 5 : commit**
  ```bash
  git add docs
  git commit -m "docs: étape 15 (données compatibles) — feuille de route, bilan, précision sur la restauration"
  ```
