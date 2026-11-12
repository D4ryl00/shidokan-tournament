import { eq } from 'drizzle-orm';
import { defaultSchedule } from '../../domain/schedule/durations.js';
import { waveKey } from '../../domain/passages/index.js';
import type { PublicCompetition, PublicCompetitionSummary } from '../../domain/public/types.js';
import { publicPhase, toPublicCompetition, todayInParis, type PublicCategoryResults, type PublicSource } from '../../domain/public/view.js';
import type { AppDb } from '../db/client.js';
import { clubs, competitions, fighters, registrations } from '../db/schema.js';
import { readCategories } from '../repositories/categories.js';
import { getCompetition, getGrid, listCompetitions } from '../repositories/competitions.js';
import { launchedCategoryIds, launchedWaveKeys } from '../repositories/launch-state.js';
import { listWaveFinals } from '../repositories/wave-finals.js';
import { listWaveSchedules } from '../repositories/wave-schedules.js';
import { passagePlan } from '../repositories/passages.js';
import { getResults } from '../repositories/results.js';
import { listWaves } from '../repositories/waves.js';
import { listZones } from '../repositories/zones.js';

/** Vrai seulement pour une compétition qui existe et qui est publique. */
export function isPublicCompetition(db: AppDb, id: string): boolean {
  return db.select({ visibility: competitions.visibility }).from(competitions).where(eq(competitions.id, id)).get()?.visibility === 'public';
}

/** Une vague lancée (vague implicite '' pour une compétition sans vague), comme dans la vue publique. */
function anyWaveLaunched(waves: { id: string }[], launched: Set<string>): boolean {
  return waves.length === 0 ? launched.has(waveKey(null)) : waves.some((w) => launched.has(w.id));
}

/** Heure du dernier résultat ou de la dernière note de kata, par catégorie. */
function lastResultAt(db: AppDb, competitionId: string): Record<string, string> {
  const rows = db.$client
    .prepare(
      `select category_id as c, max(updated_at) as t from (
         select category_id, updated_at from match_results where competition_id = ?
         union all select category_id, updated_at from kata_scores where competition_id = ?
       ) where updated_at is not null group by category_id`,
    )
    .all(competitionId, competitionId) as { c: string; t: string }[];
  return Object.fromEntries(rows.map((r) => [r.c, r.t]));
}

/** Heures de fin : par combat (`match_results.created_at`), par tour de kata (dernière note), pour les catégories données. */
function endedAtOf(db: AppDb, competitionId: string, categoryIds: Set<string>): PublicSource['endedAt'] {
  const out: PublicSource['endedAt'] = {};
  const of = (c: string) => (out[c] ??= { matches: {}, round1: null, final: null });
  const matches = db.$client.prepare('select category_id as c, match_id as m, created_at as t from match_results where competition_id = ?').all(competitionId) as { c: string; m: string; t: string }[];
  for (const r of matches) if (categoryIds.has(r.c)) of(r.c).matches[r.m] = r.t;
  const kata = db.$client
    .prepare('select category_id as c, round as r, max(updated_at) as t from kata_scores where competition_id = ? group by category_id, round')
    .all(competitionId) as { c: string; r: 'round1' | 'final'; t: string | null }[];
  for (const r of kata) if (categoryIds.has(r.c) && r.t) of(r.c)[r.r] = r.t;
  return out;
}

/**
 * Données d'une compétition publique, lues champ par champ pour la vue publique ; null si elle est inconnue ou privée.
 * Seules les catégories numérotées dans une vague lancée ont leurs résultats chargés. Rien n'est écrit (pas de
 * synchronisation des catégories) : une lecture publique ne change pas l'empreinte de la compétition.
 */
export async function loadPublicSource(db: AppDb, id: string, now: Date): Promise<PublicSource | null> {
  const competition = db
    .select({ id: competitions.id, name: competitions.name, date: competitions.date, location: competitions.location, visibility: competitions.visibility })
    .from(competitions)
    .where(eq(competitions.id, id))
    .get();
  if (!competition || competition.visibility !== 'public') return null;
  // Lecture seule : aucune écriture sans session (les catégories d'une vague lancée sont figées de toute façon).
  const categories = await readCategories(db, id);
  const launched = launchedCategoryIds(db, id);
  const results: Record<string, PublicCategoryResults> = {};
  for (const c of categories) {
    if (!c.bracket || !launched.has(c.id)) continue;
    const r = await getResults(db, id, c.id);
    results[c.id] = { records: r.records, kataScores: r.kataScores, tieBreaks: r.tieBreaks };
  }
  const settings = (await getCompetition(db, id))?.settings;
  return {
    today: todayInParis(now),
    competition: { id: competition.id, name: competition.name, date: competition.date, location: competition.location },
    waves: (await listWaves(db, id)).map((w) => ({ id: w.id, name: w.name, order: w.order })),
    launchedWaveKeys: launchedWaveKeys(db, id),
    zones: (await listZones(db, id)).map((z) => ({ id: z.id, name: z.name, order: z.order })),
    fighters: db
      .select({ id: fighters.id, lastName: fighters.lastName, firstName: fighters.firstName, clubId: fighters.clubId, publicNameHidden: fighters.publicNameHidden })
      .from(fighters)
      .where(eq(fighters.competitionId, id))
      .all(),
    clubs: db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.competitionId, id)).all(),
    registrations: db.select({ id: registrations.id, fighterId: registrations.fighterId }).from(registrations).where(eq(registrations.competitionId, id)).all(),
    categories,
    results,
    lastResultAt: lastResultAt(db, id),
    plan: await passagePlan(db, id, categories),
    launchedCategoryIds: launched,
    finalsZones: Object.fromEntries(listWaveFinals(db, id).map((w) => [w.waveKey, w.finalsZoneId])),
    schedule: settings?.schedule ?? defaultSchedule(),
    triathlonRounds: settings?.triathlonRounds ?? 3,
    grid: await getGrid(db, id),
    waveSchedules: listWaveSchedules(db, id),
    endedAt: endedAtOf(db, id, launched),
  };
}

/** Vue publique d'une compétition ; null si elle est inconnue ou privée. */
export async function loadPublicCompetition(db: AppDb, id: string, now: Date): Promise<PublicCompetition | null> {
  const src = await loadPublicSource(db, id, now);
  return src ? toPublicCompetition(src) : null;
}

export interface PublicList {
  today: PublicCompetitionSummary[];
  upcoming: PublicCompetitionSummary[];
  past: PublicCompetitionSummary[];
}

/** Compétitions publiques : aujourd'hui et à venir par date croissante, historique de la plus récente à la plus ancienne. */
export async function loadPublicList(db: AppDb, now: Date): Promise<PublicList> {
  const today = todayInParis(now);
  const out: PublicList = { today: [], upcoming: [], past: [] };
  for (const c of await listCompetitions(db)) {
    if (c.visibility !== 'public') continue;
    const sessions = await listWaves(db, c.id);
    const launched = anyWaveLaunched(sessions, launchedWaveKeys(db, c.id));
    const phase = publicPhase(c.date, today, launched);
    const planned = new Map(listWaveSchedules(db, c.id).map((w) => [w.waveId, w.plannedStart]));
    // Sans session : une entrée « Session unique » si elle a une heure prévue.
    const waves = sessions.length === 0
      ? (planned.get(null) ? [{ name: 'Session unique', plannedStart: planned.get(null) ?? null }] : [])
      : [...sessions].sort((a, b) => a.order - b.order).map((w) => ({ name: w.name, plannedStart: planned.get(w.id) ?? null }));
    out[phase].push({ id: c.id, name: c.name, date: c.date, location: c.location, phase, launched, waves });
  }
  const byDate = (a: PublicCompetitionSummary, b: PublicCompetitionSummary) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'fr');
  out.today.sort(byDate);
  out.upcoming.sort(byDate);
  out.past.sort((a, b) => byDate(b, a));
  return out;
}
