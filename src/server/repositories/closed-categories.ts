import { and, eq } from 'drizzle-orm';
import type { Category } from '../../domain/categories.js';
import { columnLabel, entryCells, entryKey, type ClosedCategoriesView, type EntryCell } from '../../domain/closed-categories.js';
import type { AppDb } from '../db/client.js';
import { closedCategories, fighters, registrations } from '../db/schema.js';
import { listCategories } from './categories.js';
import { getGrid, GridValidationError } from './competitions.js';

export type { ClosedCategoriesView };

const toCell = (r: typeof closedCategories.$inferSelect): EntryCell => ({ ageBandCode: r.ageBandCode, sex: r.sex, discipline: r.discipline, ruleset: (r.ruleset || null) as EntryCell['ruleset'] });

function closedRows(db: AppDb, competitionId: string) {
  return db.select().from(closedCategories).where(eq(closedCategories.competitionId, competitionId)).all();
}

/** Cases fermées de la compétition (clés `entryKey`). */
export function closedSet(db: AppDb, competitionId: string): Set<string> {
  return new Set(closedRows(db, competitionId).map((r) => entryKey(toCell(r))));
}

/** La catégorie couvre-t-elle cette case ? (même discipline et règlement, tranche incluse, même sexe ou mixte) */
const covers = (c: Category, cell: EntryCell) =>
  c.key.discipline === cell.discipline && c.key.ruleset === cell.ruleset && c.key.ageBandCodes.includes(cell.ageBandCode) && (c.key.sex === cell.sex || c.key.sex === 'X');

async function lockedKeys(db: AppDb, competitionId: string, cells: EntryCell[]): Promise<Set<string>> {
  const locked = (await listCategories(db, competitionId)).filter((c) => c.status === 'started' || c.status === 'finished' || c.launchLocked);
  return new Set(cells.filter((cell) => locked.some((c) => covers(c, cell))).map(entryKey));
}

export async function getClosedCategories(db: AppDb, competitionId: string): Promise<ClosedCategoriesView> {
  const grid = await getGrid(db, competitionId);
  const fs = new Map(db.select().from(fighters).where(eq(fighters.competitionId, competitionId)).all().map((f) => [f.id, f]));
  const counts: Record<string, number> = {};
  for (const r of db.select().from(registrations).where(eq(registrations.competitionId, competitionId)).all()) {
    if (r.placementLocked) continue;
    const f = fs.get(r.fighterId)!;
    const k = entryKey({ ageBandCode: f.ageBandCode, sex: f.sex, discipline: r.discipline, ruleset: r.ruleset });
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return { closed: closedRows(db, competitionId).map(toCell), counts, locked: [...(await lockedKeys(db, competitionId, entryCells(grid)))] };
}

/** Ferme (`closed`) ou rouvre des cases : cases de la grille seulement, jamais une case lancée, toujours une case ouverte. */
export async function setClosedCategories(db: AppDb, competitionId: string, cells: EntryCell[], closed: boolean): Promise<void> {
  const grid = await getGrid(db, competitionId);
  const valid = entryCells(grid);
  const validKeys = new Set(valid.map(entryKey));
  if (cells.some((c) => !validKeys.has(entryKey(c)))) throw new GridValidationError(['Catégorie inconnue dans la grille.']);
  if (closed) {
    const locked = await lockedKeys(db, competitionId, cells);
    const errors = cells.filter((c) => locked.has(entryKey(c))).map((c) => {
      const band = grid.ageBands.find((b) => b.code === c.ageBandCode)!;
      return `${band.label} ${c.sex} ${columnLabel(c)} : catégorie déjà lancée, elle ne peut plus être fermée.`;
    });
    if (errors.length) throw new GridValidationError(errors);
    const after = new Set([...closedSet(db, competitionId), ...cells.map(entryKey)]);
    if (valid.every((c) => after.has(entryKey(c)))) throw new GridValidationError(['Au moins une catégorie doit rester ouverte.']);
  }
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    for (const c of cells) {
      const row = { competitionId, ageBandCode: c.ageBandCode, sex: c.sex, discipline: c.discipline, ruleset: c.ruleset ?? '' };
      if (closed) t.insert(closedCategories).values(row).onConflictDoNothing().run();
      else {
        t.delete(closedCategories)
          .where(and(eq(closedCategories.competitionId, competitionId), eq(closedCategories.ageBandCode, row.ageBandCode), eq(closedCategories.sex, row.sex), eq(closedCategories.discipline, row.discipline), eq(closedCategories.ruleset, row.ruleset)))
          .run();
      }
    }
  });
}
