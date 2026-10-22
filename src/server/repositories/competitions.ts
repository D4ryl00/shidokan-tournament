import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Competition, CompetitionInput } from '../../domain/competition.js';
import { ffkDefaultGrid } from '../../domain/grid-ffk.js';
import { validateGrid } from '../../domain/grid.js';
import { defaultSettings, mergeSettings, readStoredSettings } from '../../domain/settings.js';
import type { CategoryGrid } from '../../domain/types.js';
import type { AppDb } from '../db/client.js';
import { ageBands, ageLinks, competitions, registrations, weightClasses } from '../db/schema.js';

export type { Competition, CompetitionInput };

// Les fonctions du dépôt sont asynchrones pour permettre le passage à PostgreSQL ;
// avec better-sqlite3, les requêtes et transactions s'exécutent de façon synchrone à l'intérieur.

export class GridValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`Grille invalide : ${errors.join(' ')}`);
  }
}

type Row = typeof competitions.$inferSelect;

function toCompetition(row: Row): Competition {
  let stored: unknown = {};
  try {
    stored = JSON.parse(row.settingsJson);
  } catch {
    stored = {};
  }
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    location: row.location,
    tatamiCount: row.tatamiCount,
    settings: readStoredSettings(stored),
    createdAt: row.createdAt,
  };
}

function getCompetitionSync(db: AppDb, id: string): Competition | null {
  const row = db.select().from(competitions).where(eq(competitions.id, id)).get();
  return row ? toCompetition(row) : null;
}

export async function createCompetition(db: AppDb, input: CompetitionInput): Promise<Competition> {
  const id = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(competitions)
      .values({
        id,
        name: input.name,
        date: input.date,
        location: input.location ?? null,
        tatamiCount: input.tatamiCount ?? 2,
        settingsJson: JSON.stringify(defaultSettings()),
      })
      .run();
    writeGrid(tx as unknown as AppDb, id, ffkDefaultGrid());
  });
  return getCompetitionSync(db, id)!;
}

export async function listCompetitions(db: AppDb): Promise<Competition[]> {
  return db
    .select()
    .from(competitions)
    .orderBy(desc(competitions.date), desc(competitions.createdAt))
    .all()
    .map(toCompetition);
}

export async function getCompetition(db: AppDb, id: string): Promise<Competition | null> {
  return getCompetitionSync(db, id);
}

export async function updateCompetition(
  db: AppDb,
  id: string,
  patch: Partial<CompetitionInput> & { settings?: unknown },
): Promise<Competition> {
  const current = getCompetitionSync(db, id);
  if (!current) throw new Error(`Compétition introuvable : ${id}`);
  let settings = current.settings;
  if (patch.settings !== undefined) {
    try {
      settings = mergeSettings(patch.settings, current.settings);
    } catch (e) {
      // Chemins d'erreur préfixés par « settings » (affichés « réglages › … »).
      if (e instanceof ZodError) throw new ZodError(e.issues.map((i) => ({ ...i, path: ['settings', ...i.path] })));
      throw e;
    }
  }
  if (patch.settings !== undefined) {
    const codes = new Set((await getGrid(db, id)).ageBands.map((b) => b.code));
    const unknown = settings.mixSexes.ageBandCodes.filter((c) => !codes.has(c));
    if (unknown.length) throw new GridValidationError([`réglages › mixité : tranche(s) d'âge inconnue(s) : ${unknown.join(', ')}`]);
  }
  db.update(competitions)
    .set({
      name: patch.name ?? current.name,
      date: patch.date ?? current.date,
      location: patch.location === undefined ? current.location : patch.location,
      tatamiCount: patch.tatamiCount ?? current.tatamiCount,
      settingsJson: JSON.stringify(settings),
    })
    .where(eq(competitions.id, id))
    .run();
  return getCompetitionSync(db, id)!;
}

export async function getGrid(db: AppDb, competitionId: string): Promise<CategoryGrid> {
  const bands = db.select().from(ageBands).where(eq(ageBands.competitionId, competitionId)).orderBy(asc(ageBands.sortOrder)).all();
  const classes = db
    .select()
    .from(weightClasses)
    .where(eq(weightClasses.competitionId, competitionId))
    .orderBy(asc(weightClasses.ageBandCode), asc(weightClasses.sex), asc(weightClasses.sortOrder))
    .all();
  const links = db.select().from(ageLinks).where(eq(ageLinks.competitionId, competitionId)).orderBy(asc(ageLinks.id)).all();
  const bandOrder = new Map(bands.map((b) => [b.code, b.sortOrder]));
  return {
    ageBands: bands.map(({ code, label, minAge, maxAge, isMinor, sortOrder }) => ({ code, label, minAge, maxAge, isMinor, sortOrder })),
    weightClasses: classes
      .sort((a, b) => (bandOrder.get(a.ageBandCode) ?? 0) - (bandOrder.get(b.ageBandCode) ?? 0) || a.sex.localeCompare(b.sex) || a.sortOrder - b.sortOrder)
      .map(({ id, ageBandCode, sex, label, maxKg, sortOrder }) => ({ id, ageBandCode, sex, label, maxKg, sortOrder })),
    ageLinks: links.map(({ fromCode, toCode, kind }) => ({ from: fromCode, to: toCode, kind })),
  };
}

/** Met la grille à jour sur place : les catégories gardent leur identifiant (renommage propagé). */
export async function replaceGrid(db: AppDb, competitionId: string, grid: CategoryGrid): Promise<void> {
  const errors = validateGrid(grid);
  if (errors.length > 0) throw new GridValidationError(errors);
  const inUse = usedWeightClassesRemoved(db, competitionId, grid);
  if (inUse.length > 0) throw new GridValidationError(inUse);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    const ids = grid.weightClasses.map((w) => w.id);
    t.delete(weightClasses)
      .where(and(eq(weightClasses.competitionId, competitionId), ids.length ? notInArray(weightClasses.id, ids) : undefined))
      .run();
    for (const w of grid.weightClasses) {
      t.insert(weightClasses)
        .values({ ...w, competitionId })
        .onConflictDoUpdate({
          target: [weightClasses.competitionId, weightClasses.id],
          set: { ageBandCode: w.ageBandCode, sex: w.sex, label: w.label, maxKg: w.maxKg, sortOrder: w.sortOrder },
        })
        .run();
    }
    t.delete(ageBands).where(eq(ageBands.competitionId, competitionId)).run();
    t.delete(ageLinks).where(eq(ageLinks.competitionId, competitionId)).run();
    writeBandsAndLinks(t, competitionId, grid);
    // Une tranche retirée de la grille sort aussi de la mixité (sinon les réglages ne s'enregistrent plus).
    const current = getCompetitionSync(t, competitionId);
    const codes = new Set(grid.ageBands.map((b) => b.code));
    if (current && current.settings.mixSexes.ageBandCodes.some((c) => !codes.has(c))) {
      const mixSexes = { ...current.settings.mixSexes, ageBandCodes: current.settings.mixSexes.ageBandCodes.filter((c) => codes.has(c)) };
      t.update(competitions)
        .set({ settingsJson: JSON.stringify({ ...current.settings, mixSexes }) })
        .where(eq(competitions.id, competitionId))
        .run();
    }
  });
}

/** Catégories de poids supprimées par la nouvelle grille alors qu'elles contiennent des inscriptions. */
function usedWeightClassesRemoved(db: AppDb, competitionId: string, grid: CategoryGrid): string[] {
  const kept = new Set(grid.weightClasses.map((w) => w.id));
  const counts = new Map<string, number>();
  for (const r of db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all()) {
    if (r.weightClassId && !kept.has(r.weightClassId)) counts.set(r.weightClassId, (counts.get(r.weightClassId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const current = db.select().from(weightClasses).where(eq(weightClasses.competitionId, competitionId)).all();
  const bands = new Map(db.select().from(ageBands).where(eq(ageBands.competitionId, competitionId)).all().map((b) => [b.code, b.label]));
  return [...counts].map(([id, n]) => {
    const wc = current.find((w) => w.id === id);
    const name = wc ? `${bands.get(wc.ageBandCode) ?? wc.ageBandCode} ${wc.sex === 'F' ? 'féminines' : 'masculins'} ${wc.label}` : id;
    return `La catégorie ${name} contient ${n} inscription(s) : elle ne peut pas être supprimée.`;
  });
}

function writeGrid(db: AppDb, competitionId: string, grid: CategoryGrid): void {
  if (grid.weightClasses.length) {
    db.insert(weightClasses).values(grid.weightClasses.map((w) => ({ ...w, competitionId }))).run();
  }
  writeBandsAndLinks(db, competitionId, grid);
}

function writeBandsAndLinks(db: AppDb, competitionId: string, grid: CategoryGrid): void {
  if (grid.ageBands.length) db.insert(ageBands).values(grid.ageBands.map((b) => ({ ...b, competitionId }))).run();
  if (grid.ageLinks.length) {
    db.insert(ageLinks)
      .values(grid.ageLinks.map((l) => ({ competitionId, fromCode: l.from, toCode: l.to, kind: l.kind })))
      .run();
  }
}
