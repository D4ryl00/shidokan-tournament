import { sql } from 'drizzle-orm';
import { blob, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Version (compteur unique de la base, jamais répété) et date de modification, tenues par des déclencheurs (`row-versions.ts`). */
const rowMeta = () => ({ version: integer('version'), updatedAt: text('updated_at') });

export const competitions = sqliteTable('competitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  date: text('date').notNull(),
  location: text('location'),
  settingsJson: text('settings_json').notNull(),
  weighInClosed: integer('weigh_in_closed', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  /** Installation qui a la main sur la compétition ; vide = gérée ici. */
  ownerInstanceId: text('owner_instance_id'),
  lastSyncAt: text('last_sync_at'),
  /** Inscriptions en ligne des clubs : pas encore ouvertes, ouvertes, figées. */
  clubEntryStatus: text('club_entry_status', { enum: ['closed', 'open', 'frozen'] }).notNull().default('closed'),
  clubEntryDeadline: text('club_entry_deadline'),
  /** Données d'organisation effacées (délai de conservation dépassé) : palmarès seul gardé. */
  purgedAt: text('purged_at'),
  ...rowMeta(),
});

/** Comptes des organisateurs (rôle serveur). Propres à l'installation : jamais copiés par une restauration ni gardés dans une sauvegarde. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['organisateur'] }).notNull().default('organisateur'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

/** Sessions de connexion (seule l'empreinte du jeton du cookie est gardée). */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  expiresAt: text('expires_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
});

/** Réglages de l'application (envoi des mails, mention sur les données, conservation…), propres à l'installation. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

/** Identité de cette installation (une seule ligne, créée au démarrage ; jamais copiée par une restauration). */
export const instance = sqliteTable('instance', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

/** Compteur unique d'où sont tirées les versions des lignes (une seule ligne, id 1). */
export const changeCounter = sqliteTable('change_counter', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull(),
});

/** Annuaire des clubs, indépendant des compétitions. */
export const clubDirectory = sqliteTable(
  'club_directory',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    /** Numéro d'affiliation FFK (chiffres en tête de l'entité FFK). */
    affiliationNumber: text('affiliation_number').unique(),
    ffkEntity: text('ffk_entity'),
    coachName: text('coach_name'),
    coachPhone: text('coach_phone'),
    coachEmail: text('coach_email'),
    notes: text('notes'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    ...rowMeta(),
  },
  (t) => [index('club_directory_name_key').on(t.nameKey)],
);

/** Journal des mails envoyés aux clubs (lien personnel). */
export const mailLog = sqliteTable('mail_log', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  clubId: text('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  sentAt: text('sent_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  status: text('status', { enum: ['sent', 'error'] }).notNull(),
  error: text('error'),
  ...rowMeta(),
});

/** Lien personnel d'un club pour une compétition (seule l'empreinte du jeton est gardée). */
export const clubInvitations = sqliteTable('club_invitations', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  clubId: text('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  sentAt: text('sent_at'),
  revokedAt: text('revoked_at'),
  lastUsedAt: text('last_used_at'),
  ...rowMeta(),
});

export const ageBands = sqliteTable(
  'age_bands',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    minAge: integer('min_age').notNull(),
    maxAge: integer('max_age'),
    isMinor: integer('is_minor', { mode: 'boolean' }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    onClubForm: integer('on_club_form', { mode: 'boolean' }).notNull().default(true),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.competitionId, t.code] })],
);

export const weightClasses = sqliteTable(
  'weight_classes',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    ageBandCode: text('age_band_code').notNull(),
    sex: text('sex', { enum: ['M', 'F'] }).notNull(),
    label: text('label').notNull(),
    maxKg: real('max_kg'),
    sortOrder: integer('sort_order').notNull(),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.competitionId, t.id] })],
);

export const ageLinks = sqliteTable('age_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  fromCode: text('from_code').notNull(),
  toCode: text('to_code').notNull(),
  kind: text('kind', { enum: ['C', 'D'] }).notNull(),
  ...rowMeta(),
});

/** Vagues d'une compétition : règles (tranches, disciplines) et clôture de leur pesée. */
export const waves = sqliteTable('waves', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  rulesJson: text('rules_json').notNull(),
  weighInClosed: integer('weigh_in_closed', { mode: 'boolean' }).notNull().default(false),
  ...rowMeta(),
});

/** Zones de combat d'une compétition (« Tatami 1 », « Ring »…), dans l'ordre d'affichage. */
export const zones = sqliteTable('zones', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  /** Disciplines accueillies (JSON) ; null = toutes. */
  disciplinesJson: text('disciplines_json'),
  ...rowMeta(),
});

export const clubs = sqliteTable('clubs', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  ffkEntity: text('ffk_entity'),
  coachName: text('coach_name'),
  coachPhone: text('coach_phone'),
  coachEmail: text('coach_email'),
  preApproval: integer('pre_approval', { mode: 'boolean' }).notNull().default(false),
  directoryClubId: text('directory_club_id').references(() => clubDirectory.id, { onDelete: 'set null' }),
  ...rowMeta(),
});

export const fighters = sqliteTable('fighters', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  clubId: text('club_id').references(() => clubs.id, { onDelete: 'set null' }),
  lastName: text('last_name').notNull(),
  firstName: text('first_name').notNull(),
  nameKey: text('name_key').notNull(),
  sex: text('sex', { enum: ['M', 'F'] }).notNull(),
  ageBandCode: text('age_band_code').notNull(),
  licence: text('licence'),
  grade: text('grade'),
  weighInKg: real('weigh_in_kg'),
  ...rowMeta(),
});

export const registrations = sqliteTable('registrations', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  fighterId: text('fighter_id')
    .notNull()
    .references(() => fighters.id, { onDelete: 'cascade' }),
  discipline: text('discipline', { enum: ['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata'] }).notNull(),
  ruleset: text('ruleset', { enum: ['jiyu', 'shobu'] }),
  weightClassId: text('weight_class_id'),
  approxWeightKg: real('approx_weight_kg'),
  otherDisciplinesJson: text('other_disciplines_json').notNull().default('[]'),
  acceptsJiyuFirst: integer('accepts_jiyu_first', { mode: 'boolean' }),
  source: text('source', { enum: ['club_form', 'ffk', 'manual', 'onsite', 'online'] }).notNull(),
  /** Présence dans la vague de sa catégorie (non pesé, présent, absent). */
  presence: text('presence', { enum: ['unknown', 'present', 'absent'] }).notNull().default('unknown'),
  ffkConfirmed: integer('ffk_confirmed', { mode: 'boolean' }).notNull().default(false),
  categoryId: text('category_id'),
  /** Placement validé par un recasement : la synchronisation automatique ne le déplace plus. */
  placementLocked: integer('placement_locked', { mode: 'boolean' }).notNull().default(false),
  /** Discipline, règlement et catégorie de poids d'avant le premier recasement (pour le retour). */
  originalJson: text('original_json'),
  recasementType: text('recasement_type'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  ...rowMeta(),
});

/** Fichiers envoyés pour import (gardés le temps de l'aperçu et de la validation). */
export const uploads = sqliteTable('uploads', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

/** Correspondances de colonnes mémorisées, par signature d'en-tête (toutes compétitions). */
export const importMappings = sqliteTable('import_mappings', {
  signature: text('signature').primaryKey(),
  mappingJson: text('mapping_json').notNull(),
});

/** Lien mémorisé « nom de club (fiche) → entité FFK » (toutes compétitions). */
export const clubAliases = sqliteTable('club_aliases', {
  nameKey: text('name_key').primaryKey(),
  clubEntity: text('club_entity').notNull(),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  keyString: text('key_string').notNull(),
  keyJson: text('key_json').notNull(),
  label: text('label').notNull(),
  status: text('status', { enum: ['provisional', 'ready', 'started', 'finished'] }).notNull().default('provisional'),
  format: text('format'),
  repechage: integer('repechage', { mode: 'boolean' }),
  thirdPlace: integer('third_place', { mode: 'boolean' }),
  seed: integer('seed').notNull(),
  bracketJson: text('bracket_json'),
  /** Clés naturelles absorbées par une fusion (leurs inscriptions continuent d'arriver ici). */
  aliasKeys: text('alias_keys').notNull().default('[]'),
  stale: integer('stale', { mode: 'boolean' }).notNull().default(false),
  zoneId: text('zone_id').references(() => zones.id, { onDelete: 'set null' }),
  /** Choix individuel de vague : id d'une vague, « none » (en attente) ou null (règles des vagues). */
  waveOverride: text('wave_override'),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Heure de la dernière renumérotation après le lancement de sa vague (imprimée « mis à jour à HH:MM »). */
  numbersUpdatedAt: text('numbers_updated_at'),
  ...rowMeta(),
});

/** Lancement d'une vague (`wave_key` '' : vague implicite d'une compétition sans vague) ; `launched` faux : rouverte. */
export const waveLaunches = sqliteTable(
  'wave_launches',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    waveKey: text('wave_key').notNull(),
    launched: integer('launched', { mode: 'boolean' }).notNull(),
    restartNumbering: integer('restart_numbering', { mode: 'boolean' }).notNull().default(false),
    launchedAt: text('launched_at').notNull(),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.competitionId, t.waveKey] })],
);

/** Numéros de passage figés au lancement d'une vague (`match_id` 'kata' : bloc de kata entier). */
export const frozenPassages = sqliteTable(
  'frozen_passages',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    waveKey: text('wave_key').notNull(),
    zoneId: text('zone_id').notNull(),
    number: integer('number').notNull(),
    categoryId: text('category_id').notNull(),
    matchId: text('match_id').notNull(),
    noRest: integer('no_rest', { mode: 'boolean' }).notNull().default(false),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.competitionId, t.waveKey, t.categoryId, t.matchId] })],
);

/** Journal des recasements validés (avec de quoi les annuler). */
export const recasements = sqliteTable('recasements', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id')
    .notNull()
    .references(() => competitions.id, { onDelete: 'cascade' }),
  registrationId: text('registration_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  type: text('type').notNull(),
  fromLabel: text('from_label').notNull(),
  toLabel: text('to_label').notNull(),
  /** Motif affiché (raison de la proposition). */
  reason: text('reason').notNull().default(''),
  manual: integer('manual', { mode: 'boolean' }).notNull(),
  preApproved: integer('pre_approved', { mode: 'boolean' }).notNull(),
  bulk: integer('bulk', { mode: 'boolean' }).notNull(),
  status: text('status', { enum: ['validated', 'undone'] }).notNull().default('validated'),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  ...rowMeta(),
});

export const refusals = sqliteTable(
  'refusals',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id').notNull(),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.competitionId, t.proposalId] })],
);

/** Résultats saisis (avec les deux combattants du combat au moment de la saisie). */
export const matchResults = sqliteTable(
  'match_results',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
    matchId: text('match_id').notNull(),
    winner: text('winner', { enum: ['a', 'b'] }).notNull(),
    method: text('method', { enum: ['points', 'decision', 'ko', 'abandon', 'disqualification', 'forfeit'] }).notNull(),
    score: text('score'),
    entrantA: text('entrant_a').notNull(),
    entrantB: text('entrant_b').notNull(),
    createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.matchId] })],
);

export const kataScores = sqliteTable(
  'kata_scores',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
    registrationId: text('registration_id').notNull(),
    round: text('round', { enum: ['round1', 'final'] }).notNull(),
    notesJson: text('notes_json').notNull(),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.registrationId, t.round] })],
);

/** Départages décidés par l'organisateur : scope « pool:<n> » ou « kata ». */
export const tieBreaks = sqliteTable(
  'tie_breaks',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
    scope: text('scope').notNull(),
    orderJson: text('order_json').notNull(),
    ...rowMeta(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.scope] })],
);

export const gridTemplates = sqliteTable('grid_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gridJson: text('grid_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
