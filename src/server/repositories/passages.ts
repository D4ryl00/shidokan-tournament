import { and, eq, inArray } from 'drizzle-orm';
import type { Bracket } from '../../domain/brackets/index.js';
import { resolveKata, type KataScores } from '../../domain/brackets/kata.js';
import { activeEntrantCount, type Category } from '../../domain/categories.js';
import type { StoredFinals } from '../../domain/passages/finals-choice.js';
import { finalMatchIds, kataFinaleKey, kataTour1Key, planPassages, type FrozenPassage, type PassagePlan, type PlanInput } from '../../domain/passages/index.js';
import { ageGroupOf, combatTiming, fightSeconds } from '../../domain/schedule/durations.js';
import type { AppDb } from '../db/client.js';
import { categories as categoryTable, frozenPassages, kataScores, matchResults, registrations, tieBreaks } from '../db/schema.js';
import { listCategories } from './categories.js';
import { getCompetition, getGrid } from './competitions.js';
import { NotFoundError } from './registrations.js';
import { listWaves } from './waves.js';
import { listZones } from './zones.js';
import { launchRows } from './launch-state.js';
import { listWaveFinals } from './wave-finals.js';

/**
 * Numéros figés des vagues lancées au moins une fois. `match_id` gardé tel quel : une ancienne clé de bloc de kata ('kata',
 * 'kata:tour1', 'kata:finale') ne correspond plus aux clés par kataka, la catégorie devient « à numéroter ».
 */
export function loadFrozen(db: AppDb, competitionId: string): FrozenPassage[] {
  return db
    .select()
    .from(frozenPassages)
    .where(eq(frozenPassages.competitionId, competitionId))
    .all()
    .map((r) => ({
      waveKey: r.waveKey,
      zoneId: r.zoneId,
      number: r.number,
      categoryId: r.categoryId,
      matchId: r.matchId,
      noRest: r.noRest,
      finalsChoice: r.finalsChoice,
    }));
}

/**
 * Passages joués (clé `${categoryId}:${matchId}`) : combat avec un résultat saisi ; kataka du tour 1 avec au moins une note
 * `round1`, ou absent (absent tardif : son passage ne se jouera pas) ; place k de la finale quand le k-ième finaliste
 * (`resolveKata`, notes et départages lus comme `getResults`) a au moins une note `final`.
 */
export function playedKeys(db: AppDb, competitionId: string): Set<string> {
  const out = new Set<string>();
  const cats = db.select({ id: categoryTable.id, bracketJson: categoryTable.bracketJson }).from(categoryTable).where(eq(categoryTable.competitionId, competitionId)).all();
  if (cats.length === 0) return out;
  const ids = cats.map((c) => c.id);
  for (const r of db.select({ categoryId: matchResults.categoryId, matchId: matchResults.matchId }).from(matchResults).where(inArray(matchResults.categoryId, ids)).all()) {
    out.add(`${r.categoryId}:${r.matchId}`);
  }
  const scores = new Map<string, KataScores>();
  for (const r of db.select().from(kataScores).where(inArray(kataScores.categoryId, ids)).all()) {
    if (!scores.has(r.categoryId)) scores.set(r.categoryId, { round1: {}, final: {} });
    scores.get(r.categoryId)![r.round][r.registrationId] = JSON.parse(r.notesJson) as number[];
  }
  const ties = new Map<string, { kata: string[]; kataFinal: string[] }>();
  for (const t of db.select().from(tieBreaks).where(and(inArray(tieBreaks.categoryId, ids), inArray(tieBreaks.scope, ['kata', 'kata:final']))).all()) {
    if (!ties.has(t.categoryId)) ties.set(t.categoryId, { kata: [], kataFinal: [] });
    ties.get(t.categoryId)![t.scope === 'kata' ? 'kata' : 'kataFinal'] = JSON.parse(t.orderJson) as string[];
  }
  // Absents de chaque catégorie (même règle que `Category.absentIds` : inscrit de la catégorie marqué absent).
  const absent = new Set(
    db.select({ id: registrations.id }).from(registrations).where(and(inArray(registrations.categoryId, ids), eq(registrations.presence, 'absent'))).all().map((r) => r.id),
  );
  const noted = (notes: number[] | undefined) => (notes ?? []).length > 0;
  for (const c of cats) {
    const bracket = c.bracketJson ? (JSON.parse(c.bracketJson) as Bracket) : null;
    if (bracket?.kind !== 'kata') continue;
    const s = scores.get(c.id) ?? { round1: {}, final: {} };
    for (const rid of bracket.order) if (noted(s.round1[rid]) || absent.has(rid)) out.add(`${c.id}:${kataTour1Key(rid)}`);
    const tb = ties.get(c.id) ?? { kata: [], kataFinal: [] };
    resolveKata(bracket, s, tb.kata, tb.kataFinal).finalists.slice(0, 2).forEach((rid, i) => {
      if (noted(s.final[rid])) out.add(`${c.id}:${kataFinaleKey((i + 1) as 1 | 2)}`);
    });
  }
  return out;
}

/** « Où » et « Quand » enregistrés de chaque catégorie de la compétition. */
function storedFinals(db: AppDb, competitionId: string): Map<string, StoredFinals> {
  return new Map(
    db
      .select({ id: categoryTable.id, where: categoryTable.finalsWhere, when: categoryTable.finalsWhen })
      .from(categoryTable)
      .where(eq(categoryTable.competitionId, competitionId))
      .all()
      .map((r) => [r.id, { where: r.where, when: r.when }]),
  );
}

/**
 * Entrée du plan de passage : catégories (rang : « Ordre » saisi, puis ordre de la grille ; choix des finales), zones,
 * vagues et leurs finales, numéros figés, réglages, durées estimées des passages (celles du mode spectateur).
 * `cats` : catégories déjà lues (évite une seconde synchronisation) ; `restart` : vagues numérotées à partir de 1.
 */
export async function planInput(db: AppDb, competitionId: string, cats?: Category[], restart: string[] = []): Promise<PlanInput> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  cats ??= await listCategories(db, competitionId);
  const ranked = cats.map((c, i) => ({ c, i })).sort((x, y) => x.c.order - y.c.order || x.i - y.i);
  const { settings } = competition;
  const grid = await getGrid(db, competitionId);
  const finals = storedFinals(db, competitionId);
  const byId = new Map(cats.map((c) => [c.id, c]));
  // Durée d'un passage : combat (rounds et repos) changement compris ; kataka, avec le changement seulement au premier
  // passage de chaque tour (premier du tirage, place 1 de la finale).
  const finalIds = new Map<string, Set<string>>();
  const durationSec = (categoryId: string, matchId: string): number => {
    const c = byId.get(categoryId);
    if (!c) return settings.schedule.changeoverSec;
    if (c.bracket?.kind === 'kata') {
      const first = c.bracket.order[0];
      const opensRound = (first !== undefined && matchId === kataTour1Key(first)) || matchId === kataFinaleKey(1);
      return settings.schedule.kataPassageSec + (opensRound ? settings.schedule.changeoverSec : 0);
    }
    let ids = finalIds.get(c.id);
    if (!ids) finalIds.set(c.id, (ids = new Set(c.bracket?.kind === 'combat' ? finalMatchIds(c.bracket) : [])));
    const isFinal = ids.has(matchId);
    return fightSeconds(combatTiming(settings, ageGroupOf(c.key, grid), c.durations, matchId, isFinal)) + settings.schedule.changeoverSec;
  };
  return {
    categories: ranked.map(({ c }, rank) => ({
      id: c.id,
      waveId: c.waveId,
      discipline: c.key.discipline,
      pinnedZoneId: c.zoneId,
      rank,
      bracket: c.bracket,
      playable: !!c.bracket && activeEntrantCount(c) >= 2,
      finals: finals.get(c.id) ?? { where: null, when: null },
    })),
    zones: (await listZones(db, competitionId)).map((z) => ({ id: z.id, order: z.order, disciplines: z.disciplines, finalsOnly: z.finalsOnly })),
    waves: await listWaves(db, competitionId),
    mode: competition.settings.passageOrder,
    frozen: loadFrozen(db, competitionId),
    // « Reprendre les numéros à 1 » choisi au lancement des vagues figées, et celui de l'aperçu.
    restart: [...restart, ...[...launchRows(db, competitionId).values()].filter((r) => r.restartNumbering).map((r) => r.waveKey)],
    waveFinals: listWaveFinals(db, competitionId),
    durationSec,
    played: playedKeys(db, competitionId),
  };
}

/** Zones (épinglées ou réparties) et numéros de passage de toute la compétition : figés pour les vagues lancées, en direct sinon. */
export async function passagePlan(db: AppDb, competitionId: string, cats?: Category[], restart: string[] = []): Promise<PassagePlan> {
  return planPassages(await planInput(db, competitionId, cats, restart));
}

/** Numéro de chaque passage (clé `${categoryId}:${matchId}` : combat, ou `kata:tour1:<rid>` / `kata:finale:1|2`). */
export function passageNumbers(plan: PassagePlan): Map<string, number> {
  return new Map(plan.zones.flatMap((z) => z.passages.map((p) => [`${p.categoryId}:${p.matchId}`, p.number] as const)));
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
