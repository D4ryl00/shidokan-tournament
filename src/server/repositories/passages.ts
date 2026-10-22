import { activeEntrantCount } from '../../domain/categories.js';
import { planPassages, type PassagePlan } from '../../domain/passages/index.js';
import type { AppDb } from '../db/client.js';
import { listCategories } from './categories.js';
import { getCompetition } from './competitions.js';
import { NotFoundError } from './registrations.js';
import { listWaves } from './waves.js';
import { listZones } from './zones.js';

/** Zones (épinglées ou réparties) et numéros de passage de toute la compétition, recalculés à chaque lecture. */
export async function passagePlan(db: AppDb, competitionId: string): Promise<PassagePlan> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const cats = await listCategories(db, competitionId);
  // Rang : « Ordre » saisi, puis ordre de la grille (celui de listCategories).
  const ranked = cats.map((c, i) => ({ c, i })).sort((x, y) => x.c.order - y.c.order || x.i - y.i);
  return planPassages({
    categories: ranked.map(({ c }, rank) => ({
      id: c.id,
      waveId: c.waveId,
      discipline: c.key.discipline,
      pinnedZoneId: c.zoneId,
      rank,
      bracket: c.bracket,
      playable: !!c.bracket && activeEntrantCount(c) >= 2,
    })),
    zones: (await listZones(db, competitionId)).map((z) => ({ id: z.id, order: z.order, disciplines: z.disciplines })),
    waves: await listWaves(db, competitionId),
    mode: competition.settings.passageOrder,
  });
}

/** Numéro de passage de chaque combat (clé `${categoryId}:${matchId}`) et de chaque bloc de kata (clé `${categoryId}:kata`). */
export function passageNumbers(plan: PassagePlan): Map<string, number> {
  return new Map(plan.zones.flatMap((z) => z.passages.map((p) => [`${p.categoryId}:${p.matchId ?? 'kata'}`, p.number] as const)));
}
