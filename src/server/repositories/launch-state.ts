import { and, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../db/client.js';
import { categories, frozenPassages, waveLaunches } from '../db/schema.js';

/** Lancements des vagues d'une compétition, par clé de vague ('' : vague implicite). Sans synchronisation des catégories. */
export function launchRows(db: AppDb, competitionId: string) {
  return new Map(db.select().from(waveLaunches).where(eq(waveLaunches.competitionId, competitionId)).all().map((r) => [r.waveKey, r]));
}

/** Clés des vagues actuellement lancées. */
export function launchedWaveKeys(db: AppDb, competitionId: string): Set<string> {
  return new Set([...launchRows(db, competitionId).values()].filter((r) => r.launched).map((r) => r.waveKey));
}

/** Catégories portant des numéros figés d'une vague actuellement lancée : leur tableau ne change plus sans confirmation. */
export function launchedCategoryIds(db: AppDb, competitionId: string): Set<string> {
  const launched = [...launchedWaveKeys(db, competitionId)];
  if (launched.length === 0) return new Set();
  return new Set(
    db.select({ id: frozenPassages.categoryId }).from(frozenPassages)
      .where(and(eq(frozenPassages.competitionId, competitionId), inArray(frozenPassages.waveKey, launched)))
      .all()
      .map((r) => r.id),
  );
}

/** Zones portant des numéros figés (de catégories qui existent encore). */
export function frozenZoneIds(db: AppDb, competitionId: string): Set<string> {
  return new Set(
    db.select({ id: frozenPassages.zoneId }).from(frozenPassages)
      .innerJoin(categories, eq(categories.id, frozenPassages.categoryId))
      .where(eq(frozenPassages.competitionId, competitionId))
      .all()
      .map((r) => r.id),
  );
}
