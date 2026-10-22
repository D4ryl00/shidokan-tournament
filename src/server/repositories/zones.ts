import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { validateZones, type Zone, type ZoneInput } from '../../domain/zones.js';
import type { AppDb } from '../db/client.js';
import { categories, zones } from '../db/schema.js';
import { CategoryLockedError } from './categories.js';
import { GridValidationError } from './competitions.js';

export async function listZones(db: AppDb, competitionId: string): Promise<Zone[]> {
  return db
    .select()
    .from(zones)
    .where(eq(zones.competitionId, competitionId))
    .orderBy(asc(zones.sortOrder))
    .all()
    .map((z) => ({ id: z.id, name: z.name, order: z.sortOrder }));
}

/**
 * Remplace la liste des zones : les zones gardées conservent leur identifiant (et leurs catégories), les nouvelles sont créées,
 * celles qui disparaissent sont supprimées et leurs catégories passent sans zone — refusé si l'une d'elles est lancée ou terminée.
 */
export async function replaceZones(db: AppDb, competitionId: string, input: ZoneInput[], knownIds?: string[]): Promise<Zone[]> {
  const errors = validateZones(input);
  if (errors.length) throw new GridValidationError(errors);
  const current = await listZones(db, competitionId);
  // Écran ouvert avant une autre modification (autre onglet) : on ne supprime pas des zones qu'il n'a jamais vues.
  if (knownIds && (knownIds.length !== current.length || current.some((z) => !knownIds.includes(z.id)))) {
    throw new CategoryLockedError('Les zones ont été modifiées ailleurs entre-temps : rechargez la page avant d’enregistrer.');
  }
  const known = new Set(current.map((z) => z.id));
  const keptIds = input.map((z) => z.id).filter((id): id is string => !!id && known.has(id));
  const removed = current.filter((z) => !keptIds.includes(z.id)).map((z) => z.id);
  if (removed.length) {
    const busy = db
      .select()
      .from(categories)
      .where(and(eq(categories.competitionId, competitionId), inArray(categories.zoneId, removed), inArray(categories.status, ['started', 'finished'])))
      .all();
    if (busy.length) {
      throw new CategoryLockedError(`Zone impossible à supprimer : une catégorie lancée s'y déroule (${busy[0]!.label}).`);
    }
  }
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (removed.length) {
      t.update(categories).set({ zoneId: null }).where(inArray(categories.zoneId, removed)).run();
      t.delete(zones).where(and(eq(zones.competitionId, competitionId), keptIds.length ? notInArray(zones.id, keptIds) : undefined)).run();
    }
    input.forEach((z, order) => {
      const name = z.name.trim();
      if (z.id && known.has(z.id)) t.update(zones).set({ name, sortOrder: order }).where(eq(zones.id, z.id)).run();
      else t.insert(zones).values({ id: crypto.randomUUID(), competitionId, name, sortOrder: order }).run();
    });
  });
  return listZones(db, competitionId);
}
