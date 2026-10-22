import { sql } from 'drizzle-orm';
import { blob, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const competitions = sqliteTable('competitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  date: text('date').notNull(),
  location: text('location'),
  settingsJson: text('settings_json').notNull(),
  weighInClosed: integer('weigh_in_closed', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
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
  source: text('source', { enum: ['club_form', 'ffk', 'manual', 'onsite'] }).notNull(),
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
});

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
});

export const refusals = sqliteTable(
  'refusals',
  {
    competitionId: text('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id').notNull(),
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
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.scope] })],
);

export const gridTemplates = sqliteTable('grid_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gridJson: text('grid_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
