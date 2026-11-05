import { and, eq, gte } from 'drizzle-orm';
import { differingFields, isUpcoming, propagationKind, type ClubField, type ClubValues } from '../../domain/club-changes.js';
import { normalizeName } from '../../domain/names.js';
import type { AppDb } from '../db/client.js';
import { clubChanges, clubDirectory, clubs, competitions } from '../db/schema.js';
import { getManagement, ReadOnlyCompetitionError, readOnlyMessage } from '../sync/ownership.js';
import { checkNumber, DirectoryConflictError, updateDirectoryEntry } from './directory.js';
import { NotFoundError } from './registrations.js';

type ClubRow = typeof clubs.$inferSelect;
type EntryRow = typeof clubDirectory.$inferSelect;

/**
 * Coordonnées du club de la compétition. Numéro : `''` (effacé par le club) vaut aucun numéro ;
 * sinon celui du club ; sinon celui de la fiche d'annuaire.
 */
export function clubValues(club: ClubRow, entry: Pick<EntryRow, 'affiliationNumber'> | null): ClubValues {
  const affiliationNumber = club.affiliationNumber === '' ? null : (club.affiliationNumber ?? entry?.affiliationNumber ?? null);
  return { name: club.name, coachName: club.coachName, coachPhone: club.coachPhone, coachEmails: club.coachEmails, affiliationNumber };
}

/** Coordonnées de la fiche d'annuaire. */
export const directoryValues = (entry: EntryRow): ClubValues => ({
  name: entry.name, coachName: entry.coachName, coachPhone: entry.coachPhone, coachEmails: entry.coachEmails, affiliationNumber: entry.affiliationNumber,
});

/**
 * Compare le club à sa fiche d'annuaire après une modification de ses coordonnées, et tient à jour son changement à examiner :
 * sans fiche, rien ; sans différence, le changement disparaît ; un changement ignoré aux mêmes valeurs reste ignoré ;
 * sinon il est écrit (toutes les valeurs du club) et à examiner.
 * `before` : valeurs du club avant l'enregistrement. Si aucun champ comparé n'a changé, aucun changement n'est créé ni redaté
 * (un changement existant n'est que rattaché à la fiche du lien actuel) : la différence vient d'ailleurs, de la fiche par exemple.
 */
export function recordClubChange(db: AppDb, clubId: string, origin: 'club' | 'competition', before?: ClubValues): void {
  const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
  if (!club?.directoryClubId) return;
  const entry = db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get();
  if (!entry) return;
  const values = clubValues(club, entry);
  const existing = db.select().from(clubChanges).where(eq(clubChanges.clubId, clubId)).get();
  if (!differingFields(values, directoryValues(entry)).length) {
    if (existing) db.delete(clubChanges).where(eq(clubChanges.clubId, clubId)).run();
    return;
  }
  if (before && !differingFields(values, before).length) {
    if (existing && existing.directoryId !== entry.id) db.update(clubChanges).set({ directoryId: entry.id }).where(eq(clubChanges.clubId, clubId)).run();
    return;
  }
  if (existing?.ignored && existing.directoryId === entry.id && !differingFields(values, JSON.parse(existing.valuesJson) as ClubValues).length) return;
  const row = { competitionId: club.competitionId, directoryId: entry.id, origin, valuesJson: JSON.stringify(values), changedAt: new Date().toISOString(), ignored: false };
  db.insert(clubChanges).values({ clubId, ...row }).onConflictDoUpdate({ target: clubChanges.clubId, set: row }).run();
}

// --- Décisions de l'organisateur et report de l'annuaire vers les compétitions à venir ---

const asTx = (tx: unknown) => tx as AppDb;

/** Date du jour, locale (`AAAA-MM-JJ`) : une compétition du jour est encore « à venir ». */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface ClubChangeView {
  clubId: string;
  competitionId: string;
  competitionName: string;
  competitionDate: string;
  managedHere: boolean;
  ownerName: string | null;
  upcoming: boolean;
  directoryId: string;
  directoryVersion: number;
  origin: 'club' | 'competition';
  changedAt: string;
  values: ClubValues;
  directory: ClubValues;
  fields: ClubField[];
}

/**
 * Changements à examiner : ni ignorés ni portant sur une fiche archivée. Une ligne devenue sans différence (la fiche ou le club a bougé
 * entre-temps) est supprimée ici.
 */
export function listClubChanges(db: AppDb, competitionId?: string): ClubChangeView[] {
  const today = localToday();
  const rows = db.select().from(clubChanges).where(competitionId ? eq(clubChanges.competitionId, competitionId) : undefined).all();
  const views: ClubChangeView[] = [];
  for (const row of rows) {
    const club = db.select().from(clubs).where(eq(clubs.id, row.clubId)).get();
    const entry = club?.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
    const competition = club ? db.select().from(competitions).where(eq(competitions.id, club.competitionId)).get() : undefined;
    if (!club || !entry || !competition) {
      db.delete(clubChanges).where(eq(clubChanges.clubId, row.clubId)).run();
      continue;
    }
    const values = clubValues(club, entry);
    const directory = directoryValues(entry);
    const fields = differingFields(values, directory);
    if (!fields.length) {
      db.delete(clubChanges).where(eq(clubChanges.clubId, row.clubId)).run();
      continue;
    }
    if (row.ignored || entry.archived) continue;
    const management = getManagement(db, competition.id);
    views.push({
      clubId: club.id, competitionId: competition.id, competitionName: competition.name, competitionDate: competition.date, managedHere: management.managedHere,
      ownerName: management.ownerName, upcoming: isUpcoming(competition.date, today), directoryId: entry.id, directoryVersion: entry.version ?? 0, origin: row.origin,
      changedAt: row.changedAt, values, directory, fields,
    });
  }
  return views.sort((a, b) => a.competitionDate.localeCompare(b.competitionDate) || a.competitionName.localeCompare(b.competitionName) || a.values.name.localeCompare(b.values.name));
}

/** Ferme le changement d'un club devenu sans différence, ou le rattache à la fiche du lien actuel ; n'en crée jamais. */
function reconcileChange(db: AppDb, clubId: string): void {
  const row = db.select().from(clubChanges).where(eq(clubChanges.clubId, clubId)).get();
  if (!row) return;
  const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
  const entry = club?.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
  if (!club || !entry || !differingFields(clubValues(club, entry), directoryValues(entry)).length) db.delete(clubChanges).where(eq(clubChanges.clubId, clubId)).run();
  else if (row.directoryId !== entry.id) db.update(clubChanges).set({ directoryId: entry.id }).where(eq(clubChanges.clubId, clubId)).run();
}

/** Numéro propre au club pour une valeur voulue : celui de la fiche se suit (null) ; effacé alors que la fiche en a un : `''`. */
function clubNumber(value: string | null, entry: Pick<EntryRow, 'affiliationNumber'>): string | null {
  const v = (value ?? '').trim();
  if (v === (entry.affiliationNumber ?? '')) return null;
  return v === '' ? '' : v;
}

/** Garde le statut de lecture seule (compétition gérée ailleurs) et « à venir » d'une compétition avant d'y écrire, dans la transaction en cours. */
function assertWritable(db: AppDb, competitionId: string): void {
  const competition = db.select().from(competitions).where(eq(competitions.id, competitionId)).get();
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const management = getManagement(db, competitionId);
  if (!management.managedHere) throw new ReadOnlyCompetitionError(readOnlyMessage(management));
  if (!isUpcoming(competition.date, localToday())) throw new DirectoryConflictError('Cette compétition n’est plus à venir : ses clubs ne sont pas modifiés.');
}

function assertNameFree(db: AppDb, club: ClubRow, name: string): void {
  const clash = db.select().from(clubs).where(and(eq(clubs.competitionId, club.competitionId), eq(clubs.nameKey, normalizeName(name)))).all().find((c) => c.id !== club.id);
  if (clash) throw new DirectoryConflictError(`Un autre club de cette compétition porte déjà le nom « ${clash.name} ».`);
}

/** Écrit des coordonnées dans un club (nom : sa clé suit) puis referme son changement s'il n'y a plus de différence. N'en crée aucun. */
function writeClubValues(db: AppDb, club: ClubRow, entry: EntryRow, values: Partial<ClubValues>): void {
  const set: Partial<typeof clubs.$inferInsert> = {};
  if (values.name !== undefined) Object.assign(set, { name: values.name.trim(), nameKey: normalizeName(values.name) });
  if (values.coachName !== undefined) set.coachName = values.coachName;
  if (values.coachPhone !== undefined) set.coachPhone = values.coachPhone;
  if (values.coachEmails !== undefined) set.coachEmails = values.coachEmails;
  if (values.affiliationNumber !== undefined) set.affiliationNumber = clubNumber(values.affiliationNumber, entry);
  if (Object.keys(set).length) db.update(clubs).set(set).where(eq(clubs.id, club.id)).run();
  reconcileChange(db, club.id);
}

export interface ResolveInput {
  directoryVersion: number;
  values: ClubValues;
  applyToClub: boolean;
}

/**
 * Enregistre dans l'annuaire les valeurs choisies pour un changement à examiner, et dans le club aussi si `applyToClub`. Tout ou rien :
 * fiche modifiée depuis l'ouverture de la comparaison, numéro d'une autre fiche, nom déjà pris, compétition gérée ailleurs ou passée
 * refusent sans rien écrire. Les autres changements de la même fiche qui deviennent identiques sont fermés.
 */
export function resolveClubChange(db: AppDb, clubId: string, input: ResolveInput): void {
  db.transaction((tx) => {
    const t = asTx(tx);
    const row = t.select().from(clubChanges).where(eq(clubChanges.clubId, clubId)).get();
    const club = t.select().from(clubs).where(eq(clubs.id, clubId)).get();
    if (!row || !club) throw new NotFoundError('Ce changement n’existe plus.');
    const entry = t.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId ?? row.directoryId)).get();
    if (!entry) throw new NotFoundError('Club introuvable dans l’annuaire');
    if ((entry.version ?? 0) !== input.directoryVersion) throw new DirectoryConflictError('Cette fiche vient de changer : rouvrez la comparaison.');
    if (input.applyToClub) {
      assertWritable(db, club.competitionId);
      assertNameFree(t, club, input.values.name);
    }
    checkNumber(t, input.values.affiliationNumber, entry.id);
    const { name, coachName, coachPhone, coachEmails, affiliationNumber } = input.values;
    updateDirectoryEntry(t, entry.id, { name, coachName, coachPhone, coachEmails, affiliationNumber });
    const updated = t.select().from(clubDirectory).where(eq(clubDirectory.id, entry.id)).get()!;
    if (input.applyToClub) writeClubValues(t, club, updated, input.values);
    t.delete(clubChanges).where(eq(clubChanges.clubId, clubId)).run();
    for (const other of t.select().from(clubChanges).where(eq(clubChanges.directoryId, entry.id)).all()) reconcileChange(t, other.clubId);
  });
}

/** Ignore un changement : il ne revient que si une valeur du club change de nouveau. */
export function ignoreClubChange(db: AppDb, clubId: string): void {
  const done = db.update(clubChanges).set({ ignored: true }).where(eq(clubChanges.clubId, clubId)).run();
  if (!done.changes) throw new NotFoundError('Ce changement n’existe plus.');
}

export interface UpcomingLine {
  clubId: string;
  competitionId: string;
  competitionName: string;
  competitionDate: string;
  managedHere: boolean;
  ownerName: string | null;
  field: ClubField;
  kind: 'apply' | 'conflict';
  clubValue: string | string[] | null;
  directoryValue: string | string[] | null;
}

/**
 * Après la modification d'une fiche : pour chaque club relié d'une compétition à venir, chaque champ que la fiche a changé (par rapport à
 * `before`, ses valeurs d'avant) et sur lequel le club diffère de la nouvelle fiche. `apply` si le club avait la valeur d'avant, sinon `conflict`.
 * Une fiche archivée ne propose rien.
 */
export function upcomingDifferences(db: AppDb, entryId: string, before: ClubValues): UpcomingLine[] {
  const entry = db.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get();
  if (!entry || entry.archived) return [];
  const directory = directoryValues(entry);
  const changed = differingFields(directory, before);
  if (!changed.length) return [];
  const lines: UpcomingLine[] = [];
  const candidates = db
    .select({ club: clubs, competition: competitions })
    .from(clubs)
    .innerJoin(competitions, eq(competitions.id, clubs.competitionId))
    .where(and(eq(clubs.directoryClubId, entryId), gte(competitions.date, localToday())))
    .all();
  for (const { club, competition } of candidates) {
    const values = clubValues(club, entry);
    const differing = differingFields(values, directory);
    const management = getManagement(db, competition.id);
    for (const field of changed.filter((f) => differing.includes(f))) {
      lines.push({
        clubId: club.id, competitionId: competition.id, competitionName: competition.name, competitionDate: competition.date, managedHere: management.managedHere,
        ownerName: management.ownerName, field, kind: propagationKind(field, values, before), clubValue: values[field], directoryValue: directory[field],
      });
    }
  }
  return lines.sort((a, b) => a.competitionDate.localeCompare(b.competitionDate) || a.competitionName.localeCompare(b.competitionName) || a.clubId.localeCompare(b.clubId));
}

export interface ApplyResult {
  competitionName: string;
  status: 'applied' | 'refused';
  message: string | null;
}

/** Reporte des champs de la fiche sur des clubs. Une transaction par club : un refus (nom pris, gérée ailleurs, passée) n'arrête pas les autres. */
export function applyDirectoryToClubs(db: AppDb, entryId: string, items: { clubId: string; fields: ClubField[] }[]): ApplyResult[] {
  return items.map(({ clubId, fields }): ApplyResult => {
    const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
    const competition = club ? db.select().from(competitions).where(eq(competitions.id, club.competitionId)).get() : undefined;
    const competitionName = competition?.name ?? '';
    try {
      db.transaction((tx) => {
        const t = asTx(tx);
        const entry = t.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get();
        if (!entry) throw new NotFoundError('Club introuvable dans l’annuaire');
        if (!club || club.directoryClubId !== entryId) throw new DirectoryConflictError('Ce club n’est plus relié à cette fiche.');
        assertWritable(db, club.competitionId);
        const directory = directoryValues(entry);
        const chosen = Object.fromEntries(fields.map((f) => [f, directory[f]])) as Partial<ClubValues>;
        if (chosen.name !== undefined) assertNameFree(t, club, chosen.name);
        writeClubValues(t, club, entry, chosen);
      });
      return { competitionName, status: 'applied', message: null };
    } catch (error) {
      if (error instanceof DirectoryConflictError || error instanceof ReadOnlyCompetitionError || error instanceof NotFoundError) return { competitionName, status: 'refused', message: error.message };
      throw error;
    }
  });
}
