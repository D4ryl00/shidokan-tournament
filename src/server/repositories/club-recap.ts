import { and, eq } from 'drizzle-orm';
import { naturalKey } from '../../domain/categories.js';
import { waveOfCategory } from '../../domain/waves.js';
import { recapLines, type RecapLine, type RecapRegistration } from '../../domain/club-recap.js';
import type { AppDb } from '../db/client.js';
import { categories, clubs, fighters, registrations } from '../db/schema.js';
import { readCategories, syncCategories } from './categories.js';
import { getGrid } from './competitions.js';
import { getCompetitionClub } from './registrations.js';
import { listWaves } from './waves.js';

/** Tout ce qu'il faut pour lire les récapitulatifs de la compétition : catégories à jour, grille, catégories par identifiant. */
async function context(db: AppDb, competitionId: string) {
  await syncCategories(db, competitionId);
  const grid = await getGrid(db, competitionId);
  const cats = new Map(db.select().from(categories).where(eq(categories.competitionId, competitionId)).all().map((c) => [c.id, c]));
  const waves = await listWaves(db, competitionId);
  const waveOf = new Map((await readCategories(db, competitionId)).map((c) => [c.id, c.waveId]));
  return { grid, cats, waves, waveOf };
}

function linesOf(db: AppDb, competitionId: string, clubId: string, { grid, cats, waves, waveOf }: Awaited<ReturnType<typeof context>>): RecapLine[] {
  const regs: RecapRegistration[] = db
    .select({ r: registrations, f: fighters })
    .from(registrations)
    .innerJoin(fighters, eq(registrations.fighterId, fighters.id))
    .where(and(eq(registrations.competitionId, competitionId), eq(fighters.clubId, clubId)))
    .all()
    .map(({ r, f }) => {
      const original = r.originalJson ? JSON.parse(r.originalJson) : null;
      const cat = r.categoryId ? cats.get(r.categoryId) : undefined;
      const final: RecapRegistration['final'] = r.withdrawnReason ? { kind: 'withdrawn' }
        : r.presence === 'absent' ? { kind: 'absent' }
        : cat ? { kind: 'category', label: cat.label, keyString: cat.keyString }
        : { kind: 'unplaced' };
      const registered = original
        ? { discipline: original.discipline, ruleset: original.ruleset ?? null, weightClassId: original.weightClassId ?? null }
        : { discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId };
      const name = (id: string | null | undefined) => waves.find((w) => w.id === id)?.name ?? null;
      const sessions = waves.length === 0 ? undefined : {
        announced: name(waveOfCategory({ key: naturalKey(registered, f), waveOverride: null, frozenWave: null, bandCounts: { [f.ageBandCode]: 1 } }, waves, grid)),
        final: r.categoryId ? name(waveOf.get(r.categoryId)) : null,
      };
      return {
        lastName: f.lastName, firstName: f.firstName, sex: f.sex, ageBandCode: f.ageBandCode,
        registered,
        final,
        sessions,
        recasementType: r.recasementType as RecapRegistration['recasementType'],
      };
    });
  return recapLines(regs, grid);
}

/** Les lignes du récapitulatif d'un club : toutes ses inscriptions, retirées et absentes comprises. */
export async function clubRecapLines(db: AppDb, competitionId: string, clubId: string): Promise<{ club: string; lines: RecapLine[] }> {
  const club = getCompetitionClub(db, competitionId, clubId);
  return { club: club.name, lines: linesOf(db, competitionId, clubId, await context(db, competitionId)) };
}

/** Les récapitulatifs de tous les clubs qui ont des inscriptions (catégories synchronisées une seule fois). */
export async function allClubRecaps(db: AppDb, competitionId: string): Promise<{ club: string; lines: RecapLine[] }[]> {
  const ctx = await context(db, competitionId);
  return db.select().from(clubs).where(eq(clubs.competitionId, competitionId)).all()
    .map((c) => ({ club: c.name, lines: linesOf(db, competitionId, c.id, ctx) }))
    .filter((c) => c.lines.length > 0);
}
