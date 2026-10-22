import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { validateWaves, type Wave, type WaveInput, type WaveRules } from '../../domain/waves.js';
import type { AppDb } from '../db/client.js';
import { categories, waves } from '../db/schema.js';
import { CategoryLockedError } from './categories.js';
import { GridValidationError } from './competitions.js';

export async function listWaves(db: AppDb, competitionId: string): Promise<Wave[]> {
  return db
    .select()
    .from(waves)
    .where(eq(waves.competitionId, competitionId))
    .orderBy(asc(waves.sortOrder))
    .all()
    .map((w) => ({ id: w.id, name: w.name, order: w.sortOrder, rules: JSON.parse(w.rulesJson) as WaveRules, weighInClosed: w.weighInClosed }));
}

/**
 * Remplace la liste des vagues : les vagues gardées conservent leur identifiant, les nouvelles sont créées,
 * celles qui disparaissent sont supprimées et les choix individuels qui les visaient sont effacés (retour aux règles).
 * `knownIds` : vagues que l'écran connaissait ; si elles ont changé entre-temps (autre onglet), refus.
 */
export async function replaceWaves(db: AppDb, competitionId: string, input: WaveInput[], knownIds?: string[]): Promise<Wave[]> {
  const errors = validateWaves(input);
  if (errors.length) throw new GridValidationError(errors);
  const current = await listWaves(db, competitionId);
  if (knownIds && (knownIds.length !== current.length || current.some((w) => !knownIds.includes(w.id)))) {
    throw new CategoryLockedError('Les vagues ont été modifiées ailleurs entre-temps : rechargez la page avant d’enregistrer.');
  }
  const known = new Set(current.map((w) => w.id));
  const keptIds = input.map((w) => w.id).filter((id): id is string => !!id && known.has(id));
  const removed = current.filter((w) => !keptIds.includes(w.id)).map((w) => w.id);
  db.transaction((tx) => {
    const t = tx as unknown as AppDb;
    if (removed.length) {
      t.update(categories).set({ waveOverride: null }).where(and(eq(categories.competitionId, competitionId), inArray(categories.waveOverride, removed))).run();
      t.delete(waves).where(and(eq(waves.competitionId, competitionId), keptIds.length ? notInArray(waves.id, keptIds) : undefined)).run();
    }
    input.forEach((w, order) => {
      const values = { name: w.name.trim(), sortOrder: order, rulesJson: JSON.stringify(w.rules) };
      if (w.id && known.has(w.id)) t.update(waves).set(values).where(eq(waves.id, w.id)).run();
      else t.insert(waves).values({ id: crypto.randomUUID(), competitionId, ...values }).run();
    });
  });
  return listWaves(db, competitionId);
}
