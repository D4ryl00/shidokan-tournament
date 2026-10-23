import { and, eq, inArray } from 'drizzle-orm';
import type { ClubFormParse } from '../../domain/club-form.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { normalizeName } from '../../domain/names.js';
import {
  combatConflictWarning,
  validateRegistration,
  type Club,
  type Fighter,
  type Registration,
  type RegistrationInput,
  type RegistrationRow,
} from '../../domain/registration.js';
import type { ProposalType } from '../../domain/replacement/types.js';
import type { DisciplineId } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { categories, clubs, fighters, registrations } from '../db/schema.js';
import { getCompetition, getGrid } from './competitions.js';

export class RegistrationValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(' '));
  }
}
export class NotFoundError extends Error {}
export class RegistrationLockedError extends Error {
  constructor() {
    super('Cette inscription appartient à une catégorie lancée : déverrouillez la catégorie d’abord.');
  }
}

/** Inscription placée dans une catégorie lancée ou terminée (tableau figé). */
function inLockedCategory(db: AppDb, categoryId: string | null): boolean {
  if (!categoryId) return false;
  const c = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  return c !== undefined && (c.status === 'started' || c.status === 'finished');
}

type ClubData = Omit<Club, 'id' | 'competitionId'>;
/** Champs absents (undefined) = inchangés lors d'une mise à jour. */
type ClubUpsert = { name: string } & Partial<Omit<ClubData, 'name'>>;

const fighterKey = (lastName: string, firstName: string) => normalizeName(`${lastName} ${firstName}`);

function toClub(row: typeof clubs.$inferSelect): Club {
  const { nameKey: _k, ...club } = row;
  return club;
}
function toFighter(row: typeof fighters.$inferSelect): Fighter {
  const { nameKey: _k, ...fighter } = row;
  return fighter;
}
function toRegistration(row: typeof registrations.$inferSelect): Registration {
  const { otherDisciplinesJson, ...rest } = row;
  return { ...rest, recasementType: rest.recasementType as ProposalType | null, otherDisciplines: JSON.parse(otherDisciplinesJson) as DisciplineId[] };
}

export async function listClubs(db: AppDb, competitionId: string): Promise<Club[]> {
  return db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).orderBy(clubs.nameKey).all().map(toClub);
}

function upsertClubSync(db: AppDb, competitionId: string, data: ClubUpsert): Club {
  const nameKey = normalizeName(data.name);
  const existing = db.select().from(clubs).where(and(eq(clubs.competitionId, competitionId), eq(clubs.nameKey, nameKey))).get();
  const defined = Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== undefined && k !== 'name'));
  if (existing) {
    if (Object.keys(defined).length) db.update(clubs).set(defined).where(eq(clubs.id, existing.id)).run();
    return toClub(db.select().from(clubs).where(eq(clubs.id, existing.id)).get()!);
  }
  const id = crypto.randomUUID();
  db.insert(clubs)
    .values({ id, competitionId, nameKey, name: data.name.trim(), ffkEntity: null, coachName: null, coachPhone: null, coachEmail: null, preApproval: false, ...defined })
    .run();
  return toClub(db.select().from(clubs).where(eq(clubs.id, id)).get()!);
}

/** Crée le club, ou met à jour celui qui porte le même nom (casse et accents ignorés). */
export async function upsertClub(db: AppDb, competitionId: string, data: ClubUpsert): Promise<Club> {
  return upsertClubSync(db, competitionId, data);
}

export async function updateClub(db: AppDb, competitionId: string, clubId: string, patch: Partial<ClubData>): Promise<Club> {
  const row = db.select().from(clubs).where(and(eq(clubs.id, clubId), eq(clubs.competitionId, competitionId))).get();
  if (!row) throw new NotFoundError('Club introuvable');
  const set = { ...patch, ...(patch.name ? { nameKey: normalizeName(patch.name) } : {}) };
  db.update(clubs).set(set).where(eq(clubs.id, clubId)).run();
  return toClub(db.select().from(clubs).where(eq(clubs.id, clubId)).get()!);
}

export async function listRegistrations(db: AppDb, competitionId: string): Promise<RegistrationRow[]> {
  const regs = db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all();
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const cs = new Map(db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all().map((c) => [c.id, c]));
  return regs
    .map((r) => {
      const f = fs.get(r.fighterId)!;
      const c = f.clubId ? cs.get(f.clubId) : undefined;
      return { ...toRegistration(r), fighter: toFighter(f), club: c ? toClub(c) : null, _sort: `${c?.nameKey ?? '~'}|${f.nameKey}` };
    })
    .sort((a, b) => a._sort.localeCompare(b._sort))
    .map(({ _sort, ...row }) => row);
}

function findOrCreateFighter(
  db: AppDb,
  competitionId: string,
  input: RegistrationInput,
  opts: { keepAge?: (fighterId: string) => boolean } = {},
): typeof fighters.$inferSelect {
  const nameKey = fighterKey(input.lastName, input.firstName);
  const existing = db
    .select()
    .from(fighters)
    .where(
      and(
        eq(fighters.competitionId, competitionId),
        eq(fighters.nameKey, nameKey),
        eq(fighters.sex, input.sex),
        input.clubId === null ? undefined : eq(fighters.clubId, input.clubId),
      ),
    )
    .all()
    .find((f) => f.clubId === input.clubId);
  if (existing) {
    const ageBandCode = opts.keepAge?.(existing.id) ? existing.ageBandCode : input.ageBandCode;
    db.update(fighters)
      .set({ ageBandCode, licence: input.licence ?? existing.licence, ...(input.grade !== undefined ? { grade: input.grade } : {}) })
      .where(eq(fighters.id, existing.id))
      .run();
    return { ...existing, ageBandCode };
  }
  const row = {
    id: crypto.randomUUID(),
    competitionId,
    clubId: input.clubId,
    lastName: input.lastName.trim(),
    firstName: input.firstName.trim(),
    nameKey,
    sex: input.sex,
    ageBandCode: input.ageBandCode,
    licence: input.licence ?? null,
    grade: input.grade ?? null,
    weighInKg: null,
    version: null,
    updatedAt: null,
  };
  db.insert(fighters).values(row).run();
  return row;
}

function registrationValues(input: RegistrationInput) {
  return {
    discipline: input.discipline,
    ruleset: input.ruleset,
    weightClassId: input.weightClassId,
    approxWeightKg: input.approxWeightKg ?? null,
    otherDisciplinesJson: JSON.stringify(input.otherDisciplines ?? []),
    acceptsJiyuFirst: input.ruleset === 'shobu' ? (input.acceptsJiyuFirst ?? null) : null,
    source: input.source,
  };
}

function rowById(db: AppDb, id: string): RegistrationRow {
  const r = db.select().from(registrations).where(eq(registrations.id, id)).get()!;
  const f = db.select().from(fighters).where(eq(fighters.id, r.fighterId)).get()!;
  const c = f.clubId ? db.select().from(clubs).where(eq(clubs.id, f.clubId)).get() : undefined;
  return { ...toRegistration(r), fighter: toFighter(f), club: c ? toClub(c) : null };
}

export async function createRegistration(
  db: AppDb,
  competitionId: string,
  input: RegistrationInput,
): Promise<{ row: RegistrationRow; warning: string | null }> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const errors = validateRegistration(input, await getGrid(db, competitionId));
  if (errors.length) throw new RegistrationValidationError(errors);
  let warning: string | null = null;
  const id = db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const fighter = findOrCreateFighter(t, competitionId, input);
    const existing = t.select().from(registrations).where(eq(registrations.fighterId, fighter.id)).all();
    warning = combatConflictWarning(existing, input, competition.settings.multipleCombatDisciplinesPerDay);
    const newId = crypto.randomUUID();
    t.insert(registrations).values({ id: newId, competitionId, fighterId: fighter.id, ...registrationValues(input) }).run();
    return newId;
  });
  return { row: rowById(db, id), warning };
}

function deleteOrphanFighters(db: AppDb, fighterIds: string[]): void {
  for (const fid of new Set(fighterIds)) {
    const left = db.select().from(registrations).where(eq(registrations.fighterId, fid)).all();
    if (left.length === 0) db.delete(fighters).where(eq(fighters.id, fid)).run();
  }
}

export async function updateRegistration(
  db: AppDb,
  competitionId: string,
  registrationId: string,
  input: RegistrationInput,
): Promise<RegistrationRow> {
  const current = db
    .select()
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)))
    .get();
  if (!current) throw new NotFoundError('Inscription introuvable');
  const errors = validateRegistration(input, await getGrid(db, competitionId));
  if (errors.length) throw new RegistrationValidationError(errors);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    // Les données du combattant (nom, sexe, âge, club) suivent la saisie.
    t.update(fighters)
      .set({
        clubId: input.clubId,
        lastName: input.lastName.trim(),
        firstName: input.firstName.trim(),
        nameKey: fighterKey(input.lastName, input.firstName),
        sex: input.sex,
        ageBandCode: input.ageBandCode,
        // Le formulaire ne renvoie pas la licence : absente = conservée.
        ...(input.licence !== undefined ? { licence: input.licence } : {}),
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
      })
      .where(eq(fighters.id, current.fighterId))
      .run();
    t.update(registrations).set(registrationValues(input)).where(eq(registrations.id, registrationId)).run();
  });
  return rowById(db, registrationId);
}

export async function deleteRegistration(db: AppDb, competitionId: string, registrationId: string): Promise<void> {
  const current = db
    .select()
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)))
    .get();
  if (!current) throw new NotFoundError('Inscription introuvable');
  if (inLockedCategory(db, current.categoryId)) throw new RegistrationLockedError();
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    t.delete(registrations).where(eq(registrations.id, registrationId)).run();
    deleteOrphanFighters(t, [current.fighterId]);
  });
}

/** Discipline d'inscription d'origine (avant un recasement qui en a changé, type H). */
const originalDiscipline = (r: { discipline: DisciplineId; originalJson: string | null }): DisciplineId =>
  r.originalJson ? (JSON.parse(r.originalJson) as { discipline: DisciplineId }).discipline : r.discipline;

/**
 * Importe une fiche club : met à jour le club ; les inscriptions de la fiche précédente sont mises à jour
 * sur place (mêmes identifiants), celles qui ont disparu de la fiche sont retirées.
 */
export async function importClubForm(
  db: AppDb,
  competitionId: string,
  parse: ClubFormParse,
  /** false : les inscriptions absentes de cette fiche sont gardées (fiche papier saisie page par page). */
  opts: { replace: boolean } = { replace: true },
): Promise<{ club: Club; imported: number; replaced: number; skipped: number }> {
  return db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const { club: name, ...coach } = parse.header;
    const club = upsertClubSync(t, competitionId, { name, ...coach });
    const clubFighters = t.select().from(fighters).where(eq(fighters.clubId, club.id)).all().map((f) => f.id);
    const previous = clubFighters.length
      ? t
          .select()
          .from(registrations)
          .where(and(inArray(registrations.fighterId, clubFighters), eq(registrations.source, 'club_form')))
          .all()
      : [];
    const kept = new Set<string>();
    let imported = 0;
    for (const row of parse.rows) {
      if (!row.input) continue;
      const input = { ...row.input, clubId: club.id, source: 'club_form' as const };
      // Une inscription confirmée par l'export FFK garde l'âge et le poids FFK (l'export fait foi).
      const confirmedFighters = new Set(previous.filter((r) => r.ffkConfirmed).map((r) => r.fighterId));
      const fighter = findOrCreateFighter(t, competitionId, input, { keepAge: (id) => confirmedFighters.has(id) });
      const same =
        previous.find((r) => r.fighterId === fighter.id && originalDiscipline(r) === input.discipline && !kept.has(r.id)) ??
        // Inscription venue d'ailleurs (export FFK, saisie) pour la même discipline : on la complète, sans doublon.
        t
          .select()
          .from(registrations)
          .where(eq(registrations.fighterId, fighter.id))
          .all()
          .find((r) => originalDiscipline(r) === input.discipline && !kept.has(r.id));
      if (same) {
        const values = registrationValues(input);
        if (same.ffkConfirmed) values.weightClassId = same.weightClassId;
        if (same.source !== 'club_form') values.source = same.source;
        if (same.originalJson) {
          // Inscription recasée : la fiche met à jour les valeurs d'origine, pas le placement validé.
          const { discipline, ruleset, weightClassId, ...rest } = values;
          const original = JSON.parse(same.originalJson) as { weightClassId: string | null };
          const fields = { discipline, ruleset, weightClassId: same.ffkConfirmed ? original.weightClassId : weightClassId };
          t.update(registrations).set({ ...rest, originalJson: JSON.stringify({ ...original, ...fields }) }).where(eq(registrations.id, same.id)).run();
        } else t.update(registrations).set(values).where(eq(registrations.id, same.id)).run();
        kept.add(same.id);
      } else {
        const id = crypto.randomUUID();
        t.insert(registrations).values({ id, competitionId, fighterId: fighter.id, ...registrationValues(input) }).run();
      }
      imported++;
    }
    // Une inscription d'une catégorie lancée n'est jamais retirée par un réimport.
    const removed = opts.replace ? previous.filter((r) => !kept.has(r.id) && !inLockedCategory(t, r.categoryId)) : [];
    if (removed.length) {
      t.delete(registrations).where(inArray(registrations.id, removed.map((r) => r.id))).run();
      deleteOrphanFighters(t, removed.map((r) => r.fighterId));
    }
    return { club, imported, replaced: previous.length, skipped: parse.rows.length - imported };
  });
}

/** Inscriptions de la fiche précédente de ce club qui disparaîtraient au réimport (aperçu). */
export async function clubFormRemovals(db: AppDb, competitionId: string, parse: ClubFormParse): Promise<{ registrationId: string; label: string }[]> {
  const club = db.select().from(clubs).where(and(eq(clubs.competitionId, competitionId), eq(clubs.nameKey, normalizeName(parse.header.club)))).get();
  if (!club) return [];
  const fs = new Map(db.select().from(fighters).where(eq(fighters.clubId, club.id)).all().map((f) => [f.id, f]));
  if (fs.size === 0) return [];
  const kept = new Set(parse.rows.filter((r) => r.input).map((r) => `${fighterKey(r.input!.lastName, r.input!.firstName)}|${r.input!.discipline}`));
  return db
    .select()
    .from(registrations)
    .where(and(inArray(registrations.fighterId, [...fs.keys()]), eq(registrations.source, 'club_form')))
    .all()
    .filter((r) => !kept.has(`${fs.get(r.fighterId)!.nameKey}|${originalDiscipline(r)}`) && !inLockedCategory(db, r.categoryId))
    .map((r) => {
      const f = fs.get(r.fighterId)!;
      return { registrationId: r.id, label: `${f.lastName} ${f.firstName} — ${DISCIPLINES[r.discipline].label}` };
    });
}

export async function countRegistrationsByWeightClass(db: AppDb, competitionId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const r of db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all()) {
    if (r.weightClassId) counts.set(r.weightClassId, (counts.get(r.weightClassId) ?? 0) + 1);
  }
  return counts;
}
