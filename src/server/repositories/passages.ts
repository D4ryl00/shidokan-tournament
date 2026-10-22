import { eq } from 'drizzle-orm';
import { activeEntrantCount, type Category } from '../../domain/categories.js';
import { planPassages, type FrozenPassage, type PassagePlan, type PlanInput } from '../../domain/passages/index.js';
import type { AppDb } from '../db/client.js';
import { categories as categoryTable, frozenPassages } from '../db/schema.js';
import { listCategories } from './categories.js';
import { getCompetition } from './competitions.js';
import { NotFoundError } from './registrations.js';
import { listWaves } from './waves.js';
import { listZones } from './zones.js';

/** Numéros figés des vagues lancées au moins une fois (`match_id` 'kata' : bloc de kata entier). */
export function loadFrozen(db: AppDb, competitionId: string): FrozenPassage[] {
  return db
    .select()
    .from(frozenPassages)
    .where(eq(frozenPassages.competitionId, competitionId))
    .all()
    .map((r) => ({ waveKey: r.waveKey, zoneId: r.zoneId, number: r.number, categoryId: r.categoryId, matchId: r.matchId === 'kata' ? null : r.matchId, noRest: r.noRest }));
}

/**
 * Entrée du plan de passage : catégories (rang : « Ordre » saisi, puis ordre de la grille), zones, vagues, numéros figés,
 * réglages. `cats` : catégories déjà lues (évite une seconde synchronisation) ; `restart` : vagues numérotées à partir de 1.
 */
export async function planInput(db: AppDb, competitionId: string, cats?: Category[], restart: string[] = []): Promise<PlanInput> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  cats ??= await listCategories(db, competitionId);
  const ranked = cats.map((c, i) => ({ c, i })).sort((x, y) => x.c.order - y.c.order || x.i - y.i);
  return {
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
    frozen: loadFrozen(db, competitionId),
    restart,
    finals: { zoneId: competition.settings.finalsZoneId, kata: competition.settings.kataFinalsOnFinalsZone },
  };
}

/** Zones (épinglées ou réparties) et numéros de passage de toute la compétition : figés pour les vagues lancées, en direct sinon. */
export async function passagePlan(db: AppDb, competitionId: string, cats?: Category[], restart: string[] = []): Promise<PassagePlan> {
  return planPassages(await planInput(db, competitionId, cats, restart));
}

/** Numéro de passage de chaque combat (clé `${categoryId}:${matchId}`) et de chaque bloc de kata (clé `${categoryId}:kata`, ou ':kata:tour1' / ':kata:finale'). */
export function passageNumbers(plan: PassagePlan): Map<string, number> {
  return new Map(plan.zones.flatMap((z) => z.passages.map((p) => [`${p.categoryId}:${p.matchId ?? 'kata'}`, p.number] as const)));
}

/**
 * Une catégorie de la vague vient d'être lancée : la répartition de la vague est fixée (chaque catégorie non épinglée
 * garde sa zone actuelle, enregistrée comme épinglage), pour que rien ne change de zone en cours de vague.
 */
export async function fixWaveZones(db: AppDb, competitionId: string, categoryId: string): Promise<void> {
  const cats = await listCategories(db, competitionId);
  const plan = await passagePlan(db, competitionId, cats);
  const wave = cats.find((c) => c.id === categoryId)?.waveId ?? null;
  for (const c of cats) {
    const zoneId = plan.categories[c.id]?.zoneId;
    if (c.waveId === wave && !c.zoneId && zoneId) db.update(categoryTable).set({ zoneId }).where(eq(categoryTable.id, c.id)).run();
  }
}
