import { and, eq, gte } from 'drizzle-orm';
import { sameEmail } from '../../domain/emails.js';
import { CLUB_FIELDS, differingFields, isUpcoming, propagationKind, type ClubField, type ClubValues } from '../../domain/club-changes.js';
import { normalizeName } from '../../domain/names.js';
import type { AppDb } from '../db/client.js';
import { clubChanges, clubDirectory, clubs, competitions } from '../db/schema.js';
import { getManagement, ReadOnlyCompetitionError, readOnlyMessage } from '../sync/ownership.js';
import { competitionChanged } from '../events.js';
import { DirectoryConflictError, updateDirectoryEntry } from './directory.js';
import { NotFoundError } from './errors.js';

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

/** Les adresses de `emails` qui ne sont pas dans `base` (casse et espaces ignorés). */
const emailsNotIn = (emails: readonly string[], base: readonly string[]) => emails.filter((e) => !base.some((b) => sameEmail(b, e)));

/**
 * Compare le club à sa fiche d'annuaire après une modification de ses coordonnées, et tient à jour son changement à examiner :
 * sans fiche, rien ; sans différence, le changement disparaît ; un changement ignoré aux mêmes valeurs reste ignoré ;
 * sinon il est écrit (toutes les valeurs du club, avec les champs que cet enregistrement a modifiés et les adresses qu'il a ajoutées) et à examiner.
 * `before` : valeurs du club avant l'enregistrement. Si aucun champ comparé n'a changé, aucun changement n'est créé ni redaté
 * (un changement existant n'est que rattaché à la fiche du lien actuel) : la différence vient d'ailleurs, de la fiche par exemple.
 * `relinked` : le club vient d'être relié à une autre fiche (nouvelle entité FFK) ; sans changement existant, un changement à examiner est créé s'il
 * diffère de cette fiche, avec la fiche pour choix par défaut (aucun champ modifié par cet enregistrement). Une compétition purgée n'en reçoit aucun.
 */
export function recordClubChange(db: AppDb, clubId: string, origin: 'club' | 'competition', before?: ClubValues, { relinked = false } = {}): void {
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
  const reference = before ?? directoryValues(entry);
  const changedFields = differingFields(values, reference);
  const purged = () => !!db.select({ purgedAt: competitions.purgedAt }).from(competitions).where(eq(competitions.id, club.competitionId)).get()?.purgedAt;
  if (before && !changedFields.length) {
    if (existing && existing.directoryId !== entry.id) db.update(clubChanges).set({ directoryId: entry.id }).where(eq(clubChanges.clubId, clubId)).run();
    else if (!existing && relinked && !purged()) {
      const row = { competitionId: club.competitionId, directoryId: entry.id, origin, valuesJson: JSON.stringify(values), changedAt: new Date().toISOString(), ignored: false, changedFields: '[]', addedEmails: '[]' };
      db.insert(clubChanges).values({ clubId, ...row }).run();
    }
    return;
  }
  if (existing?.ignored && existing.directoryId === entry.id && !differingFields(values, JSON.parse(existing.valuesJson) as ClubValues).length) return;
  if (purged()) return;
  // Un changement encore à examiner sur la même fiche : ses choix par défaut se cumulent avec ceux de cet enregistrement, pour les champs qui
  // diffèrent encore de la fiche et les adresses encore présentes dans le club.
  let fields = changedFields;
  let added = emailsNotIn(values.coachEmails, reference.coachEmails);
  if (existing && !existing.ignored && existing.directoryId === entry.id) {
    const still = differingFields(values, directoryValues(entry));
    const previous = JSON.parse(existing.changedFields) as ClubField[];
    fields = CLUB_FIELDS.filter((f) => still.includes(f) && (changedFields.includes(f) || previous.includes(f)));
    const earlier = (JSON.parse(existing.addedEmails) as string[]).filter((e) => values.coachEmails.some((v) => sameEmail(v, e)));
    added = [...added, ...emailsNotIn(earlier, added)];
  }
  const row = {
    competitionId: club.competitionId, directoryId: entry.id, origin, valuesJson: JSON.stringify(values), changedAt: new Date().toISOString(), ignored: false,
    changedFields: JSON.stringify(fields), addedEmails: JSON.stringify(added),
  };
  db.insert(clubChanges).values({ clubId, ...row }).onConflictDoUpdate({ target: clubChanges.clubId, set: row }).run();
}

/**
 * Après la réception d'une compétition rendue par un PC : un changement ignoré dont les valeurs du club ne sont plus celles de l'ignorance
 * (le PC les a changées pendant qu'il avait la main) repasse à examiner, avec les champs que le PC a modifiés.
 */
export function reopenIgnoredChanges(db: AppDb, competitionId: string): void {
  for (const row of db.select().from(clubChanges).where(and(eq(clubChanges.competitionId, competitionId), eq(clubChanges.ignored, true))).all()) {
    const club = db.select().from(clubs).where(eq(clubs.id, row.clubId)).get();
    const entry = club?.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
    if (!club || !entry) continue;
    const values = clubValues(club, entry);
    const ignoredValues = JSON.parse(row.valuesJson) as ClubValues;
    const changedFields = differingFields(values, ignoredValues);
    if (!changedFields.length) continue;
    db.update(clubChanges)
      .set({ ignored: false, valuesJson: JSON.stringify(values), changedFields: JSON.stringify(changedFields), addedEmails: JSON.stringify(emailsNotIn(values.coachEmails, ignoredValues.coachEmails)), changedAt: new Date().toISOString() })
      .where(eq(clubChanges.clubId, row.clubId)).run();
  }
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
  /** Champs que l'enregistrement du changement a modifiés, et adresses qu'il a ajoutées : les autres valeurs ont la fiche pour choix par défaut. */
  changedFields: ClubField[];
  addedEmails: string[];
}

/**
 * Changements à examiner : ni ignorés ni portant sur une fiche archivée. Une ligne devenue sans différence (la fiche ou le club a bougé
 * entre-temps) est supprimée ici. `managedHereOnly` (un PC) : seules les compétitions gérées ici sont listées.
 */
export function listClubChanges(db: AppDb, competitionId?: string, managedHereOnly = false): ClubChangeView[] {
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
    if (managedHereOnly && !management.managedHere) continue;
    views.push({
      clubId: club.id, competitionId: competition.id, competitionName: competition.name, competitionDate: competition.date, managedHere: management.managedHere,
      ownerName: management.ownerName, upcoming: isUpcoming(competition.date, today), directoryId: entry.id, directoryVersion: entry.version ?? 0, origin: row.origin,
      changedAt: row.changedAt, values, directory, fields, changedFields: JSON.parse(row.changedFields) as ClubField[], addedEmails: JSON.parse(row.addedEmails) as string[],
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
  else {
    // Le changement survit : ses valeurs sont celles du club maintenant (un champ appliqué depuis la fiche ne doit pas laisser l'ancien état).
    db.update(clubChanges).set({ directoryId: entry.id, valuesJson: JSON.stringify(clubValues(club, entry)) }).where(eq(clubChanges.clubId, clubId)).run();
  }
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

/** Une autre fiche de l'annuaire porte déjà ce nom (casse et accents ignorés) ; un doublon déjà là n'empêche pas de garder le nom actuel. */
function assertEntryNameFree(db: AppDb, entry: EntryRow, name: string): void {
  const key = normalizeName(name);
  if (key === entry.nameKey) return;
  const clash = db.select().from(clubDirectory).where(eq(clubDirectory.nameKey, key)).all().find((e) => e.id !== entry.id);
  if (clash) throw new DirectoryConflictError(`Une autre fiche de l’annuaire porte déjà le nom « ${clash.name} ».`);
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
  /** `changedAt` du changement tel que la comparaison l'affichait. */
  changedAt: string;
  values: ClubValues;
  applyToClub: boolean;
}

const STALE = 'Cette fiche vient de changer : rouvrez la comparaison.';

/** Le changement à examiner d'un club, tel que la liste le présente : ni ignoré, ni sur une fiche archivée, et inchangé depuis l'affichage. */
function openChange(db: AppDb, clubId: string, changedAt: string) {
  const row = db.select().from(clubChanges).where(eq(clubChanges.clubId, clubId)).get();
  const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
  const entry = club?.directoryClubId ? db.select().from(clubDirectory).where(eq(clubDirectory.id, club.directoryClubId)).get() : undefined;
  if (!row || !club || !entry || row.ignored || entry.archived) throw new NotFoundError('Ce changement n’existe plus.');
  if (row.changedAt !== changedAt) throw new DirectoryConflictError(STALE);
  return { row, club, entry };
}

/**
 * Enregistre dans l'annuaire les valeurs choisies pour un changement à examiner, et dans le club aussi si `applyToClub`. Tout ou rien :
 * fiche ou club modifiés depuis l'ouverture de la comparaison, numéro ou nom d'une autre fiche, nom déjà pris dans la compétition, compétition
 * gérée ailleurs ou passée refusent sans rien écrire. Sans application au club sur une compétition gérée ailleurs, le changement reste tant que le club
 * diffère du résultat. Les autres changements de la même fiche qui deviennent identiques sont fermés.
 */
export function resolveClubChange(db: AppDb, clubId: string, input: ResolveInput): void {
  const touched = new Set<string>();
  db.transaction((tx) => {
    const t = asTx(tx);
    const { club, entry } = openChange(t, clubId, input.changedAt);
    if ((entry.version ?? 0) !== input.directoryVersion) throw new DirectoryConflictError(STALE);
    if (input.applyToClub) {
      assertWritable(db, club.competitionId);
      assertNameFree(t, club, input.values.name);
    }
    assertEntryNameFree(t, entry, input.values.name);
    const { name, coachName, coachPhone, coachEmails, affiliationNumber } = input.values;
    updateDirectoryEntry(t, entry.id, { name, coachName, coachPhone, coachEmails, affiliationNumber }); // contrôle aussi le numéro (une autre fiche le porte)
    const updated = t.select().from(clubDirectory).where(eq(clubDirectory.id, entry.id)).get()!;
    if (input.applyToClub) writeClubValues(t, club, updated, input.values);
    // Compétition à venir gérée ailleurs, rien appliqué au club : s'il diffère encore du résultat, le changement reste à examiner au retour de la main.
    // La fiche vient d'être choisie par l'organisateur : elle est le choix par défaut de tous les champs. Compétition passée : seul l'annuaire est
    // modifié, il n'y aura rien à appliquer au club, le changement est fermé.
    const date = t.select({ date: competitions.date }).from(competitions).where(eq(competitions.id, club.competitionId)).get()?.date;
    if (!input.applyToClub && !getManagement(db, club.competitionId).managedHere && date !== undefined && isUpcoming(date, localToday())) {
      reconcileChange(t, clubId);
      t.update(clubChanges).set({ changedFields: '[]', addedEmails: '[]' }).where(eq(clubChanges.clubId, clubId)).run();
    } else t.delete(clubChanges).where(eq(clubChanges.clubId, clubId)).run();
    touched.add(club.competitionId);
    for (const other of t.select().from(clubChanges).where(eq(clubChanges.directoryId, entry.id)).all()) {
      reconcileChange(t, other.clubId);
      touched.add(other.competitionId);
    }
  });
  for (const id of touched) competitionChanged(id);
}

/** Ignore un changement tel que la comparaison l'affichait : il ne revient que si une valeur du club change de nouveau. */
export function ignoreClubChange(db: AppDb, clubId: string, changedAt: string): void {
  const competitionId = db.transaction((tx) => {
    const t = asTx(tx);
    const { club } = openChange(t, clubId, changedAt);
    t.update(clubChanges).set({ ignored: true }).where(eq(clubChanges.clubId, clubId)).run();
    return club.competitionId;
  });
  competitionChanged(competitionId);
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
 * Après la modification d'une fiche : si un champ comparé a changé (par rapport à `before`, ses valeurs d'avant), pour chaque club relié d'une
 * compétition à venir, tous les champs sur lesquels il diffère de la nouvelle fiche. `apply` si le club avait la valeur d'avant, sinon `conflict`
 * (y compris une différence restée d'une comparaison fermée sans rien appliquer). Une fiche archivée ne propose rien.
 * `before` null : demandé depuis la fiche, sans modification (valeurs d'avant inconnues, par exemple une fiche déjà changée par la
 * synchronisation Google) ; toutes les différences sont proposées, en conflit.
 */
export function upcomingDifferences(db: AppDb, entryId: string, before: ClubValues | null): UpcomingLine[] {
  const entry = db.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get();
  if (!entry || entry.archived) return [];
  const directory = directoryValues(entry);
  if (before && !differingFields(directory, before).length) return [];
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
    for (const field of differing) {
      lines.push({
        clubId: club.id, competitionId: competition.id, competitionName: competition.name, competitionDate: competition.date, managedHere: management.managedHere,
        ownerName: management.ownerName, field, kind: before ? propagationKind(field, values, before) : 'conflict', clubValue: values[field], directoryValue: directory[field],
      });
    }
  }
  return lines.sort((a, b) => a.competitionDate.localeCompare(b.competitionDate) || a.competitionName.localeCompare(b.competitionName) || a.clubId.localeCompare(b.clubId));
}

/** Différences restées entre une fiche et les clubs des compétitions à venir, sans modification de la fiche : toutes en conflit. */
export function remainingUpcomingDifferences(db: AppDb, entryId: string): UpcomingLine[] {
  if (!db.select({ id: clubDirectory.id }).from(clubDirectory).where(eq(clubDirectory.id, entryId)).get()) throw new NotFoundError('Club introuvable dans l’annuaire');
  return upcomingDifferences(db, entryId, null);
}

export interface ApplyResult {
  clubId: string;
  competitionName: string;
  status: 'applied' | 'refused';
  message: string | null;
}

export interface ShownField {
  field: ClubField;
  clubValue: unknown;
  directoryValue: unknown;
}

const BLANK: ClubValues = { name: '', coachName: null, coachPhone: null, coachEmails: [], affiliationNumber: null };
/** La valeur affichée est-elle encore la valeur actuelle ? Comparée comme `differingFields` (vide et absent se valent). */
function sameShown(field: ClubField, shownValue: unknown, current: ClubValues): boolean {
  if (field === 'coachEmails') return Array.isArray(shownValue) && !differingFields({ ...BLANK, coachEmails: shownValue as string[] }, { ...BLANK, coachEmails: current.coachEmails }).length;
  if (shownValue !== null && typeof shownValue !== 'string') return false;
  return !differingFields({ ...BLANK, [field]: shownValue }, { ...BLANK, [field]: current[field] }).length;
}

/**
 * Reporte des champs de la fiche sur des clubs. Chaque champ porte les valeurs du club et de la fiche telles que l'organisateur les a vues :
 * si l'une a changé depuis, le club est refusé. Une transaction par club : un refus (nom pris, gérée ailleurs, passée) n'arrête pas les autres.
 */
export function applyDirectoryToClubs(db: AppDb, entryId: string, items: { clubId: string; fields: ShownField[] }[]): ApplyResult[] {
  if (!db.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get()) throw new NotFoundError('Club introuvable dans l’annuaire');
  const touched = new Set<string>();
  const results = items.map(({ clubId, fields }): ApplyResult => {
    const club = db.select().from(clubs).where(eq(clubs.id, clubId)).get();
    const competition = club ? db.select().from(competitions).where(eq(competitions.id, club.competitionId)).get() : undefined;
    const competitionName = competition?.name ?? 'Compétition inconnue';
    try {
      db.transaction((tx) => {
        const t = asTx(tx);
        const entry = t.select().from(clubDirectory).where(eq(clubDirectory.id, entryId)).get();
        if (!entry) throw new NotFoundError('Club introuvable dans l’annuaire');
        const current = club ? t.select().from(clubs).where(eq(clubs.id, clubId)).get() : undefined;
        if (!club || !current) throw new NotFoundError('Ce club n’existe plus.');
        if (current.directoryClubId !== entryId) throw new DirectoryConflictError('Ce club n’est plus relié à cette fiche.');
        assertWritable(db, current.competitionId);
        const directory = directoryValues(entry);
        const values = clubValues(current, entry);
        if (fields.some((f) => !sameShown(f.field, f.clubValue, values) || !sameShown(f.field, f.directoryValue, directory))) {
          throw new DirectoryConflictError('Ce club ou cette fiche vient de changer : rien n’a été appliqué à ce club.');
        }
        const chosen = Object.fromEntries(fields.map((f) => [f.field, directory[f.field]])) as Partial<ClubValues>;
        if (chosen.name !== undefined) assertNameFree(t, current, chosen.name);
        writeClubValues(t, current, entry, chosen);
        touched.add(current.competitionId);
      });
      return { clubId, competitionName, status: 'applied', message: null };
    } catch (error) {
      if (error instanceof DirectoryConflictError || error instanceof ReadOnlyCompetitionError || error instanceof NotFoundError) return { clubId, competitionName, status: 'refused', message: error.message };
      throw error;
    }
  });
  for (const id of touched) competitionChanged(id);
  return results;
}

/**
 * Enregistre la modification d'une fiche (les valeurs d'avant sont lues dans la même transaction), puis calcule ce qu'elle change dans les
 * compétitions à venir. Le calcul est à part : la fiche reste enregistrée même s'il échoue.
 */
export function updateDirectoryEntryWithUpcoming(db: AppDb, id: string, patch: Parameters<typeof updateDirectoryEntry>[2]) {
  const { entry, before } = db.transaction((tx) => {
    const t = asTx(tx);
    const row = t.select().from(clubDirectory).where(eq(clubDirectory.id, id)).get();
    return { before: row ? directoryValues(row) : null, entry: updateDirectoryEntry(t, id, patch) };
  });
  return { ...entry, upcoming: before ? upcomingDifferences(db, entry.id, before) : [] };
}
