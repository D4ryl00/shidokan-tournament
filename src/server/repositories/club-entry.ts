import { and, eq, inArray } from 'drizzle-orm';
import { closedEntryWarning, lineToRows, WEIGHT_MISSING, type ClubFormLine } from '../../domain/club-form.js';
import { closedSummary, columnLabel, entryKey, isEntryClosed, offeredAgeBands } from '../../domain/closed-categories.js';
import { enteredValues, registrationsToLine } from '../../domain/club-line.js';
import { renderPrivacyNotice } from '../../domain/app-settings.js';
import { getAppSettings } from './app-settings.js';
import { normalizeName } from '../../domain/names.js';
import { ageRangeText } from '../../domain/grid.js';
import type { DisciplineId, Sex } from '../../domain/types.js';
import { assignAffiliationNumber, checkAffiliationNumber, linkClubResult } from '../db/club-directory.js';
import type { AppDb } from '../db/client.js';
import { categories, clubDirectory, clubs, competitions, fighters, registrations } from '../db/schema.js';
import { getCompetition, getGrid } from './competitions.js';
import { closedSet } from './closed-categories.js';
import { clubValues, recordClubChange } from './club-changes.js';
import { NotFoundError, RegistrationValidationError, upsertFighterRegistration } from './registrations.js';

/** Compétition et club d'un lien personnel. */
export interface ClubAccess {
  competitionId: string;
  clubId: string;
}
/** Qui écrit la ligne : le coach (lien personnel) ou l'organisateur (écran Inscriptions). */
export type LineWriter = { kind: 'coach' } | { kind: 'organiser' };
export interface ClubLine {
  fighterId: string;
  /** Club actuel du combattant ('' s'il n'en a pas). */
  clubId: string;
  /** Nom masqué sur la page publique (vaut pour toutes ses inscriptions). */
  publicNameHidden: boolean;
  /** Empreinte du combattant et de ses inscriptions (ids et versions) : une écriture sur une empreinte périmée est refusée,
   *  y compris quand l'organisateur a supprimé une inscription entre-temps. */
  version: string;
  line: ClubFormLine;
  editable: boolean;
  /** Combats commencés, vu par l'organisateur : la ligne est verrouillée sauf le nom, le prénom, le grade et le nom masqué. */
  namesEditable: boolean;
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
  /** Plusieurs disciplines de combat le même jour autorisées (réglage de la compétition). */
  multipleCombats: boolean;
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
export const ORGANISER_LOCKED_REASON =
  'Ses combats ont commencé : seuls le nom, le prénom, le grade et l’affichage du nom se corrigent ici ; pour la catégorie, passez par Réaffectation ou Tableaux.';
export const CLOSED_ENTRY = (label: string) => `${label} : catégorie non ouverte à cette compétition.`;
const CLOSED_NOTICE = (label: string) => `${label} : cette catégorie n’est plus ouverte, l’organisateur vous contactera.`;
const WITHDRAWN_NOTICE = (label: string) => `Ne combattra pas en ${label} : catégorie non ouverte.`;
export const WEIGHT_CLASS_MISSING = 'Catégorie de poids manquante.';

function competitionRow(db: AppDb, access: ClubAccess) {
  const c = db.select().from(competitions).where(eq(competitions.id, access.competitionId)).get();
  if (!c) throw new NotFoundError('Lien inconnu ou expiré.');
  return c;
}
function clubRow(db: AppDb, access: ClubAccess, viewer: LineWriter['kind'] = 'coach') {
  const club = db.select().from(clubs).where(and(eq(clubs.id, access.clubId), eq(clubs.competitionId, access.competitionId))).get();
  if (!club) throw new NotFoundError(viewer === 'coach' ? 'Lien inconnu ou expiré.' : 'Club introuvable');
  return club;
}
const isEditable = (c: { clubEntryStatus: string; ownerInstanceId: string | null }) => c.clubEntryStatus === 'open' && c.ownerInstanceId === null;

function assertWritable(db: AppDb, access: ClubAccess): void {
  if (!isEditable(competitionRow(db, access))) throw new ClubEntryClosedError();
}

/** Ligne d'un combattant du club, avec sa version et son verrou. */
function lineOf(db: AppDb, fighter: typeof fighters.$inferSelect, viewer: LineWriter['kind'] = 'coach'): ClubLine {
  const regs = db.select().from(registrations).where(eq(registrations.fighterId, fighter.id)).all();
  const catIds = regs.map((r) => r.categoryId).filter((x): x is string => !!x);
  const locked = catIds.length > 0 && db.select().from(categories).where(inArray(categories.id, catIds)).all().some((c) => c.status === 'started' || c.status === 'finished');
  const { line, editable, reason, warnings } = registrationsToLine(
    fighter,
    regs.map((r) => ({
      discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId, approxWeightKg: r.approxWeightKg,
      otherDisciplines: JSON.parse(r.otherDisciplinesJson) as DisciplineId[], acceptsJiyuFirst: r.acceptsJiyuFirst, originalJson: r.originalJson,
    })),
  );
  const version = [String(fighter.version ?? 0), ...regs.map((r) => `${r.id}:${r.version ?? 0}`).sort()].join('|');
  const closed = closedSet(db, fighter.competitionId);
  const notices = [...warnings, ...regs.flatMap((r) => {
    const cell = { ageBandCode: fighter.ageBandCode, sex: fighter.sex, discipline: r.discipline, ruleset: r.ruleset };
    if (r.withdrawnReason) return [WITHDRAWN_NOTICE(columnLabel(cell))];
    if (r.placementLocked || !isEntryClosed(closed, cell)) return [];
    // L'organisateur peut choisir une catégorie fermée : il reçoit l'avertissement des fiches, le coach la mention de contact.
    return [viewer === 'organiser' ? closedEntryWarning(cell, closed)! : CLOSED_NOTICE(columnLabel(cell))];
  })];
  const base = { fighterId: fighter.id, clubId: fighter.clubId ?? '', publicNameHidden: fighter.publicNameHidden, version, line, notices, namesEditable: false };
  if (!locked) return { ...base, editable, reason };
  return viewer === 'organiser' ? { ...base, editable: false, namesEditable: true, reason: ORGANISER_LOCKED_REASON } : { ...base, editable: false, reason: LOCKED_REASON };
}

/** Ligne relue après le recalcul des catégories qui suit une écriture : sa version tient compte des inscriptions déplacées. */
export function reloadLine(db: AppDb, saved: ClubLine, viewer: LineWriter['kind']): ClubLine {
  const fighter = db.select().from(fighters).where(eq(fighters.id, saved.fighterId)).get();
  return fighter ? lineOf(db, fighter, viewer) : saved;
}

/** Ligne d'un combattant pour l'écran Inscriptions (organisateur). Sans club : pas de ligne éditable, l'écran passe d'abord par l'étape club. */
export function fighterLine(db: AppDb, competitionId: string, fighterId: string): ClubLine {
  const fighter = db.select().from(fighters).where(and(eq(fighters.id, fighterId), eq(fighters.competitionId, competitionId))).get();
  if (!fighter) throw new NotFoundError('Combattant introuvable');
  const line = lineOf(db, fighter, 'organiser');
  // Sans club et combats commencés : rien à corriger ici (l'étape club viendrait d'abord, et le club est verrouillé).
  return fighter.clubId ? line : { ...line, editable: false, namesEditable: false, reason: line.reason === ORGANISER_LOCKED_REASON ? ORGANISER_LOCKED_REASON : null };
}

function headerOf(db: AppDb, club: typeof clubs.$inferSelect): ClubEntryView['club'] {
  const entry = club.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
  return {
    name: club.name, coachName: club.coachName, coachPhone: club.coachPhone, coachEmails: club.coachEmails, preApproval: club.preApproval,
    affiliationNumber: clubValues(club, entry ?? null).affiliationNumber,
  };
}

export async function getClubEntry(db: AppDb, access: ClubAccess): Promise<ClubEntryView> {
  const c = competitionRow(db, access);
  const club = clubRow(db, access);
  const multipleCombats = (await getCompetition(db, access.competitionId))!.settings.multipleCombatDisciplinesPerDay;
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
    multipleCombats,
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

/**
 * En-tête du club : met à jour le club de la compétition (numéro d'affiliation compris), pas l'annuaire. Ce qui diffère de la fiche
 * devient un changement à examiner par l'organisateur, si l'enregistrement a changé une valeur comparée. Seul un club sans fiche
 * en reçoit une, avec ses valeurs ; une fiche existante n'est jamais complétée.
 */
export async function updateClubEntryHeader(db: AppDb, access: ClubAccess, header: ClubEntryHeader): Promise<ClubEntryView['club']> {
  assertWritable(db, access);
  const club = clubRow(db, access);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const { affiliationNumber, ...fields } = header;
    const wasLinked = !!club.directoryClubId;
    const knownEntry = club.directoryClubId ? t.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() ?? null : null;
    const before = wasLinked ? clubValues(club, knownEntry) : undefined;
    t.update(clubs).set(fields).where(eq(clubs.id, club.id)).run();
    const { id: entryId, created } = linkClubResult(t, club.id, 'link');
    const entry = t.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get()!;
    let own: string | null;
    if (affiliationNumber) {
      if (affiliationNumber === club.affiliationNumber) own = affiliationNumber; // déjà gardé pour le club : plus de contrôle
      else if (affiliationNumber === entry.affiliationNumber) own = null; // celui de la fiche, laissé en place : le club le suit
      else {
        // Une fiche créée à l'instant prend le numéro du club ; sinon il est seulement contrôlé.
        if (created) assignAffiliationNumber(t, club.id, affiliationNumber);
        else checkAffiliationNumber(t, club.id, affiliationNumber);
        own = affiliationNumber;
      }
    } else {
      // Effacé : '' si la fiche a un numéro (la page n'affiche plus le sien) ; un effacement déjà enregistré reste.
      own = entry.affiliationNumber && wasLinked ? '' : club.affiliationNumber === '' ? '' : null;
    }
    t.update(clubs).set({ affiliationNumber: own }).where(eq(clubs.id, club.id)).run();
    recordClubChange(t, club.id, 'club', before);
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

/** Ligne existante, vérifiée avant une écriture : version à jour, ni verrouillée ni en lecture seule. `clubId` : club où elle doit être (null : n'importe lequel de la compétition). */
function checkedLine(db: AppDb, competitionId: string, clubId: string | null, fighterId: string, expectedVersion: string, viewer: LineWriter['kind'] = 'coach') {
  const fighter = db
    .select()
    .from(fighters)
    .where(and(eq(fighters.id, fighterId), eq(fighters.competitionId, competitionId), ...(clubId ? [eq(fighters.clubId, clubId)] : [])))
    .get();
  if (!fighter) throw new NotFoundError('Combattant introuvable');
  const current = lineOf(db, fighter, viewer);
  if (current.version !== expectedVersion) throw new StaleLineError();
  if (!current.editable) throw new LineReadOnlyError(current.reason ?? '');
  return fighter;
}

/** Crée (fighterId null) ou modifie la ligne d'un combattant : ses inscriptions suivent la ligne (combats et/ou kata). L'organisateur peut aussi le changer de club. */
export async function saveClubLine(
  db: AppDb,
  access: ClubAccess,
  fighterId: string | null,
  line: ClubFormLine,
  expectedVersion: string | null,
  opts: { writer: LineWriter; publicNameHidden?: boolean },
): Promise<ClubLine> {
  const coach = opts.writer.kind === 'coach';
  // Une seule lecture de la compétition (la route de l'organisateur ne la vérifie pas avant).
  const competition = await getCompetition(db, access.competitionId);
  if (!competition) throw new NotFoundError(coach ? 'Lien inconnu ou expiré.' : 'Compétition introuvable');
  if (coach) assertWritable(db, access);
  const club = clubRow(db, access, opts.writer.kind);
  // Le coach ne touche que les combattants de son club ; l'organisateur, ceux de toute la compétition (il peut les changer de club).
  const existing = fighterId
    ? db.select().from(fighters).where(and(eq(fighters.id, fighterId), eq(fighters.competitionId, access.competitionId), ...(coach ? [eq(fighters.clubId, club.id)] : []))).get()
    : undefined;
  if (existing && !coach) {
    const current = lineOf(db, existing, 'organiser');
    if (current.namesEditable) return saveNamesOnly(db, club.id, existing, current, line, expectedVersion ?? '', opts.publicNameHidden);
  }
  const registered = existing ? db.select().from(registrations).where(eq(registrations.fighterId, existing.id)).all() : [];
  // Plusieurs combats avec le réglage désactivé : seulement s'ils étaient tous déjà enregistrés pour ce combattant.
  const alreadyEntered = new Set(registered.map((r) => enteredValues({ ...r, otherDisciplines: [] }).discipline));
  const multipleCombats = competition.settings.multipleCombatDisciplinesPerDay || line.combats.every((d) => alreadyEntered.has(d));
  const rows = lineToRows(line, 1, await getGrid(db, access.competitionId), competition.settings.weighInToleranceKg, new Set(), { multipleCombats });
  // En ligne, le coach choisit la catégorie de poids : le poids actuel est facultatif.
  const errors = rows.flatMap((r) => r.errors).filter((e) => e !== WEIGHT_MISSING);
  if (line.combats.length && !line.weightClassId) errors.unshift(WEIGHT_CLASS_MISSING);
  if (errors.length || rows.some((r) => !r.input)) throw new RegistrationValidationError(errors);
  // La source d'une inscription existante est gardée par `upsertFighterRegistration` ; celle d'une nouvelle dépend de l'auteur.
  const source = coach ? ('online' as const) : ('onsite' as const);
  const inputs = rows.map((r) => ({ ...r.input!, clubId: club.id, source }));
  // Une catégorie fermée ne s'ouvre pas en ligne, sauf pour une inscription déjà enregistrée qui y était ; l'organisateur peut la choisir.
  if (coach) {
    const closed = closedSet(db, access.competitionId);
    const known = new Set<string>();
    if (existing) for (const r of registered) known.add(entryKey({ ageBandCode: existing.ageBandCode, sex: existing.sex, ...enteredValues({ ...r, otherDisciplines: [] }) }));
    const refused = inputs
      .map((i) => ({ ageBandCode: i.ageBandCode, sex: i.sex, discipline: i.discipline, ruleset: i.ruleset }))
      .filter((cell) => isEntryClosed(closed, cell) && !known.has(entryKey(cell)));
    if (refused.length) throw new RegistrationValidationError(refused.map((cell) => CLOSED_ENTRY(columnLabel(cell))));
  }
  const savedId = db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const duplicate = duplicateOf(t, club.id, line, fighterId);
    if (duplicate) throw new RegistrationValidationError([`${duplicate.lastName} ${duplicate.firstName} est déjà dans la liste.`]);
    const fields = {
      lastName: line.lastName.trim(), firstName: line.firstName.trim(), nameKey: normalizeName(`${line.lastName} ${line.firstName}`),
      sex: line.sex!, ageBandCode: line.ageBandCode!, clubId: club.id,
      ...(line.kata ? { grade: line.grade?.trim() || null } : {}),
      ...(opts.publicNameHidden === undefined ? {} : { publicNameHidden: opts.publicNameHidden }),
    };
    let id = fighterId;
    if (id) {
      checkedLine(t, access.competitionId, coach ? club.id : null, id, expectedVersion ?? '', opts.writer.kind);
      t.update(fighters).set(fields).where(eq(fighters.id, id)).run();
    } else {
      id = crypto.randomUUID();
      t.insert(fighters).values({ id, competitionId: access.competitionId, licence: null, grade: null, weighInKg: null, ...fields }).run();
    }
    const kept = new Set<string>();
    // Sexe ou âge changé par le coach : la catégorie de poids de la ligne l'emporte sur celle de l'export FFK (qui ne correspond plus) ;
    // le choix de l'organisateur l'emporte toujours.
    const identityChanged = !!existing && (existing.sex !== line.sex || existing.ageBandCode !== line.ageBandCode);
    for (const input of inputs) kept.add(upsertFighterRegistration(t, access.competitionId, id, input, kept, { weightClassWins: !coach || identityChanged }));
    const dropped = t.select().from(registrations).where(eq(registrations.fighterId, id)).all().filter((r) => !kept.has(r.id));
    if (dropped.length) t.delete(registrations).where(inArray(registrations.id, dropped.map((r) => r.id))).run();
    return id;
  });
  return lineOf(db, db.select().from(fighters).where(eq(fighters.id, savedId)).get()!, opts.writer.kind);
}

/**
 * Combattant dont les combats ont commencé, corrigé par l'organisateur : seuls le nom, le prénom, le grade (s'il fait du kata)
 * et le nom masqué changent ; le reste de la ligne est ignoré, ses inscriptions et ses catégories ne bougent pas. Pas de changement de club.
 */
function saveNamesOnly(
  db: AppDb, clubId: string, fighter: typeof fighters.$inferSelect, current: ClubLine, line: ClubFormLine, expectedVersion: string, publicNameHidden: boolean | undefined,
): ClubLine {
  if (current.version !== expectedVersion) throw new StaleLineError();
  if (fighter.clubId !== clubId) throw new LineReadOnlyError(current.reason ?? '');
  const lastName = line.lastName.trim();
  const firstName = line.firstName.trim();
  if (!lastName) throw new RegistrationValidationError(['Le nom est obligatoire.']);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const duplicate = duplicateOf(t, clubId, { ...line, sex: fighter.sex }, fighter.id);
    if (duplicate) throw new RegistrationValidationError([`${duplicate.lastName} ${duplicate.firstName} est déjà dans la liste.`]);
    t.update(fighters)
      .set({
        lastName, firstName, nameKey: normalizeName(`${lastName} ${firstName}`),
        ...(current.line.kata ? { grade: line.grade?.trim() || null } : {}),
        ...(publicNameHidden === undefined ? {} : { publicNameHidden }),
      })
      .where(eq(fighters.id, fighter.id))
      .run();
  });
  return lineOf(db, db.select().from(fighters).where(eq(fighters.id, fighter.id)).get()!, 'organiser');
}

/** Retire un combattant du club : ses inscriptions et lui. */
export async function deleteClubLine(db: AppDb, access: ClubAccess, fighterId: string, expectedVersion: string, opts: { writer: LineWriter }): Promise<void> {
  if (opts.writer.kind === 'coach') assertWritable(db, access);
  const club = clubRow(db, access, opts.writer.kind);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    // L'organisateur supprime un combattant de n'importe quel club de la compétition (la fenêtre peut avoir changé son club).
    checkedLine(t, access.competitionId, opts.writer.kind === 'coach' ? club.id : null, fighterId, expectedVersion, opts.writer.kind);
    t.delete(registrations).where(eq(registrations.fighterId, fighterId)).run();
    t.delete(fighters).where(eq(fighters.id, fighterId)).run();
  });
}
