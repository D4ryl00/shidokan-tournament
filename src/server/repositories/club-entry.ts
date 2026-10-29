import { and, eq, inArray } from 'drizzle-orm';
import { lineToRows, WEIGHT_MISSING, type ClubFormLine } from '../../domain/club-form.js';
import { closedSummary, columnLabel, entryKey, isEntryClosed, offeredAgeBands } from '../../domain/closed-categories.js';
import { enteredValues, registrationsToLine } from '../../domain/club-line.js';
import { renderPrivacyNotice } from '../../domain/app-settings.js';
import { getAppSettings } from './app-settings.js';
import { normalizeName } from '../../domain/names.js';
import { ageRangeText } from '../../domain/grid.js';
import type { DisciplineId, Sex } from '../../domain/types.js';
import { assignAffiliationNumber, linkClub } from '../db/club-directory.js';
import type { AppDb } from '../db/client.js';
import { categories, clubDirectory, clubs, competitions, fighters, registrations } from '../db/schema.js';
import { getCompetition, getGrid } from './competitions.js';
import { closedSet } from './closed-categories.js';
import { NotFoundError, RegistrationValidationError, upsertFighterRegistration } from './registrations.js';

/** Compétition et club d'un lien personnel. */
export interface ClubAccess {
  competitionId: string;
  clubId: string;
}
export interface ClubLine {
  fighterId: string;
  /** Empreinte du combattant et de ses inscriptions (ids et versions) : une écriture sur une empreinte périmée est refusée,
   *  y compris quand l'organisateur a supprimé une inscription entre-temps. */
  version: string;
  line: ClubFormLine;
  editable: boolean;
  reason: string | null;
  /** Mentions pour le coach (catégorie qui n'est plus ouverte…). */
  notices: string[];
}
export interface ClubEntryHeader {
  coachName: string | null;
  coachPhone: string | null;
  coachEmails: string[];
  preApproval: boolean;
  affiliationNumber: string | null;
}
export interface ClubEntryView {
  competition: { name: string; date: string; location: string | null; deadline: string | null; status: 'closed' | 'open' | 'frozen' };
  editable: boolean;
  club: ClubEntryHeader & { name: string };
  /** `ages` : « 14 à 15 ans ». */
  ageBands: { code: string; label: string; ages: string; isMinor: boolean }[];
  /** Catégories de poids des tranches proposées, de la plus légère à l'ouverte. */
  weightClasses: { id: string; ageBandCode: string; sex: Sex; label: string; maxKg: number | null }[];
  /** Cases fermées (`entryKey`) : le formulaire ne propose pas ces choix. */
  closed: string[];
  /** Ce qui n'est pas ouvert, en phrases (comme sur les fiches). */
  closedSummary: string[];
  lines: ClubLine[];
  /** Mention sur les données personnelles, rendue (réglages de l'application). */
  privacyNotice: string;
}

export class ClubEntryClosedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super('Les inscriptions sont closes : contactez l’organisateur.');
  }
}
export class StaleLineError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Ce combattant a été modifié entre-temps : la liste a été rechargée.');
  }
}
export class LineReadOnlyError extends Error {
  readonly statusCode = 409;
}

export const LOCKED_REASON = 'Ses combats ont commencé : contactez l’organisateur.';
export const CLOSED_ENTRY = (label: string) => `${label} : catégorie non ouverte à cette compétition.`;
const CLOSED_NOTICE = (label: string) => `${label} : cette catégorie n’est plus ouverte, l’organisateur vous contactera.`;
const WITHDRAWN_NOTICE = (label: string) => `Ne combattra pas en ${label} : catégorie non ouverte.`;
export const WEIGHT_CLASS_MISSING = 'Catégorie de poids manquante.';
export const FFK_IDENTITY = 'Le sexe et la catégorie d’âge viennent de l’export FFK : contactez l’organisateur pour les changer.';

function competitionRow(db: AppDb, access: ClubAccess) {
  const c = db.select().from(competitions).where(eq(competitions.id, access.competitionId)).get();
  if (!c) throw new NotFoundError('Lien inconnu ou expiré.');
  return c;
}
function clubRow(db: AppDb, access: ClubAccess) {
  const club = db.select().from(clubs).where(and(eq(clubs.id, access.clubId), eq(clubs.competitionId, access.competitionId))).get();
  if (!club) throw new NotFoundError('Lien inconnu ou expiré.');
  return club;
}
const isEditable = (c: { clubEntryStatus: string; ownerInstanceId: string | null }) => c.clubEntryStatus === 'open' && c.ownerInstanceId === null;

function assertWritable(db: AppDb, access: ClubAccess): void {
  if (!isEditable(competitionRow(db, access))) throw new ClubEntryClosedError();
}

/** Ligne d'un combattant du club, avec sa version et son verrou. */
function lineOf(db: AppDb, fighter: typeof fighters.$inferSelect): ClubLine {
  const regs = db.select().from(registrations).where(eq(registrations.fighterId, fighter.id)).all();
  const catIds = regs.map((r) => r.categoryId).filter((x): x is string => !!x);
  const locked = catIds.length > 0 && db.select().from(categories).where(inArray(categories.id, catIds)).all().some((c) => c.status === 'started' || c.status === 'finished');
  const { line, editable, reason } = registrationsToLine(
    fighter,
    regs.map((r) => ({
      discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId, approxWeightKg: r.approxWeightKg,
      otherDisciplines: JSON.parse(r.otherDisciplinesJson) as DisciplineId[], acceptsJiyuFirst: r.acceptsJiyuFirst, originalJson: r.originalJson,
    })),
  );
  const version = [String(fighter.version ?? 0), ...regs.map((r) => `${r.id}:${r.version ?? 0}`).sort()].join('|');
  const closed = closedSet(db, fighter.competitionId);
  const notices = regs.flatMap((r) => {
    const cell = { ageBandCode: fighter.ageBandCode, sex: fighter.sex, discipline: r.discipline, ruleset: r.ruleset };
    if (r.withdrawnReason) return [WITHDRAWN_NOTICE(columnLabel(cell))];
    return !r.placementLocked && isEntryClosed(closed, cell) ? [CLOSED_NOTICE(columnLabel(cell))] : [];
  });
  return locked ? { fighterId: fighter.id, version, line, editable: false, reason: LOCKED_REASON, notices } : { fighterId: fighter.id, version, line, editable, reason, notices };
}

function headerOf(db: AppDb, club: typeof clubs.$inferSelect): ClubEntryView['club'] {
  const entry = club.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
  return {
    name: club.name, coachName: club.coachName, coachPhone: club.coachPhone, coachEmails: club.coachEmails, preApproval: club.preApproval,
    affiliationNumber: entry?.affiliationNumber ?? null,
  };
}

export async function getClubEntry(db: AppDb, access: ClubAccess): Promise<ClubEntryView> {
  const c = competitionRow(db, access);
  const club = clubRow(db, access);
  const grid = await getGrid(db, access.competitionId);
  const closed = closedSet(db, access.competitionId);
  const lines = db
    .select()
    .from(fighters)
    .where(eq(fighters.clubId, club.id))
    .orderBy(fighters.nameKey)
    .all()
    .map((f) => lineOf(db, f));
  // Tranches proposées, plus celle d'une ligne déjà enregistrée qui ne l'est plus (sa liste montre la valeur enregistrée).
  const ageBands = grid.ageBands.filter((b) => offeredAgeBands(grid, closed).includes(b) || lines.some((l) => l.line.ageBandCode === b.code));
  return {
    competition: { name: c.name, date: c.date, location: c.location, deadline: c.clubEntryDeadline, status: c.clubEntryStatus },
    editable: isEditable(c),
    club: headerOf(db, club),
    ageBands: ageBands.map((b) => ({ code: b.code, label: b.label, ages: ageRangeText(b), isMinor: b.isMinor })),
    weightClasses: grid.weightClasses
      .filter((w) => ageBands.some((b) => b.code === w.ageBandCode))
      .sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity))
      .map(({ id, ageBandCode, sex, label, maxKg }) => ({ id, ageBandCode, sex, label, maxKg })),
    closed: [...closed],
    closedSummary: closedSummary(grid, closed),
    lines,
    privacyNotice: renderPrivacyNotice(getAppSettings(db)),
  };
}

/** En-tête du club : met à jour le club de la compétition et l'annuaire (coordonnées données par le club lui-même). */
export async function updateClubEntryHeader(db: AppDb, access: ClubAccess, header: ClubEntryHeader): Promise<ClubEntryView['club']> {
  assertWritable(db, access);
  const club = clubRow(db, access);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const { affiliationNumber, ...fields } = header;
    t.update(clubs).set(fields).where(eq(clubs.id, club.id)).run();
    const entryId = club.directoryClubId ?? linkClub(t, club.id);
    const coords = {
      ...(fields.coachName ? { coachName: fields.coachName } : {}),
      ...(fields.coachPhone ? { coachPhone: fields.coachPhone } : {}),
      ...(fields.coachEmails.length ? { coachEmails: fields.coachEmails } : {}),
    };
    if (Object.keys(coords).length) t.update(clubDirectory).set(coords).where(eq(clubDirectory.id, entryId)).run();
    if (affiliationNumber) assignAffiliationNumber(t, club.id, affiliationNumber);
  });
  return headerOf(db, clubRow(db, access));
}

/** Combattant de ce club qui porte déjà ce nom et ce sexe (autre que `exceptId`). */
function duplicateOf(db: AppDb, clubId: string, line: ClubFormLine, exceptId: string | null) {
  const nameKey = normalizeName(`${line.lastName} ${line.firstName}`);
  return db
    .select()
    .from(fighters)
    .where(and(eq(fighters.clubId, clubId), eq(fighters.nameKey, nameKey)))
    .all()
    .find((f) => f.sex === line.sex && f.id !== exceptId);
}

/** Ligne existante du club, vérifiée avant une écriture : version à jour, ni verrouillée ni en lecture seule. */
function checkedLine(db: AppDb, clubId: string, fighterId: string, expectedVersion: string) {
  const fighter = db.select().from(fighters).where(and(eq(fighters.id, fighterId), eq(fighters.clubId, clubId))).get();
  if (!fighter) throw new NotFoundError('Combattant introuvable');
  const current = lineOf(db, fighter);
  if (current.version !== expectedVersion) throw new StaleLineError();
  if (!current.editable) throw new LineReadOnlyError(current.reason ?? '');
  return fighter;
}

/** Crée (fighterId null) ou modifie la ligne d'un combattant du club : ses inscriptions suivent la ligne (combat et/ou kata). */
export async function saveClubLine(db: AppDb, access: ClubAccess, fighterId: string | null, line: ClubFormLine, expectedVersion: string | null): Promise<ClubLine> {
  assertWritable(db, access);
  const club = clubRow(db, access);
  const competition = (await getCompetition(db, access.competitionId))!;
  const rows = lineToRows(line, 1, await getGrid(db, access.competitionId), competition.settings.weighInToleranceKg);
  // En ligne, le coach choisit la catégorie de poids : le poids actuel est facultatif.
  const errors = rows.flatMap((r) => r.errors).filter((e) => e !== WEIGHT_MISSING);
  if (line.combat && !line.weightClassId) errors.unshift(WEIGHT_CLASS_MISSING);
  if (errors.length || rows.some((r) => !r.input)) throw new RegistrationValidationError(errors);
  const inputs = rows.map((r) => ({ ...r.input!, clubId: club.id, source: 'online' as const }));
  // Une catégorie fermée ne s'ouvre pas en ligne, sauf pour une inscription déjà enregistrée qui y était.
  const closed = closedSet(db, access.competitionId);
  const known = new Set<string>();
  const existing = fighterId ? db.select().from(fighters).where(and(eq(fighters.id, fighterId), eq(fighters.clubId, club.id))).get() : undefined;
  if (existing) {
    for (const r of db.select().from(registrations).where(eq(registrations.fighterId, existing.id)).all()) {
      known.add(entryKey({ ageBandCode: existing.ageBandCode, sex: existing.sex, ...enteredValues({ ...r, otherDisciplines: [] }) }));
    }
  }
  const refused = inputs
    .map((i) => ({ ageBandCode: i.ageBandCode, sex: i.sex, discipline: i.discipline, ruleset: i.ruleset }))
    .filter((cell) => isEntryClosed(closed, cell) && !known.has(entryKey(cell)));
  if (refused.length) throw new RegistrationValidationError(refused.map((cell) => CLOSED_ENTRY(columnLabel(cell))));
  const savedId = db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const duplicate = duplicateOf(t, club.id, line, fighterId);
    if (duplicate) throw new RegistrationValidationError([`${duplicate.lastName} ${duplicate.firstName} est déjà dans la liste.`]);
    const fields = {
      lastName: line.lastName.trim(), firstName: line.firstName.trim(), nameKey: normalizeName(`${line.lastName} ${line.firstName}`),
      sex: line.sex!, ageBandCode: line.ageBandCode!,
      ...(line.kata ? { grade: line.grade?.trim() || null } : {}),
    };
    let id = fighterId;
    if (id) {
      const current = checkedLine(t, club.id, id, expectedVersion ?? '');
      // L'export FFK fait foi pour le sexe et l'âge (comme à l'import d'une fiche) : sa catégorie de poids en dépend.
      const ffk = t.select().from(registrations).where(and(eq(registrations.fighterId, id), eq(registrations.ffkConfirmed, true))).get();
      if (ffk && (current.sex !== fields.sex || current.ageBandCode !== fields.ageBandCode)) throw new RegistrationValidationError([FFK_IDENTITY]);
      t.update(fighters).set(fields).where(eq(fighters.id, id)).run();
    } else {
      id = crypto.randomUUID();
      t.insert(fighters).values({ id, competitionId: access.competitionId, clubId: club.id, licence: null, grade: null, weighInKg: null, ...fields }).run();
    }
    const kept = new Set<string>();
    for (const input of inputs) kept.add(upsertFighterRegistration(t, access.competitionId, id, input, kept));
    const dropped = t.select().from(registrations).where(eq(registrations.fighterId, id)).all().filter((r) => !kept.has(r.id));
    if (dropped.length) t.delete(registrations).where(inArray(registrations.id, dropped.map((r) => r.id))).run();
    return id;
  });
  return lineOf(db, db.select().from(fighters).where(eq(fighters.id, savedId)).get()!);
}

/** Retire un combattant du club : ses inscriptions et lui. */
export async function deleteClubLine(db: AppDb, access: ClubAccess, fighterId: string, expectedVersion: string): Promise<void> {
  assertWritable(db, access);
  const club = clubRow(db, access);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    checkedLine(t, club.id, fighterId, expectedVersion);
    t.delete(registrations).where(eq(registrations.fighterId, fighterId)).run();
    t.delete(fighters).where(eq(fighters.id, fighterId)).run();
  });
}
