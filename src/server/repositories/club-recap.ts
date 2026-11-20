import { and, eq } from 'drizzle-orm';
import { recapLines, type RecapLine, type RecapRegistration } from '../../domain/club-recap.js';
import type { AppDb } from '../db/client.js';
import { categories, fighters, registrations } from '../db/schema.js';
import { syncCategories } from './categories.js';
import { getGrid } from './competitions.js';
import { getCompetitionClub } from './registrations.js';

/** Les lignes du récapitulatif d'un club : toutes ses inscriptions, retirées et absentes comprises. */
export async function clubRecapLines(db: AppDb, competitionId: string, clubId: string): Promise<{ club: string; lines: RecapLine[] }> {
  const club = getCompetitionClub(db, competitionId, clubId);
  await syncCategories(db, competitionId);
  const grid = await getGrid(db, competitionId);
  const cats = new Map(db.select().from(categories).where(eq(categories.competitionId, competitionId)).all().map((c) => [c.id, c]));
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
      return {
        lastName: f.lastName, firstName: f.firstName, sex: f.sex, ageBandCode: f.ageBandCode,
        registered: original
          ? { discipline: original.discipline, ruleset: original.ruleset ?? null, weightClassId: original.weightClassId ?? null }
          : { discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId },
        final,
        recasementType: r.recasementType as RecapRegistration['recasementType'],
      };
    });
  return { club: club.name, lines: recapLines(regs, grid) };
}
